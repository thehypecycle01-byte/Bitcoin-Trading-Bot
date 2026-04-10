import { BybitService, Order, TPSLConfig } from './bybit';
import { SignalEngine, Signal, CandleData } from './SignalEngine';
import { RiskManager, PositionSizeResult } from './RiskManager';
import { PortfolioManager, ActiveTrade, ClosedTrade } from './PortfolioManager';
import { AnalyticsService } from './AnalyticsService';

export interface TradeExecutionConfig {
  enabled: boolean;
  riskPercent: number; // 0.01 for 1%
  minConfidence: number; // 0-1, e.g., 0.6 for 60%
  maxConcurrentTrades: number;
  cooldownSeconds: number;
  maxDailyLossPercent: number;
}

export interface TradeResult {
  success: boolean;
  order?: Order;
  trade?: ActiveTrade;
  error?: string;
  reason: string;
}

export class TradeEngine {
  private bybitService: BybitService;
  private signalEngine: SignalEngine;
  private riskManager: RiskManager;
  private portfolioManager: PortfolioManager;
  private analyticsService: AnalyticsService;

  private config: TradeExecutionConfig = {
    enabled: false,
    riskPercent: 0.01,
    minConfidence: 0.6,
    maxConcurrentTrades: 5,
    cooldownSeconds: 30,
    maxDailyLossPercent: 0.05
  };

  private lastSignals: Map<string, Signal> = new Map();
  private isProcessing: boolean = false;

  constructor(
    bybitService: BybitService,
    initialEquity: number = 10000
  ) {
    this.bybitService = bybitService;
    this.signalEngine = new SignalEngine();
    this.riskManager = new RiskManager();
    this.portfolioManager = new PortfolioManager(initialEquity);
    this.analyticsService = new AnalyticsService();

    // Listen to bybit service events
    this.setupEventListeners();
  }

  /**
   * Configure trade execution parameters
   */
  configure(config: Partial<TradeExecutionConfig>): void {
    this.config = { ...this.config, ...config };
    this.portfolioManager.setMaxConcurrentTrades(this.config.maxConcurrentTrades);
    this.portfolioManager.setCooldownPeriod(this.config.cooldownSeconds * 1000);
    this.portfolioManager.setMaxDailyLossPercent(this.config.maxDailyLossPercent);
    console.log('[TradeEngine] Configuration updated:', this.config);
  }

