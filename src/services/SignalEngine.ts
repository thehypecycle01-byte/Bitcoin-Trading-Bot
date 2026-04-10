import { EMA, RSI, ATR } from 'technicalindicators';

export interface Signal {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  timestamp: number;
}

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class SignalEngine {
  private ema9Period = 9;
  private ema21Period = 21;
  private rsiPeriod = 14;
  private rsiOverbought = 70;
  private rsiOversold = 30;
  private volatilityThreshold = 0.015;
  private ema50Period = 50;
  private atrPeriod = 14;
  private minAtrThreshold = 0.002;
  private minVolumeMultiplier = 1.0;
  private signalCooldownCandles = 15;
  private lastSignals: Map<string, {signal: 'BUY' | 'SELL'; candleIndex: number}> = new Map();

  async generateSignal(symbol: string, candles: CandleData[]): Promise<Signal> {
    if (candles.length < this.ema50Period) {
      return {symbol, signal: 'HOLD', confidence: 0, reason: 'Insufficient candles', timestamp: Date.now()};
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    const ema9V = EMA.calculate({period: this.ema9Period, values: closes});
    const ema21V = EMA.calculate({period: this.ema21Period, values: closes});
    const ema50V = EMA.calculate({period: this.ema50Period, values: closes});
    const rsiV = RSI.calculate({period: this.rsiPeriod, values: closes});

    if (ema9V.length === 0 || ema21V.length === 0 || ema50V.length === 0 || rsiV.length === 0) {
      return {symbol, signal: 'HOLD', confidence: 0, reason: 'Calc failed', timestamp: Date.now()};
    }

    const ema9L = ema9V[ema9V.length - 1];
    const ema21L = ema21V[ema21V.length - 1];
    const ema50L = ema50V[ema50V.length - 1];
    const rsiL = rsiV[rsiV.length - 1];
    const closeL = closes[closes.length - 1];

    const ema9P = ema9V.length > 1 ? ema9V[ema9V.length - 2] : ema9L;
    const ema21P = ema21V.length > 1 ? ema21V[ema21V.length - 2] : ema21L;

    const atrData = {high: highs, low: lows, close: closes, period: this.atrPeriod};
    const atrV = ATR.calculate(atrData);
    if (atrV.length === 0) return {symbol, signal: 'HOLD', confidence: 0, reason: 'ATR failed', timestamp: Date.now()};
    const atrL = atrV[atrV.length - 1];
    const atrP = (atrL / closeL) * 100;

    if (atrP < this.minAtrThreshold * 100) {
      return {symbol, signal: 'HOLD', confidence: 0.2, reason: 'Low volatility', timestamp: Date.now()};
    }

    const avgVol = this.calculateAverageVolume(volumes);
    const latestVol = volumes[volumes.length - 1];
    const volRatio = latestVol / avgVol;

    if (volRatio < this.minVolumeMultiplier) {
      return {symbol, signal: 'HOLD', confidence: 0.15, reason: 'Low volume', timestamp: Date.now()};
    }

    const trend = closeL > ema50L ? 'UP' : 'DOWN';
    const buyCondition = ema9P <= ema21P && ema9L > ema21L && closeL > ema50L;
    const sellCondition = ema9P >= ema21P && ema9L < ema21L && closeL < ema50L;

    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0;
    let reason = '';

    if (buyCondition) {
      if (!this.isValidRSI('BUY', rsiL)) {
        return {symbol, signal: 'HOLD', confidence: 0.25, reason: 'RSI out of zone', timestamp: Date.now()};
      }
      if (this.isOnCooldown(symbol, 'BUY', candles.length)) {
        return {symbol, signal: 'HOLD', confidence: 0.3, reason: 'Cooldown active', timestamp: Date.now()};
      }
      signal = 'BUY';
      confidence = this.calcConfidence('BUY', ema9L, ema21L, ema50L, rsiL, volRatio, atrP);
      reason = 'BUY signal: EMA crossover confirmed';
      this.updateSignal(symbol, 'BUY', candles.length);
    } else if (sellCondition) {
      if (!this.isValidRSI('SELL', rsiL)) {
        return {symbol, signal: 'HOLD', confidence: 0.25, reason: 'RSI out of zone', timestamp: Date.now()};
      }
      if (this.isOnCooldown(symbol, 'SELL', candles.length)) {
        return {symbol, signal: 'HOLD', confidence: 0.3, reason: 'Cooldown active', timestamp: Date.now()};
      }
      signal = 'SELL';
      confidence = this.calcConfidence('SELL', ema9L, ema21L, ema50L, rsiL, volRatio, atrP);
      reason = 'SELL signal: EMA crossover confirmed';
      this.updateSignal(symbol, 'SELL', candles.length);
    }

    return {symbol, signal, confidence: Math.min(confidence, 1), reason, timestamp: Date.now()};
  }

  private isValidRSI(type: 'BUY' | 'SELL', rsi: number): boolean {
    return type === 'BUY' ? (rsi >= 40 && rsi <= 65) : (rsi >= 35 && rsi <= 60);
  }

  private isOnCooldown(symbol: string, signal: 'BUY' | 'SELL', idx: number): boolean {
    const last = this.lastSignals.get(symbol);
    if (!last || last.signal !== signal) return false;
    return idx - last.candleIndex < this.signalCooldownCandles;
  }

  private updateSignal(symbol: string, signal: 'BUY' | 'SELL', idx: number): void {
    this.lastSignals.set(symbol, {signal, candleIndex: idx});
  }

  private calculateAverageVolume(volumes: number[]): number {
    const recent = volumes.slice(-20);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  private calcConfidence(signal: 'BUY' | 'SELL', e9: number, e21: number, e50: number, rsi: number, vr: number, atr: number): number {
    let conf = 0.6;
    const ed = Math.abs((e9 - e21) / e21) * 100;
    conf += Math.min(ed / 5, 0.2);
    conf += signal === 'BUY' ? (rsi < 50 ? 0.15 : rsi < 58 ? 0.08 : 0) : (rsi > 50 ? 0.15 : rsi > 42 ? 0.08 : 0);
    conf += Math.min((vr - 1) * 0.1, 0.1);
    conf += ((signal === 'BUY' && e9 > e50) || (signal === 'SELL' && e9 < e50)) ? 0.1 : 0;
    conf += atr > 0.01 ? 0.05 : 0;
    return Math.max(Math.min(conf, 1), 0.4);
  }

  setEmaPeriods(short: number, long: number, trend?: number): void {
    this.ema9Period = short;
    this.ema21Period = long;
    if (trend) this.ema50Period = trend;
  }

  setRsiPeriod(period: number, ob: number, os: number): void {
    this.rsiPeriod = period;
    this.rsiOverbought = ob;
    this.rsiOversold = os;
  }

  setAtrConfiguration(period: number, threshold: number): void {
    this.atrPeriod = period;
    this.minAtrThreshold = threshold;
  }

  setVolumeMultiplier(m: number): void {
    this.minVolumeMultiplier = m;
  }

  setSignalCooldown(c: number): void {
    this.signalCooldownCandles = c;
  }

  setVolatilityThreshold(t: number): void {
    this.volatilityThreshold = t;
  }
}