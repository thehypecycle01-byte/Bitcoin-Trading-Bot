import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createAPIRoutes } from './routes/api';
import { BybitService } from './services/bybit';
import { BybitWebSocket } from './services/websocket';
import { TradingEngine } from './models/engine';
import { CandleData } from './strategy/indicators';

dotenv.config();

const app = express();
// Set PORT dynamically; default to 5000
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
const bybit = new BybitService(
  process.env.BYBIT_API_KEY || '',
  process.env.BYBIT_API_SECRET || '',
  process.env.BYBIT_TESTNET === 'true'
);

const wsClient = new BybitWebSocket(process.env.BYBIT_TESTNET === 'true');

const engine = new TradingEngine(bybit, {
  riskPercentage: parseFloat(process.env.RISK_PERCENTAGE || '1'),
  takeProfitPercentage: parseFloat(process.env.TAKE_PROFIT_PERCENTAGE || '2'),
  stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || '1'),
  maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY || '5')
});

// API Routes
app.use('/api', createAPIRoutes(engine, bybit));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocket setup and trading loop
let isRunning = false;

async function startTradingBot(): Promise<void> {
  try {
    console.log('[TradingBot] Initializing trading engine...');
    await engine.initialize();

    console.log('[TradingBot] Connecting to WebSocket...');
    try {
      await wsClient.connect();
      
      // Listen for connection events
      wsClient.on('connected', () => {
        console.log('[TradingBot] WebSocket connected - subscribing to BTCUSDT');
        wsClient.subscribe('BTCUSDT');
      });

      wsClient.on('disconnected', () => {
        console.log('[TradingBot] WebSocket disconnected');
      });

      wsClient.on('reconnectAttempt', (data) => {
        console.log(`[TradingBot] WebSocket reconnect attempt ${data.attempt} in ${data.delay}ms`);
      });

      wsClient.on('reconnectFailed', () => {
        console.error('[TradingBot] WebSocket reconnection failed - trading loop disabled');
        isRunning = false;
      });

      // Market data update handler
      wsClient.on('priceUpdate', async (update) => {
        console.log(`[TradingBot] Price update: ${update.symbol} @ $${update.price.toFixed(2)}`);
      });

      console.log('[TradingBot] Starting trading loop...');
      isRunning = true;

      // Periodic market check (every 10-15 seconds)
      const intervalSeconds = parseInt(process.env.INTERVAL_SECONDS || '15');
      const tradingLoopInterval = setInterval(async () => {
        if (!isRunning) return;

        try {
          // Fetch latest kline
          const klines = await bybit.getKlines('BTCUSDT', '5', 1);
          if (klines.length > 0) {
            const kline = klines[0];
            const candle: CandleData = {
              timestamp: kline.timestamp,
              open: kline.open,
              high: kline.high,
              low: kline.low,
              close: kline.close,
              volume: kline.volume
            };

            const signal = await engine.processMarketUpdate(candle);
            if (signal) {
              console.log(`[TradingBot] SIGNAL: ${signal.type.toUpperCase()} @ $${signal.price.toFixed(2)} (Confidence: ${(signal.confidence * 100).toFixed(1)}%)`);
            }
          }
        } catch (error) {
          console.error('[TradingBot] Error in trading loop:', error instanceof Error ? error.message : error);
        }
      }, intervalSeconds * 1000);

      // Store interval for cleanup on process termination
      (global as any).tradingLoopInterval = tradingLoopInterval;

      console.log('[TradingBot] Trading bot started successfully');
    } catch (wsError) {
      console.error('[TradingBot] WebSocket connection failed:', wsError instanceof Error ? wsError.message : wsError);
      console.warn('[TradingBot] Proceeding without real-time WebSocket. API routes remain available.');
      isRunning = false;
      // Keep API server running even if WebSocket fails
    }
  } catch (error) {
    console.error('[TradingBot] Error starting trading bot:', error instanceof Error ? error.message : error);
    console.warn('[TradingBot] Proceeding without trading loop. API routes remain available.');
    isRunning = false;
    // do not exit, keep API server running
  }
}

// Graceful shutdown handler
function setupGracefulShutdown() {
  const shutdown = (signal: string) => {
    console.log(`\n[TradingBot] Received ${signal}, initiating graceful shutdown...`);
    isRunning = false;
    
    // Clear trading loop interval
    const interval = (global as any).tradingLoopInterval;
    if (interval) {
      clearInterval(interval);
      console.log('[TradingBot] Trading loop interval cleared');
    }
    
    // Close WebSocket
    wsClient.disconnect?.();
    
    console.log('[TradingBot] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Start server with dynamic port selection
function startServer(port: number) {
  const server = app.listen(port, async () => {
    console.log(`Server running on port ${port}`);
    setupGracefulShutdown();
    await startTradingBot();
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying port ${port + 1}...`);
      startServer(port + 1); // Increment port and retry
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

// Start server
startServer(PORT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  isRunning = false;
  wsClient.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  isRunning = false;
  wsClient.disconnect();
  process.exit(0);
});

export default app;
