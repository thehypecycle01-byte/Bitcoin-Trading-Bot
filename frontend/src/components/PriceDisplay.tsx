'use client';

interface PriceDisplayProps {
  price: number;
  symbol?: string;
  change24h?: number;
}

export function PriceDisplay({ price, symbol = 'BTC/USDT', change24h }: PriceDisplayProps) {
  const isPositive = change24h ? change24h >= 0 : true;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-6">
      <p className="text-gray-400 text-sm mb-2">{symbol}</p>
      <div className="flex items-end gap-2">
        <h2 className="text-4xl font-bold text-white">
          ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </h2>
        {change24h !== undefined && (
          <span className={`text-lg font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? '+' : ''}{change24h.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}
