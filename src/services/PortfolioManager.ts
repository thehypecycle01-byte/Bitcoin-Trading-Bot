import { Order, Position } from './bybit';

export interface ActiveTrade {
  symbol: string;
  orderId: string;
  side: 'Buy' | 'Sell';
  entryPrice: number;
  quantity: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  entryTime: number;
  riskAmount: number;
}

export interface ClosedTrade {
  symbol: string;
  side: 'Buy' | 'Sell';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryTime: number;
  exitTime: number;
  pnl: number;
  pnlPercent: number;
  reason: 'TP' | 'SL' | 'MANUAL';
}

export interface PortfolioSnapshot {
  totalEquity: number;
  usedMargin: number;
  availableMargin: number;
  openPositions: ActiveTrade[];
  closedTrades: ClosedTrade[];
  totalOpenPnL: number;
  totalClosedPnL: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  dayStartEquity: number;
  dailyPnL: number;
  maxConcurrentTrades: number;
}

export class PortfolioManager {
  private activeTrades: Map<string, ActiveTrade> = new Map();
  private closedTrades: ClosedTrade[] = [];
  private dayStartEquity: number = 0;
  private maxConcurrentTrades: number = 5;
  private cooldownBySymbol: Map<string, number> = new Map();
  private cooldownPeriod: number = 30000; // 30 seconds
  private maxDailyLossPercent: number = 0.05; // 5% max daily loss

  constructor(initialEquity: number) {
    this.dayStartEquity = initialEquity;
  }

  /**
   * Add a new active trade
   */
  addTrade(trade: ActiveTrade): boolean {
    // Check concurrent trades limit
    if (this.activeTrades.size >= this.maxConcurrentTrades) {
      console.warn(
        `[PortfolioManager] Max concurrent trades (${this.maxConcurrentTrades}) reached`
      );
      return false;
    }

    // Check for duplicate symbol trade
    if (this.activeTrades.has(trade.symbol)) {
      console.warn(`[PortfolioManager] Trade already exists for ${trade.symbol}`);
      return false;
    }

    // Check cooldown
    const lastTradeTime = this.cooldownBySymbol.get(trade.symbol) || 0;
    if (Date.now() - lastTradeTime < this.cooldownPeriod) {
      console.warn(
        `[PortfolioManager] Cooldown active for ${trade.symbol} (${Math.round(
          (this.cooldownPeriod - (Date.now() - lastTradeTime)) / 1000
        )}s remaining)`
      );
      return false;
    }

    this.activeTrades.set(trade.symbol, trade);
    this.cooldownBySymbol.set(trade.symbol, Date.now());
    console.log(`[PortfolioManager] Added trade: ${trade.symbol} ${trade.side} @ ${trade.entryPrice}`);
    return true;
  }

  /**
   * Close an active trade
   */
  closeTrade(
    symbol: string,
    exitPrice: number,
    reason: 'TP' | 'SL' | 'MANUAL' = 'MANUAL'
  ): ClosedTrade | null {
    const trade = this.activeTrades.get(symbol);
    if (!trade) {
      console.warn(`[PortfolioManager] No active trade for ${symbol}`);
      return null;
    }

    // Calculate PnL
    let pnl = 0;
    if (trade.side === 'Buy') {
      pnl = (exitPrice - trade.entryPrice) * trade.quantity;
    } else {
      pnl = (trade.entryPrice - exitPrice) * trade.quantity;
    }

    const pnlPercent = (pnl / trade.riskAmount) * 100;

    const closedTrade: ClosedTrade = {
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice,
      quantity: trade.quantity,
      entryTime: trade.entryTime,
      exitTime: Date.now(),
      pnl,
      pnlPercent,
      reason
    };

    this.closedTrades.push(closedTrade);
    this.activeTrades.delete(symbol);

    console.log(
      `[PortfolioManager] Closed trade: ${symbol} ${reason} | PnL: ${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`
    );

    return closedTrade;
  }

