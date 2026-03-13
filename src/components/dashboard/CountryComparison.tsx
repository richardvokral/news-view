"use client";

interface CountryComparisonProps {
  us: number;
  de: number;
}

export default function CountryComparison({ us, de }: CountryComparisonProps) {
  const total = us + de;
  if (total === 0) return null;

  const usPercent = Math.round((us / total) * 100);
  const dePercent = 100 - usPercent;

  return (
    <div className="flex items-center gap-1.5 min-w-[120px]">
      <span className="text-xs font-mono text-blue-600 w-6 text-right">
        {us}
      </span>
      <div className="flex-1 flex h-4 rounded-sm overflow-hidden bg-gray-100">
        {us > 0 && (
          <div
            className="bg-blue-500 transition-all"
            style={{ width: `${usPercent}%` }}
            title={`US: ${us} articles (${usPercent}%)`}
          />
        )}
        {de > 0 && (
          <div
            className="bg-amber-500 transition-all"
            style={{ width: `${dePercent}%` }}
            title={`DE: ${de} articles (${dePercent}%)`}
          />
        )}
      </div>
      <span className="text-xs font-mono text-amber-600 w-6">
        {de}
      </span>
    </div>
  );
}
