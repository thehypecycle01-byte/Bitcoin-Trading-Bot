import { EventEmitter } from 'events';
import WebSocket from 'ws';

/**
 * Bybit v5 WebSocket message structure
 */
interface BybitMessage {
  success?: boolean;
  ret_msg?: string;
  op?: string;
  conn_id?: string;
  req_id?: string;
  type?: string;
  topic?: string;
  id?: string;
  data?: Record<string, any> | Record<string, any>[];
}

/**
 * Bybit ticker snapshot/delta structure
 */
interface BybitTicker {
  symbol: string;
  lastPrice: string;
  bid1Price: string;
  ask1Price: string;
  lastTickTime: string;
  volume24h?: string;
  turnover24h?: string;
  price24hPcnt?: string;
  usdIndexPrice?: string;
}

/**
 * Standardized market data update for trading bot
 */
export interface MarketDataUpdate {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
  volume24h?: number;
}

/**
 * Reconnection configuration
 */
interface ReconnectConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Production-grade Bybit WebSocket client for v5 API
 * Features:
 *  - Robust connection management with exponential backoff
 *  - Subscription state preservation across reconnects
 *  - Heartbeat (ping/pong) to keep connection alive
 *  - Strong TypeScript typing
 *  - Comprehensive event system
 *  - Reliable message handling
 */
