export interface PositionSizeResult {
  positionSize: number;
  riskAmount: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfit: number;
  pipValue: number;
  valid: boolean;
  reason: string;
}

export class RiskManager {
  private symbolPipValues: Map<string, number> = new Map([
    ['BTCUSDT', 1.0],
    ['ETHUSDT', 0.1],
    ['BNBUSDT', 0.01],
    ['XRPUSDT', 0.0001],
    ['ADAUSDT', 0.00001]
  ]);

  private minPositionSize = 0.001; // Minimum trade size
  private maxPositionPercent = 0.5; // Max 50% of balance per trade (will be further limited by portfolio)

  /**
   * Calculate position size based on risk management rules
   */
  calculatePositionSize(
    accountBalance: number,
    riskPercent: number, // e.g., 0.01 for 1%
    entryPrice: number,
    stopLossPrice: number,
    symbol: string = 'BTCUSDT'
  ): PositionSizeResult {
    try {
      // Validate inputs
      if (accountBalance <= 0) {
        return {
          positionSize: 0,
          riskAmount: 0,
          entryPrice,
          stopLossPrice,
          takeProfit: 0,
          pipValue: 0,
          valid: false,
          reason: 'Invalid account balance'
        };
      }

      if (riskPercent <= 0 || riskPercent > 0.1) {
        return {
          positionSize: 0,
          riskAmount: 0,
          entryPrice,
          stopLossPrice,
          takeProfit: 0,
          pipValue: 0,
          valid: false,
          reason: 'Risk must be between 0% and 10%'
        };
      }

      if (entryPrice <= 0 || stopLossPrice <= 0) {
        return {
          positionSize: 0,
          riskAmount: 0,
          entryPrice,
          stopLossPrice,
          takeProfit: 0,
          pipValue: 0,
          valid: false,
          reason: 'Entry and stop loss prices must be positive'
        };
      }

      // Get pip value for symbol
      const pipValue = this.symbolPipValues.get(symbol) || 1.0;

      // Calculate risk in account currency
      const riskAmount = accountBalance * riskPercent;

      // Calculate price distance in pips
      const priceDistance = Math.abs(entryPrice - stopLossPrice);
      const pipDistance = priceDistance / pipValue;

      if (pipDistance <= 0) {
        return {
          positionSize: 0,
          riskAmount,
          entryPrice,
          stopLossPrice,
          takeProfit: 0,
          pipValue,
          valid: false,
          reason: 'Entry and stop loss prices are the same'
        };
      }

      // Calculate position size: Risk / pips per unit
      const positionSize = riskAmount / pipDistance;

      // Calculate take profit (200 pips)
      let takeProfit = 0;
      if (entryPrice > stopLossPrice) {
        // Buy position: TP above entry
        takeProfit = entryPrice + (200 * pipValue);
      } else {
        // Sell position: TP below entry
        takeProfit = entryPrice - (200 * pipValue);
      }

      // Validate position size
      if (positionSize < this.minPositionSize) {
        return {
          positionSize,
          riskAmount,
          entryPrice,
          stopLossPrice,
          takeProfit,
          pipValue,
          valid: false,
          reason: `Position size (${positionSize.toFixed(4)}) below minimum (${this.minPositionSize})`
        };
      }

      // Check max position size relative to balance
      const maxPositionSize = (accountBalance / entryPrice) * this.maxPositionPercent;
      if (positionSize > maxPositionSize) {
        return {
          positionSize: maxPositionSize,
          riskAmount,
          entryPrice,
          stopLossPrice,
          takeProfit,
          pipValue,
          valid: false,
          reason: `Position size capped to max ${(this.maxPositionPercent * 100)}% of balance`
        };
      }

      return {
        positionSize: this.roundToValidPrecision(positionSize, symbol),
        riskAmount,
        entryPrice,
        stopLossPrice,
        takeProfit,
        pipValue,
        valid: true,
        reason: 'Valid position size'
      };
    } catch (error) {
      return {
        positionSize: 0,
        riskAmount: 0,
        entryPrice,
        stopLossPrice,
        takeProfit: 0,
        pipValue: 0,
        valid: false,
        reason: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Round position size to valid precision based on symbol
   */
  private roundToValidPrecision(positionSize: number, symbol: string): number {
    // Most crypto exchanges accept 3-8 decimal places
    let decimals = 4;

    if (symbol.includes('BTC') || symbol.includes('ETH')) {
      decimals = 4;
    } else if (symbol.includes('BNB') || symbol.includes('XRP')) {
      decimals = 2;
    }

    const multiplier = Math.pow(10, decimals);
    return Math.floor(positionSize * multiplier) / multiplier;
  }

  /**
   * Set pip value for a symbol
   */
  setPipValue(symbol: string, pipValue: number): void {
    this.symbolPipValues.set(symbol, pipValue);
  }

  /**
   * Get pip value for a symbol
   */
  getPipValue(symbol: string): number {
    return this.symbolPipValues.get(symbol) || 1.0;
  }

  /**
   * Set minimum position size
   */
  setMinPositionSize(minSize: number): void {
    this.minPositionSize = minSize;
  }

  /**
   * Set maximum position percent of balance
   */
  setMaxPositionPercent(percent: number): void {
    this.maxPositionPercent = Math.max(0, Math.min(percent, 1));
  }
}
