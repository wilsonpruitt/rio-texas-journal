/**
 * Server-rendered SVG sankey: Era A (7 districts) → Era B (3 districts).
 * Flow widths proportional to church counts from the official 2025
 * conversion chart (203 churches mapped).
 */
import conversion from '@/lib/district-conversion-2025.json';

type Row = {
  new_district: string;     // 'North' | 'Central' | 'South'
  county: string;
  city: string;
  church: string;
  old_district: string;     // 'Capital' | 'Coastal Bend' | ...
};

const ERA_A_ORDER = ['Capital', 'Crossroads', 'Hill Country', 'West', 'Las Misiones', 'Coastal Bend', 'El Valle'];
const ERA_B_ORDER = ['North', 'Central', 'South'];

const ERA_A_COLOR: Record<string, string> = {
  Capital: '#2563eb',
  'Coastal Bend': '#06b6d4',
  Crossroads: '#f59e0b',
  'El Valle': '#dc2626',
  'Hill Country': '#16a34a',
  'Las Misiones': '#a855f7',
  West: '#78350f',
};

const ERA_B_COLOR: Record<string, string> = {
  Central: '#2563eb',
  North: '#16a34a',
  South: '#dc2626',
};

export default function Sankey() {
  const rows = conversion as Row[];
  // Counts per (old, new) pair
  const flowCounts = new Map<string, number>();
  const oldTotals = new Map<string, number>();
  const newTotals = new Map<string, number>();
  for (const r of rows) {
    if (!ERA_A_COLOR[r.old_district]) continue;
    if (!ERA_B_COLOR[r.new_district]) continue;
    const k = `${r.old_district}|${r.new_district}`;
    flowCounts.set(k, (flowCounts.get(k) ?? 0) + 1);
    oldTotals.set(r.old_district, (oldTotals.get(r.old_district) ?? 0) + 1);
    newTotals.set(r.new_district, (newTotals.get(r.new_district) ?? 0) + 1);
  }
  const grandTotal = rows.length;

  // Layout
  const width = 880;
  const height = 360;
  const padTop = 16;
  const padBottom = 16;
  const nodeWidth = 16;
  const leftLabelW = 130;
  const rightLabelW = 110;
  const leftX = leftLabelW;
  const rightX = width - rightLabelW - nodeWidth;
  const innerH = height - padTop - padBottom;
  const nodeGap = 6;

  // Vertical positions: each district's slot is proportional to count + small gap.
  const totalGapsLeft = nodeGap * (ERA_A_ORDER.length - 1);
  const scaleLeft = (innerH - totalGapsLeft) / grandTotal;
  const totalGapsRight = nodeGap * (ERA_B_ORDER.length - 1);
  const scaleRight = (innerH - totalGapsRight) / grandTotal;

  const leftPositions = new Map<string, { y: number; height: number }>();
  let yL = padTop;
  for (const d of ERA_A_ORDER) {
    const cnt = oldTotals.get(d) ?? 0;
    const h = cnt * scaleLeft;
    leftPositions.set(d, { y: yL, height: h });
    yL += h + nodeGap;
  }
  const rightPositions = new Map<string, { y: number; height: number }>();
  let yR = padTop;
  for (const d of ERA_B_ORDER) {
    const cnt = newTotals.get(d) ?? 0;
    const h = cnt * scaleRight;
    rightPositions.set(d, { y: yR, height: h });
    yR += h + nodeGap;
  }

  // Track cumulative offset within each node (used to stack flow ribbons).
  const leftOffset = new Map<string, number>();
  const rightOffset = new Map<string, number>();

  // Sort flows by source/target order so ribbons stack predictably.
  const flows: { from: string; to: string; count: number }[] = [];
  for (const a of ERA_A_ORDER) {
    for (const b of ERA_B_ORDER) {
      const c = flowCounts.get(`${a}|${b}`) ?? 0;
      if (c > 0) flows.push({ from: a, to: b, count: c });
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-medium">Era A → Era B district reshuffle</h3>
          <p className="text-xs text-zinc-500">2025 conversion chart, {grandTotal} churches.</p>
        </div>
        <p className="text-xs text-zinc-500">Width = number of churches.</p>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mt-3 block w-full">
        {/* Era A node rects + labels */}
        {ERA_A_ORDER.map((d) => {
          const pos = leftPositions.get(d)!;
          const color = ERA_A_COLOR[d];
          return (
            <g key={`l-${d}`}>
              <rect x={leftX} y={pos.y} width={nodeWidth} height={pos.height} fill={color} />
              <text
                x={leftX - 6}
                y={pos.y + pos.height / 2 + 3}
                textAnchor="end"
                fontSize="11"
                className="fill-zinc-700 dark:fill-zinc-300"
              >
                {d}
              </text>
              <text
                x={leftX - 6}
                y={pos.y + pos.height / 2 + 15}
                textAnchor="end"
                fontSize="9"
                className="fill-zinc-500"
              >
                {oldTotals.get(d)}
              </text>
            </g>
          );
        })}

        {/* Era B node rects + labels */}
        {ERA_B_ORDER.map((d) => {
          const pos = rightPositions.get(d)!;
          const color = ERA_B_COLOR[d];
          return (
            <g key={`r-${d}`}>
              <rect x={rightX} y={pos.y} width={nodeWidth} height={pos.height} fill={color} />
              <text
                x={rightX + nodeWidth + 6}
                y={pos.y + pos.height / 2 + 3}
                textAnchor="start"
                fontSize="11"
                className="fill-zinc-700 dark:fill-zinc-300"
              >
                {d}
              </text>
              <text
                x={rightX + nodeWidth + 6}
                y={pos.y + pos.height / 2 + 15}
                textAnchor="start"
                fontSize="9"
                className="fill-zinc-500"
              >
                {newTotals.get(d)}
              </text>
            </g>
          );
        })}

        {/* Flow ribbons */}
        {flows.map((f, i) => {
          const lp = leftPositions.get(f.from)!;
          const rp = rightPositions.get(f.to)!;
          const flowH = f.count * scaleLeft;     // left ribbon height in left scale
          const flowHR = f.count * scaleRight;   // right ribbon height in right scale
          const lOff = leftOffset.get(f.from) ?? 0;
          const rOff = rightOffset.get(f.to) ?? 0;
          leftOffset.set(f.from, lOff + flowH);
          rightOffset.set(f.to, rOff + flowHR);

          const x1 = leftX + nodeWidth;
          const x2 = rightX;
          const yTopL = lp.y + lOff;
          const yBotL = yTopL + flowH;
          const yTopR = rp.y + rOff;
          const yBotR = yTopR + flowHR;
          const cpx1 = x1 + (x2 - x1) * 0.5;
          const cpx2 = x1 + (x2 - x1) * 0.5;

          const path = `
            M ${x1} ${yTopL}
            C ${cpx1} ${yTopL}, ${cpx2} ${yTopR}, ${x2} ${yTopR}
            L ${x2} ${yBotR}
            C ${cpx2} ${yBotR}, ${cpx1} ${yBotL}, ${x1} ${yBotL}
            Z
          `;
          return (
            <path
              key={i}
              d={path}
              fill={ERA_A_COLOR[f.from]}
              fillOpacity={0.32}
              stroke="none"
            >
              <title>{f.from} → {f.to}: {f.count} church{f.count === 1 ? '' : 'es'}</title>
            </path>
          );
        })}
      </svg>
    </div>
  );
}
