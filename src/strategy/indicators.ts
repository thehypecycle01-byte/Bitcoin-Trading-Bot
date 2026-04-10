import { EMA, RSI } from 'technicalindicators';

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  ema50: number;
  ema200: number;
  rsi14: number;
  timestamp: number;
  price: number;
}

export class TradingIndicators {
  private candles: CandleData[] = [];
  private maxCandles = 250; // Store enough for EMA-200

  addCandle(candle: CandleData): void {
    this.candles.push(candle);
    if (this.candles.length > this.maxCandles) {
      this.candles.shift();
    }
  }

  /**
   * Check if we have enough candles for reliable indicator calculation
   * EMA-200 requires 200 candles, RSI-14 requires 15 (14 + 1 for comparison)
   */
  hasEnoughCandles(): boolean {
    // Need at least 200 candles for EMA-200 to be reliable
    return this.candles.length >= 200;
  }

  calculateEMA(period: number): number | null {
    if (this.candles.length < period) return null;

    const closes = this.candles.map(c => c.close);
    const emaValues = EMA.calculate({ values: closes, period });
    return emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
  }

  calculateRSI(period: number = 14): number | null {
    if (this.candles.length < period + 1) return null;

    const closes = this.candles.map(c => c.close);
    const rsiValues = RSI.calculate({ values: closes, period });
    return rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
  }

  getIndicators(): Indicators | null {
    const ema50 = this.calculateEMA(50);
    const ema200 = this.calculateEMA(200);
    const rsi14 = this.calculateRSI(14);

    if (!ema50 || !ema200 || rsi14 === null) {
      return null;
    }

    const latest = this.candles[this.candles.length - 1];

    return {
      ema50,
      ema200,
      rsi14,
      timestamp: latest.timestamp,
      price: latest.close
    };
  }

  getLastCandle(): CandleData | null {
    return this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
  }
}
