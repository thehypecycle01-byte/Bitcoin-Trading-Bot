import { ClosedTrade } from './PortfolioManager';

// Logger interface for structured logging
export interface Logger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

// Default console logger
class ConsoleLogger implements Logger {
  info(message: string, meta?: any): void {
    console.log(`[INFO] ${message}`, meta ? JSON.stringify(meta) : '');
  }
  warn(message: string, meta?: any): void {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '');
  }
  error(message: string, meta?: any): void {
    console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta) : '');
  }
}

// Configuration options
export interface AnalyticsConfig {
  startingEquity?: number;
  riskFreeRate?: number;
  defaultFee?: number;
  defaultSlippage?: number;
  logger?: Logger;
}

export interface TradeMetrics {
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly winRate: number;
  readonly lossRate: number;
  readonly totalPnL: number;
  readonly totalPnLPercent: number;
  readonly averagePnL: number;
  readonly maxWin: number;
  readonly maxLoss: number;
  readonly profitFactor: number;
  readonly avgWinSize: number;
  readonly avgLossSize: number;
  readonly consecutiveWins: number;
  readonly consecutiveLosses: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownPercent: number;
  readonly equityPeak: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly expectancy: number;
  readonly riskRewardRatio: number;
  readonly returnsStdDev: number;
}

export interface DailyStats {
  readonly date: string;
  openingEquity: number;
  closingEquity: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  tradesExecuted: number;
  wins: number;
  losses: number;
}

export interface EquityPoint {
  readonly date: number;
  readonly equity: number;
  readonly drawdown: number;
  readonly drawdownPercent: number;
}

export type TimeFrameMetrics = 'daily' | 'weekly' | 'monthly' | 'all-time';

export interface AnalyticsClosedTrade extends ClosedTrade {
  readonly fee: number;
  readonly slippage: number;
  readonly netPnL: number;
  readonly netPnLPercent: number;
}

export class AnalyticsService {
  private readonly closedTrades: AnalyticsClosedTrade[] = [];
  private readonly dailyStats: Map<string, DailyStats> = new Map();
  private readonly config: Required<AnalyticsConfig>;
  private readonly logger: Logger;

  // Incremental tracking
  private runningEquity: number;
  private peakEquity: number;
  private maxDrawdown: number = 0;
  private maxDrawdownPercent: number = 0;
  private totalTrades: number = 0;
  private totalWins: number = 0;
  private totalLosses: number = 0;
  private totalPnL: number = 0;
  private maxConsecutiveWins: number = 0;
  private maxConsecutiveLosses: number = 0;
  private currentWinStreak: number = 0;
  private currentLossStreak: number = 0;

  // Caching
  private readonly metricsCache: Map<string, TradeMetrics> = new Map();
  private equityCurveCache: { startingEquity: number; curve: readonly EquityPoint[] } | null = null;
  private drawdownSeriesCache: readonly EquityPoint[] | null = null;

  // Persistence hooks
  protected saveToDatabase?(trade: AnalyticsClosedTrade): void;
  protected loadFromDatabase?(): readonly AnalyticsClosedTrade[];

  constructor(config: AnalyticsConfig = {}) {
    this.config = {
      startingEquity: config.startingEquity ?? 10000,
      riskFreeRate: config.riskFreeRate ?? 0,
      defaultFee: config.defaultFee ?? 0,
      defaultSlippage: config.defaultSlippage ?? 0,
      logger: config.logger ?? new ConsoleLogger()
    };
    this.logger = this.config.logger;
    this.runningEquity = this.config.startingEquity;
    this.peakEquity = this.config.startingEquity;
  }

  /**
   * Validate trade input
   */
  private validateTrade(trade: ClosedTrade): void {
    if (!trade.symbol || typeof trade.symbol !== 'string') throw new Error('Invalid symbol');
    if (!Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) throw new Error('Invalid entryPrice');
    if (!Number.isFinite(trade.exitPrice) || trade.exitPrice <= 0) throw new Error('Invalid exitPrice');
    if (!Number.isFinite(trade.quantity) || trade.quantity <= 0) throw new Error('Invalid quantity');
    if (!Number.isFinite(trade.entryTime) || trade.entryTime <= 0) throw new Error('Invalid entryTime');
    if (!Number.isFinite(trade.exitTime) || trade.exitTime <= 0) throw new Error('Invalid exitTime');
    if (!Number.isFinite(trade.pnl)) throw new Error('Invalid pnl');
  }

