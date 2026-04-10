'use client';

import Head from 'next/head';
import { useEffect, useState, useRef, useCallback } from 'react';
import { marketAPI, tradesAPI, accountAPI } from '@/api';
import dynamic from 'next/dynamic';
import { Spinner, LoadingSkeletons } from '@/components/Loading';

interface CandleChartProps {
  data: Candle[];
  height?: number;
}

const CandleChart = dynamic<CandleChartProps>(
  () => import('@/components/CandleChart').then((mod) => mod.CandleChart),
  {
    ssr: false,
    loading: () => <Spinner />,
  }
);

// ============================================================================
// Types & Interfaces
// ============================================================================

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  id: string;
  symbol: string;
  entryPrice: number;
  quantity: number;
  side: 'long' | 'short' | 'Buy' | 'Sell';
  status: 'open' | 'closed' | 'pending';
  openTime: number;
  closeTime?: number;
  closePrice?: number;
  pnl?: number;
  roiPercentage?: number;
  takeProfitPrice: number;
  stopLossPrice: number;
}

interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  expectancy?: number;
  riskRewardRatio?: number;
}

interface TradeWithHistory extends Trade {
  priceHistory: number[]; // Last 30 price points
  previousPnL?: number; // Track previous P/L for flash animation
  flashTrigger?: boolean; // Indicates if flash animation should trigger
}

