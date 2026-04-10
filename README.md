# Bitcoin Trading Bot 🤖

An automated cryptocurrency trading system using EMA/RSI technical analysis with Bybit API integration.

## Features

✅ **Automated Trading**
- EMA-50 & EMA-200 crossover detection
- RSI-14 overbought/oversold signals
- Real-time market monitoring (10-15 sec intervals)
- Market order execution via Bybit

✅ **Risk Management**
- 1% risk per trade
- 2% take profit target
- 1% stop loss
- Maximum 5 trades per day

✅ **Live Dashboard**
- TradingView candlestick charts
- Real-time price updates via WebSocket
- Trade history and performance metrics
- Account balance tracking

✅ **Security**
- JWT authentication
- API keys in `.env` (never committed)
- Secure credential handling

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: Next.js, React, TailwindCSS
- **Charts**: TradingView Lightweight Charts
- **APIs**: Bybit REST & WebSocket
- **Indicators**: technicalindicators

## Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn
- Bybit API credentials (testnet or live)

### Installation

1. **Clone and install backend**
```bash
npm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your Bybit API credentials
```

3. **Install and setup frontend**
```bash
cd frontend
npm install
```

### Running

**Terminal 1 - Backend**
```bash
npm run dev
```

**Terminal 2 - Frontend**
```bash
cd frontend
npm run dev
```

**Access Dashboard**: http://localhost:3000

## Project Structure

```
.
├── src/
│   ├── index.ts                 # Entry point
│   ├── strategy/
│   │   ├── indicators.ts       # EMA, RSI calculations
│   │   └── signals.ts          # Buy/Sell signal logic
│   ├── services/
│   │   ├── bybit.ts            # Bybit API integration
│   │   └── websocket.ts        # Real-time price updates
│   ├── models/
│   │   └── engine.ts           # Trading engine & risk management
│   └── routes/
│       └── api.ts              # REST API endpoints
├── frontend/                    # Next.js dashboard
│   ├── src/components/         # React components
│   ├── src/pages/              # Next.js pages
│   └── public/                 # Static assets
└── .env.example                # Environment template
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/market` | Current BTC price |
| GET | `/api/klines` | Historical candlestick data |
| GET | `/api/trades` | Open & closed trades |
| GET | `/api/performance` | Performance metrics |
| GET | `/api/balance` | Account balance |
| GET | `/api/positions` | Current positions |
| POST | `/api/order` | Place manual order |
| GET | `/health` | Health check |

## Strategy Details

### Buy Signal
```
EMA50 > EMA200 AND RSI < 40
```

### Sell Signal
```
EMA50 < EMA200 AND RSI > 60
```

### Risk Calculation
```
Position Size = (Account Balance × 1%) / (Entry Price × Stop Loss %)
```

## Environment Variables

```
BYBIT_API_KEY=           # Bybit API key
BYBIT_API_SECRET=        # Bybit API secret
BYBIT_TESTNET=true       # Use testnet (true/false)
PORT=5000                # Backend port
RISK_PERCENTAGE=1        # Risk per trade (%)
TAKE_PROFIT_PERCENTAGE=2 # TP target (%)
STOP_LOSS_PERCENTAGE=1   # SL target (%)
MAX_TRADES_PER_DAY=5     # Max daily trades
INTERVAL_SECONDS=15      # Market check interval
JWT_SECRET=your_secret   # JWT signing key
```

## Performance Metrics

The dashboard displays:
- **Win Rate**: % of profitable trades
- **Profit Factor**: Gross profit / Gross loss
- **Max Drawdown**: Peak-to-trough decline
- **Sharpe Ratio**: Risk-adjusted returns
- **Total P/L**: Realized gains/losses

## Security Notes

⚠️ **IMPORTANT**
- Never commit `.env` file
- Use testnet for testing
- Start with small position sizes
- Monitor bot regularly
- Set API key restrictions on Bybit

## Troubleshooting

**"Cannot read property 'result' of undefined"**
- Check Bybit API credentials
- Verify testnet/live URL match
- Check API key permissions

**WebSocket disconnects frequently**
- Check network connection
- Verify firewall rules
- Check Bybit WebSocket status

**No trading signals**
- Need 200+ candles for EMA-200
- Check strategy parameters
- Verify market conditions meet signal criteria

## Development

### Adding Indicators
Edit `src/strategy/indicators.ts` to add new technical indicators.

### Modifying Strategy
Edit `src/strategy/signals.ts` to adjust buy/sell logic.

### Custom Risk Rules
Edit `src/models/engine.ts` `shouldExecuteSignal()` method.

## License

MIT

## Disclaimer

This bot is for educational purposes. Trading cryptocurrencies involves risk. Past performance does not guarantee future results. Always do your own research before trading with real capital.
