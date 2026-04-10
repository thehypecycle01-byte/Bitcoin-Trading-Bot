# Common Modifications Guide

Quick recipes for common changes to the trading bot.

## 🔄 Modify Strategy

### Change Entry/Exit Conditions

**File**: `src/strategy/signals.ts`

**Current Strategy:**
```typescript
// BUY: EMA50 > EMA200 AND RSI < 40
// SELL: EMA50 < EMA200 AND RSI > 60
```

**Example 1: More Conservative (Fewer, Higher Confidence Trades)**
```typescript
// In determineSignal() method:

// BUY Signal: Only on strong bullish + oversold
if (
  indicators.ema50 > indicators.ema200 &&
  indicators.rsi14 < 35  // More oversold
) {
  // Add extra confirmation
  const emaDiff = (indicators.ema50 - indicators.ema200) / indicators.ema200;
  if (emaDiff > 0.005) { // 0.5% difference minimum
    return SignalType.BUY;
  }
}

// SELL Signal: Only on strong bearish + overbought
if (
  indicators.ema50 < indicators.ema200 &&
  indicators.rsi14 > 65  // More overbought
) {
  const emaDiff = (indicators.ema200 - indicators.ema50) / indicators.ema200;
  if (emaDiff > 0.005) { // 0.5% difference minimum
    return SignalType.SELL;
  }
}
```

**Example 2: Add MACD Filter**
```typescript
// First add MACD calculation to indicators.ts
// Then in signals.ts:

if (
  indicators.ema50 > indicators.ema200 &&
  indicators.rsi14 < 40 &&
  indicators.macd > indicators.macdSignal  // MACD bullish
) {
  return SignalType.BUY;
}
```

### Add New Indicator

**File**: `src/strategy/indicators.ts`

```typescript
import { MACD, Stochastic, BollingerBands } from 'technicalindicators';

// Add to Indicators interface:
export interface Indicators {
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: number;           // Add MACD
  macdSignal: number;
  macdHistogram: number;
  stochastic: number;     // Add Stochastic
  bollingerUpper: number; // Add Bollinger
  bollingerLower: number;
  timestamp: number;
  price: number;
}

// Add calculation methods:
calculateMACD(): number | null {
  if (this.candles.length < 26) return null;
  const closes = this.candles.map(c => c.close);
  const macdData = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
  return macdData.length > 0 ? macdData[macdData.length - 1] : null;
}

// Update getIndicators() to include new indicators
```

## 💰 Adjust Risk Management

**File**: `.env` or `src/models/engine.ts`

### Reduce Risk (Conservative)
```bash
RISK_PERCENTAGE=0.5           # 0.5% instead of 1%
TAKE_PROFIT_PERCENTAGE=1      # 1% instead of 2%
STOP_LOSS_PERCENTAGE=0.5      # 0.5% instead of 1%
MAX_TRADES_PER_DAY=3          # 3 instead of 5
```

### Increase Risk (Aggressive)
```bash
RISK_PERCENTAGE=2             # 2% instead of 1%
TAKE_PROFIT_PERCENTAGE=4      # 4% instead of 2%
STOP_LOSS_PERCENTAGE=2        # 2% instead of 1%
MAX_TRADES_PER_DAY=10         # 10 instead of 5
```

### Implement Trailing Stop

**File**: `src/models/engine.ts`

```typescript
// In Trade interface:
interface Trade {
  // ... existing fields ...
  trailingStopPrice?: number;
  peakPrice?: number;
}

// In executeBuy():
const trade: Trade = {
  // ... existing ...
  trailingStopPrice: stopLossPrice,
  peakPrice: signal.price
};

// Add periodic update in trading loop:
private updateTrailingStops(currentPrice: number): void {
  for (const trade of this.openTrades.values()) {
    if (trade.status !== 'open') continue;
    
    if (currentPrice > trade.peakPrice!) {
      trade.peakPrice = currentPrice;
      // Move trailing stop up by 0.5% of new peak
      trade.trailingStopPrice = currentPrice * 0.995;
    }
  }
}
```

## 📊 Modify Dashboard

**File**: `frontend/src/pages/index.tsx`

### Add Real-time Updates
```typescript
// Add useEffect with WebSocket subscription:
useEffect(() => {
  const ws = new WebSocket('ws://localhost:5000/ws');
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'priceUpdate') {
      setPrice(data.price);
    }
  };
  
  return () => ws.close();
}, []);
```

### Add Alert Notifications
```typescript
// Install: npm install react-toastify
import { toast } from 'react-toastify';

// Use in components:
const handleTrade = async (trade: Trade) => {
  try {
    // Place trade
    toast.success(`${trade.side.toUpperCase()} trade executed!`);
  } catch (error) {
    toast.error(`Trade failed: ${error.message}`);
  }
};
```

