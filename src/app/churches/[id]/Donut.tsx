/**
 * Inline SVG donut chart with a small legend on the right.
 * Server-rendered. Slices are skipped if their value is 0.
 */

export type Slice = { label: string; value: number; color: string };

export default function Donut({
  slices,
  size = 96,
  thickness = 14,
  total: totalOverride,
  centerLabel,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  total?: number;
  centerLabel?: string;
}) {
  const computed = slices.reduce((s, x) => s + x.value, 0);
  const total = totalOverride ?? computed;
  if (total <= 0) {
    return <div className="text-xs text-zinc-500">No data</div>;
  }

  const radius = size / 2 - thickness / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Build stroke-dasharray segments. Each slice covers (value/total) of
  // the circumference; we render the donut by stacking circles with
  // rotated dasharrays.
  let cumulative = 0;
  const segments = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / total) * circumference;
      const offset = -cumulative;
      cumulative += len;
      return { ...s, len, offset, dash: `${len} ${circumference - len}` };
    });

  return (
    <div className="flex items-start gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="currentColor" strokeWidth={thickness} className="text-zinc-100 dark:text-zinc-900" />
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={seg.dash}
              strokeDashoffset={seg.offset}
            />
          ))}
        </g>
        {centerLabel && (
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fontWeight="600" className="fill-zinc-700 dark:fill-zinc-200">
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="text-xs space-y-0.5">
        {slices
          .filter((s) => s.value > 0)
          .sort((a, b) => b.value - a.value)
          .map((s) => {
            const pct = (s.value / total) * 100;
            return (
              <li key={s.label} className="flex items-baseline gap-1.5">
                <span className="size-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                <span className="text-zinc-700 dark:text-zinc-300">{s.label}</span>
                <span className="text-zinc-500 tabular-nums">
                  {pct.toFixed(pct < 1 ? 1 : 0)}%
                </span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