  /**
   * Main entry point: Process price update from WebSocket
   */
  async onPriceUpdate(symbol: string, candles: CandleData[]): Promise<void> {
    if (this.isProcessing || !this.config.enabled) {
      return;
    }

    this.isProcessing = true;

    try {
      // Generate signal
      const signal = await this.signalEngine.generateSignal(symbol, candles);
      this.lastSignals.set(symbol, signal);

      console.log(
        `[TradeEngine] Signal for ${symbol}: ${signal.signal} (confidence: ${(
          signal.confidence * 100
        ).toFixed(1)}%) - ${signal.reason}`
      );

      // Check if signal meets minimum confidence
      if (
        (signal.signal === 'BUY' || signal.signal === 'SELL') &&
        signal.confidence < this.config.minConfidence
      ) {
        console.log(
          `[TradeEngine] Signal confidence (${(signal.confidence * 100).toFixed(
            1
          )}%) below minimum (${(this.config.minConfidence * 100).toFixed(1)}%)`
        );
        return;
      }

      // Handle positions and trades
      if (signal.signal === 'HOLD') {
        // Monitor existing positions for TP/SL
        await this.monitorPositions(symbol);
      } else if (signal.signal === 'BUY' || signal.signal === 'SELL') {
        // Try to execute new trade
        await this.executeTrade(symbol, signal);
      }
    } catch (error) {
      console.error('[TradeEngine] Error processing price update:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute a trade based on signal
   */
  private async executeTrade(symbol: string, signal: Signal): Promise<TradeResult> {
    try {
      // Check portfolio constraints
      const canTrade = this.portfolioManager.canOpenTrade(symbol);
      if (!canTrade.allowed) {
        console.log(`[TradeEngine] Cannot open trade: ${canTrade.reason}`);
        return {
          success: false,
          error: canTrade.reason,
          reason: 'Portfolio constraint'
        };
      }

      // Get market price
      const market = await this.bybitService.getMarketPrice(symbol);

      // Determine entry and SL
      let entryPrice = market.price;
      let stopLossPrice = 0;
      let side: 'Buy' | 'Sell' = 'Buy';

      if (signal.signal === 'BUY') {
        side = 'Buy';
        stopLossPrice = market.bid - market.bid * 0.01; // 1% SL
      } else {
        side = 'Sell';
        stopLossPrice = market.ask + market.ask * 0.01; // 1% SL
      }

      // Get balance
      const balance = await this.bybitService.getBalance();
      const usdtBalance = balance['USDT'] || balance['BUSD'] || 0;

      if (usdtBalance <= 0) {
        return {
          success: false,
          error: 'Insufficient balance',
          reason: 'No USDT balance available'
        };
      }

      // Calculate position size
      const positionSizeResult = this.riskManager.calculatePositionSize(
        usdtBalance,
        this.config.riskPercent,
        entryPrice,
        stopLossPrice,
        symbol
      );

      if (!positionSizeResult.valid) {
        return {
          success: false,
          error: positionSizeResult.reason,
          reason: 'Risk management validation failed'
        };
      }

      // Check daily loss limit
      if (!this.portfolioManager.checkDailyLossLimit(usdtBalance)) {
        return {
          success: false,
          error: 'Daily loss limit exceeded',
          reason: 'Risk management protection'
        };
      }

      // Place order
      const order = await this.bybitService.placeOrder({
        symbol,
        side,
        orderType: 'Market',
        quantity: positionSizeResult.positionSize,
        takeProfitPrice: positionSizeResult.takeProfit,
        stopLossPrice: positionSizeResult.stopLossPrice
      });

      // Record trade in portfolio
      const activeTrade: ActiveTrade = {
        symbol,
        orderId: order.orderId,
        side,
        entryPrice: positionSizeResult.entryPrice,
        quantity: positionSizeResult.positionSize,
        takeProfitPrice: positionSizeResult.takeProfit,
        stopLossPrice: positionSizeResult.stopLossPrice,
        entryTime: Date.now(),
        riskAmount: positionSizeResult.riskAmount
      };

      const added = this.portfolioManager.addTrade(activeTrade);
      if (!added) {
        console.warn('[TradeEngine] Failed to add trade to portfolio');
      }

      console.log(`[TradeEngine] Trade executed: ${symbol} ${side} | Size: ${positionSizeResult.positionSize} | Entry: ${positionSizeResult.entryPrice}`);

      return {
        success: true,
        order,
        trade: activeTrade,
        reason: `${signal.signal} trade executed on ${symbol}`
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TradeEngine] Trade execution failed:', errorMsg);
      return {
        success: false,
        error: errorMsg,
        reason: 'Trade execution error'
      };
    }
  }

  /**
   * Monitor open positions for TP/SL
   */
  private async monitorPositions(symbol: string): Promise<void> {
    const market = await this.bybitService.getMarketPrice(symbol);
    const trade = this.portfolioManager.getTrade(symbol);

    if (!trade) return;

    let shouldClose = false;
    let reason: 'TP' | 'SL' | 'MANUAL' = 'MANUAL';

    if (trade.side === 'Buy') {
      if (market.price >= trade.takeProfitPrice) {
        shouldClose = true;
        reason = 'TP';
      } else if (market.price <= trade.stopLossPrice) {
        shouldClose = true;
        reason = 'SL';
      }
    } else {
      if (market.price <= trade.takeProfitPrice) {
        shouldClose = true;
        reason = 'TP';
      } else if (market.price >= trade.stopLossPrice) {
        shouldClose = true;
        reason = 'SL';
      }
    }

    if (shouldClose) {
      await this.closeTrade(symbol, market.price, reason);
    }
  }

  /**
   * Close an open trade
   */
  async closeTrade(
    symbol: string,
    exitPrice: number,
    reason: 'TP' | 'SL' | 'MANUAL' = 'MANUAL'
  ): Promise<void> {
    try {
      const trade = this.portfolioManager.getTrade(symbol);
      if (!trade) {
        console.warn(`[TradeEngine] No open trade for ${symbol}`);
        return;
      }

      // Place close order
      await this.bybitService.placeOrder({
        symbol,
        side: trade.side === 'Buy' ? 'Sell' : 'Buy',
        orderType: 'Market',
        quantity: trade.quantity
      });

      // Record closed trade
      const closedTrade = this.portfolioManager.closeTrade(symbol, exitPrice, reason);
      if (closedTrade) {
        this.analyticsService.recordTrade(closedTrade);
      }

      console.log(
        `[TradeEngine] Trade closed: ${symbol} via ${reason} at ${exitPrice.toFixed(2)}`
      );
    } catch (error) {
      console.error(`[TradeEngine] Failed to close trade for ${symbol}:`, error);
    }
  }

  /**
   * Setup event listeners from BybitService
   */
  private setupEventListeners(): void {
    this.bybitService.on('orderCreated', (order: Order) => {
      console.log(`[TradeEngine] Order created: ${order.orderId}`);
    });

    this.bybitService.on('orderFilled', (order: Order) => {
      console.log(`[TradeEngine] Order filled: ${order.orderId} | Qty: ${order.filledQuantity}`);
    });

    this.bybitService.on('positionClosed', (data: any) => {
      console.log(`[TradeEngine] Position closed: ${data.symbol} via ${data.reason}`);
    });

    this.bybitService.on('orderFailed', (data: any) => {
      console.error(`[TradeEngine] Order failed: ${data.params.symbol}`, data.error);
    });
  }

  /**
   * Enable/disable trading
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    console.log(`[TradeEngine] Trading ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Check if trading is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get last signal for symbol
   */
  getLastSignal(symbol: string): Signal | undefined {
    return this.lastSignals.get(symbol);
  }

  /**
   * Get all last signals
   */
  getAllLastSignals(): Map<string, Signal> {
    return this.lastSignals;
  }

  /**
   * Get access to services (for dashboard/monitoring)
   */
  getServices() {
    return {
      portfolio: this.portfolioManager,
      analytics: this.analyticsService,
      bybit: this.bybitService,
      signalEngine: this.signalEngine,
      riskManager: this.riskManager
    };
  }

  /**
   * Get current portfolio state
   */
  async getPortfolioState() {
    const balance = await this.bybitService.getBalance();
    const usdtBalance = balance['USDT'] || balance['BUSD'] || 0;
    return this.portfolioManager.getSnapshot(usdtBalance);
  }

  /**
   * Get trading metrics
   */
  getMetrics() {
    return this.analyticsService.getMetrics('all-time');
  }

  /**
   * Manually close all trades (emergency)
   */
  async closeAllTrades(): Promise<void> {
    const portfolio = await this.getPortfolioState();
    for (const trade of portfolio.openPositions) {
      await this.closeTrade(trade.symbol, 0, 'MANUAL');
    }
    console.log('[TradeEngine] All trades closed');
  }
}