  /**
   * Record a closed trade with fees and slippage
   */
  recordTrade(trade: ClosedTrade, fee: number = this.config.defaultFee, slippage: number = this.config.defaultSlippage): void {
    this.validateTrade(trade);
    if (!Number.isFinite(fee) || fee < 0) throw new Error('Invalid fee');
    if (!Number.isFinite(slippage) || slippage < 0) throw new Error('Invalid slippage');

    const netPnL = trade.pnl - fee - slippage;
    const netPnLPercent = (netPnL / (trade.entryPrice * trade.quantity)) * 100;

    const analyticsTrade: AnalyticsClosedTrade = {
      ...trade,
      fee,
      slippage,
      netPnL,
      netPnLPercent
    };

    this.closedTrades.push(analyticsTrade);
    this.updateIncrementalMetrics(analyticsTrade);
    this.updateDailyStats(analyticsTrade);
    this.invalidateCaches();

    try {
      if (this.saveToDatabase) {
        this.saveToDatabase(analyticsTrade);
      }
    } catch (error) {
      this.logger.error('Failed to save trade to database', { error: error instanceof Error ? error.message : String(error), trade });
    }

    this.logger.info('Trade recorded', { symbol: trade.symbol, netPnL, totalTrades: this.totalTrades });
  }

  /**
   * Record multiple closed trades
   */
  recordTrades(trades: readonly ClosedTrade[], fees?: readonly number[], slippages?: readonly number[]): void {
    trades.forEach((trade, index) => {
      const fee = fees?.[index] ?? this.config.defaultFee;
      const slippage = slippages?.[index] ?? this.config.defaultSlippage;
      this.recordTrade(trade, fee, slippage);
    });
  }

  /**
   * Ingest closed trades from Bybit API
   */
  ingestBybitClosedTrades(apiTrades: readonly any[]): void {
    const mappedTrades: ClosedTrade[] = apiTrades.map(apiTrade => ({
      symbol: apiTrade.symbol,
      side: apiTrade.side,
      entryPrice: parseFloat(apiTrade.avgEntryPrice),
      exitPrice: parseFloat(apiTrade.avgExitPrice),
      quantity: parseFloat(apiTrade.qty),
      entryTime: new Date(apiTrade.createdTime).getTime(),
      exitTime: new Date(apiTrade.updatedTime).getTime(),
      pnl: parseFloat(apiTrade.closedPnl),
      pnlPercent: 0,
      reason: apiTrade.closedPnl > 0 ? 'TP' : 'SL'
    }));

    this.recordTrades(mappedTrades);
    this.logger.info('Bybit trades ingested', { count: apiTrades.length });
  }

  /**
   * Update incremental metrics
   */
  private updateIncrementalMetrics(trade: AnalyticsClosedTrade): void {
    this.totalTrades++;
    this.totalPnL += trade.netPnL;
    this.runningEquity += trade.netPnL;
    this.peakEquity = Math.max(this.peakEquity, this.runningEquity);
    const drawdown = this.peakEquity - this.runningEquity;
    const drawdownPercent = this.peakEquity > 0 ? (drawdown / this.peakEquity) * 100 : 0;
    this.maxDrawdown = Math.max(this.maxDrawdown, drawdown);
    this.maxDrawdownPercent = Math.max(this.maxDrawdownPercent, drawdownPercent);

    if (trade.netPnL > 0) {
      this.totalWins++;
      this.currentWinStreak++;
      this.currentLossStreak = 0;
      this.maxConsecutiveWins = Math.max(this.maxConsecutiveWins, this.currentWinStreak);
    } else if (trade.netPnL < 0) {
      this.totalLosses++;
      this.currentLossStreak++;
      this.currentWinStreak = 0;
      this.maxConsecutiveLosses = Math.max(this.maxConsecutiveLosses, this.currentLossStreak);
    }
  }

