/**
 * PAR — fetch ZCTA population for two ACS 5-yr vintages and write per-ZIP growth.
 * Growth 2018→2023 (5-yr midpoints ≈ 2016→2021) is a cohort covariate in par-model.ts:
 * fast-growing ZIPs run systematically above the growth-blind expectation (residual
 * r=0.115, monotonic by quartile — tested 2026-07-05).
 *
 * Requires CENSUS_API_KEY (unkeyed requests get 302'd).
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/fetch-zip-growth.ts
 */
import { writeFileSync } from "node:fs";

const KEY = process.env.CENSUS_API_KEY;
if (!KEY) throw new Error("CENSUS_API_KEY missing");
const OUT = new URL("./data/par/zip-growth.json", import.meta.url).pathname;
const MIN_BASE = 500; // ignore tiny-base ZIPs where % growth explodes

async function vintage(year: number): Promise<Map<string, number>> {
  const url = `https://api.census.gov/data/${year}/acs/acs5?get=B01003_001E&for=zip%20code%20tabulation%20area:*&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS ${year}: HTTP ${res.status}`);
  const rows: string[][] = await res.json();
  const m = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const v = Number(r[0]);
    if (Number.isFinite(v) && v > 0) m.set(r[r.length - 1], v);
  }
  return m;
}

const [p2023, p2018] = await Promise.all([vintage(2023), vintage(2018)]);
const growth: Record<string, number> = {};
for (const [zip, v23] of p2023) {
  const v18 = p2018.get(zip);
  if (v18 != null && v18 >= MIN_BASE) growth[zip] = Math.round(((v23 - v18) / v18) * 10000) / 10000;
}
writeFileSync(OUT, JSON.stringify({ vintages: [2018, 2023], minBase: MIN_BASE, growth }, null, 1));
console.log(`wrote ${OUT}: ${Object.keys(growth).length} ZIPs (of ${p2023.size} in 2023 vintage)`);
