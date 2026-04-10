import { BybitService, Order, Position } from '../services/bybit';
import { TradingIndicators, CandleData } from '../strategy/indicators';
import { SignalGenerator, SignalType, TradeSignal } from '../strategy/signals';
import { AnalyticsService } from '../services/AnalyticsService';

export interface Trade {
  id: string;
  symbol: string;
  entryPrice: number;
  quantity: number;
  side: 'long' | 'short';
  status: 'open' | 'closed' | 'pending';
  openTime: number;
  closeTime?: number;
  closePrice?: number;
  pnl?: number;
  roiPercentage?: number;
  takeProfitPrice: number;
  stopLossPrice: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export class TradingEngine {
  private bybit: BybitService;
  private indicators: TradingIndicators;
  private signalGenerator: SignalGenerator;
  private analytics: AnalyticsService;
  private openTrades: Map<string, Trade> = new Map();
  private closedTrades: Trade[] = [];
  private tradesPerDay: number = 0;
  private dailyResetTime: number = 0;
  private lastTradeTime: number = 0;
  private riskPercentage: number;
  private takeProfitPercentage: number;
  private stopLossPercentage: number;
  private maxTradesPerDay: number;
  private accountBalance: number = 0;

  constructor(bybit: BybitService, config: {
    riskPercentage?: number;
    takeProfitPercentage?: number;
    stopLossPercentage?: number;
    maxTradesPerDay?: number;
  } = {}) {
    this.bybit = bybit;
    this.indicators = new TradingIndicators();
    this.signalGenerator = new SignalGenerator();
    this.analytics = new AnalyticsService({ startingEquity: 100 });
    this.riskPercentage = config.riskPercentage || 1;
    this.takeProfitPercentage = config.takeProfitPercentage || 2;
    this.stopLossPercentage = config.stopLossPercentage || 1;
    this.maxTradesPerDay = config.maxTradesPerDay || 5;
    this.dailyResetTime = this.getNextResetTime();
  }

  async initialize(): Promise<void> {
    try {
      // Fetch initial klines
      const klines = await this.bybit.getKlines('BTCUSDT', '5', 200);
      klines.forEach(kline => {
        this.indicators.addCandle({
          timestamp: kline.timestamp,
          open: kline.open,
          high: kline.high,
          low: kline.low,
          close: kline.close,
          volume: kline.volume
        });
      });

      // Fetch account balance
      const balance = await this.bybit.getBalance();
      this.accountBalance = balance['USDT'] || 100;

      console.log('Trading engine initialized');
    } catch (error) {
      console.error('Error initializing trading engine:', error);
      throw error;
    }
  }

  async processMarketUpdate(candle: CandleData): Promise<TradeSignal | null> {
    try {
      this.indicators.addCandle(candle);

      // Reset daily trade counter if needed
      if (Date.now() > this.dailyResetTime) {
        this.tradesPerDay = 0;
        this.dailyResetTime = this.getNextResetTime();
      }

      // Not enough data for reliable signals
      if (!this.indicators.hasEnoughCandles()) {
        return null;
      }

      const indicators = this.indicators.getIndicators();
      if (!indicators) return null;

      const signal = this.signalGenerator.generateSignal(indicators);

      // Check if we should execute this signal
      if (this.shouldExecuteSignal(signal)) {
        await this.executeSignal(signal);
      }

      return signal;
    } catch (error) {
      console.error('Error processing market update:', error);
      return null;
    }
  }

  private shouldExecuteSignal(signal: TradeSignal): boolean {
    // Don't trade if we hit max trades per day
    if (this.tradesPerDay >= this.maxTradesPerDay) {
      return false;
    }

    // Don't trade on HOLD signals
    if (signal.type === SignalType.HOLD) {
      return false;
    }

    // Minimum confidence threshold
    if (signal.confidence < 0.6) {
      return false;
    }

    // Don't trade too frequently (minimum 1 minute between trades)
    if (Date.now() - this.lastTradeTime < 60000) {
      return false;
    }

    // For SELL, only if we have open positions
    if (signal.type === SignalType.SELL && this.openTrades.size === 0) {
      return false;
    }

    return true;
  }

  private async executeSignal(signal: TradeSignal): Promise<void> {
    try {
      if (signal.type === SignalType.BUY) {
        await this.executeBuy(signal);
      } else if (signal.type === SignalType.SELL) {
        await this.executeSell(signal);
      }

      this.tradesPerDay++;
      this.lastTradeTime = Date.now();
    } catch (error) {
      console.error('Error executing signal:', error);
    }
  }

  private async executeBuy(signal: TradeSignal): Promise<void> {
    try {
      const quantity = this.calculateQuantity(signal.price);
      if (quantity <= 0) return;

      const takeProfitPrice = signal.price * (1 + this.takeProfitPercentage / 100);
      const stopLossPrice = signal.price * (1 - this.stopLossPercentage / 100);

      const order = await this.bybit.placeOrder({
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        quantity,
        takeProfitPrice,
        stopLossPrice
      });

      const trade: Trade = {
        id: order.orderId,
        symbol: 'BTCUSDT',
        entryPrice: signal.price,
        quantity,
        side: 'long',
        status: 'open',
        openTime: Date.now(),
        takeProfitPrice,
        stopLossPrice
      };

      this.openTrades.set(trade.id, trade);
      console.log(`BUY order placed: ${quantity} BTC @ ${signal.price}`);
    } catch (error) {
      console.error('Error executing buy:', error);
    }
  }

  private async executeSell(signal: TradeSignal): Promise<void> {
    try {
      // Close the first open trade
      const firstTrade = this.openTrades.values().next().value;
      if (!firstTrade) return;

      const order = await this.bybit.placeOrder({
        symbol: 'BTCUSDT',
        side: 'Sell',
        orderType: 'Market',
        quantity: firstTrade.quantity
      });

      firstTrade.status = 'closed';
      firstTrade.closeTime = Date.now();
      firstTrade.closePrice = signal.price;
      firstTrade.pnl = (signal.price - firstTrade.entryPrice) * firstTrade.quantity;
      firstTrade.roiPercentage = ((signal.price - firstTrade.entryPrice) / firstTrade.entryPrice) * 100;

      // Record the closed trade in analytics
      this.analytics.recordTrade({
        symbol: firstTrade.symbol,
        side: 'Buy',
        entryPrice: firstTrade.entryPrice,
        exitPrice: signal.price,
        quantity: firstTrade.quantity,
        entryTime: firstTrade.openTime,
        exitTime: Date.now(),
        pnl: firstTrade.pnl || 0,
        pnlPercent: firstTrade.roiPercentage || 0,
        reason: signal.price >= firstTrade.takeProfitPrice ? 'TP' : 'SL'
      });

      this.openTrades.delete(firstTrade.id);
      this.closedTrades.push(firstTrade);

      console.log(`SELL order placed: ${firstTrade.quantity} BTC @ ${signal.price} | PnL: ${firstTrade.pnl}`);
    } catch (error) {
      console.error('Error executing sell:', error);
    }
  }

  private calculateQuantity(entryPrice: number): number {
    // Risk 1% of account per trade
    const riskAmount = this.accountBalance * (this.riskPercentage / 100);
    // How many BTC can we buy with this risk?
    const stopLossAmount = entryPrice * (this.stopLossPercentage / 100);
    return riskAmount / stopLossAmount;
  }

  private getNextResetTime(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  getOpenTrades(): Trade[] {
    return Array.from(this.openTrades.values());
  }

  getClosedTrades(): Trade[] {
    return this.closedTrades;
  }

  getPerformanceMetrics(): PerformanceMetrics {
    const totalTrades = this.closedTrades.length;
    const winningTrades = this.closedTrades.filter(t => t.pnl! > 0).length;
    const losingTrades = this.closedTrades.filter(t => t.pnl! < 0).length;

    const totalPnL = this.closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalWins = this.closedTrades
      .filter(t => t.pnl! > 0)
      .reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(this.closedTrades
      .filter(t => t.pnl! < 0)
      .reduce((sum, t) => sum + (t.pnl || 0), 0));

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
      totalPnL,
      averageWin: winningTrades > 0 ? totalWins / winningTrades : 0,
      averageLoss: losingTrades > 0 ? totalLosses / losingTrades : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      maxDrawdown: this.calculateMaxDrawdown(),
      sharpeRatio: this.calculateSharpeRatio(totalPnL, totalTrades)
    };
  }

  private calculateMaxDrawdown(): number {
    let maxDrawdown = 0;
    let peak = 0;
    let cumulative = 0;

    for (const trade of this.closedTrades) {
      cumulative += trade.pnl || 0;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  private calculateSharpeRatio(totalPnL: number, tradeCount: number): number {
    if (tradeCount === 0) return 0;
    const avgReturn = totalPnL / tradeCount;
    const riskFreeRate = 0.02 / 252; // Annual risk-free rate / trading days

    const squaredDiffs = this.closedTrades
      .map(t => (t.pnl || 0) - avgReturn)
      .reduce((sum, diff) => sum + (diff * diff), 0);

    const stdDev = Math.sqrt(squaredDiffs / tradeCount);
    return stdDev > 0 ? (avgReturn - riskFreeRate) / stdDev : 0;
  }

  /**
   * Get detailed analytics metrics from AnalyticsService
   */
  getAnalyticsMetrics(timeFrame: 'daily' | 'weekly' | 'monthly' | 'all-time' = 'all-time') {
    return this.analytics.getMetrics(timeFrame, 100);
  }

  /**
   * Get daily statistics
   */
  getDailyStats() {
    return this.analytics.getDailyStats();
  }

  getTradesPerDay(): number {
    return this.tradesPerDay;
  }

  getAccountBalance(): number {
    return this.accountBalance;
  }
}