### Add Tab Navigation
```typescript
const [activeTab, setActiveTab] = useState('overview');

return (
  <div className="space-y-6">
    <div className="flex gap-4 border-b">
      <button 
        onClick={() => setActiveTab('overview')}
        className={activeTab === 'overview' ? 'border-b-2' : ''}
      >
        Overview
      </button>
      <button 
        onClick={() => setActiveTab('trades')}
        className={activeTab === 'trades' ? 'border-b-2' : ''}
      >
        Trades
      </button>
    </div>
    
    {activeTab === 'overview' && <OverviewSection />}
    {activeTab === 'trades' && <TradesSection />}
  </div>
);
```

## 🔗 Add Custom API Endpoint

**File**: `src/routes/api.ts`

```typescript
// Add new endpoint:
router.get('/custom-metric', async (req: Request, res: Response) => {
  try {
    const trades = engine.getClosedTrades();
    
    // Calculate custom metric
    const consecutiveWins = calculateConsecutiveWins(trades);
    const winStreak = Math.max(...consecutiveWins);
    
    res.json({
      winStreak,
      lastTrade: trades[trades.length - 1]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate metric' });
  }
});

// Helper function
function calculateConsecutiveWins(trades: Trade[]): number[] {
  const streaks = [];
  let streak = 0;
  
  for (const trade of trades) {
    if ((trade.pnl || 0) > 0) {
      streak++;
    } else {
      if (streak > 0) streaks.push(streak);
      streak = 0;
    }
  }
  
  return streaks.length > 0 ? streaks : [0];
}
```

## 📱 Add Email Alerts

**Install**: `npm install nodemailer`

**File**: `src/services/alerts.ts`

```typescript
import nodemailer from 'nodemailer';

export class AlertService {
  private transporter: nodemailer.Transporter;

  constructor(emailConfig: {
    user: string;
    pass: string;
  }) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: emailConfig
    });
  }

  async sendTradeAlert(trade: {
    side: string;
    price: number;
    quantity: number;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.ALERT_EMAIL,
      to: process.env.ALERT_TO_EMAIL,
      subject: `🚨 ${trade.side} Signal: ${trade.quantity} BTC @ $${trade.price}`,
      html: `
        <h2>${trade.side} Signal</h2>
        <p>Price: $${trade.price}</p>
        <p>Quantity: ${trade.quantity}</p>
        <p>Time: ${new Date().toISOString()}</p>
      `
    });
  }
}
```

Use it:
```typescript
// In index.ts
const alerts = new AlertService({
  user: process.env.GMAIL_USER!,
  pass: process.env.GMAIL_PASSWORD!
});

// When trade executes:
await alerts.sendTradeAlert(trade);
```

## 🗄️ Add Database Logging

**Install**: `npm install pg` (PostgreSQL) or `npm install mongodb`

**File**: `src/services/database.ts`

```typescript
import { Pool } from 'pg';

export class DatabaseService {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async saveTrade(trade: Trade): Promise<void> {
    const query = `
      INSERT INTO trades 
      (id, symbol, entry_price, quantity, side, status, open_time, pnl, roi)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    
    await this.pool.query(query, [
      trade.id,
      trade.symbol,
      trade.entryPrice,
      trade.quantity,
      trade.side,
      trade.status,
      new Date(trade.openTime),
      trade.pnl,
      trade.roiPercentage
    ]);
  }
}
```

## 🔌 Change Chart Timeframe

**File**: `backend/src/index.ts`

```typescript
// Change from 5m to 15m:
setInterval(async () => {
  const klines = await bybit.getKlines('BTCUSDT', '15', 1); // 15 instead of 5
  // ...
}, intervalSeconds * 1000);
```

**File**: `frontend/src/pages/index.tsx`

```typescript
// In API call:
const candlesRes = await marketAPI.getKlines('BTCUSDT', '15', 200);
```

## 🎨 Change Dashboard Theme

**File**: `frontend/tailwind.config.js`

```javascript
// Change from dark gray to navy:
theme: {
  extend: {
    colors: {
      gray: {
        950: '#0a0e27',  // Navy instead of black
        900: '#1a1f3a',
        700: '#3d4661',
      },
      // Add accent color
      trading: {
        green: '#10b981',  // Profit color
        red: '#ef4444',    // Loss color
      }
    },
  },
},
```

## 🔐 Add API Authentication

**File**: `src/middleware/auth.ts`

```typescript
import jwt from 'jsonwebtoken';

export function verifyToken(req: any, res: any, next: Function) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
}

// Use in routes:
router.get('/trades', verifyToken, (req, res) => {
  // Handle request
});
```

## 📝 Integration Checklist

After making modifications:

- [ ] Test on testnet first
- [ ] Check TypeScript compilation: `npm run build`
- [ ] Verify API endpoints: `curl http://localhost:5000/api/...`
- [ ] Check logs for errors
- [ ] Monitor dashboard for correct data
- [ ] Validate strategy signals match expectations
- [ ] Check for performance regressions
- [ ] Run for 24+ hours before going live

---

**Need more help?** Each modification is documented in the code with comments. Check inline documentation for details!
