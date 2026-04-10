/**
 * INTEGRATION EXAMPLE: Production-Grade Trading System
 *
 * This file demonstrates how to integrate:
 * - SignalEngine (AI signal generation)
 * - RiskManager (position sizing)
 * - PortfolioManager (trade tracking)
 * - TradeEngine (orchestration)
 * - AnalyticsService (PnL tracking)
 *
 * With your existing:
 * - BybitService (API interaction)
 * - BybitWebSocket (price stream)
 */

import { BybitService } from './bybit';
import { BybitWebSocket } from './websocket';
import { TradeEngine } from './TradeEngine';
import { CandleData } from './SignalEngine';

/**
 * Step 1: Initialize Core Services
 */
export async function initializeTradeSystem() {
  const apiKey = process.env.BYBIT_API_KEY || '';
  const apiSecret = process.env.BYBIT_API_SECRET || '';
  const isTestnet = process.env.BYBIT_TESTNET === 'true';

  // Initialize trading services
  const bybitService = new BybitService(apiKey, apiSecret, isTestnet);
  const wsClient = new BybitWebSocket(isTestnet);
  const tradeEngine = new TradeEngine(bybitService, 10000); // Starting capital: $10,000

  // Configure trade engine
  tradeEngine.configure({
    enabled: false, // Start disabled for safety testing
    riskPercent: 0.01, // 1% risk per trade
    minConfidence: 0.65, // 65% signal confidence threshold
    maxConcurrentTrades: 3, // Max 3 open trades
    cooldownSeconds: 30, // 30 second cooldown between trades on same symbol
    maxDailyLossPercent: 0.05 // Stop trading if daily loss > 5%
  });

  return { bybitService, wsClient, tradeEngine };
}

/**
 * Step 2: Connect WebSocket and Setup Price Update Handler
 */
export async function setupPriceUpdates(
  wsClient: BybitWebSocket,
  tradeEngine: TradeEngine,
  symbols: string[] = ['BTCUSDT']
) {
  await wsClient.connect();

  wsClient.on('connected', () => {
    console.log('[Integration] WebSocket connected - subscribing to symbols');
    symbols.forEach(symbol => {
      wsClient.subscribe(symbol);
    });
  });

  wsClient.on('priceUpdate', async (update) => {
    console.log(`[Integration] Price: ${update.symbol} @ $${update.price.toFixed(2)}`);
  });

  wsClient.on('disconnected', () => {
    console.log('[Integration] WebSocket disconnected');
  });
}

/**
 * Step 3: Setup Trading Loop (Process Candles Every X Seconds)
 */
export function setupTradingLoop(
  bybitService: BybitService,
  tradeEngine: TradeEngine,
  symbols: string[] = ['BTCUSDT'],
  intervalSeconds: number = 15
) {
  const tradingInterval = setInterval(async () => {
    for (const symbol of symbols) {
      try {
        // Fetch historical candles (200 candles, 5-min interval)
        const candles = await bybitService.getKlines(symbol, '5', 200);

        if (candles.length === 0) {
          console.warn(`[Integration] No candles received for ${symbol}`);
          continue;
        }

        // Convert to format expected by SignalEngine
        const candleData: CandleData[] = candles.map(kline => ({
          timestamp: kline.timestamp,
          open: kline.open,
          high: kline.high,
          low: kline.low,
          close: kline.close,
          volume: kline.volume
        }));

        // Process price update through TradeEngine
        // This will:
        // 1. Generate signal via SignalEngine
        // 2. Check portfolio constraints via PortfolioManager
        // 3. Calculate position size via RiskManager
        // 4. Execute trade via BybitService
        // 5. Record analytics via AnalyticsService
        await tradeEngine.onPriceUpdate(symbol, candleData);
      } catch (error) {
        console.error(`[Integration] Error processing ${symbol}:`, error);
      }
    }
  }, intervalSeconds * 1000);

  return tradingInterval;
}

/**
 * Step 4: Setup Dashboard API Routes
 */
