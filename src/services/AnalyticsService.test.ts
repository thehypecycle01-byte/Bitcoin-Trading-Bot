import { AnalyticsService, AnalyticsClosedTrade, TradeMetrics } from './AnalyticsService';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService({ startingEquity: 10000 });
  });

  afterEach(() => {
    service.reset();
  });

  describe('calculateMetrics', () => {
    it('should return zero metrics for empty trades', () => {
      const metrics = service.getMetrics('all-time');
      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.sharpeRatio).toBe(0);
    });

    it('should calculate metrics for winning trades', () => {
      const trades: AnalyticsClosedTrade[] = [
        {
          symbol: 'BTCUSDT',
          side: 'Buy',
          entryPrice: 50000,
          exitPrice: 51000,
          quantity: 0.1,
          entryTime: Date.now() - 1000,
          exitTime: Date.now(),
          pnl: 100,
          pnlPercent: 2,
          reason: 'TP',
          fee: 1,
          slippage: 0.5,
          netPnL: 98.5,
          netPnLPercent: 1.97
        }
      ];

      // Mock private method by recording trade
      service.recordTrade({
        symbol: 'BTCUSDT',
        side: 'Buy',
        entryPrice: 50000,
        exitPrice: 51000,
        quantity: 0.1,
        entryTime: Date.now() - 1000,
        exitTime: Date.now(),
        pnl: 100,
        pnlPercent: 2,
        reason: 'TP'
      }, 1, 0.5);

      const metrics = service.getMetrics('all-time');
      expect(metrics.totalTrades).toBe(1);
      expect(metrics.winningTrades).toBe(1);
      expect(metrics.totalPnL).toBe(98.5);
      expect(metrics.winRate).toBe(100);
    });

    it('should handle all losses', () => {
      service.recordTrade({
        symbol: 'BTCUSDT',
        side: 'Buy',
        entryPrice: 50000,
        exitPrice: 49000,
        quantity: 0.1,
        entryTime: Date.now() - 1000,
        exitTime: Date.now(),
        pnl: -100,
        pnlPercent: -2,
        reason: 'SL'
      }, 1, 0.5);

      const metrics = service.getMetrics('all-time');
      expect(metrics.profitFactor).toBe(0);
      expect(metrics.expectancy).toBeLessThan(0);
    });

    it('should handle large trades', () => {
      service.recordTrade({
        symbol: 'BTCUSDT',
        side: 'Buy',
        entryPrice: 50000,
        exitPrice: 60000,
        quantity: 1,
        entryTime: Date.now() - 1000,
        exitTime: Date.now(),
        pnl: 10000,
        pnlPercent: 20,
        reason: 'TP'
      }, 10, 5);

      const metrics = service.getMetrics('all-time');
      expect(metrics.maxWin).toBe(9985);
      expect(metrics.totalPnL).toBe(9985);
    });
  });

  describe('updateDailyStats', () => {
    it('should update daily stats correctly', () => {
      const trade: AnalyticsClosedTrade = {
        symbol: 'BTCUSDT',
        side: 'Buy',
        entryPrice: 50000,
        exitPrice: 51000,
        quantity: 0.1,
        entryTime: Date.now() - 1000,
        exitTime: Date.now(),
        pnl: 100,
        pnlPercent: 2,
        reason: 'TP',
        fee: 1,
        slippage: 0.5,
        netPnL: 98.5,
        netPnLPercent: 1.97
      };

      // Access private method via type assertion
      (service as any).updateDailyStats(trade);
      const dailyStats = service.getDailyStats();
      expect(dailyStats.length).toBe(1);
      expect(dailyStats[0].tradesExecuted).toBe(1);
      expect(dailyStats[0].wins).toBe(1);
    });
  });

  describe('getConsecutiveStats', () => {
    it('should calculate consecutive wins and losses', () => {
      const trades: AnalyticsClosedTrade[] = [
        { ...mockTrade(), netPnL: 10 },
        { ...mockTrade(), netPnL: 20 },
        { ...mockTrade(), netPnL: -5 },
        { ...mockTrade(), netPnL: -10 },
        { ...mockTrade(), netPnL: -15 }
      ];

      const stats = (service as any).getConsecutiveStats(trades);
      expect(stats.maxConsecutiveWins).toBe(2);
      expect(stats.maxConsecutiveLosses).toBe(3);
    });
  });

  describe('calculateEquityCurve', () => {
    it('should calculate equity curve correctly', () => {
      const trades: AnalyticsClosedTrade[] = [
        { ...mockTrade(), netPnL: 100 },
        { ...mockTrade(), netPnL: -50 },
        { ...mockTrade(), netPnL: 200 }
      ];

      const curve = (service as any).calculateEquityCurve(trades, 10000);
      expect(curve.length).toBe(3);
      expect(curve[0].equity).toBe(10100);
      expect(curve[1].equity).toBe(10050);
      expect(curve[2].equity).toBe(10250);
    });
  });

  describe('validation', () => {
    it('should throw error for invalid trade', () => {
      expect(() => {
        service.recordTrade({
          symbol: '',
          side: 'Buy',
          entryPrice: -100,
          exitPrice: 50000,
          quantity: 0.1,
          entryTime: Date.now(),
          exitTime: Date.now(),
          pnl: 100,
          pnlPercent: 2,
          reason: 'TP'
        });
      }).toThrow('Invalid symbol');
    });
  });

  describe('exports', () => {
    it('should export trades as CSV', () => {
      service.recordTrade(mockTrade());
      const csv = service.exportTradesCSV();
      expect(csv).toContain('symbol,side');
      expect(csv).toContain('BTCUSDT');
    });

    it('should export daily stats as CSV', () => {
      service.recordTrade(mockTrade());
      const csv = service.exportDailyStatsCSV();
      expect(csv).toContain('date,openingEquity');
    });
  });
});

function mockTrade(): AnalyticsClosedTrade {
  return {
    symbol: 'BTCUSDT',
    side: 'Buy',
    entryPrice: 50000,
    exitPrice: 51000,
    quantity: 0.1,
    entryTime: Date.now() - 1000,
    exitTime: Date.now(),
    pnl: 100,
    pnlPercent: 2,
    reason: 'TP',
    fee: 1,
    slippage: 0.5,
    netPnL: 98.5,
    netPnLPercent: 1.97
  };
}