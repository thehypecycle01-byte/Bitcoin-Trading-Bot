# Setup Guide

## Installation Steps

### 1. Backend Setup

```bash
# From project root
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your Bybit credentials
# BYBIT_API_KEY=your_key
# BYBIT_API_SECRET=your_secret
# BYBIT_TESTNET=true (for testing)
```

### 2. Frontend Setup

```bash
cd frontend
npm install
cd ..
```

### 3. Start Services

**Terminal 1 - Backend:**
```bash
npm run dev
# Server will start on http://localhost:5000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Dashboard will be on http://localhost:3000
```

### 4. Access Dashboard

Open http://localhost:3000 in your browser

## Configuration

### Environment Variables

**.env** (Backend)
- `BYBIT_API_KEY`: Your Bybit API key
- `BYBIT_API_SECRET`: Your Bybit API secret
- `BYBIT_TESTNET`: Set to `true` for testnet (recommended for testing)
- `RISK_PERCENTAGE`: Risk per trade (default: 1%)
- `TAKE_PROFIT_PERCENTAGE`: TP target (default: 2%)
- `STOP_LOSS_PERCENTAGE`: SL target (default: 1%)
- `MAX_TRADES_PER_DAY`: Max daily trades (default: 5)
- `INTERVAL_SECONDS`: Market check interval (default: 15)

**.env.local** (Frontend)
- `NEXT_PUBLIC_API_URL`: Backend API URL (default: http://localhost:5000/api)

## Getting Bybit API Credentials

1. Go to https://www.bybit.com (or testnet: https://testnet.bybit.com)
2. Sign in or create account
3. Navigate to Account Settings → API
4. Create new API key with:
   - Read permissions: enabled
   - Spot Trading: enabled
5. Copy API Key and Secret to `.env`

## Trading Strategy

**Entry (BUY Signal)**
```
EMA50 > EMA200  AND  RSI < 40
```

**Exit (SELL Signal)**
```
EMA50 < EMA200  AND  RSI > 60
```

**Risk Management**
- Position size = (Account Balance × Risk%) / (Entry Price × Stop Loss%)
- Always respects 1% risk per trade
- Take profit at +2%
- Stop loss at -1%
- Max 5 trades per day

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/market` | GET | Current BTC price |
| `/api/klines` | GET | Historical OHLCV data |
| `/api/trades` | GET | Open and closed trades |
| `/api/performance` | GET | Performance metrics |
| `/api/balance` | GET | Account balance |
| `/api/positions` | GET | Current positions |
| `/api/order` | POST | Place manual order |
| `/health` | GET | Health check |

**Example: Get Historical Data**
```bash
curl "http://localhost:5000/api/klines?symbol=BTCUSDT&interval=5&limit=200"
```

**Example: Place Order**
```bash
curl -X POST http://localhost:5000/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSDT",
    "side": "Buy",
    "quantity": 0.01,
    "price": 30000
  }'
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 5000
netstat -ano | findstr :5000

# Kill process (Windows)
taskkill /PID <PID> /F
```

### Cannot Connect to Bybit
- Verify API credentials are correct
- Check testnet setting matches (BYBIT_TESTNET=true for testnet)
- Ensure API key has proper permissions

### WebSocket Connection Issues
- Check network/firewall settings
- Verify Bybit WebSocket status
- Check browser console for errors

### No Trading Signals
- Need 200+ candles for EMA-200 (about 17 hours on 5m chart)
- Check that signal conditions are met
- Review logs in terminal

### Dashboard Not Loading
- Verify backend is running on port 5000
- Check .env.local in frontend folder
- Clear browser cache and refresh

## Development Tips

### Enable Debug Logging
Edit `src/index.ts` and add before starting:
```typescript
console.log('Trading bot config:', {
  riskPercentage: parseFloat(process.env.RISK_PERCENTAGE || '1'),
  maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY || '5'),
});
```

### Test with Testnet
Always test strategy on testnet first:
1. Set `BYBIT_TESTNET=true`
2. Fund testnet account
3. Run bot for 24+ hours
4. Analyze results before live trading

### Monitor Logs
```bash
# Backend logs show:
# - Trading signals
# - Order execution
# - Performance metrics
# - WebSocket status
```

### Manual Tests
```bash
# Check health
curl http://localhost:5000/health

# Get current price
curl http://localhost:5000/api/market

# Get trades
curl http://localhost:5000/api/trades

# Get performance
curl http://localhost:5000/api/performance
```

## Production Deployment

⚠️ **NOT recommended for production without:**
- Thorough backtesting
- Paper trading validation
- Enhanced error handling
- Database for trade logging
- APM/monitoring setup
- Automated alerts
- Rate limiting
- Circuit breakers

## Support & Resources

- Bybit API Docs: https://bybit-exchange.github.io/docs/
- TradingView Docs: https://www.tradingview.com/pine-script-docs/
- Technical Indicators: https://github.com/anandanand84/technicalindicators
- Next.js Docs: https://nextjs.org/docs

## License

MIT
