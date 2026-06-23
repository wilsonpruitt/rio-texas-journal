"use client";

import { useMemo, useState } from "react";
import { fmtUsd } from "@/lib/atlas";
import {
  type FinanceRow, type Assumptions, type ProjPoint,
  project, reservesExhaustedYear, ASSUMPTION_KEYS,
} from "@/lib/finance-model";

const HORIZON = 5;
const COST_PER_PLANT = 400_000; // rough all-in cost to plant one new church

export default function ConferenceScenario({ rows, baseline }: { rows: FinanceRow[]; baseline: Assumptions }) {
  const [a, setA] = useState<Assumptions>(baseline);
  const set = (k: keyof Assumptions) => (v: number) => setA((p) => ({ ...p, [k]: v }));

  const base = useMemo(() => project(rows, baseline, HORIZON), [rows, baseline]);
  const scen = useMemo(() => project(rows, a, HORIZON), [rows, a]);

  const lastBase = base[base.length - 1];
  const lastScen = scen[scen.length - 1];
  const exhausted = reservesExhaustedYear(scen);
  const dirty = ASSUMPTION_KEYS.some((k) => a[k] !== baseline[k]);
  const firstProjYear = scen.find((p) => p.projected)!.year;
  const held = useMemo(() => {
    const withHeld = rows.filter((r) => r.property_held != null);
    return withHeld.length ? (withHeld[withHeld.length - 1].property_held as number) : 0;
  }, [rows]);
  // Cumulative distribution of property proceeds across the projection.
  const sale = useMemo(() => {
    const proj = scen.filter((p) => p.projected);
    const sum = (f: (p: ProjPoint) => number) => proj.reduce((s, p) => s + f(p), 0);
    return {
      sold: sum((p) => p.propertySold), paf: sum((p) => p.toPaf),
      districts: sum((p) => p.toDistricts), conference: sum((p) => p.toConference),
    };
  }, [scen]);

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      {/* chart + headline */}
      <div className="panel rounded-lg p-6 order-2 lg:order-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="eyebrow">Reserves (net assets), projected {HORIZON} yrs</div>
          <div className="flex items-center gap-4 text-xs text-ink-mute">
            <Legend color="var(--color-ink)" label="Actual" />
            <Legend color="var(--color-faint)" label="Trend" dash />
            <Legend color="var(--color-teal)" label="Your scenario" />
          </div>
        </div>

        <ReserveChart base={base} scen={scen} />

        <div className="mt-5 grid grid-cols-2 gap-4">
          <Outcome
            label={`Reserves in ${lastScen.year}`}
            value={fmtUsd(lastScen.netAssets)}
            delta={dirty ? lastScen.netAssets - lastBase.netAssets : null}
          />
          <div>
            <div className="eyebrow">Trajectory</div>
            {exhausted ? (
              <div className="mt-1 text-ember font-semibold">Reserves exhausted by {exhausted}</div>
            ) : lastScen.netAssets >= scen.find((p) => !p.projected)!.netAssets ? (
              <div className="mt-1 text-teal font-semibold">Reserves hold or grow</div>
            ) : (
              <div className="mt-1 text-amber font-semibold">Reserves decline, not exhausted</div>
            )}
            <div className="mt-1 text-xs text-faint">
              Operating {lastScen.operating >= 0 ? "surplus" : "deficit"} of {fmtUsd(Math.abs(lastScen.operating))} in {lastScen.year}
            </div>
          </div>
        </div>

        {/* per-year operating line */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-xs tnum">
            <thead>
              <tr className="text-ink-mute text-left">
                <th className="font-normal py-1 pr-3">Year</th>
                {scen.filter((p) => p.projected).map((p) => <th key={p.year} className="font-normal py-1 px-2 text-right">{p.year}</th>)}
              </tr>
            </thead>
            <tbody>
              <Tr label="Apportionments" pts={scen} pick={(p) => p.apportionment} />
              <Tr label="Total revenue" pts={scen} pick={(p) => p.totalRev} />
              <Tr label="Expenses" pts={scen} pick={(p) => p.expense} />
              <Tr label="Surplus / deficit" pts={scen} pick={(p) => p.operating} signed />
              {a.newChurchSpend > 0 && <Tr label="New-church draw" pts={scen} pick={(p) => -p.churchSpend} signed />}
              {a.propertySaleRate > 0 && <Tr label="Property sold" pts={scen} pick={(p) => p.propertySold} />}
            </tbody>
          </table>
        </div>

        {a.propertySaleRate > 0 && (
          <div className="mt-5 rounded-md border border-rule p-4">
            <div className="eyebrow">Where the proceeds go · {HORIZON} yrs</div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Split label="District Strategy Teams" value={sale.districts} />
              <Split label="Conference Vitality & Dev" value={sale.conference} />
              <Split label="Property Admin Fund" value={sale.paf} />
            </div>
            <p className="mt-3 text-xs text-faint leading-relaxed">
              Of {fmtUsd(sale.sold)} in property sold (¶2549.3 + Urban Ministry Strategic Plan). Every share is
              restricted but stays in conference net assets as a designated fund until spent.
            </p>
          </div>
        )}
        <p className="mt-4 text-xs text-faint leading-relaxed">
          Illustrative model. Audited revenue and expense aggregates include pass-through flows (the conference
          insurance program, grants, restricted-fund releases) that move year to year, so treat the projected path as a
          directional what-if, not a forecast. The projection excludes 2025&rsquo;s one-time, non-cash property
          windfall (≈$14.2M of closed churches reverting to the conference) and treats the ≈$27M of property held for
          sale as non-spendable — it earns no investment return — so the forward line reflects recurring operations,
          not last year&rsquo;s asset jump. Selling that property (slider) follows BoD ¶2549.3 and the Río Texas Urban
          Ministry Strategic Plan: 20% funds the Property Administration Fund (capped at $400k), then net proceeds
          split by category — urban 75% district / 25% conference, non-urban 100% district. Every share stays in
          conference net assets as a restricted designated fund, so reserves don&rsquo;t fall on sale; the property
          simply converts from idle to invested, and the draw-down comes when the funds are spent. Apportionment
          revenue is the cleanest line and the one most under the conference&rsquo;s influence.
        </p>
      </div>

      {/* controls */}
      <div className="panel rounded-lg p-6 order-1 lg:order-2 h-fit lg:sticky lg:top-20">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Assumptions</div>
          {dirty && <button onClick={() => setA(baseline)} className="text-xs text-teal hover:underline">Reset to trend</button>}
        </div>
        <p className="mt-2 text-xs text-ink-mute">Defaults follow each line&rsquo;s 2016–2025 trend. Drag to ask &ldquo;what if?&rdquo;</p>

        <div className="mt-5 space-y-5">
          <Slider label={`Apportionments in ${firstProjYear}`} hint="one-time jump, next year only" value={a.apportionmentStep} onChange={set("apportionmentStep")} min={-0.3} max={0.3} base={baseline.apportionmentStep} highlight />
          <Slider label="Apportionment revenue" hint="ongoing annual change" value={a.apportionmentGrowth} onChange={set("apportionmentGrowth")} min={-0.2} max={0.2} base={baseline.apportionmentGrowth} />
          <Slider label="Other revenue" hint="ongoing annual change" value={a.otherRevGrowth} onChange={set("otherRevGrowth")} min={-0.2} max={0.2} base={baseline.otherRevGrowth} />
          <Slider label="Expenses" hint="ongoing annual change" value={a.expenseGrowth} onChange={set("expenseGrowth")} min={-0.2} max={0.2} base={baseline.expenseGrowth} />
          <Slider label="Investment return" hint="on reserves / yr" value={a.investmentReturn} onChange={set("investmentReturn")} min={0} max={0.1} base={baseline.investmentReturn} />

          <div className="pt-4 border-t border-rule">
            <div className="eyebrow">Asset moves</div>
            <p className="mt-1 text-xs text-ink-mute">Deliberate uses of reserves, in dollars.</p>
          </div>
          <Slider label="New church planting" unit="count" neutral step={1}
            hint={`≈ ${fmtUsd(a.newChurchSpend)} / yr at ${fmtUsd(COST_PER_PLANT)} per plant`}
            value={a.newChurchSpend / COST_PER_PLANT}
            onChange={(n) => set("newChurchSpend")(Math.round(n) * COST_PER_PLANT)}
            min={0} max={6} base={baseline.newChurchSpend / COST_PER_PLANT} />
          <Slider label="Sell held property" unit="pct" neutral step={0.02}
            hint={`${fmtUsd(a.propertySaleRate * held)} / yr of ${fmtUsd(held)} held for sale`}
            value={a.propertySaleRate} onChange={set("propertySaleRate")} min={0} max={0.4} base={baseline.propertySaleRate} />
          {a.propertySaleRate > 0 && (
            <Slider label="Urban share of sales" unit="share" neutral step={0.05}
              hint="urban → 75% district / 25% conference · non-urban → 100% district"
              value={a.urbanShare} onChange={set("urbanShare")} min={0} max={1} base={baseline.urbanShare} />
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({ label, hint, value, onChange, min, max, base, step = 0.005, highlight, unit = "pct", neutral }: {
  label: string; hint: string; value: number; onChange: (v: number) => void;
  min: number; max: number; base: number; step?: number; highlight?: boolean;
  unit?: "pct" | "usd" | "count" | "share"; neutral?: boolean;
}) {
  const fmt = (n: number) =>
    unit === "usd" ? fmtUsd(n)
    : unit === "count" ? `${Math.round(n)} ${Math.round(n) === 1 ? "church" : "churches"}`
    : unit === "share" ? `${Math.round(n * 100)}%`
    : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
  const valColor = neutral ? "text-ink" : value < 0 ? "text-ember" : value > 0 ? "text-teal" : "text-ink-mute";
  return (
    <div className={highlight ? "rounded-md ring-1 ring-teal/25 bg-teal-soft/40 p-3 -m-0.5" : ""}>
      <div className="flex items-baseline justify-between">
        <label className="text-sm text-ink">{label}</label>
        <span className={`tnum text-sm font-semibold ${valColor}`}>{fmt(value)}</span>
      </div>
      <div className="text-xs text-faint">{hint}</div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-2 w-full accent-teal"
      />
      <div className="flex justify-between text-[10px] text-faint tnum">
        <span>{fmt(min)}</span>
        <span>{highlight ? `start ${fmt(base)}` : `trend ${fmt(base)}`}</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
}

function Split({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="tnum text-lg font-semibold text-ink">{fmtUsd(value)}</div>
      <div className="text-xs text-ink-mute leading-tight">{label}</div>
    </div>
  );
}

function Legend({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash ? "3 2" : undefined} /></svg>
      {label}
    </span>
  );
}

function Outcome({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 tnum text-2xl font-semibold text-ink">{value}</div>
      {delta != null && delta !== 0 && (
        <div className={`text-xs tnum ${delta > 0 ? "text-teal" : "text-ember"}`}>
          {delta > 0 ? "+" : "−"}{fmtUsd(Math.abs(delta))} vs trend
        </div>
      )}
    </div>
  );
}

function Tr({ label, pts, pick, signed }: { label: string; pts: ProjPoint[]; pick: (p: ProjPoint) => number; signed?: boolean }) {
  const proj = pts.filter((p) => p.projected);
  return (
    <tr className="border-t border-rule">
      <td className="py-1 pr-3 text-ink-mute whitespace-nowrap">{label}</td>
      {proj.map((p) => {
        const v = pick(p);
        const cls = signed ? (v >= 0 ? "text-teal" : "text-ember") : "text-ink";
        return <td key={p.year} className={`py-1 px-2 text-right ${cls}`}>{signed && v >= 0 ? "+" : ""}{fmtUsd(v)}</td>;
      })}
    </tr>
  );
}

// ---- reserves chart (actual + baseline trend + scenario) -------------------
function ReserveChart({ base, scen }: { base: ProjPoint[]; scen: ProjPoint[] }) {
  const W = 640, H = 260, P = { l: 56, r: 16, t: 12, b: 26 };
  const years = scen.map((p) => p.year);
  const xMin = Math.min(...years), xMax = Math.max(...years);
  const all = [...base, ...scen].map((p) => p.netAssets);
  const yMax = Math.max(...all, 0) * 1.08;
  const yMin = Math.min(...all, 0);
  const x = (yr: number) => P.l + ((yr - xMin) / (xMax - xMin)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - yMin) / (yMax - yMin)) * (H - P.t - P.b);

  const line = (pts: ProjPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.year).toFixed(1)} ${y(p.netAssets).toFixed(1)}`).join(" ");
  const actual = scen.filter((p) => !p.projected);
  const splitYr = actual[actual.length - 1].year;
  const baseFut = base.filter((p) => p.projected || p.year === splitYr);
  const scenFut = scen.filter((p) => p.projected || p.year === splitYr);

  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label="Projected reserves">
      {/* zero line */}
      {yMin < 0 && <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--color-ember)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />}
      {/* y gridlines */}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = yMin + ((yMax - yMin) * i) / ticks;
        return (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--color-rule)" strokeWidth="1" opacity="0.5" />
            <text x={P.l - 8} y={y(v) + 3} textAnchor="end" className="fill-faint" style={{ fontSize: 10 }}>{fmtUsd(v)}</text>
          </g>
        );
      })}
      {/* x labels */}
      {scen.filter((_, i) => i % 2 === 0).map((p) => (
        <text key={p.year} x={x(p.year)} y={H - 8} textAnchor="middle" className="fill-faint" style={{ fontSize: 10 }}>{p.year}</text>
      ))}
      {/* split marker */}
      <line x1={x(splitYr)} x2={x(splitYr)} y1={P.t} y2={H - P.b} stroke="var(--color-rule)" strokeWidth="1" />
      {/* baseline trend (dashed) */}
      <path d={line(baseFut)} fill="none" stroke="var(--color-faint)" strokeWidth="1.5" strokeDasharray="3 2" />
      {/* actual (solid ink) */}
      <path d={line(actual)} fill="none" stroke="var(--color-ink)" strokeWidth="2" />
      {/* scenario projection (solid teal) */}
      <path d={line(scenFut)} fill="none" stroke="var(--color-teal)" strokeWidth="2.5" />
      {/* end dot */}
      <circle cx={x(scenFut[scenFut.length - 1].year)} cy={y(scenFut[scenFut.length - 1].netAssets)} r="3.5" fill="var(--color-teal)" />
    </svg>
  );
}
