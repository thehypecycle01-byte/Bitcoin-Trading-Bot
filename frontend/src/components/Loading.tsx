'use client';

export function Spinner() {
  return (
    <div className="flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
    </div>
  );
}

export function LoadingSkeletons() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-gray-900 rounded-lg border border-gray-700 h-20 animate-pulse" />
      ))}
    </div>
  );
}