export function setupDashboardRoutes(app: any, tradeEngine: TradeEngine) {
  // Get current portfolio state
  app.get('/api/portfolio', async (req: any, res: any) => {
    try {
      const portfolio = await tradeEngine.getPortfolioState();
      res.json(portfolio);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Get trading metrics
  app.get('/api/metrics', (req: any, res: any) => {
    try {
      const metrics = tradeEngine.getMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Get last signals for all symbols
  app.get('/api/signals', (req: any, res: any) => {
    try {
      const signals = tradeEngine.getAllLastSignals();
      const signalsArray = Array.from(signals.values());
      res.json(signalsArray);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Enable/disable trading
  app.post('/api/trading/:action', (req: any, res: any) => {
    try {
      const { action } = req.params;
      if (action === 'start') {
        tradeEngine.setEnabled(true);
        res.json({ status: 'Trading enabled' });
      } else if (action === 'stop') {
        tradeEngine.setEnabled(false);
        res.json({ status: 'Trading disabled' });
      } else {
        res.status(400).json({ error: 'Unknown action' });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Emergency close all trades
  app.post('/api/trading/emergency-close', async (req: any, res: any) => {
    try {
      await tradeEngine.closeAllTrades();
      res.json({ status: 'All trades closed' });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Get analytics
  app.get('/api/analytics', (req: any, res: any) => {
    try {
      const services = tradeEngine.getServices() as any;
      const analytics = services.analytics.getMetrics('all-time');
      const dailyStats = services.analytics.getDailyStats();
      const symbolPerf = services.analytics.getSymbolPerformance();
      res.json({ metrics: analytics, dailyStats, symbolPerformance: symbolPerf });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}

/**
 * Step 5: Complete Initialization Function
 */
export async function initializeFullSystem(app: any) {
  console.log('[Integration] Initializing production trading system...');

  // Initialize all services
  const { bybitService, wsClient, tradeEngine } = await initializeTradeSystem();

  // Setup price updates
  await setupPriceUpdates(wsClient, tradeEngine, ['BTCUSDT', 'ETHUSDT']);

  // Setup trading loop (every 15 seconds)
  const tradingLoop = setupTradingLoop(
    bybitService,
    tradeEngine,
    ['BTCUSDT', 'ETHUSDT'],
    15
  );

  // Setup dashboard routes
  setupDashboardRoutes(app, tradeEngine);

  console.log('[Integration] System initialized successfully');
  console.log('[Integration] Trading is DISABLED by default - enable via /api/trading/start');

  return {
    tradeEngine,
    WSClient: wsClient,
    bybitService,
    tradingLoop
  };
}

/**
 * USAGE IN YOUR main index.ts:
 *
 * import express from 'express';
 * import { initializeFullSystem } from './services/integration-example';
 *
 * const app = express();
 *
 * async function main() {
 *   const system = await initializeFullSystem(app);
 *   app.listen(5000, () => {
 *     console.log('Trading server running on port 5000');
 *
 *     // Example: Start trading after 2 seconds
 *     // setTimeout(() => {
 *     //   system.tradeEngine.setEnabled(true);
 *     // }, 2000);
 *   });
 * }
 *
 * main().catch(console.error);
 */

/**
 * API ENDPOINTS CREATED:
 *
 * GET  /api/portfolio       - Current portfolio state (open trades, equity, PnL)
 * GET  /api/metrics         - Trading metrics (win rate, profit factor, etc)
 * GET  /api/signals         - Latest signals for each symbol
 * POST /api/trading/start   - Enable trading
 * POST /api/trading/stop    - Disable trading
 * POST /api/trading/emergency-close - Close all open trades
 * GET  /api/analytics       - Detailed analytics (daily stats, symbol performance)
 */

/**
 * PERFORMANCE NOTES:
 *
 * 1. Signal generation: ~100-200ms per symbol (EMA + RSI calculation)
 * 2. Trade execution: ~200-500ms (API call + order confirmation)
 * 3. Portfolio check: <10ms (local map lookup)
 * 4. Risk calculation: <5ms (simple math)
 *
 * Total per symbol per cycle: ~300-700ms
 * With 2 symbols: ~600ms-1.4s per 15s cycle = well under budget
 *
 * WebSocket remains independent and responsive
 */

/**
 * SAFETY FEATURES ENABLED:
 *
 * ✅ Symbol-level execution lock (no duplicate orders)
 * ✅ 30-second cooldown between same-symbol trades
 * ✅ Max 3 concurrent trades limit
 * ✅ 1% risk per trade (adjustable)
 * ✅ 65% signal confidence threshold
 * ✅ 5% daily loss limit (auto-stops trading)
 * ✅ 200 pip TP / 100 pip SL (configurable)
 * ✅ Spread validation before market orders
 * ✅ Retry logic for API failures
 * ✅ Rate limiting (100ms between requests)
 * ✅ Graceful error handling and logging
 */
