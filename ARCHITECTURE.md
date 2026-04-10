# Project Structure

```
NEW_BTC_TRADING_BOT_BYBIT/
├── .github/
│   └── copilot-instructions.md      # AI assistant guidelines
│
├── src/                              # Backend TypeScript source
│   ├── index.ts                      # Entry point & server
│   ├── strategy/
│   │   ├── indicators.ts             # EMA, RSI calculations
│   │   └── signals.ts                # Buy/Sell signal generation
│   ├── services/
│   │   ├── bybit.ts                  # Bybit API client
│   │   └── websocket.ts              # WebSocket price updates
│   ├── models/
│   │   └── engine.ts                 # Trading engine & risk management
│   └── routes/
│       └── api.ts                    # REST API endpoints
│
├── frontend/                         # Next.js React app
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index.tsx             # Main dashboard
│   │   │   ├── _app.tsx              # App wrapper
│   │   │   └── _document.tsx         # HTML document
│   │   ├── components/
│   │   │   ├── CandleChart.tsx       # TradingView chart
│   │   │   ├── PriceDisplay.tsx      # Price ticker
│   │   │   ├── TradesTable.tsx       # Trade history
│   │   │   ├── StatCard.tsx          # Stat display
│   │   │   └── Loading.tsx           # Loading UI
│   │   ├── styles/
│   │   │   └── globals.css           # Global styles
│   │   └── api.ts                    # API client
│   ├── public/                       # Static files
│   ├── tailwind.config.js            # Tailwind config
│   ├── postcss.config.js             # PostCSS config
│   ├── next.config.js                # Next.js config
│   ├── tsconfig.json                 # TypeScript config
│   ├── package.json                  # Dependencies
│   └── .env.local                    # Frontend env
│
├── .env.example                      # Environment template
├── package.json                      # Backend dependencies
├── tsconfig.json                     # TypeScript config
├── README.md                         # Project overview
├── SETUP.md                          # Setup instructions
└── ARCHITECTURE.md                   # Architecture docs (this file)
```

## Architecture Overview

### Backend Flow

```
┌─────────────────────────────────────────┐
│        Main Process (index.ts)          │
│  - Express server on :5000              │
│  - Trading engine initialization        │
└────────────────────┬────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
    API Routes  WebSocket    Trading Loop
    (7 routes)  (subscribe)  (every 15sec)
        │            │            │
        │            │     ┌──────┴──────┐
        │            │     │             │
        ▼            ▼     ▼             ▼
   Bybit REST   Bybit WS  Fetch    Process
   - Market     - Tickers Klines   Signals
   - Trades     - Updates          │
   - Orders              ┌─────────┴───────┐
   - Balance             │               │
   - Positions           ▼               ▼
                      Trading Engine
                      - Indicators
                      - Signal Gen
                      - Order Exec
```

### Frontend Flow

```
┌─────────────────────────────────┐
│   Dashboard (index.tsx)         │
│   - React component             │
│   - useEffect hooks for data    │
├─────────────────────────────────┤
│   Auto-refresh every 15 seconds │
└────────────────┬────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
 API Client   Components   Rendering
 - /market    - Chart      - Price
 - /klines    - Tables     - Stats
 - /trades    - Cards      - Trades
 - /perf      - Loading    - History
    │            │            │
    │            ▼            │
    └─────────────────────────┴──► Canvas/DOM
```

## Data Flow

### Trading Signal Generation

```
Market Update (every 15s)
    │
    ├─ Fetch latest OHLCV data
    │
    ├─ Add to indicator buffer
    │
    ├─ Calculate EMA50, EMA200, RSI14
    │
    ├─ Generate signal (BUY/SELL/HOLD)
    │
    ├─ Check conditions:
    │  • Max trades per day?
    │  • Confidence > 60%?
    │  • Minimum time since last trade?
    │  • Have position for SELL?
    │
    ├─ Calculate position size
    │  Position = (Balance × 1%) / (Price × Stop%)
    │
    ├─ Place market order
    │   (with TP/SL)
    │
    └─ Store trade record
```

### Risk Management

```
Position Size Calculation:
─────────────────────────
Account Balance    = $10,000
Risk per Trade     = 1% = $100
Stop Loss Target   = Price - 1%
Position Size      = $100 / (Price × 1%)

Example with BTC @ $30,000:
───────────────────────────
Risk Amount        = $100
Stop Loss %        = 1% = $300
Position Size      = $100 / $300 = 0.333 BTC

Trade Execution:
───────────────
Entry Price        = $30,000
Take Profit        = $30,000 + 2% = $30,600
Stop Loss          = $30,000 - 1% = $29,700
Max Loss           = $100 (1% of account)
Max Gain           = $200 (2% of position)
```

## Key Components

### TradingIndicators (indicators.ts)
- Stores candlestick data (up to 250)
- Calculates EMA-50, EMA-200
- Calculates RSI-14
- Returns current indicators

### SignalGenerator (signals.ts)
- Applies buy/sell logic
- Calculates confidence score
- Prevents signal spam
- Minimum 5-minute intervals

### TradingEngine (engine.ts)
- Orchestrates trading logic
- Manages open/closed trades
- Executes orders
- Calculates performance metrics
- Enforces daily trade limits

### BybitService (bybit.ts)
- REST API client for Bybit
- Functions:
  - `getMarketPrice()` - current price
  - `getKlines()` - historical data
  - `placeOrder()` - execute trade
  - `getPositions()` - current holdings
  - `getBalance()` - account balance
  - `getOpenOrders()` - pending orders
  - `cancelOrder()` - cancel order

### BybitWebSocket (websocket.ts)
- Real-time price ticker updates
- Auto-reconnection (5 attempts)
- Event emitter pattern
- Subscribes to BTCUSDT

## Database-less Architecture

⚠️ **Current Implementation**
- All trade data stored in-memory
- Trades lost on server restart
- No historical analysis persistence

**For Production:**
- Add PostgreSQL
- Implement trade logging
- Add performance history
- Enable backtesting

## Security Considerations

✅ **Implemented**
- API keys in .env (never in code)
- JWT support (not currently used)
- CORS enabled

⚠️ **To Add for Production**
- Database encryption
- API rate limiting
- Request validation
- Error logging
- Audit trails
- Access control

## Performance

- **Indicator Calculation**: ~1ms
- **Signal Generation**: ~1ms
- **Order Placement**: ~100-500ms (API)
- **WebSocket Latency**: ~50-200ms

## Scalability Notes

Current bottlenecks:
1. Single-threaded Node.js processing
2. No horizontal scaling
3. In-memory trade storage
4. No caching layer

For production scale:
- Add Redis cache
- Implement job queue
- Distributed trading workers
- Message pub/sub
- Analytics database
