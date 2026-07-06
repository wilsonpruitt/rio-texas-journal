/**
 * PAR Phase 1 — charge-level expected-professions baseline.
 *
 * "How likely are future professions of faith at this charge, regardless of the
 * pastor?" Expected professions for church c in year t:
 *
 *     expected(c,t) = exposure(c,t) × Y(t) × M(c,t)
 *
 *   exposure = membership entering the year (last reported MEMBTOT before t)
 *   Y(t)     = conference-wide professions per member that year (year effect —
 *              absorbs COVID collapse + secular decline so no one is scored
 *              against a different era)
 *   M(c,t)   = the charge's propensity multiplier: empirical-Bayes blend of its
 *              own trailing 3-yr professions record with its cohort's rate
 *              (size band × community favorability tercile × ethnicity), the
 *              cohort itself shrunk toward the conference. Small churches sit
 *              near their cohort; big churches carry their own history.
 *
 * Count-based (Gamma-Poisson) so zeros are natural and no transforms are needed.
 * Uncertainty band = ±sqrt(phi × expected) with phi the empirical overdispersion.
 *
 * Validation gate: cohorts trained on ≤2019, predictions scored on 2022–2023
 * against naive (last observed value) and size-only baselines.
 *
 * Model core shared with build-par.ts via scripts/lib/par-model.ts.
 *
 * Outputs:
 *   scripts/data/par/baseline.json  — full: every gcfa church with history
 *   data/public/par.json               — site bundle: active churches only
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/build-par-baseline.ts
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { district2025 } from "../src/lib/districts.ts";
import { writeFileSync } from "node:fs";
import {
  GATE_MEMBERS, TRAIN_MIN, TRAIN_MAX, TRAIL, STRENGTH_CHURCH, STRENGTH_COHORT,
  loadStats, buildContext, buildParModel,
} from "./lib/par-model.ts";

const OUT_FULL = new URL("./data/par/baseline.json", import.meta.url).pathname;
const OUT_SITE = new URL("../data/public/par.json", import.meta.url).pathname;
const FORECAST_YEARS = [2025, 2026, 2027];

const db = adminClient();
const stats = await loadStats(new Set(["MEMBTOT", "RECPROF"]));
const ctx = await buildContext(db, stats.keys());
const model = buildParModel(stats, ctx);
const { exposure, yearEffect, cohortTable, growthAdjust, propensity, expectedAt } = model;

// ---------------------------------------------------------------- validation (train ≤2019, test 2022–23)
const cohortsTrain = cohortTable(2019);
const gAdjTrain = growthAdjust(2019, cohortsTrain);
let validation: any;
{
  type Row = { gcfa: string; t: number; actual: number; model: number; sizeOnly: number; naive: number };
  const rows: Row[] = [];
  for (const [gcfa, f] of stats) {
    const prof = f.get("RECPROF");
    if (!prof) continue;
    for (const t of [2022, 2023]) {
      const e = exposure(gcfa, t), p = prof.get(t), Y = yearEffect.get(t);
      if (e == null || e < GATE_MEMBERS || p == null || Y == null) continue;
      const m = expectedAt(gcfa, t, cohortsTrain, gAdjTrain)!;
      let naive: number | null = null;
      for (let y = t - 1; y >= t - 3 && naive == null; y--) if (prof.has(y)) naive = prof.get(y)!;
      if (naive == null) continue;
      rows.push({ gcfa, t, actual: p, model: m, sizeOnly: e * Y, naive });
    }
  }
  const mae = (get: (r: Row) => number) => rows.reduce((a, r) => a + Math.abs(r.actual - get(r)), 0) / rows.length;
  const corr = (get: (r: Row) => number) => {
    const xs = rows.map(get), ys = rows.map((r) => r.actual);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };
  console.log(`\n=== VALIDATION (cohorts ≤2019 -> test 2022–2023, n=${rows.length} church-years) ===`);
  console.log(`MAE  model ${mae((r) => r.model).toFixed(2)} | size-only ${mae((r) => r.sizeOnly).toFixed(2)} | naive-last ${mae((r) => r.naive).toFixed(2)}`);
  console.log(`corr model ${corr((r) => r.model).toFixed(3)} | size-only ${corr((r) => r.sizeOnly).toFixed(3)} | naive-last ${corr((r) => r.naive).toFixed(3)}`);
  rows.sort((a, b) => a.model - b.model);
  console.log(`calibration by expected-decile (sum actual / sum expected):`);
  const D = 10, per = Math.floor(rows.length / D);
  const calibration: { decile: number; actual: number; expected: number }[] = [];
  for (let d = 0; d < D; d++) {
    const seg = rows.slice(d * per, d === D - 1 ? rows.length : (d + 1) * per);
    const sa = seg.reduce((a, r) => a + r.actual, 0), se = seg.reduce((a, r) => a + r.model, 0);
    calibration.push({ decile: d + 1, actual: sa, expected: Math.round(se * 10) / 10 });
    console.log(`  d${d + 1}: actual ${sa} vs expected ${se.toFixed(1)}  (ratio ${(sa / se).toFixed(2)})`);
  }
  validation = {
    n: rows.length,
    maeModel: mae((r) => r.model), maeSizeOnly: mae((r) => r.sizeOnly), maeNaive: mae((r) => r.naive),
    corrModel: corr((r) => r.model), corrSizeOnly: corr((r) => r.sizeOnly), corrNaive: corr((r) => r.naive),
    calibration,
  };
}

// ---------------------------------------------------------------- full fit + outputs
const cohorts = cohortTable(TRAIN_MAX);
const gAdj = growthAdjust(TRAIN_MAX, cohorts);
console.log(`growth correctors: ${[...gAdj.entries()].map(([k, v]) => `${k} ${v.toFixed(3)}`).join(" | ")}`);

// overdispersion phi from training years under the full fit
let phi = 1;
{
  let chi2 = 0, n = 0;
  for (const [gcfa, f] of stats) {
    const prof = f.get("RECPROF");
    if (!prof) continue;
    for (let t = TRAIN_MIN; t <= TRAIN_MAX; t++) {
      const e = exposure(gcfa, t), p = prof.get(t);
      if (e == null || e < GATE_MEMBERS || p == null) continue;
      const exp = expectedAt(gcfa, t, cohorts, gAdj);
      if (exp == null || exp <= 0) continue;
      chi2 += (p - exp) ** 2 / exp;
      n++;
    }
  }
  phi = n ? chi2 / n : 1;
  console.log(`\noverdispersion phi = ${phi.toFixed(2)} (band = ±sqrt(phi·expected)) over ${n} training church-years`);
}

type ChurchOut = {
  gcfa: string; id: string | null; name: string; city: string | null; district: string | null; status: string;
  members: number | null; ethnicity: string; favorability: number | null;
  propensityM: number; cohortM: number; propensityPct: number | null;
  history: { year: number; actual: number | null; expected: number | null }[];
  forecast: { year: number; expected: number; lo: number; hi: number }[];
};
const outRows: ChurchOut[] = [];
for (const [gcfa, f] of stats) {
  const ident = ctx.identByGcfa.get(gcfa);
  if (!ident) continue;
  const prof = f.get("RECPROF");
  const memLatest = exposure(gcfa, 2025);
  const status = ctx.statusByGcfa.get(gcfa) ?? "unknown";
  const { M, cohortM } = propensity(gcfa, 2025, cohorts);
  const history: ChurchOut["history"] = [];
  for (let t = 2014; t <= 2024; t++) {
    const p = prof?.get(t) ?? null;
    const exp = expectedAt(gcfa, t, cohorts, gAdj);
    if (p == null && exp == null) continue;
    history.push({ year: t, actual: p, expected: exp != null ? Math.round(exp * 10) / 10 : null });
  }
  const forecast: ChurchOut["forecast"] = [];
  if (memLatest != null && memLatest >= GATE_MEMBERS && status === "active") {
    for (const t of FORECAST_YEARS) {
      const exp = expectedAt(gcfa, t, cohorts, gAdj);
      if (exp == null) continue;
      const band = Math.sqrt(phi * exp);
      forecast.push({ year: t, expected: Math.round(exp * 10) / 10, lo: Math.max(0, Math.round((exp - band) * 10) / 10), hi: Math.round((exp + band) * 10) / 10 });
    }
  }
  outRows.push({
    gcfa, id: ctx.idMap[gcfa] ?? null, name: ident.church_name, city: ident.city ?? null,
    district: district2025(ident.county_name, gcfa), status,
    members: memLatest, ethnicity: ctx.eth3(gcfa), favorability: ctx.favByGcfa.get(gcfa) ?? null,
    propensityM: Math.round(M * 100) / 100, cohortM: Math.round(cohortM * 100) / 100, propensityPct: null,
    history, forecast,
  });
}
// propensity percentile among active, gated churches
{
  const act = outRows.filter((r) => r.status === "active" && (r.members ?? 0) >= GATE_MEMBERS).sort((a, b) => a.propensityM - b.propensityM);
  act.forEach((r, i) => { r.propensityPct = Math.round((i / Math.max(1, act.length - 1)) * 100); });
}

const meta = {
  generatedAt: new Date().toISOString(),
  gateMembers: GATE_MEMBERS, trainYears: [TRAIN_MIN, TRAIN_MAX], trail: TRAIL,
  strengthChurch: STRENGTH_CHURCH, strengthCohort: STRENGTH_COHORT, phi: Math.round(phi * 100) / 100,
  yearEffects: [...yearEffect.entries()].sort((a, b) => a[0] - b[0]).map(([year, y]) => ({ year, per100: Math.round(y * 10000) / 100, projected: year > 2024 })),
  validation,
};
writeFileSync(OUT_FULL, JSON.stringify({ meta, churches: outRows }, null, 2));
const siteRows = outRows.filter((r) => r.status === "active" && (r.members ?? 0) >= GATE_MEMBERS);
writeFileSync(OUT_SITE, JSON.stringify({ meta, churches: siteRows }, null, 2));

console.log(`\nyear effects (professions per 100 members): ${meta.yearEffects.filter((y) => [2015, 2019, 2020, 2021, 2023].includes(y.year)).map((y) => `${y.year}: ${y.per100}`).join(" | ")}`);
console.log(`wrote ${OUT_FULL} (${outRows.length} churches) and ${OUT_SITE} (${siteRows.length} active)`);

// Covenant spot-check (Wilson's charge)
const cov = outRows.find((r) => r.gcfa === "758130");
if (cov) {
  console.log(`\nCovenant Austin: members=${cov.members} M=${cov.propensityM} (cohort ${cov.cohortM}) pct=${cov.propensityPct}`);
  console.log(`  history: ${cov.history.map((h) => `${h.year}: ${h.actual ?? "—"}/${h.expected ?? "—"}`).join("  ")}`);
  console.log(`  forecast: ${cov.forecast.map((f) => `${f.year}: ${f.expected} [${f.lo}–${f.hi}]`).join("  ")}`);
}