  /**
   * Get metrics for all time or specific period (with caching)
   */
  getMetrics(timeFrame: TimeFrameMetrics = 'all-time', startingEquity: number = this.config.startingEquity): TradeMetrics {
    const cacheKey = `${timeFrame}-${startingEquity}`;
    if (this.metricsCache.has(cacheKey)) {
      return this.metricsCache.get(cacheKey)!;
    }

    let trades = this.getSortedTrades();

    if (timeFrame === 'daily') {
      trades = this.getTradesToday();
    } else if (timeFrame === 'weekly') {
      trades = this.getTradesThisWeek();
    } else if (timeFrame === 'monthly') {
      trades = this.getTradesThisMonth();
    }

    const metrics = this.calculateMetrics(trades, startingEquity);
    this.metricsCache.set(cacheKey, metrics);
    return metrics;
  }

  /**
   * Calculate detailed metrics with professional risk measures
   */
  private calculateMetrics(trades: readonly AnalyticsClosedTrade[], startingEquity: number): TradeMetrics {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        lossRate: 0,
        totalPnL: 0,
        totalPnLPercent: 0,
        averagePnL: 0,
        maxWin: 0,
        maxLoss: 0,
        profitFactor: 0,
        avgWinSize: 0,
        avgLossSize: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        equityPeak: startingEquity,
        sharpeRatio: 0,
        sortinoRatio: 0,
        expectancy: 0,
        riskRewardRatio: 0,
        returnsStdDev: 0
      };
    }

    const winningTrades = trades.filter(t => t.netPnL > 0);
    const losingTrades = trades.filter(t => t.netPnL < 0);

    const totalPnL = trades.reduce((sum, t) => sum + t.netPnL, 0);
    const totalPnLPercent = (totalPnL / startingEquity) * 100;
    const averagePnL = totalPnL / trades.length;

    const maxWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.netPnL)) : 0;
    const maxLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.netPnL)) : 0;

    const totalWins = winningTrades.reduce((sum, t) => sum + t.netPnL, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.netPnL, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0);

    const avgWinSize = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLossSize = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
    const riskRewardRatio = avgLossSize > 0 ? avgWinSize / avgLossSize : 0;

    const winRate = (winningTrades.length / trades.length) * 100;
    const lossRate = (losingTrades.length / trades.length) * 100;
    const expectancy = (winningTrades.length / trades.length) * avgWinSize - (losingTrades.length / trades.length) * avgLossSize;

    const consecutiveMetrics = this.getConsecutiveStats(trades);

    const equityCurve = this.calculateEquityCurve(trades, startingEquity);
    const { maxDrawdown, maxDrawdownPercent, equityPeak } = this.calculateDrawdownMetrics(equityCurve);
    const returns = this.calculateReturns(equityCurve);
    const returnsStdDev = this.calculateStdDev(returns);
    const sharpeRatio = returnsStdDev > 0 ? ((this.calculateAverageReturn(returns) - this.config.riskFreeRate / 252) / returnsStdDev) * Math.sqrt(252) : 0;
    const sortinoRatio = this.calculateSortinoRatio(returns);

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: Number(winRate.toFixed(2)),
      lossRate: Number(lossRate.toFixed(2)),
      totalPnL: Number(totalPnL.toFixed(4)),
      totalPnLPercent: Number(totalPnLPercent.toFixed(2)),
      averagePnL: Number(averagePnL.toFixed(4)),
      maxWin: Number(maxWin.toFixed(4)),
      maxLoss: Number(maxLoss.toFixed(4)),
      profitFactor: Number(profitFactor.toFixed(2)),
      avgWinSize: Number(avgWinSize.toFixed(4)),
      avgLossSize: Number(avgLossSize.toFixed(4)),
      consecutiveWins: consecutiveMetrics.maxConsecutiveWins,
      consecutiveLosses: consecutiveMetrics.maxConsecutiveLosses,
      maxDrawdown: Number(maxDrawdown.toFixed(4)),
      maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
      equityPeak: Number(equityPeak.toFixed(4)),
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      sortinoRatio: Number(sortinoRatio.toFixed(2)),
      expectancy: Number(expectancy.toFixed(4)),
      riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
      returnsStdDev: Number(returnsStdDev.toFixed(4))
    };
  }

  /**
   * Get trades for this week (Mon-Sun)
   */
  private getTradesThisWeek(): readonly AnalyticsClosedTrade[] {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setUTCDate(now.getUTCDate() - now.getUTCDay() + 1); // Monday
    startOfWeek.setUTCHours(0, 0, 0, 0);
    const startTime = startOfWeek.getTime();
    return this.getSortedTrades().filter(t => t.exitTime >= startTime);
  }

  /**
   * Get trades for this month (1st-30th/31st)
   */
  private getTradesThisMonth(): readonly AnalyticsClosedTrade[] {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startTime = startOfMonth.getTime();
    return this.getSortedTrades().filter(t => t.exitTime >= startTime);
  }

  // ... (rest of the methods remain similar, with improvements for validation, logging, etc.)

  /**
   * Export trades as JSON
   */
  exportTrades(): string {
    return JSON.stringify(this.closedTrades, null, 2);
  }

  /**
   * Export trades as CSV
   */
  exportTradesCSV(): string {
    const headers = ['symbol', 'side', 'entryPrice', 'exitPrice', 'quantity', 'entryTime', 'exitTime', 'pnl', 'pnlPercent', 'reason', 'fee', 'slippage', 'netPnL', 'netPnLPercent'];
    const rows = this.closedTrades.map(trade => [
      trade.symbol, trade.side, trade.entryPrice, trade.exitPrice, trade.quantity,
      trade.entryTime, trade.exitTime, trade.pnl, trade.pnlPercent, trade.reason,
      trade.fee, trade.slippage, trade.netPnL, trade.netPnLPercent
    ]);
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * Export daily stats as CSV
   */
  exportDailyStatsCSV(): string {
    const headers = ['date', 'openingEquity', 'closingEquity', 'dailyPnL', 'dailyPnLPercent', 'tradesExecuted', 'wins', 'losses'];
    const rows = Array.from(this.dailyStats.values()).map(stat => [
      stat.date, stat.openingEquity, stat.closingEquity, stat.dailyPnL, stat.dailyPnLPercent,
      stat.tradesExecuted, stat.wins, stat.losses
    ]);
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * Get all daily stats
   */
  getDailyStats(): readonly DailyStats[] {
    return Array.from(this.dailyStats.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Update daily statistics
   */
  private updateDailyStats(trade: AnalyticsClosedTrade): void {
    const date = new Date(trade.exitTime).toISOString().split('T')[0];
    const existing = this.dailyStats.get(date);

    if (existing) {
      existing.closingEquity += trade.netPnL;
      existing.dailyPnL += trade.netPnL;
      existing.dailyPnLPercent = ((existing.dailyPnL / existing.openingEquity) * 100);
      existing.tradesExecuted++;
      if (trade.netPnL > 0) existing.wins++;
      else if (trade.netPnL < 0) existing.losses++;
    } else {
      const openingEquity = this.runningEquity - trade.netPnL;
      this.dailyStats.set(date, {
        date,
        openingEquity,
        closingEquity: this.runningEquity,
        dailyPnL: trade.netPnL,
        dailyPnLPercent: (trade.netPnL / openingEquity) * 100,
        tradesExecuted: 1,
        wins: trade.netPnL > 0 ? 1 : 0,
        losses: trade.netPnL < 0 ? 1 : 0
      });
    }
  }

  /**
   * Get sorted trades by exit time
   */
  private getSortedTrades(): readonly AnalyticsClosedTrade[] {
    return [...this.closedTrades].sort((a, b) => a.exitTime - b.exitTime);
  }

  /**
   * Get trades for today
   */
  private getTradesToday(): readonly AnalyticsClosedTrade[] {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startTime = today.getTime();
    const endTime = startTime + 24 * 60 * 60 * 1000;
    return this.getSortedTrades().filter(t => t.exitTime >= startTime && t.exitTime < endTime);
  }

  /**
   * Get consecutive win/loss statistics
   */
  private getConsecutiveStats(trades: readonly AnalyticsClosedTrade[]): { maxConsecutiveWins: number; maxConsecutiveLosses: number } {
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of trades) {
      if (trade.netPnL > 0) {
        currentWins++;
        currentLosses = 0;
        maxWins = Math.max(maxWins, currentWins);
      } else if (trade.netPnL < 0) {
        currentLosses++;
        currentWins = 0;
        maxLosses = Math.max(maxLosses, currentLosses);
      }
    }

    return { maxConsecutiveWins: maxWins, maxConsecutiveLosses: maxLosses };
  }

  /**
   * Calculate equity curve
   */
  private calculateEquityCurve(trades: readonly AnalyticsClosedTrade[], startingEquity: number): readonly EquityPoint[] {
    if (this.equityCurveCache?.startingEquity === startingEquity) {
      return this.equityCurveCache.curve;
    }

    let equity = startingEquity;
    let peak = startingEquity;
    const curve: EquityPoint[] = [];

    for (const trade of trades) {
      equity += trade.netPnL;
      peak = Math.max(peak, equity);
      const drawdown = peak - equity;
      const drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;

      curve.push({
        date: trade.exitTime,
        equity,
        drawdown,
        drawdownPercent
      });
    }

    this.equityCurveCache = { startingEquity, curve };
    return curve;
  }

  /**
   * Calculate drawdown metrics
   */
  private calculateDrawdownMetrics(equityCurve: readonly EquityPoint[]): { maxDrawdown: number; maxDrawdownPercent: number; equityPeak: number } {
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let equityPeak = equityCurve.length > 0 ? equityCurve[0].equity : 0;

    for (const point of equityCurve) {
      equityPeak = Math.max(equityPeak, point.equity);
      const drawdown = equityPeak - point.equity;
      const drawdownPercent = equityPeak > 0 ? (drawdown / equityPeak) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
    }

    return { maxDrawdown, maxDrawdownPercent, equityPeak };
  }

  /**
   * Calculate daily returns
   */
  private calculateReturns(equityCurve: readonly EquityPoint[]): readonly number[] {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prevEquity = equityCurve[i - 1].equity;
      const currentEquity = equityCurve[i].equity;
      const dailyReturn = prevEquity > 0 ? (currentEquity - prevEquity) / prevEquity : 0;
      returns.push(dailyReturn);
    }
    return returns;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate average return
   */
  private calculateAverageReturn(returns: readonly number[]): number {
    if (returns.length === 0) return 0;
    return returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
  }

  /**
   * Calculate Sortino ratio
   */
  private calculateSortinoRatio(returns: readonly number[]): number {
    const avgReturn = this.calculateAverageReturn(returns);
    const negativeReturns = returns.filter(r => r < 0);
    const downsideStdDev = negativeReturns.length > 0 ? this.calculateStdDev(negativeReturns) : 0;
    return downsideStdDev > 0 ? (avgReturn / downsideStdDev) * Math.sqrt(252) : 0;
  }

  /**
   * Invalidate all caches
   */
  private invalidateCaches(): void {
    this.metricsCache.clear();
    this.equityCurveCache = null;
    this.drawdownSeriesCache = null;
  }

  /**
   * Reset all data
   */
  reset(): void {
    this.closedTrades.length = 0;
    this.dailyStats.clear();
    this.runningEquity = this.config.startingEquity;
    this.peakEquity = this.config.startingEquity;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
    this.totalTrades = 0;
    this.totalWins = 0;
    this.totalLosses = 0;
    this.totalPnL = 0;
    this.maxConsecutiveWins = 0;
    this.maxConsecutiveLosses = 0;
    this.currentWinStreak = 0;
    this.currentLossStreak = 0;
    this.invalidateCaches();
    this.logger.info('AnalyticsService reset');
  }
}
