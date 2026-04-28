/**
 * Inline-SVG sparkline for a single church's metric over the years parsed.
 * Server component — pure data → SVG, no client JS.
 */

export type Point = { year: number; value: number | null };

export default function Sparkline({
  label,
  points,
  format = 'count',
  width = 320,
  height = 56,
}: {
  label: string;
  points: Point[];
  format?: 'count' | 'usd';
  width?: number;
  height?: number;
}) {
  const allValid = points.filter((p): p is { year: number; value: number } => p.value != null);
  if (allValid.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="mt-1 text-zinc-400">No data</div>
      </div>
    );
  }

  // Filter out clear outliers (e.g. parser-leaked sequence numbers from
  // older Era A years that produced "members = 13" for a 2300-member
  // church). Keep points within [median/5, median*5].
  const sorted = [...allValid].map((p) => p.value).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const valid = allValid.filter((p) => p.value >= median / 5 && p.value <= median * 5);
  if (valid.length === 0) valid.push(...allValid); // fall back if filter wipes everything

  const minY = Math.min(...valid.map((p) => p.value));
  const maxY = Math.max(...valid.map((p) => p.value));
  const minX = Math.min(...valid.map((p) => p.year));
  const maxX = Math.max(...valid.map((p) => p.year));
  const xRange = Math.max(maxX - minX, 1);
  const yRange = Math.max(maxY - minY, 1);

  const padX = 6;
  const padY = 8;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const xAt = (year: number) => padX + ((year - minX) / xRange) * innerW;
  const yAt = (val: number) => padY + innerH - ((val - minY) / yRange) * innerH;

  const path = valid
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.year).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
    .join(' ');
  const area = `${path} L ${xAt(valid[valid.length - 1].year).toFixed(1)} ${padY + innerH} L ${xAt(valid[0].year).toFixed(1)} ${padY + innerH} Z`;

  const last = valid[valid.length - 1];
  const first = valid[0];
  const delta = last.value - first.value;
  const pctDelta = first.value !== 0 ? (delta / first.value) * 100 : 0;
  const trendUp = delta > 0;
  const trendFlat = Math.abs(pctDelta) < 1;

  const fmt = (v: number) =>
    format === 'usd'
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
      : new Intl.NumberFormat('en-US').format(v);

  const trendColor = trendFlat
    ? 'text-zinc-500'
    : trendUp
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';
  const lineColor = trendFlat ? '#71717a' : trendUp ? '#16a34a' : '#dc2626';
  const fillColor = trendFlat ? '#a1a1aa20' : trendUp ? '#16a34a20' : '#dc262620';

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
        <div className={'text-xs tabular-nums ' + trendColor}>
          {trendFlat ? '—' : (trendUp ? '↑' : '↓')} {Math.abs(pctDelta).toFixed(0)}%
        </div>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <div className="text-lg font-semibold tabular-nums">{fmt(last.value)}</div>
        <div className="text-xs text-zinc-500 tabular-nums">{first.year}–{last.year}</div>
      </div>
      <svg width={width} height={height} className="mt-1 block w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path d={area} fill={fillColor} stroke="none" />
        <path d={path} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {valid.map((p) => (
          <circle key={p.year} cx={xAt(p.year)} cy={yAt(p.value)} r="1.8" fill={lineColor} />
        ))}
      </svg>
    </div>
  );
}
