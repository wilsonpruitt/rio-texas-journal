/**
 * Charge viability index (Conference Atlas Tier-A module).
 *
 * Can this charge sustain a full-time pastor? Two data-derived quantities:
 *
 *   pastoral cost = COMPPAST + PASTHOUS + TOTCASH + HLTHBILLED + PENBILLED
 *                   (3-yr mean of reported years — cash cost of the appointment)
 *   capacity      = ANNOPP total operating income, 3-yr mean (GRANDTOT fallback)
 *
 *   burden        = pastoral cost / capacity
 *   full-time floor = conference median pastoral cost at clearly-full-time
 *                     charges (250+ members) — what a full-time appointment
 *                     actually costs here, derived not decreed
 *   affordability = capacity × SUSTAINABLE_SHARE vs the floor
 *
 * Tiers (thresholds are stated assumptions, not doctrine):
 *   sustainable        burden ≤ 33% and can afford the floor
 *   strained           burden 33–45% but can afford the floor
 *   below the line     burden ok but capacity×share < floor (part-time / shared
 *                      appointment territory — cooperative-parish candidates)
 *   unsustainable      burden > 45%
 *
 * Output: scripts/data/par/viability.json (church-level, no personal data).
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/build-viability.ts
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { district2025 } from "../src/lib/districts.ts";
import { writeFileSync } from "node:fs";
import { loadStats, buildContext } from "./lib/par-model.ts";
import config from "../src/lib/conference.ts";

const OUT = new URL("./data/par/viability.json", import.meta.url).pathname;
const V = config.models.viability ?? {};
const SUSTAINABLE_SHARE = V.sustainableShare ?? 1 / 3; // share of operating income a charge can durably spend on pastoral support
const BURDEN_STRAINED = V.burdenStrained ?? 0.33;
const BURDEN_UNSUSTAINABLE = V.burdenUnsustainable ?? 0.45;
const FLOOR_MEMBERS = V.floorMembers ?? 250;       // "clearly full-time" cohort for deriving the floor
const FLOOR_PERCENTILE = V.floorPercentile ?? 0.25;

const db = adminClient();
const stats = await loadStats(new Set(["MEMBTOT", "AVATTWOR", "COMPPAST", "PASTHOUS", "TOTCASH", "HLTHBILLED", "PENBILLED", "ANNOPP", "GRANDTOT", "FUNDSCRA"]));
const ctx = await buildContext(db, stats.keys());

const val = (gcfa: string, code: string, y: number): number | null => stats.get(gcfa)?.get(code)?.get(y) ?? null;

// mean over the last n years (≤2024) where COMPPAST is reported and > 0
function recentYears(gcfa: string, n = 3): number[] {
  const comp = stats.get(gcfa)?.get("COMPPAST");
  if (!comp) return [];
  return [...comp.entries()].filter(([y, v]) => y <= 2024 && v > 0).map(([y]) => y).sort((a, b) => b - a).slice(0, n);
}
const pastoralCostAt = (gcfa: string, y: number): number =>
  (val(gcfa, "COMPPAST", y) ?? 0) + (val(gcfa, "PASTHOUS", y) ?? 0) + (val(gcfa, "TOTCASH", y) ?? 0) +
  (val(gcfa, "HLTHBILLED", y) ?? 0) + (val(gcfa, "PENBILLED", y) ?? 0);

type Row = {
  gcfa: string; id: string | null; name: string; city: string | null; district: string | null;
  members: number | null; worship: number | null;
  capacity: number; capacitySource: "ANNOPP" | "GRANDTOT";
  pastoralCost: number; burden: number; burdenTrendPp: number | null;
  canAffordFullTime: boolean; tier: string;
};
const pre: Omit<Row, "tier" | "canAffordFullTime">[] = [];

for (const gcfa of stats.keys()) {
  if (ctx.statusByGcfa.get(gcfa) !== "active") continue;
  const ident = ctx.identByGcfa.get(gcfa);
  if (!ident) continue;
  const yrs = recentYears(gcfa);
  if (!yrs.length) continue;

  const cost = yrs.reduce((s, y) => s + pastoralCostAt(gcfa, y), 0) / yrs.length;
  let capSrc: Row["capacitySource"] = "ANNOPP";
  let capYrs = yrs.map((y) => val(gcfa, "ANNOPP", y)).filter((v): v is number => v != null && v > 0);
  if (!capYrs.length) {
    capSrc = "GRANDTOT";
    capYrs = yrs.map((y) => val(gcfa, "GRANDTOT", y)).filter((v): v is number => v != null && v > 0);
  }
  if (!capYrs.length || cost <= 0) continue;
  const subsidy = yrs.reduce((s, y) => s + (val(gcfa, "FUNDSCRA", y) ?? 0), 0) / yrs.length;
  const capacity = capYrs.reduce((s, v) => s + v, 0) / capYrs.length + subsidy;

  // burden trajectory over the last ~8 reported years (percentage points / yr)
  const pts: Array<[number, number]> = [];
  const comp = stats.get(gcfa)!.get("COMPPAST")!;
  for (const [y, v] of comp) {
    if (y > 2024 || v <= 0) continue;
    const cap = val(gcfa, "ANNOPP", y) ?? val(gcfa, "GRANDTOT", y);
    if (cap == null || cap <= 0) continue;
    pts.push([y, pastoralCostAt(gcfa, y) / cap]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const w = pts.slice(-8);
  let slope: number | null = null;
  if (w.length >= 4) {
    const n = w.length, mx = w.reduce((s, p) => s + p[0], 0) / n, my = w.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, sxy = 0;
    for (const [x, y] of w) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
    slope = sxx ? (sxy / sxx) * 100 : null; // pp per year
  }

  const mem = stats.get(gcfa)?.get("MEMBTOT");
  const wor = stats.get(gcfa)?.get("AVATTWOR");
  const latest = (m?: Map<number, number>) => m?.size ? m.get(Math.max(...m.keys()))! : null;

  pre.push({
    gcfa, id: ctx.idMap[gcfa] ?? null, name: ident.church_name, city: ident.city ?? null,
    district: district2025(ident.county_name, gcfa),
    members: latest(mem), worship: latest(wor),
    capacity: Math.round(capacity), capacitySource: capSrc,
    pastoralCost: Math.round(cost), burden: Math.round((cost / capacity) * 1000) / 1000,
    burdenTrendPp: slope != null ? Math.round(slope * 100) / 100 : null,
  });
}

// full-time floor: median pastoral cost among clearly-full-time charges
const ftCosts = pre.filter((r) => (r.members ?? 0) >= FLOOR_MEMBERS).map((r) => r.pastoralCost).sort((a, b) => a - b);
const floor = ftCosts[Math.floor(ftCosts.length * FLOOR_PERCENTILE)]; // P25: a minimum viable full-time package

const rows: Row[] = pre.map((r) => {
  const afford = r.capacity * SUSTAINABLE_SHARE >= floor;
  const tier =
    r.burden > 1.5 ? "externally funded / check data" :
    r.burden > BURDEN_UNSUSTAINABLE ? "unsustainable" :
    !afford ? "below the full-time line" :
    r.burden > BURDEN_STRAINED ? "strained" : "sustainable";
  return { ...r, canAffordFullTime: afford, tier };
});

const byTier = new Map<string, number>();
for (const r of rows) byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1);
const medBurden = [...rows].sort((a, b) => a.burden - b.burden)[Math.floor(rows.length / 2)].burden;

writeFileSync(OUT, JSON.stringify({
  meta: {
    generatedAt: new Date().toISOString(),
    assumptions: { sustainableShare: SUSTAINABLE_SHARE, burdenStrained: BURDEN_STRAINED, burdenUnsustainable: BURDEN_UNSUSTAINABLE, floorMembers: FLOOR_MEMBERS },
    fullTimeFloor: floor, medianBurden: medBurden, churches: rows.length,
    tiers: Object.fromEntries(byTier),
  },
  churches: rows.sort((a, b) => b.burden - a.burden),
}, null, 2));

console.log(`${rows.length} active churches scored | full-time floor (P25 pastoral cost at ${FLOOR_MEMBERS}+): $${floor.toLocaleString()}`);
console.log(`median burden ${(medBurden * 100).toFixed(0)}% of operating income`);
console.log(`tiers: ${[...byTier.entries()].map(([t, n]) => `${t} ${n}`).join(" | ")}`);
console.log(`\nhighest burden (pastoral cost as % of income):`);
for (const r of rows.slice(0, 10)) {
  console.log(`  ${(r.burden * 100).toFixed(0)}%  ${r.name} (${r.district ?? "?"}) — cost $${r.pastoralCost.toLocaleString()} / income $${r.capacity.toLocaleString()}, ${r.members} members${r.burdenTrendPp != null ? `, trend ${r.burdenTrendPp > 0 ? "+" : ""}${r.burdenTrendPp}pp/yr` : ""}`);
}
const cov = rows.find((r) => r.gcfa === "758130");
if (cov) console.log(`\nCovenant Austin: burden ${(cov.burden * 100).toFixed(0)}% ($${cov.pastoralCost.toLocaleString()} / $${cov.capacity.toLocaleString()}), tier "${cov.tier}", afford full-time: ${cov.canAffordFullTime}`);
const districts = new Map<string, { n: number; below: number }>();
for (const r of rows) {
  const d = r.district ?? "?";
  const t = districts.get(d) ?? { n: 0, below: 0 };
  t.n++;
  if (!r.canAffordFullTime) t.below++;
  districts.set(d, t);
}
console.log(`\nper district — charges below the full-time line:`);
for (const [d, t] of districts) console.log(`  ${d}: ${t.below}/${t.n} (${((t.below / t.n) * 100).toFixed(0)}%)`);
