import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 10000
});

export const marketAPI = {
  getPrice: () => client.get('/market'),
  getKlines: (symbol = 'BTCUSDT', interval = '5', limit = 200) =>
    client.get('/klines', { params: { symbol, interval, limit } })
};

export const tradesAPI = {
  getTrades: () => client.get('/trades'),
  getPerformance: () => client.get('/performance'),
  placeOrder: (data: any) => client.post('/order', data)
};

export const accountAPI = {
  getBalance: () => client.get('/balance'),
  getPositions: () => client.get('/positions')
};

export default client;
