/**
 * PAR Phase 2 — pastor Professions-of-faith Above Replacement. LOCAL ONLY.
 *
 * For each appointment stint, PAR compares the professions the charge actually
 * recorded during the pastor's full years against what the charge AS RECEIVED
 * was expected to produce in each year's conference climate:
 *
 *     PAR(year) = actual RECPROF − expectedFrozen(charge, year | arrival state)
 *
 * The baseline freezes the charge's size and trailing professions record at
 * arrival (so a plum assignment carries a high expectation and the pastor's own
 * effect never leaks into their own baseline) and rolls only the conference-wide
 * year effect forward (so 2020–21 pastors aren't scored against 2015).
 *
 * Attribution rules (v1, documented in METHODOLOGY.md):
 *  - UMC appointment years run July–June; GCFA data years are calendar. A data
 *    year is credited only under full-year incumbency: stint [s, e) covers data
 *    year D iff s < D < e. Transition years are EXCLUDED, not split.
 *  - Associate/co-pastor stints (detected from the stub church-name prefix) are
 *    never credited; church-years where 2+ pastors qualify are dropped as
 *    ambiguous rather than guessed.
 *  - Charges below 25 members at arrival are not scored (rates are noise).
 *  - PAR/yr is empirical-Bayes shrunk: parTotal / (yearsScored + 2).
 *
 * Outputs (gitignored — pastor names attached, never deployed):
 *   scripts/data/par/pastor-par.csv
 *   scripts/data/par/par-brief.html
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/build-par.ts
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { GATE_MEMBERS, TRAIN_MAX, loadStats, buildContext, buildParModel } from "./lib/par-model.ts";
import config from "../src/lib/conference.ts";

const MAP_PATH = new URL("./data/par/church-match-map.json", import.meta.url).pathname;
const OUT_CSV = new URL("./data/par/pastor-par.csv", import.meta.url).pathname;
const OUT_HTML = new URL("./data/par/par-brief.html", import.meta.url).pathname;

const DATA_MIN = config.years.dataMin;   // reliable appointment coverage starts (Rio Texas merger: 2015)
const DATA_MAX = config.years.dataMax;   // include latest year where the church reported
const K_SHRINK = config.models.par?.kShrink ?? 2;      // EB shrink of PAR/yr toward 0
const OPEN_END = config.years.openEnd;   // open-ended stints run through journal_year (openEnd − 1)

const db = adminClient();

// ---------------------------------------------------------------- load
const mapFile = JSON.parse(readFileSync(MAP_PATH, "utf8"));
const matchMap: Record<string, string> = mapFile.byChurchId ?? {};
const nonChurchIds = new Set<string>(mapFile.nonChurchIds ?? []);

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return rows;
}

type ChurchRow = { id: string; canonical_name: string; gcfa_number: string | null };
type ApptRow = { id: string; church_id: string; clergy_id: string; journal_year: number; role: string | null; years_at_appt: number | null };
type ClergyRow = { id: string; canonical_name: string };

const churchRows = await fetchAll<ChurchRow>("church", "id, canonical_name, gcfa_number");
const apptRows = await fetchAll<ApptRow>("appointment", "id, church_id, clergy_id, journal_year, role, years_at_appt");
const clergyRows = await fetchAll<ClergyRow>("clergy", "id, canonical_name");
const churchById = new Map(churchRows.map((c) => [c.id, c]));
const clergyName = new Map(clergyRows.map((c) => [c.id, c.canonical_name]));

const stats = await loadStats(new Set(["MEMBTOT", "RECPROF", "REMCHR", "REMWITH", "REMUMC", "REMOTH", "REMDEATH", "RECUMC", "RECOTH", "RECREST", "COMPPAST", "PASTHOUS", "TOTCASH"]));
const ctx = await buildContext(db, stats.keys());
const model = buildParModel(stats, ctx);
const cohorts = model.cohortTable(TRAIN_MAX);
const gAdj = model.growthAdjust(TRAIN_MAX, cohorts);

const field = (gcfa: string, code: string, y: number): number | null => stats.get(gcfa)?.get(code)?.get(y) ?? null;

// ---------------------------------------------------------------- stints
// Resolve each appointment row to a gcfa church; merge per clergy×gcfa into
// continuous stints; flag associate rows via the stub-name prefix (role is null
// on all pre-2025 rows — the Section I importer stripped it into church text).
type Stint = { clergyId: string; gcfa: string; start: number; end: number; isAssoc: boolean };
const raw: Stint[] = [];
let skippedNonChurch = 0, skippedUnresolved = 0;
for (const a of apptRows) {
  const c = churchById.get(a.church_id);
  if (!c) continue;
  const gcfa = c.gcfa_number ?? matchMap[a.church_id] ?? null;
  if (!gcfa) {
    if (nonChurchIds.has(a.church_id)) skippedNonChurch++;
    else skippedUnresolved++;
    continue;
  }
  const isAssoc = /\bAssoc|Co-Pastor/i.test(c.canonical_name) || /\bAssoc|Co-Pastor/i.test(a.role ?? "");
  const end = a.years_at_appt != null ? a.journal_year + Math.max(1, a.years_at_appt) : OPEN_END;
  raw.push({ clergyId: a.clergy_id, gcfa, start: a.journal_year, end, isAssoc });
}
// merge overlapping/adjacent intervals per clergy×gcfa (assoc merged separately)
const stints: Stint[] = [];
{
  const groups = new Map<string, Stint[]>();
  for (const s of raw) {
    const k = `${s.clergyId}|${s.gcfa}|${s.isAssoc ? "A" : "P"}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => a.start - b.start);
    let cur = { ...g[0] };
    for (let i = 1; i < g.length; i++) {
      if (g[i].start <= cur.end) cur.end = Math.max(cur.end, g[i].end);
      else { stints.push(cur); cur = { ...g[i] }; }
    }
    stints.push(cur);
  }
}
// Close stale open-ended stints. Every journal reprints the clergy's career and the
// importer leaves the then-current appointment with years_at_appt = null, so a clergy
// can carry several "open" stints. An open stint really ends when the clergy's next
// stint at a DIFFERENT church starts (strictly later start — same-start concurrency
// is a legitimate multi-point charge and stays open).
{
  const byClergy = new Map<string, Stint[]>();
  for (const s of stints) (byClergy.get(s.clergyId) ?? byClergy.set(s.clergyId, []).get(s.clergyId)!).push(s);
  for (const g of byClergy.values()) {
    for (const s of g) {
      if (s.end !== OPEN_END) continue;
      const nextStart = Math.min(...g.filter((o) => o.gcfa !== s.gcfa && o.start > s.start).map((o) => o.start));
      if (Number.isFinite(nextStart)) s.end = nextStart;
    }
  }
}

// ---------------------------------------------------------------- attribution
// candidate credited years per stint: s < D < e, within data window
type Credit = { stint: Stint; year: number };
const credits: Credit[] = [];
for (const s of stints) {
  if (s.isAssoc) continue;
  for (let D = Math.max(s.start + 1, DATA_MIN); D < s.end && D <= DATA_MAX; D++) credits.push({ stint: s, year: D });
}
// drop church-years claimed by 2+ pastors (ambiguous senior/associate parsing)
const byChurchYear = new Map<string, Credit[]>();
for (const c of credits) {
  const k = `${c.stint.gcfa}|${c.year}`;
  (byChurchYear.get(k) ?? byChurchYear.set(k, []).get(k)!).push(c);
}
let droppedAmbiguous = 0;
const clean: Credit[] = [];
for (const g of byChurchYear.values()) {
  const distinctClergy = new Set(g.map((c) => c.stint.clergyId));
  if (distinctClergy.size > 1) { droppedAmbiguous += g.length; continue; }
  clean.push(...g);
}

// ---------------------------------------------------------------- scoring
type StintScore = {
  clergyId: string; name: string; gcfa: string; church: string; start: number; end: number;
  years: { year: number; actual: number; expected: number; par: number }[];
  actualTotal: number; expectedTotal: number; parTotal: number; parPerYr: number; parShrunk: number;
  arrivalMembers: number | null;
  flows: { nonNaturalOut: number; deaths: number; transfersIn: number };
  compBaseSum: number; compTotalSum: number; compYears: number; yearSum: number;
};
const scoreByStint = new Map<Stint, StintScore>();
let skippedSmall = 0, skippedNoData = 0;
for (const c of clean) {
  const s = c.stint;
  const arrivalT = s.start; // exposure + trailing record fully pre-arrival
  const e0 = model.exposure(s.gcfa, arrivalT);
  if (e0 == null || e0 < GATE_MEMBERS) { skippedSmall++; continue; }
  const actual = field(s.gcfa, "RECPROF", c.year);
  if (actual == null) { skippedNoData++; continue; }
  const expected = model.expectedFrozen(s.gcfa, c.year, arrivalT, cohorts, gAdj);
  if (expected == null) { skippedNoData++; continue; }
  let sc = scoreByStint.get(s);
  if (!sc) {
    const ident = ctx.identByGcfa.get(s.gcfa);
    sc = {
      clergyId: s.clergyId, name: clergyName.get(s.clergyId) ?? "(unknown)", gcfa: s.gcfa,
      church: ident ? `${ident.church_name}${ident.city ? " (" + ident.city + ")" : ""}` : s.gcfa,
      start: s.start, end: s.end, years: [],
      actualTotal: 0, expectedTotal: 0, parTotal: 0, parPerYr: 0, parShrunk: 0,
      arrivalMembers: e0, flows: { nonNaturalOut: 0, deaths: 0, transfersIn: 0 },
      compBaseSum: 0, compTotalSum: 0, compYears: 0, yearSum: 0,
    };
    scoreByStint.set(s, sc);
  }
  const par = actual - expected;
  sc.years.push({ year: c.year, actual, expected: Math.round(expected * 100) / 100, par: Math.round(par * 100) / 100 });
  sc.actualTotal += actual;
  sc.expectedTotal += expected;
  sc.parTotal += par;
  sc.flows.nonNaturalOut += (field(s.gcfa, "REMCHR", c.year) ?? 0) + (field(s.gcfa, "REMWITH", c.year) ?? 0) + (field(s.gcfa, "REMUMC", c.year) ?? 0) + (field(s.gcfa, "REMOTH", c.year) ?? 0);
  sc.flows.deaths += field(s.gcfa, "REMDEATH", c.year) ?? 0;
  sc.flows.transfersIn += (field(s.gcfa, "RECUMC", c.year) ?? 0) + (field(s.gcfa, "RECOTH", c.year) ?? 0) + (field(s.gcfa, "RECREST", c.year) ?? 0);
  const base = field(s.gcfa, "COMPPAST", c.year);
  if (base != null && base > 0) {
    sc.compBaseSum += base;
    sc.compTotalSum += base + (field(s.gcfa, "PASTHOUS", c.year) ?? 0) + (field(s.gcfa, "TOTCASH", c.year) ?? 0);
    sc.compYears++;
    sc.yearSum += c.year;
  }
}
const scores = [...scoreByStint.values()].filter((s) => s.years.length > 0);
for (const s of scores) {
  s.years.sort((a, b) => a.year - b.year);
  s.parPerYr = s.parTotal / s.years.length;
  s.parShrunk = s.parTotal / (s.years.length + K_SHRINK);
}

// ---------------------------------------------------------------- diagnostics
const allPar = scores.flatMap((s) => s.years.map((y) => y.par));
const meanPar = allPar.reduce((a, b) => a + b, 0) / allPar.length;
console.log(`stints merged: ${stints.length} (raw rows ${raw.length}; skipped non-church ${skippedNonChurch}, unresolved ${skippedUnresolved})`);
console.log(`credited church-years: ${clean.length} (dropped ambiguous multi-pastor ${droppedAmbiguous}, small-at-arrival ${skippedSmall}, no data ${skippedNoData})`);
console.log(`scored stints: ${scores.length} across ${new Set(scores.map((s) => s.clergyId)).size} pastors | pastor-years scored: ${allPar.length}`);
console.log(`PAR/yr distribution: mean ${meanPar.toFixed(2)} (≈0 expected)`);

// split-half reliability: pastors with ≥2 stints of ≥2 scored years — does PAR persist across charges?
let splitR: number | null = null, splitN = 0;
{
  const byClergy = new Map<string, StintScore[]>();
  for (const s of scores.filter((s) => s.years.length >= 2)) {
    (byClergy.get(s.clergyId) ?? byClergy.set(s.clergyId, []).get(s.clergyId)!).push(s);
  }
  const xs: number[] = [], ys: number[] = [];
  for (const g of byClergy.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => b.years.length - a.years.length);
    xs.push(g[0].parPerYr);
    ys.push(g[1].parPerYr);
  }
  splitN = xs.length;
  if (splitN >= 5) {
    const mx = xs.reduce((a, b) => a + b, 0) / splitN, my = ys.reduce((a, b) => a + b, 0) / splitN;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < splitN; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    splitR = sxy / Math.sqrt(sxx * syy);
  }
  console.log(`split-half reliability (PAR/yr across a pastor's two longest stints): r=${splitR?.toFixed(3) ?? "n/a"} (n=${splitN} pastors)`);
}

const ranked = scores.filter((s) => s.years.length >= 3).sort((a, b) => b.parShrunk - a.parShrunk);
console.log(`\ntop 10 (≥3 scored years, shrunk PAR/yr):`);
for (const s of ranked.slice(0, 10)) console.log(`  ${s.parShrunk.toFixed(2)}/yr  ${s.name} @ ${s.church} ${s.start}–${s.end === OPEN_END ? "now" : s.end} (actual ${s.actualTotal} vs expected ${s.expectedTotal.toFixed(1)} over ${s.years.length} yrs)`);
console.log(`bottom 5:`);
for (const s of ranked.slice(-5)) console.log(`  ${s.parShrunk.toFixed(2)}/yr  ${s.name} @ ${s.church} ${s.start}–${s.end === OPEN_END ? "now" : s.end} (actual ${s.actualTotal} vs expected ${s.expectedTotal.toFixed(1)})`);

// ---------------------------------------------------------------- outputs
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
// Leading apostrophe on name/church guards CSV formula injection (names can start with =,+,-,@).
const csvLines = [
  "clergy,church,gcfa,start,end,years_scored,arrival_members,actual_total,expected_total,par_total,par_per_yr,par_shrunk,non_natural_out,deaths,transfers_in,comp_base_mean,comp_total_mean,comp_years,comp_mid_year",
  ...scores.sort((a, b) => b.parShrunk - a.parShrunk).map((s) =>
    [esc(s.name), esc(s.church), s.gcfa, s.start, s.end === OPEN_END ? "" : s.end, s.years.length, s.arrivalMembers ?? "",
      s.actualTotal, s.expectedTotal.toFixed(2), s.parTotal.toFixed(2), s.parPerYr.toFixed(2), s.parShrunk.toFixed(2),
      s.flows.nonNaturalOut, s.flows.deaths, s.flows.transfersIn,
      s.compYears ? Math.round(s.compBaseSum / s.compYears) : "", s.compYears ? Math.round(s.compTotalSum / s.compYears) : "",
      s.compYears, s.compYears ? (s.yearSum / s.compYears).toFixed(1) : ""].join(",")),
];
writeFileSync(OUT_CSV, csvLines.join("\n"));

const fmtStint = (s: StintScore) => `
  <tr><td>${s.name}</td><td>${s.church}</td><td>${s.start}–${s.end === OPEN_END ? "now" : s.end}</td>
  <td class="num">${s.years.length}</td><td class="num">${s.arrivalMembers}</td>
  <td class="num">${s.actualTotal}</td><td class="num">${s.expectedTotal.toFixed(1)}</td>
  <td class="num ${s.parShrunk >= 0 ? "pos" : "neg"}">${s.parShrunk >= 0 ? "+" : ""}${s.parShrunk.toFixed(2)}</td>
  <td class="num">${s.flows.nonNaturalOut}</td><td class="num">${s.flows.transfersIn}</td></tr>`;
const html = `<!doctype html><meta charset="utf-8"><title>PAR brief — PRIVATE</title>
<style>
body{font:14px/1.5 -apple-system,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.4rem} .warn{background:#fff3cd;border:1px solid #ffc107;padding:.6rem 1rem;border-radius:6px}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:13px}
td,th{border-bottom:1px solid #ddd;padding:.35rem .5rem;text-align:left} .num{text-align:right;font-variant-numeric:tabular-nums}
.pos{color:#0a6640;font-weight:600}.neg{color:#a82a2a;font-weight:600} small{color:#666}
</style>
<h1>Professions of Faith Above Replacement — private brief</h1>
<p class="warn"><b>Local analysis only.</b> Pastor names attached — do not publish, deploy, or share raw. PAR measures professions of faith only: not faithfulness, pastoral care, or justice ministry. Never read a ranking without its uncertainty; a stint of 2–3 years is mostly noise.</p>
<p><b>Model.</b> PAR(year) = actual professions − expected professions for the charge <i>as received</i>: size and trailing 3-yr professions record frozen at arrival, cohort prior (size × community favorability × ethnicity), conference-wide year effect rolling (COVID years scored against COVID expectations). Shrunk PAR/yr = PAR<sub>total</sub>/(years+${K_SHRINK}).</p>
<p><b>Validation.</b> Pastor-years scored: ${allPar.length} across ${scores.length} stints / ${new Set(scores.map((s) => s.clergyId)).size} pastors. Mean PAR/yr ${meanPar.toFixed(2)} (≈0 by construction). <b>Split-half reliability r = ${splitR?.toFixed(3) ?? "n/a"}</b> (n=${splitN} pastors with 2+ scored stints) — the degree to which PAR persists when the same pastor moves to a different charge. Ambiguous multi-pastor church-years dropped: ${droppedAmbiguous}.</p>
<h2>Top 25 (≥3 scored years, shrunk PAR/yr)</h2>
<table><tr><th>Pastor</th><th>Charge</th><th>Span</th><th>Yrs</th><th>Arrival mem.</th><th>Actual</th><th>Expected</th><th>PAR/yr†</th><th>Non-nat. out</th><th>Transfers in</th></tr>
${ranked.slice(0, 25).map(fmtStint).join("")}</table>
<h2>Bottom 15 (≥3 scored years)</h2>
<table><tr><th>Pastor</th><th>Charge</th><th>Span</th><th>Yrs</th><th>Arrival mem.</th><th>Actual</th><th>Expected</th><th>PAR/yr†</th><th>Non-nat. out</th><th>Transfers in</th></tr>
${ranked.slice(-15).map(fmtStint).join("")}</table>
<p><small>† shrunk. "Non-nat. out" = removals by charge-conference action, withdrawal, or transfer out during scored years — the "people leaving" context panel. Full data: pastor-par.csv. Generated ${new Date().toISOString().slice(0, 10)}.</small></p>`;
writeFileSync(OUT_HTML, html);
console.log(`\nwrote ${OUT_CSV} (${scores.length} stints) and ${OUT_HTML} (both gitignored)`);
