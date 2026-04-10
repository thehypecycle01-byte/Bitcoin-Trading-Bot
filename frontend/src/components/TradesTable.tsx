'use client';

interface Trade {
  id: string;
  symbol: string;
  entryPrice: number;
  quantity: number;
  side: 'long' | 'short';
  status: 'open' | 'closed' | 'pending';
  openTime: number;
  closeTime?: number;
  closePrice?: number;
  pnl?: number;
  roiPercentage?: number;
  takeProfitPrice: number;
  stopLossPrice: number;
}

interface TradesTableProps {
  trades: Trade[];
  type?: 'open' | 'closed' | 'all';
}

export function TradesTable({ trades, type = 'all' }: TradesTableProps) {
  const filtered = type === 'all'
    ? trades
    : trades.filter(t => t.status === type);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-gray-400">
          <thead className="bg-gray-800 border-b border-gray-700">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Pair</th>
              <th className="px-4 py-3 text-left font-semibold">Side</th>
              <th className="px-4 py-3 text-right font-semibold">Entry</th>
              <th className="px-4 py-3 text-right font-semibold">Qty</th>
              <th className="px-4 py-3 text-right font-semibold">TP</th>
              <th className="px-4 py-3 text-right font-semibold">SL</th>
              {type === 'closed' && (
                <>
                  <th className="px-4 py-3 text-right font-semibold">Exit</th>
                  <th className="px-4 py-3 text-right font-semibold">P/L</th>
                  <th className="px-4 py-3 text-right font-semibold">ROI%</th>
                </>
              )}
              <th className="px-4 py-3 text-left font-semibold">Time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={type === 'closed' ? 10 : 7} className="px-4 py-6 text-center text-gray-500">
                  No {type === 'all' ? 'trades' : `${type} trades`}
                </td>
              </tr>
            ) : (
              filtered.map(trade => (
                <tr key={trade.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition">
                  <td className="px-4 py-3 font-semibold text-white">{trade.symbol}</td>
                  <td className={`px-4 py-3 font-semibold ${trade.side === 'long' ? 'text-green-500' : 'text-red-500'}`}>
                    {trade.side.toUpperCase()}
                  </td>
                  <td className="px-4 py-3 text-right">${trade.entryPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">{trade.quantity.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right text-green-400">${trade.takeProfitPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-red-400">${trade.stopLossPrice.toFixed(2)}</td>
                  {type === 'closed' && (
                    <>
                      <td className="px-4 py-3 text-right">${trade.closePrice?.toFixed(2) || '-'}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${(trade.pnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        ${trade.pnl?.toFixed(2) || '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${(trade.roiPercentage || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {trade.roiPercentage?.toFixed(2) || '-'}%
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3">
                    {new Date(trade.openTime).toLocaleTimeString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
