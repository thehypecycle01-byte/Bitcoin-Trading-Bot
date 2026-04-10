'use client';

interface Stat {
  label: string;
  value: string | number;
  subtext?: string;
  isPositive?: boolean;
}

export function StatCard({ label, value, subtext, isPositive }: Stat) {
  const textColor = isPositive === undefined
    ? 'text-white'
    : isPositive
      ? 'text-green-500'
      : 'text-red-500';

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
      <p className="text-gray-400 text-sm mb-2">{label}</p>
      <p className={`text-2xl font-bold ${textColor}`}>
        {typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}
      </p>
      {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
    </div>
  );
}
