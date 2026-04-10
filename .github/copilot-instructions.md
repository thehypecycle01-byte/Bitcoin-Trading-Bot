# Bitcoin Trading Bot - Development Instructions

This project is an automated Bitcoin trading system using EMA/RSI strategy with Bybit API integration.

## Project Structure

- **Backend**: Node.js + Express (port 5000)
- **Frontend**: Next.js (port 3000)
- **Strategy**: EMA-50, EMA-200, RSI-14 indicators
- **Exchange**: Bybit spot trading

## Key Features

- Real-time BTC price monitoring (10-15 sec intervals)
- Automated buy/sell signals based on technical indicators
- Risk management: 1% per trade, 2% TP, 1% SL
- Max 5 trades per day
- Live TradingView dashboard
- WebSocket real-time updates
- JWT authentication
- Secure API key management via .env

## Setup Instructions

1. Install dependencies: `npm install` (backend) and `cd frontend && npm install`
2. Configure `.env` files with Bybit API credentials
3. Start backend: `npm run dev`
4. Start frontend: `cd frontend && npm run dev`
5. Access dashboard at http://localhost:3000

## Development Guidelines

- All API keys must be in `.env`, never commit credentials
- Strategy logic in `backend/src/strategy/`
- API integration in `backend/src/services/bybit.ts`
- Real-time updates use WebSocket connections
- Frontend components are in `frontend/src/components/`
