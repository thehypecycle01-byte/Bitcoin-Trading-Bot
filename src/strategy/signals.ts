import { Indicators } from './indicators';

export enum SignalType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD'
}

export interface TradeSignal {
  type: SignalType;
  price: number;
  timestamp: number;
  confidence: number; // 0-1: confidence score
  indicators: Indicators;
}

export class SignalGenerator {
  private lastSignal: SignalType = SignalType.HOLD;
  private lastSignalTime: number = 0;
  private minSignalInterval: number = 300000; // 5 minutes between signals

  generateSignal(indicators: Indicators): TradeSignal {
    const signal = this.determineSignal(indicators);
    const confidence = this.calculateConfidence(indicators, signal);

    return {
      type: signal,
      price: indicators.price,
      timestamp: indicators.timestamp,
      confidence,
      indicators
    };
  }

  private determineSignal(indicators: Indicators): SignalType {
    const now = Date.now();

    // Prevent signal spam - minimum interval between trades
    if (now - this.lastSignalTime < this.minSignalInterval) {
      return SignalType.HOLD;
    }

    // BUY Signal: EMA50 > EMA200 AND RSI < 40
    if (
      indicators.ema50 > indicators.ema200 &&
      indicators.rsi14 < 40
    ) {
      this.lastSignal = SignalType.BUY;
      this.lastSignalTime = now;
      return SignalType.BUY;
    }

    // SELL Signal: EMA50 < EMA200 AND RSI > 60
    if (
      indicators.ema50 < indicators.ema200 &&
      indicators.rsi14 > 60
    ) {
      this.lastSignal = SignalType.SELL;
      this.lastSignalTime = now;
      return SignalType.SELL;
    }

    return SignalType.HOLD;
  }

  private calculateConfidence(indicators: Indicators, signal: SignalType): number {
    let confidence = 0.5; // Base confidence

    if (signal === SignalType.BUY) {
      // Increase confidence if RSI is very low
      confidence += (40 - indicators.rsi14) / 100;
      // Increase confidence if EMA50 is significantly above EMA200
      const emaDifference = (indicators.ema50 - indicators.ema200) / indicators.ema200;
      confidence += Math.min(emaDifference * 10, 0.3);
    } else if (signal === SignalType.SELL) {
      // Increase confidence if RSI is very high
      confidence += (indicators.rsi14 - 60) / 100;
      // Increase confidence if EMA50 is significantly below EMA200
      const emaDifference = (indicators.ema200 - indicators.ema50) / indicators.ema200;
      confidence += Math.min(emaDifference * 10, 0.3);
    }

    return Math.min(confidence, 1);
  }

  getLastSignal(): SignalType {
    return this.lastSignal;
  }

  resetSignalCooldown(): void {
    this.lastSignalTime = 0;
  }
}
