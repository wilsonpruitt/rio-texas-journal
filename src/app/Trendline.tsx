/**
 * Larger sparkline-style line chart for conference-wide totals.
 * Server-rendered SVG with year labels on the X axis.
 */

export type Point = { year: number; value: number };

export default function Trendline({
  label,
  points,
  format = 'count',
  height = 140,
  highlightYear,
}: {
  label: string;
  points: Point[];
  format?: 'count' | 'usd';
  height?: number;
  highlightYear?: number;
}) {
  if (points.length === 0) return null;
  // Drop outliers (parser-corrupted older Era A points sometimes leaked
  // sequence numbers as values; conference-wide sums of those become tiny
  // compared to real totals). Median-window filter, same logic as the
  // per-church Sparkline.
  const initial = [...points].sort((a, b) => a.year - b.year);
  const valuesSorted = initial.map((p) => p.value).sort((a, b) => a - b);
  const median = valuesSorted[Math.floor(valuesSorted.length / 2)] || 1;
  const filteredSorted = initial.filter((p) => p.value >= median / 5 && p.value <= median * 5 && p.value > 0);
  const sorted = filteredSorted.length >= 2 ? filteredSorted : initial;
  if (sorted.length === 0) return null;
  const minY = Math.min(...sorted.map((p) => p.value));
  const maxY = Math.max(...sorted.map((p) => p.value));
  const minX = sorted[0].year;
  const maxX = sorted[sorted.length - 1].year;
  const xRange = Math.max(maxX - minX, 1);
  const yRange = Math.max(maxY - minY, 1);
  const yPadFraction = 0.1;
  const yLow = minY - yRange * yPadFraction;
  const yHigh = maxY + yRange * yPadFraction;
  const yEffRange = yHigh - yLow;

  const width = 800;
  const padX = 32;
  const padTop = 20;
  const padBottom = 28;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const xAt = (year: number) => padX + ((year - minX) / xRange) * innerW;
  const yAt = (val: number) => padTop + innerH - ((val - yLow) / yEffRange) * innerH;

  const path = sorted
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.year).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
    .join(' ');
  const area = `${path} L ${xAt(sorted[sorted.length - 1].year).toFixed(1)} ${padTop + innerH} L ${xAt(sorted[0].year).toFixed(1)} ${padTop + innerH} Z`;

  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  const delta = last.value - first.value;
  const pctDelta = first.value !== 0 ? (delta / first.value) * 100 : 0;
  const trendUp = delta > 0;
  const trendFlat = Math.abs(pctDelta) < 1;
  const lineColor = trendFlat ? '#71717a' : trendUp ? '#16a34a' : '#dc2626';
  const fillColor = trendFlat ? '#a1a1aa20' : trendUp ? '#16a34a20' : '#dc262615';

  const fmt = (v: number) =>
    format === 'usd'
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: v >= 1_000_000 ? 'compact' : 'standard' }).format(v)
      : new Intl.NumberFormat('en-US').format(v);

  // Year tick labels: every other year if range is wide, else every year.
  const tickEvery = xRange > 8 ? 2 : 1;
  const ticks = sorted.filter((p, i) => i === 0 || i === sorted.length - 1 || (p.year - minX) % tickEvery === 0);

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">{label}</h3>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold tabular-nums">{fmt(last.value)}</span>
          <span className={'text-xs tabular-nums ' + (trendFlat ? 'text-zinc-500' : trendUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
            {trendFlat ? '—' : trendUp ? '↑' : '↓'} {Math.abs(pctDelta).toFixed(1)}% since {first.year}
          </span>
        </div>
      </div>
      <svg width={width} height={height} className="mt-2 block w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path d={area} fill={fillColor} stroke="none" />
        <path d={path} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {sorted.map((p) => (
          <g key={p.year}>
            <circle cx={xAt(p.year)} cy={yAt(p.value)} r={p.year === highlightYear ? 4 : 2.5} fill={lineColor} />
            {p.year === highlightYear && (
              <text x={xAt(p.year)} y={yAt(p.value) - 8} textAnchor="middle" className="fill-zinc-700 dark:fill-zinc-300" fontSize="11" fontWeight="600">
                {fmt(p.value)}
              </text>
            )}
          </g>
        ))}
        {ticks.map((p) => (
          <text key={p.year} x={xAt(p.year)} y={height - 8} textAnchor="middle" className="fill-zinc-500" fontSize="11">
            {p.year}
          </text>
        ))}
      </svg>
    </div>
  );
}
