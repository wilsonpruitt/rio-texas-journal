"use client";

import { useId } from "react";

export type Pt = { year: number; value: number };

/**
 * Editorial area/line trend chart. Optional projection points render as a
 * dashed continuation with a translucent confidence band.
 */
export function TrendChart({
  points,
  projection,
  band,
  height = 132,
  accent = "teal",
  format = "count",
  markMergerYear = 2015,
}: {
  points: Pt[];
  projection?: Pt[];
  band?: { year: number; lo: number; hi: number }[];
  height?: number;
  accent?: "teal" | "ember" | "amber" | "ink";
  format?: "count" | "usd";
  markMergerYear?: number | null;
}) {
  const uid = useId();
  const all = [...points, ...(projection ?? [])];
  if (all.length < 2) {
    return <div className="h-[132px] grid place-items-center text-sm text-faint">Insufficient data</div>;
  }
  const W = 720;
  const H = height;
  const padX = 8;
  const padTop = 12;
  const padBot = 20;
  const xs = all.map((p) => p.year);
  const minYr = Math.min(...xs);
  const maxYr = Math.max(...xs);
  const ys = [...all.map((p) => p.value), ...(band?.flatMap((b) => [b.lo, b.hi]) ?? [])];
  const maxV = Math.max(...ys, 1);
  const minV = Math.min(0, ...ys);

  const x = (yr: number) => padX + ((yr - minYr) / Math.max(1, maxYr - minYr)) * (W - padX * 2);
  const y = (v: number) => padTop + (1 - (v - minV) / (maxV - minV)) * (H - padTop - padBot);

  const color = {
    teal: "var(--color-teal)",
    ember: "var(--color-ember)",
    amber: "var(--color-amber)",
    ink: "var(--color-ink)",
  }[accent];

  const line = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.year).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = (pts: Pt[]) => `${line(pts)} L${x(pts[pts.length - 1].year).toFixed(1)},${y(minV).toFixed(1)} L${x(pts[0].year).toFixed(1)},${y(minV).toFixed(1)} Z`;

  const fmt = (n: number) =>
    format === "usd"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, notation: n >= 1e6 ? "compact" : "standard" }).format(n)
      : new Intl.NumberFormat("en-US", { notation: n >= 1e4 ? "compact" : "standard" }).format(n);

  const last = points[points.length - 1];
  const projLine = projection && projection.length ? [last, ...projection] : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* merger marker */}
      {markMergerYear && markMergerYear > minYr && markMergerYear < maxYr && (
        <g>
          <line x1={x(markMergerYear)} x2={x(markMergerYear)} y1={padTop - 4} y2={H - padBot} stroke="var(--color-rule-bold)" strokeWidth="1" strokeDasharray="2 3" />
          <text x={x(markMergerYear) + 3} y={padTop + 4} fontSize="9" fill="var(--color-faint)" fontFamily="var(--font-mono)">merger</text>
        </g>
      )}

      {/* confidence band */}
      {band && band.length > 1 && (
        <path
          d={`${band.map((b, i) => `${i ? "L" : "M"}${x(b.year).toFixed(1)},${y(b.hi).toFixed(1)}`).join(" ")} ${[...band].reverse().map((b) => `L${x(b.year).toFixed(1)},${y(b.lo).toFixed(1)}`).join(" ")} Z`}
          fill={color}
          opacity="0.08"
        />
      )}

      <path d={area(points)} fill={`url(#fill-${uid})`} />
      <path d={line(points)} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />

      {projLine && (
        <path d={line(projLine)} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
      )}

      {/* endpoint */}
      <circle cx={x(last.year)} cy={y(last.value)} r="2.6" fill={color} />
      <text x={x(last.year) - 4} y={y(last.value) - 7} fontSize="10" textAnchor="end" fill="var(--color-ink)" fontFamily="var(--font-mono)" fontWeight="600">
        {fmt(last.value)}
      </text>

      {/* axis years */}
      <text x={padX} y={H - 5} fontSize="9" fill="var(--color-faint)" fontFamily="var(--font-mono)">{minYr}</text>
      <text x={W - padX} y={H - 5} fontSize="9" textAnchor="end" fill="var(--color-faint)" fontFamily="var(--font-mono)">{maxYr}</text>
    </svg>
  );
}