  /**
   * Get current portfolio snapshot
   */
  getSnapshot(currentEquity: number): PortfolioSnapshot {
    const openPnL = this.calculateOpenPnL();
    const { wins, losses } = this.calculateWinRate();
    const totalClosedPnL = this.closedTrades.reduce((sum, t) => sum + t.pnl, 0);
    const dailyPnL = currentEquity - this.dayStartEquity;

    return {
      totalEquity: currentEquity,
      usedMargin: this.activeTrades.size * 1, // Simplified - would need entry prices
      availableMargin: currentEquity,
      openPositions: Array.from(this.activeTrades.values()),
      closedTrades: this.closedTrades,
      totalOpenPnL: openPnL,
      totalClosedPnL,
      winCount: wins,
      lossCount: losses,
      winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
      dayStartEquity: this.dayStartEquity,
      dailyPnL,
      maxConcurrentTrades: this.maxConcurrentTrades
    };
  }

  /**
   * Calculate open PnL (currently rough estimate)
   */
  private calculateOpenPnL(): number {
    // This would need current market prices to calculate accurately
    // For now, return 0 - actual implementation would need price feed
    return 0;
  }

  /**
   * Calculate win/loss count
   */
  private calculateWinRate(): { wins: number; losses: number } {
    const wins = this.closedTrades.filter(t => t.pnl > 0).length;
    const losses = this.closedTrades.filter(t => t.pnl < 0).length;
    return { wins, losses };
  }

  /**
   * Check if can open new trade (portfolio checks)
   */
  canOpenTrade(symbol: string): { allowed: boolean; reason: string } {
    // Check max concurrent trades
    if (this.activeTrades.size >= this.maxConcurrentTrades) {
      return {
        allowed: false,
        reason: `Max concurrent trades (${this.maxConcurrentTrades}) reached`
      };
    }

    // Check for duplicate
    if (this.activeTrades.has(symbol)) {
      return {
        allowed: false,
        reason: `Trade already exists for ${symbol}`
      };
    }

    // Check cooldown
    const lastTradeTime = this.cooldownBySymbol.get(symbol) || 0;
    const timeSinceLast = Date.now() - lastTradeTime;
    if (timeSinceLast < this.cooldownPeriod) {
      return {
        allowed: false,
        reason: `Cooldown active for ${symbol} (${Math.round(
          (this.cooldownPeriod - timeSinceLast) / 1000
        )}s remaining)`
      };
    }

    return { allowed: true, reason: 'OK' };
  }

  /**
   * Check max daily loss limit
   */
  checkDailyLossLimit(currentEquity: number): boolean {
    const dailyPnL = currentEquity - this.dayStartEquity;
    const dailyLossPercent = Math.abs(dailyPnL) / this.dayStartEquity;

    if (dailyLossPercent > this.maxDailyLossPercent && dailyPnL < 0) {
      console.error(
        `[PortfolioManager] Daily loss limit exceeded: ${(dailyLossPercent * 100).toFixed(2)}%`
      );
      return false;
    }

    return true;
  }

  /**
   * Get active trade count
   */
  getActiveTradeCount(): number {
    return this.activeTrades.size;
  }

  /**
   * Get trade by symbol
   */
  getTrade(symbol: string): ActiveTrade | undefined {
    return this.activeTrades.get(symbol);
  }

  /**
   * Set max concurrent trades
   */
  setMaxConcurrentTrades(max: number): void {
    this.maxConcurrentTrades = Math.max(1, max);
  }

  /**
   * Set cooldown period between trades on same symbol (ms)
   */
  setCooldownPeriod(ms: number): void {
    this.cooldownPeriod = Math.max(5000, ms);
  }

  /**
   * Set max daily loss percent
   */
  setMaxDailyLossPercent(percent: number): void {
    this.maxDailyLossPercent = Math.max(0, Math.min(percent, 0.5));
  }

  /**
   * Reset daily metrics
   */
  resetDailyMetrics(currentEquity: number): void {
    this.dayStartEquity = currentEquity;
    this.closedTrades = [];
    console.log(`[PortfolioManager] Daily metrics reset - Starting equity: ${currentEquity}`);
  }
}
