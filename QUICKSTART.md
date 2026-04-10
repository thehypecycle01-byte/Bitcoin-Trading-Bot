# Quick Start ⚡

## 1. Install Dependencies

```bash
# Backend
npm install

# Frontend
cd frontend && npm install && cd ..
```

## 2. Configure Environment

```bash
# Copy template
cp .env.example .env

# Edit .env with your Bybit credentials
# Get API keys from: https://testnet.bybit.com (for testing)
```

Key settings:
```
BYBIT_API_KEY=your_key
BYBIT_API_SECRET=your_secret
BYBIT_TESTNET=true    # Start with testnet!
RISK_PERCENTAGE=1
MAX_TRADES_PER_DAY=5
INTERVAL_SECONDS=15
```

## 3. Start Services

**Terminal 1 - Backend:**
```bash
npm run dev
# Logs: "Server running on port 5000"
```

**Terminal 2 - Frontend:**
```bash
cd frontend && npm run dev
# Logs: "ready - started server on..."
```

## 4. Open Dashboard

```
http://localhost:3000
```

You'll see:
- Live BTC price chart
- Trading signals
- Performance metrics
- Open/closed trades

## What's Included ✅

- **Strategy Engine**: EMA50/200 + RSI14 
- **Risk Management**: 1% per trade, 2% TP, 1% SL
- **Bybit Integration**: Real-time data + order execution
- **WebSocket**: Live price updates
- **Dashboard**: TradingView charts + stats
- **API**: 7 REST endpoints for automation

## File Structure 📁

```
Backend:
├── src/strategy/        EMA, RSI, signals
├── src/services/        Bybit API, WebSocket
├── src/models/          Trading engine
├── src/routes/          REST API

Frontend:
├── src/components/      Chart, tables, cards
├── src/pages/           Dashboard
├── src/styles/          Tailwind CSS
```

## Next Steps 🚀

1. **Test with Testnet** (BYBIT_TESTNET=true)
   - Run for 24+ hours
   - Monitor signal generation
   - Verify order execution

2. **Adjust Strategy**
   - Edit `src/strategy/signals.ts` for buy/sell conditions
   - Modify risk parameters in `.env`
   - Backtest before live trading

3. **Add Database** (optional)
   - Store trade history
   - Enable performance analysis
   - Implement backtesting

4. **Deploy** (when ready)
   - Use PM2 for process management
   - Add monitoring/alerts
   - Use cloud provider (AWS, Digital Ocean, etc.)

## Important Notes ⚠️

- **Start on testnet** - use fake funds
- **Never hardcode API keys** - always use .env
- **Monitor the bot** - watch logs regularly
- **Small position sizes** - start with minimal risk
- **Backtest first** - test strategy thoroughly
- **Read Bybit docs** - understand their API limits

## Troubleshooting 🔧

**"Cannot read property 'result' of undefined"**
→ Check API credentials and testnet setting

**"No signals generated"**
→ Need 200+ candles (≈17 hours), check if conditions met

**"Dashboard shows no data"**
→ Check backend is running on :5000

**Port already in use**
```bash
lsof -i :5000  # Find process
kill -9 <PID>  # Kill it
```

## API Examples

```bash
# Get current price
curl http://localhost:5000/api/market

# Get trades
curl http://localhost:5000/api/trades

# Get performance
curl http://localhost:5000/api/performance

# Check health
curl http://localhost:5000/health
```

## Documentation

- **README.md** - Project overview
- **SETUP.md** - Detailed setup guide
- **ARCHITECTURE.md** - Technical architecture
- **Code comments** - Inline documentation

---

**Need help?** Check the logs in terminal for error messages. They usually tell you what's wrong!

**Ready to trade?** Good luck! 🎯📈
