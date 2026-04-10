import { Router, Request, Response } from 'express';
import { TradingEngine } from '../models/engine';
import { BybitService } from '../services/bybit';

// Utility function for detailed error logging and handling
function handleError(error: unknown, context: string, res: Response, statusCode: number = 500) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  console.error(`[${context}] Error:`, {
    message: errorMessage,
    stack: errorStack,
    timestamp: new Date().toISOString()
  });

  res.status(statusCode).json({
    error: errorMessage,
    context,
    timestamp: Date.now()
  });
}

export function createAPIRoutes(
  engine: TradingEngine,
  bybit: BybitService
): Router {
  const router = Router();

  // GET /api/market - Get current market data
  router.get('/market', async (req: Request, res: Response) => {
    try {
      const market = await bybit.getMarketPrice();
      res.json(market);
    } catch (error) {
      const fallback = {
        symbol: 'BTCUSDT',
        price: 0,
        bid: 0,
        ask: 0,
        timestamp: Date.now()
      };
      handleError(error, 'GET /api/market', res, 503);
    }
  });

  // GET /api/trades - Get open and closed trades
  router.get('/trades', (req: Request, res: Response) => {
    try {
      const openTrades = engine.getOpenTrades();
      const closedTrades = engine.getClosedTrades();
      res.json({
        open: openTrades,
        closed: closedTrades,
        totalTrades: openTrades.length + closedTrades.length,
        tradesPerDay: engine.getTradesPerDay()
      });
    } catch (error) {
      handleError(error, 'GET /api/trades', res);
    }
  });

  // GET /api/performance - Get performance metrics
  router.get('/performance', (req: Request, res: Response) => {
    try {
      const metrics = engine.getPerformanceMetrics();
      res.json(metrics);
    } catch (error) {
      handleError(error, 'GET /api/performance', res);
    }
  });

  // GET /api/analytics - Get detailed analytics (new endpoint)
  router.get('/analytics', (req: Request, res: Response) => {
    try {
      const timeFrame = (req.query.timeFrame as string) || 'all-time';
      const metrics = engine.getAnalyticsMetrics(timeFrame as any);
      const dailyStats = engine.getDailyStats();
      
      res.json({
        metrics,
        dailyStats,
        timeFrame,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleError(error, 'GET /api/analytics', res);
    }
  });

  // POST /api/order - Place manual order
  router.post('/order', async (req: Request, res: Response) => {
    try {
      const { symbol, side, quantity, price } = req.body;

      if (!symbol || !side || !quantity) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          required: ['symbol', 'side', 'quantity', 'price (for limit orders)'],
          context: 'POST /api/order'
        });
      }

      if (typeof quantity !== 'number' || quantity <= 0) {
        return res.status(400).json({ 
          error: 'Quantity must be a positive number',
          context: 'POST /api/order'
        });
      }

      const order = await bybit.placeOrder({
        symbol,
        side,
        orderType: 'Limit',
        quantity,
        price
      });

      res.json(order);
    } catch (error) {
      handleError(error, 'POST /api/order', res);
    }
  });

  // GET /api/positions - Get current positions
  router.get('/positions', async (req: Request, res: Response) => {
    try {
      const positions = await bybit.getPositions();
      res.json(positions);
    } catch (error) {
      handleError(error, 'GET /api/positions', res, 503);
    }
  });

  // GET /api/balance - Get account balance
  router.get('/balance', async (req: Request, res: Response) => {
    try {
      const balance = await bybit.getBalance();
      res.json(balance);
    } catch (error) {
      handleError(error, 'GET /api/balance', res, 503);
    }
  });

  // GET /api/klines - Get historical candlestick data
  router.get('/klines', async (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string) || 'BTCUSDT';
      const interval = (req.query.interval as string) || '5';
      const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);

      if (!symbol || !interval) {
        return res.status(400).json({
          error: 'Missing symbol or interval parameter',
          context: 'GET /api/klines'
        });
      }

      const klines = await bybit.getKlines(symbol, interval, limit);
      res.json({ symbol, interval, limit, klines, count: klines.length });
    } catch (error) {
      handleError(error, 'GET /api/klines', res, 503);
    }
  });

  return router;
}
