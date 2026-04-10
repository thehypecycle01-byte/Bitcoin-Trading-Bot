import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export interface OrderParams {
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'Market' | 'Limit';
  quantity: number;
  price?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}

export interface Order {
  orderId: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  status: string;
  timestamp: number;
  filledQuantity?: number;
}

export interface Position {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnL: number;
  roiPercentage: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}

export interface Market {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
}

export interface TPSLConfig {
  type: 'percentage' | 'price' | 'atr';
  takeProfit: number; // percentage (0.02 for 2%), price units, or ATR multiplier
  stopLoss: number;   // percentage (0.01 for 1%), price units, or ATR multiplier
}

export type BybitServiceEvent =
  | 'orderCreated'
  | 'orderFilled'
  | 'positionClosed'
  | 'orderFailed';

export class BybitService extends EventEmitter {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private orders: Map<string, Order> = new Map();
  private positions: Map<string, Position> = new Map();
  private placingOrderBySymbol: Map<string, boolean> = new Map();
  private lastRequestTime: number = 0;
  private requestInterval: number = 100; // 100ms minimum between requests
  private spreadThreshold: number = 0.01; // 1% max spread
  private tpSlConfigs: Map<string, TPSLConfig> = new Map();

  constructor(apiKey: string, apiSecret: string, testnet: boolean = true) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = testnet
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';
  }

  private generateSignature(
    timestamp: string,
    recv_window: string,
    queryString: string
  ): string {
    const message = timestamp + this.apiKey + recv_window + queryString;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('hex');
  }

  private buildHeaders(queryString: string = ''): Record<string, string> {
    const timestamp = Date.now().toString();
    const recv_window = '5000';
    const signature = this.generateSignature(timestamp, recv_window, queryString);

    return {
      'X-BAPI-KEY': this.apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recv_window,
      'Content-Type': 'application/json'
    };
  }

  private async throttleRequest(): Promise<void> {
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.requestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.requestInterval - timeSinceLast));
    }
    this.lastRequestTime = Date.now();
  }

  private async request<T>(
    config: AxiosRequestConfig,
    retries: number = 3,
    authenticated: boolean = false
  ): Promise<T> {
    await this.throttleRequest();

    let attempt = 0;
    const baseDelay = 500; // 500ms base delay

    while (attempt <= retries) {
      try {
        const requestConfig: AxiosRequestConfig = {
          ...config,
          timeout: 10000, // 10 second timeout
          baseURL: this.baseUrl
        };

        if (authenticated) {
          let signData = '';
          if (config.method === 'GET' && config.params) {
            signData = new URLSearchParams(config.params as Record<string, string>).toString();
          } else if (config.method === 'POST' && config.data) {
            signData = JSON.stringify(config.data);
          }
          requestConfig.headers = {
            ...requestConfig.headers,
            ...this.buildHeaders(signData)
          };
        }

        const response = await axios.request<T>(requestConfig);
        return response.data;
      } catch (error) {
        const axiosErr = error as AxiosError;

        if (axiosErr.response) {
          // API error
          const status = axiosErr.response.status;
          const message = (axiosErr.response.data as any)?.ret_msg || axiosErr.message;
          console.error(`[BybitService] API error (${status}): ${message}`);
          if (status >= 500 && attempt < retries) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
            continue;
          }
          throw new Error(`Bybit API error: ${status} ${message}`);
        } else if (axiosErr.code === 'ECONNABORTED' || axiosErr.request) {
          // Network error
          console.error(`[BybitService] Network error: ${axiosErr.message}`);
          if (attempt < retries) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
            continue;
          }
          throw new Error(`Bybit network error: ${axiosErr.message}`);
        } else {
          throw axiosErr;
        }
      }
    }

    throw new Error('Bybit request failed after retries');
  }

  async getMarketPrice(symbol: string = 'BTCUSDT'): Promise<Market> {
    const data = await this.request<{ result: { list: any[] } }>({
      method: 'GET',
      url: `/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`
    });

    const ticker = data.result?.list?.[0];
    if (!ticker) throw new Error('Bybit market ticker missing');

    const price = parseFloat(ticker.lastPrice);
    const bid = parseFloat(ticker.bid1Price || ticker.lastPrice);
    const ask = parseFloat(ticker.ask1Price || ticker.lastPrice);

    if (!isFinite(price) || !isFinite(bid) || !isFinite(ask)) {
      throw new Error('Bybit ticker invalid numeric values');
    }

    return {
      symbol,
      price,
      bid,
      ask,
      timestamp: Date.now()
    };
  }

  async getKlines(
    symbol: string = 'BTCUSDT',
    interval: string = '5',
    limit: number = 200
  ): Promise<any[]> {
    const data = await this.request<{ result: { list: any[] } }>({
      method: 'GET',
      url: `/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
    });

    return (data.result?.list || []).map((kline: any[]) => ({
      timestamp: parseInt(kline[0], 10),
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5])
    })).reverse();
  }

  async placeOrder(params: OrderParams): Promise<Order> {
    if (this.placingOrderBySymbol.get(params.symbol)) {
      throw new Error(`Order placement in progress for ${params.symbol}`);
    }

    if (!params.symbol || !params.side || !params.orderType || params.quantity <= 0) {
      throw new Error('Invalid order params');
    }

    if (params.orderType === 'Limit' && (params.price === undefined || params.price <= 0)) {
      throw new Error('Limit orders require valid price');
    }

    this.placingOrderBySymbol.set(params.symbol, true);

    try {
      // Check spread for slippage protection
      if (params.orderType === 'Market') {
        const market = await this.getMarketPrice(params.symbol);
        const spread = market.ask - market.bid;
        const spreadPct = (spread / market.ask) * 100;
        if (spreadPct > this.spreadThreshold * 100) {
          throw new Error(`Spread too wide (${spreadPct.toFixed(2)}% > ${(this.spreadThreshold * 100)}%)`);
        }
      }

      const orderData: any = {
        category: 'spot',
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType,
        qty: params.quantity.toString()
      };

      if (params.orderType === 'Limit' && params.price) {
        orderData.price = params.price.toString();
      }

      const response = await this.request<{ result: { orderId: string } }>(
        {
          method: 'POST',
          url: '/v5/order/create',
          data: orderData
        },
        3,
        true // authenticated
      );

      const orderId = response.result.orderId;
      const orderStatus = await this.getOrder(orderId, params.symbol);

      this.orders.set(orderId, orderStatus);
      this.emit('orderCreated', orderStatus);

      // Store TP/SL if provided or configured
      const tpSlConfig = this.getTPSLConfig(params.symbol);
      let takeProfitPrice = params.takeProfitPrice;
      let stopLossPrice = params.stopLossPrice;

      // For market orders without explicit TP/SL, try to get current market price
      const entryPrice = params.price || (await this.getMarketPrice(params.symbol)).ask;

      if (tpSlConfig && !takeProfitPrice && !stopLossPrice) {
        const prices = this.calculateTPSLPrices(entryPrice, tpSlConfig);
        takeProfitPrice = prices.takeProfit;
        stopLossPrice = prices.stopLoss;
      }

      if (takeProfitPrice || stopLossPrice) {
        const position: Position = {
          symbol: params.symbol,
          side: params.side,
          quantity: params.quantity,
          entryPrice: entryPrice,
          markPrice: 0,
          unrealizedPnL: 0,
          roiPercentage: 0,
          takeProfitPrice,
          stopLossPrice
        };
        this.positions.set(params.symbol, position);
      }

      return orderStatus;
    } catch (error) {
      console.error('Error placing order:', error);
      this.emit('orderFailed', { params, error });
      throw error;
    } finally {
      this.placingOrderBySymbol.set(params.symbol, false);
    }
  }

  async getOrder(orderId: string, symbol: string = 'BTCUSDT'): Promise<Order> {
    const data = await this.request<{ result: { list: any[] } }>(
      {
        method: 'GET',
        url: `/v5/order/realtime?category=spot&orderId=${encodeURIComponent(orderId)}`
      },
      3,
      true // authenticated
    );

    const found = (data.result?.list || [])[0];
    if (!found) {
      throw new Error(`Order not found ${orderId}`);
    }

    const order: Order = {
      orderId: found.orderId,
      symbol: found.symbol,
      side: found.side,
      quantity: parseFloat(found.qty),
      price: parseFloat(found.price || 0),
      status: found.orderStatus,
      timestamp: parseInt(found.createdTime, 10),
      filledQuantity: parseFloat(found.cumExecQty || 0)
    };

    // Handle partial fills and full fills
    if (order.status === 'Filled' || order.status === 'PartiallyFilled') {
      this.emit('orderFilled', order);
    }

    this.orders.set(orderId, order);
    return order;
  }

  async getPositions(): Promise<Position[]> {
    try {
      // For spot trading, use balances and executed orders to track positions
      const balance = await this.getBalance();
      const positions: Position[] = [];

      // Get all recent orders to determine positions
      const data = await this.request<{ result: { list: any[] } }>(
        {
          method: 'GET',
          url: '/v5/order/realtime?category=spot&limit=50'
        },
        3,
        true
      );

      const orders = data.result?.list || [];

      // Group orders by symbol and calculate net position
      const positionMap = new Map<string, { quantity: number; entryPrice: number; totalCost: number }>();

      orders.forEach((order: any) => {
        if (order.orderStatus === 'Filled' || order.orderStatus === 'PartiallyFilled') {
          const symbol = order.symbol;
          const side = order.side;
          const qty = parseFloat(order.cumExecQty);
          const price = parseFloat(order.avgPrice || order.price);

          if (!positionMap.has(symbol)) {
            positionMap.set(symbol, { quantity: 0, entryPrice: 0, totalCost: 0 });
          }

          const pos = positionMap.get(symbol)!;

          if (side === 'Buy') {
            pos.quantity += qty;
            pos.totalCost += qty * price;
          } else {
            pos.quantity -= qty;
            pos.totalCost -= qty * price;
          }
        }
      });

      // Convert to Position objects
      positionMap.forEach((pos, symbol) => {
        if (Math.abs(pos.quantity) > 0.000001) { // Ignore dust
          const entryPrice = pos.totalCost / pos.quantity;
          const currentPrice = 0; // Would need to get from market data
          const side = pos.quantity > 0 ? 'Buy' : 'Sell';

          positions.push({
            symbol,
            side,
            quantity: Math.abs(pos.quantity),
            entryPrice,
            markPrice: currentPrice,
            unrealizedPnL: 0, // Calculate if needed
            roiPercentage: 0
          });
        }
      });

      // Sync local positions map
      this.positions.clear();
      positions.forEach((position) => {
        this.positions.set(position.symbol, position);
      });

      return positions;
    } catch (error) {
      console.error('Error getting positions:', error);
      return [];
    }
  }

  // Monitor all positions with current market price (call this from WebSocket price updates)
  async monitorPositions(currentPrices: Record<string, number>): Promise<void> {
    for (const [symbol, price] of Object.entries(currentPrices)) {
      await this.handleTakeProfitStopLoss(price, symbol);
    }
  }

  // Get live PnL for open positions (requires current market prices)
  async getLivePnL(): Promise<{ symbol: string; pnl: number; pnlPercent: number }[]> {
    try {
      const pnlData: { symbol: string; pnl: number; pnlPercent: number }[] = [];

      for (const [symbol, position] of this.positions) {
        try {
          const market = await this.getMarketPrice(symbol);
          let pnl = 0;

          if (position.side === 'Buy') {
            pnl = (market.price - position.entryPrice) * position.quantity;
          } else {
            pnl = (position.entryPrice - market.price) * position.quantity;
          }

          const pnlPercent = (pnl / (position.entryPrice * position.quantity)) * 100;

          pnlData.push({
            symbol,
            pnl,
            pnlPercent
          });
        } catch (error) {
          console.error(`[BybitService] Error calculating PnL for ${symbol}:`, error);
        }
      }

      return pnlData;
    } catch (error) {
      console.error('[BybitService] Error getting live PnL:', error);
      return [];
    }
  }

  // Get TP/SL configuration for a symbol
  getTPSLConfig(symbol: string): TPSLConfig | undefined {
    return this.tpSlConfigs.get(symbol);
  }

  // Calculate TP/SL prices based on config
  private calculateTPSLPrices(entryPrice: number, config: TPSLConfig): { takeProfit: number; stopLoss: number } {
    switch (config.type) {
      case 'percentage':
        return {
          takeProfit: entryPrice * (1 + config.takeProfit),
          stopLoss: entryPrice * (1 - config.stopLoss)
        };
      case 'price':
        return {
          takeProfit: entryPrice + config.takeProfit,
          stopLoss: entryPrice - config.stopLoss
        };
      case 'atr':
        // For ATR, we'd need ATR value, but for now return entry price (would need ATR calculation)
        console.warn('ATR-based TP/SL not fully implemented, using percentage fallback');
        return {
          takeProfit: entryPrice * (1 + 0.02), // 2% fallback
          stopLoss: entryPrice * (1 - 0.01)   // 1% fallback
        };
      default:
        throw new Error(`Unknown TP/SL type: ${config.type}`);
    }
  }

  async getBalance(): Promise<Record<string, number>> {
    try {
      const data = await this.request<{ result: { list: any[] } }>(
        {
          method: 'GET',
          url: '/v5/account/wallet-balance?accountType=UNIFIED'
        },
        3,
        true // authenticated
      );

      const balance: Record<string, number> = {};
      const coins = data.result?.list?.[0]?.coin || [];

      coins.forEach((coin: any) => {
        balance[coin.coin] = parseFloat(coin.walletBalance);
      });

      return balance;
    } catch (error) {
      console.error('Error getting balance:', error);
      return {};
    }
  }

  async cancelOrder(orderId: string, symbol: string = 'BTCUSDT'): Promise<void> {
    try {
      const orderData = {
        category: 'spot',
        symbol,
        orderId
      };

      await this.request(
        {
          method: 'POST',
          url: '/v5/order/cancel',
          data: orderData
        },
        3,
        true // authenticated
      );

      this.orders.delete(orderId);
    } catch (error) {
      console.error('Error canceling order:', error);
      throw error;
    }
  }

  async handleTakeProfitStopLoss(currentPrice: number, symbol: string = 'BTCUSDT'): Promise<void> {
    const position = this.positions.get(symbol);
    if (!position || position.quantity === 0) return;

    const config = this.getTPSLConfig(symbol);
    if (!config) return; // No TP/SL configured

    const { takeProfit, stopLoss } = this.calculateTPSLPrices(position.entryPrice, config);

    let shouldClose = false;
    let reason = '';

    if (position.side === 'Buy') {
      if (currentPrice >= takeProfit) {
        shouldClose = true;
        reason = 'Take Profit';
      } else if (currentPrice <= stopLoss) {
        shouldClose = true;
        reason = 'Stop Loss';
      }
    } else if (position.side === 'Sell') {
      if (currentPrice <= takeProfit) {
        shouldClose = true;
        reason = 'Take Profit';
      } else if (currentPrice >= stopLoss) {
        shouldClose = true;
        reason = 'Stop Loss';
      }
    }

    if (shouldClose) {
      try {
        await this.placeOrder({
          symbol,
          side: position.side === 'Buy' ? 'Sell' : 'Buy',
          orderType: 'Market',
          quantity: position.quantity
        });

        // Update position as closed
        position.quantity = 0;
        this.positions.set(symbol, position);

        this.emit('positionClosed', { symbol, position, reason, price: currentPrice });
      } catch (error) {
        console.error('[BybitService] TP/SL close position failed:', error);
      }
    }
  }
}