export class BybitWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private manuallyDisconnected: boolean = false;

  // Reconnection state
  private reconnectAttempts: number = 0;
  private reconnectConfig: ReconnectConfig;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectTimers: Set<NodeJS.Timeout> = new Set();
  
  // Subscription management
  private activeSubscriptions: Set<string> = new Set();
  private pendingSubscriptions: Set<string> = new Set();
  private resubscribeTimers: Set<NodeJS.Timeout> = new Set();
  
  // Heartbeat management
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 20000; // 20 seconds
  private readonly HEARTBEAT_TIMEOUT = 5000; // 5 second timeout for pong

  // Reconnection lock
  private isReconnecting: boolean = false;

  // Message rate limiting
  private lastEmitTime: Map<string, number> = new Map();
  private readonly MIN_EMIT_INTERVAL = 50; // 20 updates per second max

  constructor(
    testnet: boolean = true,
    reconnectConfig?: Partial<ReconnectConfig>
  ) {
    super();
    
    this.url = testnet
      ? 'wss://stream-testnet.bybit.com/v5/public/spot'
      : 'wss://stream.bybit.com/v5/public/spot';
    
    this.reconnectConfig = {
      maxAttempts: 10,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 1.5,
      ...reconnectConfig
    };

    this.on('error', (error) => {
      console.error('[BybitWS] Error:', error);
    });
  }

  /**
   * Connect to Bybit WebSocket
   */
  connect(): Promise<void> {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      console.warn('[BybitWS] Already connected');
      if (!this.connectPromise) {
        this.connectPromise = Promise.resolve();
      }
      return this.connectPromise;
    }

    if (this.isConnecting && this.connectPromise) {
      console.warn('[BybitWS] Connection already in progress');
      return this.connectPromise;
    }

    this.isConnecting = true;
    this.manuallyDisconnected = false;

    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const cleanupConnectState = (): void => {
        this.isConnecting = false;
        this.connectPromise = null;
      };

      const onResolved = (): void => {
        if (settled) return;
        settled = true;
        cleanupConnectState();
        resolve();
      };

      const onRejected = (error: Error | WebSocket.ErrorEvent): void => {
        if (settled) return;
        settled = true;
        cleanupConnectState();
        reject(error);
      };

      try {
        console.log(`[BybitWS] Connecting to ${this.url}`);

        // Prevent event listener memory leak and stale connection objects
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
          this.ws.removeAllListeners();
          this.ws.terminate();
        }

        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        const wsRef = this.ws;

        this.ws.on('open', () => {
          if (this.ws !== wsRef) return; // ignore stale open events

          console.log('[BybitWS] Connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.isReconnecting = false;

          this.startHeartbeat();
          this.resubscribeAll();

          this.emit('connected');
          onResolved();
        });

        this.ws.on('message', (data: Buffer | ArrayBuffer) => {
          if (this.ws !== wsRef || this.ws?.readyState !== WebSocket.OPEN) return;
          this.handleMessage(data);
        });

        this.ws.on('error', (error: WebSocket.ErrorEvent) => {
          if (this.ws !== wsRef) return;
          console.error('[BybitWS] WebSocket error:', error);
          this.emit('error', error);
          onRejected(error);
        });

        this.ws.on('close', () => {
          if (this.ws !== wsRef) return;
          console.log('[BybitWS] Disconnected');

          this.isConnected = false;
          this.stopHeartbeat();
          this.emit('disconnected');

          if (!settled) {
            onRejected(new Error('WebSocket closed before open'));
          }

          if (!this.isReconnecting) {
            this.scheduleReconnect();
          }
        });
      } catch (error) {
        console.error('[BybitWS] Connection failed:', error);
        onRejected(error as Error);
      }
    });

    return this.connectPromise;
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: Buffer | ArrayBuffer): void {
    try {
      // Convert buffer to string
      let rawData: string;
      
      if (data instanceof ArrayBuffer) {
        rawData = new TextDecoder().decode(data);
      } else if (Buffer.isBuffer(data)) {
        rawData = data.toString('utf-8');
      } else {
        rawData = String(data);
      }

      // Guard against excessively large messages (1MB limit)
      if (rawData.length > 1024 * 1024) {
        console.warn('[BybitWS] Ignoring oversized message');
        return;
      }

      // Safe JSON parsing guard
      if (!rawData) return;

      let message: BybitMessage;
      try {
        message = JSON.parse(rawData);
      } catch (error) {
        console.warn('[BybitWS] Ignoring malformed message', rawData);
        return;
      }

      // Handle subscription confirmations
      if (message.success !== undefined) {
        if (message.success) {
          console.log(`[BybitWS] Subscription confirmed: ${message.ret_msg}`);
        } else {
          console.error(`[BybitWS] Subscription failed: ${message.ret_msg}`);
        }
        return;
      }

      // Handle pong response from Bybit heartbeat
      if (message.op === 'pong') {
        console.log('[BybitWS] Received pong');
        this.clearHeartbeatTimeout();
        return;
      }

      // Safe message guards
      if (!message.topic || !message.data) return;

      // Handle ticker data (real-time market updates)
      if (message.topic.startsWith('tickers.')) {
        this.processTicker(message);
        return;
      }

    } catch (error) {
      console.error('[BybitWS] Error parsing message:', error);
    }
  }

  /**
   * Process ticker message and emit market data update
   */
  private processTicker(message: BybitMessage): void {
    try {
      if (!message.data) return;

      // Improve symbol extraction safety
      if (!message.topic || !message.topic.startsWith('tickers.')) return;
      const parts = message.topic.split('.');
      if (parts.length < 2 || !parts[1]) return;
      const symbol = parts[1].toUpperCase();

      // Rate limiting - limit to max 20 updates per second per symbol
      const now = Date.now();
      const last = this.lastEmitTime.get(symbol) || 0;

      if (now - last < this.MIN_EMIT_INTERVAL) return;

      this.lastEmitTime.set(symbol, now);

      // Handle both array and object formats from Bybit
      const ticker = Array.isArray(message.data) 
        ? message.data[0] as BybitTicker
        : message.data as BybitTicker;

      if (!ticker || !ticker.lastPrice) {
        return;
      }

      // Use exchange timestamp instead of local time
      const timestampRaw = ticker.lastTickTime ? parseInt(ticker.lastTickTime) : Date.now();
      const timestamp = isFinite(timestampRaw) ? timestampRaw : Date.now();

      // Add NaN / Invalid Price Protection
      const price = parseFloat(ticker.lastPrice);
      const bid = parseFloat(ticker.bid1Price || ticker.lastPrice);
      const ask = parseFloat(ticker.ask1Price || ticker.lastPrice);

      if (!isFinite(price) || !isFinite(bid) || !isFinite(ask)) return;

      const update: MarketDataUpdate = {
        symbol,
        price,
        bid,
        ask,
        timestamp,
        volume24h: ticker.volume24h ? parseFloat(ticker.volume24h) : undefined
      };

      // Emit price update
      this.emit('priceUpdate', update);

      // Emit latency metric (optional but recommended for monitoring)
      const latency = now - timestamp;
      if (latency >= 0) {
        this.emit('latency', latency);
      }
    } catch (error) {
      console.error('[BybitWS] Error processing ticker:', error);
    }
  }

  /**
   * Subscribe to one or more symbols
   */
  subscribe(symbols: string | string[]): void {
    const symbolArray = Array.isArray(symbols) ? symbols : [symbols];
    
    symbolArray.forEach((symbol) => {
      symbol = symbol.toUpperCase();
      
      if (this.activeSubscriptions.has(symbol)) {
        console.log(`[BybitWS] Already subscribed to ${symbol}`);
        return;
      }

      if (this.isConnected) {
        this.sendSubscription(symbol, 'subscribe');
        this.activeSubscriptions.add(symbol);
      } else {
        // Queue for subscription after reconnect
        this.pendingSubscriptions.add(symbol);
      }
    });
  }

  /**
   * Unsubscribe from symbols
   */
  unsubscribe(symbols: string | string[]): void {
    const symbolArray = Array.isArray(symbols) ? symbols : [symbols];
    
    symbolArray.forEach((symbol) => {
      symbol = symbol.toUpperCase();
      
      this.activeSubscriptions.delete(symbol);
      this.pendingSubscriptions.delete(symbol);
      this.lastEmitTime.delete(symbol);

      if (this.isConnected) {
        this.sendSubscription(symbol, 'unsubscribe');
      }
    });
  }

  /**
   * Send subscription message to WebSocket
   */
  private sendSubscription(symbol: string, op: 'subscribe' | 'unsubscribe'): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[BybitWS] Cannot send ${op} - WebSocket not connected`);
      return;
    }

    const message = {
      op,
      args: [`tickers.${symbol}`]
    };

    try {
      this.ws.send(JSON.stringify(message));
      console.log(`[BybitWS] Sent ${op} for ${symbol}`);
    } catch (error) {
      console.error(`[BybitWS] Error sending ${op}:`, error);
    }
  }

  /**
   * Resubscribe to all active subscriptions (used after reconnect)
   */
  private resubscribeAll(): void {
    console.log(`[BybitWS] Resubscribing to ${this.activeSubscriptions.size + this.pendingSubscriptions.size} symbols`);

    this.pendingSubscriptions.forEach((symbol) => {
      this.activeSubscriptions.add(symbol);
    });
    this.pendingSubscriptions.clear();

    let delay = 0;
    this.activeSubscriptions.forEach((symbol) => {
      const timer = setTimeout(() => {
        this.resubscribeTimers.delete(timer);
        this.sendSubscription(symbol, 'subscribe');
      }, delay);

      this.resubscribeTimers.add(timer);
      delay += 50;
    });
  }

  /**
   * Start heartbeat (ping) mechanism - Bybit compatible
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.isReconnecting || !this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        this.ws.send(JSON.stringify({ op: 'ping' }));
        console.log('[BybitWS] Sent ping');

        this.clearHeartbeatTimeout();

        this.heartbeatTimeout = setTimeout(() => {
          if (this.isReconnecting) return;
          console.warn('[BybitWS] No pong received - reconnecting');
          this.reconnect();
        }, this.HEARTBEAT_TIMEOUT);
      } catch (error) {
        console.error('[BybitWS] Error sending heartbeat:', error);
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clearHeartbeatTimeout();
  }

  /**
   * Clear heartbeat timeout
   */
  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.manuallyDisconnected) return;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      console.error('[BybitWS] Max reconnection attempts reached');
      this.emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;

    const delay = Math.min(
      this.reconnectConfig.initialDelay * Math.pow(this.reconnectConfig.backoffMultiplier, this.reconnectAttempts - 1),
      this.reconnectConfig.maxDelay
    );

    console.log(`[BybitWS] Scheduled reconnect attempt ${this.reconnectAttempts}/${this.reconnectConfig.maxAttempts} in ${delay}ms`);
    this.emit('reconnectAttempt', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimers.delete(this.reconnectTimeout as NodeJS.Timeout);
      this.reconnectTimeout = null;
      this.reconnect();
    }, delay);

    if (this.reconnectTimeout) {
      this.reconnectTimers.add(this.reconnectTimeout);
    }
  }

  /**
   * Attempt to reconnect - prevents multiple simultaneous reconnect attempts
   */
  private reconnect(): void {
    if (this.isReconnecting || this.isConnecting) return;
    this.isReconnecting = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimers.delete(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    for (const timer of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch {}
      this.ws = null;
    }

    console.log(`[BybitWS] Reconnecting (attempt ${this.reconnectAttempts})`);

    this.connect()
      .then(() => {
        this.isReconnecting = false;
      })
      .catch((error) => {
        console.error('[BybitWS] Reconnection failed:', error);
        this.isReconnecting = false;

        if (!this.isConnected) {
          this.scheduleReconnect();
        }
      });
  }

  /**
   * Gracefully disconnect
   */
  disconnect(): void {
    console.log('[BybitWS] Disconnecting');

    this.isReconnecting = false;
    this.isConnecting = false;
    this.manuallyDisconnected = true;

    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    for (const timer of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    for (const timer of this.resubscribeTimers) {
      clearTimeout(timer);
    }
    this.resubscribeTimers.clear();

    this.lastEmitTime.clear();

    this.activeSubscriptions.clear();
    this.pendingSubscriptions.clear();

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close(1000, 'Normal closure');
      } catch (error) {
        console.error('[BybitWS] Error closing WebSocket:', error);
      }
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Check if connected
   */
  isConnectedToWS(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.activeSubscriptions);
  }

  /**
   * Get connection status
   */
  getStatus(): {
    connected: boolean;
    subscriptions: string[];
    reconnectAttempts: number;
  } {
    return {
      connected: this.isConnected,
      subscriptions: this.getSubscriptions(),
      reconnectAttempts: this.reconnectAttempts
    };
  }
}