interface PricePoint {
  timestamp: number;
  price: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Canvas-based sparkline renderer for optimized performance
 */
const renderSparkline = (data: number[], canvasRef: HTMLCanvasElement | null, color: string) => {
  if (!canvasRef || data.length < 2) return;

  const ctx = canvasRef.getContext('2d');
  if (!ctx) return;

  const padding = 4;
  const width = canvasRef.width;
  const height = canvasRef.height;

  ctx.clearRect(0, 0, width, height);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();

  data.forEach((point, index) => {
    const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((point - min) / range) * (height - 2 * padding);

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
};

/**
 * Detect if P/L change is significant (>= 1% threshold)
 */
const isSignificantChange = (oldPnL: number | undefined, newPnL: number | undefined, threshold = 0.01): boolean => {
  if (!oldPnL || !newPnL) return false;
  const percentChange = Math.abs((newPnL - oldPnL) / oldPnL);
  return percentChange >= threshold;
};

/**
 * Format price with proper decimals
 */
const formatPrice = (price: number, decimals = 2): string => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
};

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * Live Price Display with Sparkline and Pulse Animation
 */
const LivePriceDisplay = ({ price, priceHistory, theme }: { price: number; priceHistory: PricePoint[]; theme: 'light' | 'dark' }) => {
  const sparklineRef = useRef<HTMLCanvasElement>(null);
  const priceChange = priceHistory.length >= 2 ? price - priceHistory[priceHistory.length - 2].price : 0;
  const isPositive = priceChange >= 0;

  useEffect(() => {
    if (sparklineRef.current && priceHistory.length > 0) {
      const prices = priceHistory.slice(-30).map(p => p.price);
      const color = isPositive ? '#10b981' : '#ef4444';
      renderSparkline(prices, sparklineRef.current, color);
    }
  }, [priceHistory, isPositive]);

  const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const borderColor = theme === 'dark' ? 'border-gray-700' : 'border-gray-300';
  const pulseClass = isPositive ? 'animate-pulse text-green-500' : 'animate-pulse text-red-500';

  return (
    <div className={`${bgColor} rounded-lg border ${borderColor} p-6 shadow-lg`}>
      <h2 className={`${textColor} text-lg font-semibold mb-2`}>BTC/USDT</h2>
      <div className={`${pulseClass} text-4xl font-bold mb-2`}>
        ${formatPrice(price, 2)}
      </div>
      <div className={`text-sm ${isPositive ? 'text-green-500' : 'text-red-500'} mb-4`}>
        {isPositive ? '↑' : '↓'} {formatPrice(Math.abs(priceChange), 2)}
      </div>
      <canvas
        ref={sparklineRef}
        width={220}
        height={60}
        className="w-full"
      />
    </div>
  );
};

/**
 * Performance Metric Card
 */
const MetricCard = ({ label, value, isPositive, theme }: { label: string; value: string | number; isPositive?: boolean; theme: 'light' | 'dark' }) => {
  const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const valueColor = isPositive === true ? 'text-green-500' : isPositive === false ? 'text-red-500' : 'text-blue-500';

  return (
    <div className={`${bgColor} rounded-lg border ${theme === 'dark' ? 'border-gray-700' : 'border-gray-300'} p-4 shadow`}>
      <p className={`${textColor} text-sm font-medium mb-1`}>{label}</p>
      <p className={`${valueColor} text-2xl font-bold`}>{value}</p>
    </div>
  );
};

/**
 * Single trade row component with independent hooks
 */
interface TradeRowProps {
  trade: TradeWithHistory;
  thresholdPct: number;
  theme: 'light' | 'dark';
}

const TradeRow = ({ trade, thresholdPct, theme }: TradeRowProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevPnLRef = useRef<number | undefined>(trade.previousPnL ?? trade.pnl);
  const [rowClass, setRowClass] = useState('');

  useEffect(() => {
    if (!canvasRef.current) return;
    const sparklineColor = (trade.pnl ?? 0) >= 0 ? '#10b981' : '#ef4444';
    renderSparkline(trade.priceHistory.slice(-30), canvasRef.current, sparklineColor);
  }, [trade.priceHistory, trade.pnl]);

  useEffect(() => {
    const prev = prevPnLRef.current ?? 0;
    const current = trade.pnl ?? 0;

    if (prev !== 0) {
      const changePct = Math.abs((current - prev) / prev);
      if (changePct >= thresholdPct) {
        setRowClass(current > prev ? 'bg-green-500/25 animate-flash' : 'bg-red-500/25 animate-flash');
        const timer = window.setTimeout(() => setRowClass(''), 800);
        return () => window.clearTimeout(timer);
      }
    }

    prevPnLRef.current = current;

    return undefined;
  }, [trade.pnl, thresholdPct]);

  const rowBorder = theme === 'dark' ? 'border-gray-700' : 'border-gray-200';
  const textColor = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const pnlClass = (trade.pnl ?? 0) >= 0 ? 'text-green-500' : 'text-red-500';

  return (
    <tr className={`border-t ${rowBorder} transition-colors duration-300 ${rowClass}`}>
      <td className={`px-3 py-2 ${textColor}`}>{trade.symbol}</td>
      <td className={`px-3 py-2 ${textColor}`}>${formatPrice(trade.entryPrice)}</td>
      <td className={`px-3 py-2 ${textColor}`}>{trade.quantity.toFixed(3)}</td>
      <td className={`px-3 py-2 ${textColor}`}>${formatPrice(trade.closePrice ?? trade.entryPrice)}</td>
      <td className={`px-3 py-2 font-semibold ${pnlClass} animate-pulse-pnl`}>${formatPrice(trade.pnl ?? 0)}</td>
      <td className={`px-3 py-2 font-semibold ${pnlClass}`}>{(trade.roiPercentage ?? 0).toFixed(2)}%</td>
      <td className="px-3 py-2">
        <canvas ref={canvasRef} width={100} height={30} className="w-24 h-8" />
      </td>
      <td className={`px-3 py-2 ${textColor}`}>{trade.status.toUpperCase()}</td>
    </tr>
  );
};

const TradesTableComponent = ({
  trades,
  type,
  theme,
  thresholdPct,
}: {
  trades: TradeWithHistory[];
  type: 'open' | 'closed';
  theme: 'light' | 'dark';
  thresholdPct: number;
}) => {
  if (trades.length === 0) {
    const textColor = theme === 'dark' ? 'text-gray-400' : 'text-gray-600';
    return <p className={`${textColor} text-center py-8`}>No {type} trades</p>;
  }

  const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const borderColor = theme === 'dark' ? 'border-gray-700' : 'border-gray-300';
  const headerText = theme === 'dark' ? 'text-gray-200' : 'text-gray-700';

  return (
    <div className={`${bgColor} rounded-lg border ${borderColor} overflow-hidden shadow-lg`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}>
            <tr>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>Symbol</th>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>Entry</th>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>Qty</th>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>Current</th>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>P/L</th>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>ROI</th>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>Chart</th>
              <th className={`px-4 py-3 text-left font-semibold ${headerText}`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <TradeRow key={trade.id} trade={trade} thresholdPct={thresholdPct} theme={theme} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================================
// Main Dashboard Component
// ============================================================================

export default function Dashboard() {
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Data states
  const [price, setPrice] = useState<number>(0);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<{ open: TradeWithHistory[]; closed: TradeWithHistory[] }>({
    open: [],
    closed: [],
  });
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Refs for tracking
  const tradeHistoryRef = useRef<{ [key: string]: number[] }>({});
  const tradeFlashRef = useRef<{ [key: string]: boolean }>({});

  /**
   * Initialize theme from localStorage
   */
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }
  }, []);

  /**
   * Toggle theme and persist to localStorage
   */
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const newTheme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', newTheme);
      document.documentElement.classList.toggle('dark', newTheme === 'dark');
      return newTheme;
    });
  }, []);

  /**
   * Fetch data from APIs
   */
  const fetchData = useCallback(async () => {
    try {
      const [marketRes, candlesRes, tradesRes, perfRes, balanceRes] = await Promise.all([
        marketAPI.getPrice().catch((e) => {
          console.error('Price fetch error:', e);
          return { data: { price: 0 } };
        }),
        marketAPI.getKlines().catch((e) => {
          console.error('Klines fetch error:', e);
          return { data: [] };
        }),
        tradesAPI.getTrades().catch((e) => {
          console.error('Trades fetch error:', e);
          return { data: { open: [], closed: [] } };
        }),
        tradesAPI.getPerformance().catch((e) => {
          console.error('Performance fetch error:', e);
          return { data: null };
        }),
        accountAPI.getBalance().catch((e) => {
          console.error('Balance fetch error:', e);
          return { data: { USDT: 0 } };
        }),
      ]);

      // Update price and history
      const newPrice = marketRes?.data?.price || 0;
      setPrice(newPrice);
      setPriceHistory((prev) => [...prev.slice(-29), { timestamp: Date.now(), price: newPrice }]);

      // Update candles
      setCandles(candlesRes?.data || []);

      // Update trades with sparklines and flash detection
      if (tradesRes?.data) {
        const { open: openTrades, closed: closedTrades } = tradesRes.data;
        const toTradesWithHistory = (t: Trade[]): TradeWithHistory[] =>
          t.map((trade) => {
            const histKey = trade.id;
            if (!tradeHistoryRef.current[histKey]) {
              tradeHistoryRef.current[histKey] = [];
            }

            // Get current price (for open trades, use closePrice if available, otherwise entryPrice)
            const currentPrice = trade.closePrice || trade.entryPrice;
            const history = tradeHistoryRef.current[histKey];
            history.push(currentPrice);
            if (history.length > 30) history.shift();

            // Detect P/L flash
            const oldPnL = trade.pnl;
            const shouldFlash = isSignificantChange(oldPnL, trade.pnl);

            if (shouldFlash && !tradeFlashRef.current[histKey]) {
              tradeFlashRef.current[histKey] = true;
              setTimeout(() => {
                tradeFlashRef.current[histKey] = false;
              }, 800); // Flash animation duration
            }

            return {
              ...trade,
              priceHistory: history,
              previousPnL: oldPnL,
              flashTrigger: tradeFlashRef.current[histKey],
            };
          });

        setTrades({
          open: toTradesWithHistory(openTrades),
          closed: toTradesWithHistory(closedTrades),
        });
      }

      // Update performance metrics
      setPerformance(perfRes?.data || null);

      // Update balance
      setBalance(balanceRes?.data?.USDT || 0);

      setLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoading(false);
    }
  }, []);

  /**
   * Setup initial data fetch and polling interval
   */
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Update every 15 seconds
    return () => clearInterval(interval);
  }, [fetchData]);

  /**
   * Add CSS animations to document head
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const styleId = 'dashboard-animations';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes pulse-pnl {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        
        @keyframes flash-bg {
          0% { background-color: currentColor; }
          100% { background-color: transparent; }
        }
        
        .animate-pulse-pnl {
          animation: pulse-pnl 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        
        .animate-flash {
          animation: flash-bg 0.8s ease-out;
        }
      `;
      document.head.appendChild(style);
    }

    return () => {
      const element = document.getElementById(styleId);
      if (element) element.remove();
    };
  }, []);

  // Loading state
  if (loading) {
    const bgColor = theme === 'dark' ? 'bg-gray-950' : 'bg-white';
    return (
      <div className={`min-h-screen ${bgColor} text-white p-6`}>
        <LoadingSkeletons />
      </div>
    );
  }

  const bgColor = theme === 'dark' ? 'bg-gray-950' : 'bg-gray-50';
  const headerBg = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const headerBorder = theme === 'dark' ? 'border-gray-700' : 'border-gray-300';
  const headerText = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const subText = theme === 'dark' ? 'text-gray-400' : 'text-gray-600';

  const totalTrades = trades.open.length + trades.closed.length;

  return (
    <>
      <Head>
        <title>Bitcoin Trading Bot Dashboard</title>
        <meta name="description" content="Automated BTC trading with EMA/RSI strategy" />
      </Head>

      <div className={`min-h-screen ${bgColor} ${headerText}`}>
        {/* Header with Theme Toggle */}
        <div className={`${headerBg} border-b ${headerBorder} px-6 py-4 shadow-md`}>
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">📊 Bitcoin Trading Bot</h1>
              <p className={`${subText} text-sm mt-1`}>EMA/RSI Strategy • Bybit Integration • Real-time Analytics</p>
            </div>
            <button
              onClick={toggleTheme}
              className={`px-4 py-2 rounded-lg font-semibold transition-all duration-300 ${
                theme === 'dark'
                  ? 'bg-yellow-500 text-gray-900 hover:bg-yellow-400'
                  : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}
            >
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-6 max-w-7xl mx-auto space-y-6">
          {/* Live Price & Account Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2">
              <LivePriceDisplay price={price} priceHistory={priceHistory} theme={theme} />
            </div>
            <MetricCard
              label="Account Balance"
              value={`$${formatPrice(balance)}`}
              isPositive={balance > 0}
              theme={theme}
            />
            <MetricCard
              label="Trades Today"
              value={totalTrades}
              isPositive={totalTrades > 0}
              theme={theme}
            />
          </div>

          {/* Candlestick Chart */}
          <div className={`${headerBg} rounded-lg border ${headerBorder} p-4 shadow-lg`}>
            <h2 className={`${headerText} text-lg font-semibold mb-4`}>BTC/USDT Chart (5m)</h2>
            {candles.length > 0 ? <CandleChart data={candles} height={400} /> : <Spinner />}
          </div>

          {/* Performance Metrics */}
          {performance && (
            <div>
              <h2 className={`${headerText} text-lg font-semibold mb-4`}>Performance Metrics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard label="Total Trades" value={performance.totalTrades} theme={theme} />
                <MetricCard
                  label="Winning Trades"
                  value={performance.winningTrades}
                  isPositive={true}
                  theme={theme}
                />
                <MetricCard
                  label="Losing Trades"
                  value={performance.losingTrades}
                  isPositive={false}
                  theme={theme}
                />
                <MetricCard
                  label="Win Rate"
                  value={`${formatPrice(performance.winRate)}%`}
                  isPositive={performance.winRate > 50}
                  theme={theme}
                />
                <MetricCard
                  label="Profit Factor"
                  value={formatPrice(performance.profitFactor, 2)}
                  isPositive={performance.profitFactor > 1}
                  theme={theme}
                />
                <MetricCard
                  label="Total P/L"
                  value={`$${formatPrice(performance.totalPnL)}`}
                  isPositive={performance.totalPnL >= 0}
                  theme={theme}
                />
                <MetricCard
                  label="Max Drawdown"
                  value={`$${formatPrice(performance.maxDrawdown)}`}
                  isPositive={false}
                  theme={theme}
                />
                <MetricCard
                  label="Sharpe Ratio"
                  value={formatPrice(performance.sharpeRatio, 2)}
                  isPositive={performance.sharpeRatio > 0}
                  theme={theme}
                />
                {performance.expectancy && (
                  <MetricCard
                    label="Expectancy"
                    value={`$${formatPrice(performance.expectancy, 2)}`}
                    isPositive={performance.expectancy > 0}
                    theme={theme}
                  />
                )}
                {performance.riskRewardRatio && (
                  <MetricCard
                    label="Risk/Reward"
                    value={formatPrice(performance.riskRewardRatio, 2)}
                    isPositive={performance.riskRewardRatio > 1}
                    theme={theme}
                  />
                )}
              </div>
            </div>
          )}

          {/* Open Trades Table */}
          <div>
            <h2 className={`${headerText} text-lg font-semibold mb-4`}>Open Positions ({trades.open.length})</h2>
            <TradesTableComponent trades={trades.open} type="open" theme={theme} thresholdPct={0.01} />
          </div>

          {/* Closed Trades Table */}
          <div>
            <h2 className={`${headerText} text-lg font-semibold mb-4`}>Trade History ({trades.closed.length})</h2>
            <TradesTableComponent trades={trades.closed} type="closed" theme={theme} thresholdPct={0.01} />
          </div>
        </div>
      </div>
    </>
  );
}
