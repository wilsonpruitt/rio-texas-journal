/**
 * Phase 4 — build model outputs from the GCFA series and write them to the
 * church_projection / church_vitality / church_cohort / model_meta tables.
 *
 * Four models (all explainable, no ML deps):
 *   1. Trend projection  — OLS on the last <=10 reported years of MEMBTOT,
 *                          AVATTWOR, GRANDTOT; project +1..+5 yrs with a band.
 *   2. Closure/vitality  — hand-rolled logistic regression mapping recent
 *                          {membership CAGR, attendance/member, log size,
 *                          baptism rate, net-change rate} -> P(ceased reporting),
 *                          trained on the 25-yr record (closed = stopped reporting
 *                          before 2024). Scored 0..100 with factor contributions.
 *   3. Cohort/peer       — size band x ethnicity for "churches like yours".
 *   4. Growth drivers    — conference-wide Pearson r between year-t per-member
 *                          inputs and t->t+3 membership growth.
 *
 * Run (after migration 0021):
 *   node --env-file=.env.local --experimental-strip-types scripts/build-models.ts [--dry]
 */
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { adminClient } from './parsers/era_b/lib/db.ts';
import { district2025, DISTRICTS_2025 } from "../src/lib/districts.ts";
import type { SupabaseClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry');
const DIR = new URL('./data/gcfa/', import.meta.url).pathname;
const LATEST = 2024;
// Stats kept in the series. Apportionment fields (TOTAPP=conference asked, APPPAID=conference
// paid) drive the district payout rollup; 0 is a meaningful value for those (paid nothing).
const KEEP = new Set(['MEMBTOT', 'AVATTWOR', 'GRANDTOT', 'NUMBAPT', 'RECPROF', 'CFTOTAL', 'ONLNWOR', 'TOTAPP', 'APPPAID']);
const PROJECT_FIELDS = ['MEMBTOT', 'AVATTWOR', 'GRANDTOT'];

type Series = Record<string, Record<string, Record<number, number>>>; // gcfa -> field -> year -> val

// --------------------------------------------------------------- math
function ols(pts: Array<[number, number]>) {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (const [x, y] of pts) sse += (y - (intercept + slope * x)) ** 2;
  const r2 = syy === 0 ? 0 : 1 - sse / syy;
  const resStd = Math.sqrt(sse / Math.max(1, n - 2));
  return { slope, intercept, r2, resStd, n };
}
const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
};
const sortedYears = (m: Record<number, number>) => Object.keys(m).map(Number).sort((a, b) => a - b);

// --------------------------------------------------------------- load series
async function loadSeries(): Promise<Series> {
  const s: Series = {};
  const rl = createInterface({ input: createReadStream(DIR + 'church_stats.jsonl'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!KEEP.has(r.field_code) || r.value_numeric == null) continue;
    // MEMBTOT=0 is an exit/non-report artifact (departing churches zero out their final
    // year), not a real count — treat as missing so it doesn't poison size/trend/cohort.
    if (r.field_code === 'MEMBTOT' && r.value_numeric === 0) continue;
    ((s[r.gcfa_number] ??= {})[r.field_code] ??= {})[r.data_year] = r.value_numeric;
  }
  return s;
}

// recent window (last `win` reported years up to LATEST) as [year,val] points
function recent(map: Record<number, number> | undefined, win = 10): Array<[number, number]> {
  if (!map) return [];
  return sortedYears(map).slice(-win).map((y) => [y, map[y]] as [number, number]);
}

// closure feature vector from a church's final/most-recent <=5 reported years
function featvec(fields: Record<string, Record<number, number>>) {
  const mem = fields['MEMBTOT']; if (!mem) return null;
  const yrs = sortedYears(mem); if (yrs.length < 3) return null;
  const w = yrs.slice(-5);
  const first = mem[w[0]], last = mem[w[w.length - 1]], span = w[w.length - 1] - w[0] || 1;
  const cagr = first > 0 ? (last / first) ** (1 / span) - 1 : 0;        // membership growth rate
  const size = Math.log10(Math.max(1, last));                          // log size
  const att = fields['AVATTWOR']?.[w[w.length - 1]] ?? null;
  const attRatio = att != null && last > 0 ? att / last : 0;           // engagement
  let bap = 0, bn = 0;
  for (const y of w) { const b = fields['NUMBAPT']?.[y]; const mm = mem[y]; if (b != null && mm > 0) { bap += b / mm; bn++; } }
  const bapRate = bn ? bap / bn : 0;                                    // baptisms per member
  const netRate = first > 0 ? (last - first) / span / first : 0;        // net change rate
  return { cagr, size, attRatio, bapRate, netRate, lastYear: w[w.length - 1] };
}

// --------------------------------------------------------------- logistic regression
function trainLogistic(X: number[][], y: number[], iters = 4000, lr = 0.1) {
  const n = X.length, d = X[0].length;
  // standardize
  const mean = Array(d).fill(0), std = Array(d).fill(0);
  for (const row of X) row.forEach((v, j) => (mean[j] += v / n));
  for (const row of X) row.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / n));
  std.forEach((v, j) => (std[j] = Math.sqrt(v) || 1));
  const Z = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));
  let w = Array(d).fill(0), b = 0;
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  for (let it = 0; it < iters; it++) {
    const gw = Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sig(Z[i].reduce((a, v, j) => a + v * w[j], b));
      const e = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += (e * Z[i][j]) / n;
      gb += e / n;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] + 0.01 * w[j]); // small L2
    b -= lr * gb;
  }
  const predict = (row: number[]) => sig(row.map((v, j) => (v - mean[j]) / std[j]).reduce((a, v, j) => a + v * w[j], b));
  // per-feature standardized contribution for one row
  const contrib = (row: number[]) => row.map((v, j) => ((v - mean[j]) / std[j]) * w[j]);
  return { predict, contrib, weights: w };
}

const tier = (s: number) => (s >= 70 ? 'high' : s >= 45 ? 'elevated' : s >= 25 ? 'moderate' : 'low');
const sizeBand = (m: number | null) =>
  m == null ? 'unknown' : m < 50 ? '<50' : m < 100 ? '50-99' : m < 250 ? '100-249' : m < 500 ? '250-499' : '500+';

async function upsert(db: SupabaseClient, table: string, rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw error;
  }
}

async function main() {
  const db = adminClient();
  const map: Record<string, string> = JSON.parse(readFileSync(DIR + 'church_id_map.json', 'utf8'));
  const churches: Array<Record<string, any>> = JSON.parse(readFileSync(DIR + 'churches.json', 'utf8'));
  const ident = new Map(churches.map((c) => [String(c.gcfa_number), c]));
  // authoritative status from the conference (disaffiliation spreadsheet + closed dates)
  const statusMap = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('church').select('id, status').not('gcfa_number', 'is', null).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    data.forEach((r) => statusMap.set(r.id, r.status));
    if (data.length < 1000) break;
  }
  // effective outcome: disaffiliated (authoritative) > closed (status OR ceased reporting <2023) > active
  // 'unverified' = roster discrepancy awaiting Wilson's confirmation — excluded from everything.
  const outcome = (g: string): 'active' | 'closed' | 'disaffiliated' | 'unverified' => {
    const s = statusMap.get(map[g]);
    if (s === 'unverified') return 'unverified';
    if (s === 'disaffiliated') return 'disaffiliated';
    const last = ident.get(g)?.last_year ?? LATEST;
    if (s === 'closed' || s === 'merged' || last < 2023) return 'closed';
    return 'active';
  };
  console.log('loading series...');
  const series = await loadSeries();
  const gcfas = Object.keys(map);
  console.log(`${gcfas.length} churches in map`);

  // ---- 1. projections ------------------------------------------------------
  const projRows: any[] = [];
  for (const g of gcfas) {
    const f = series[g]; if (!f) continue;
    for (const fc of PROJECT_FIELDS) {
      const pts = recent(f[fc], 10).filter((p) => p[1] != null);
      if (pts.length < 4) continue;
      const { slope, intercept, r2, resStd } = ols(pts);
      const baseYear = pts[pts.length - 1][0], baseVal = pts[pts.length - 1][1];
      for (let h = 1; h <= 5; h++) {
        const yr = baseYear + h;
        const yhat = intercept + slope * yr;
        projRows.push({
          church_id: map[g], field_code: fc, method: 'ols', base_year: baseYear,
          base_value: baseVal, slope: round(slope), r2: round(r2), horizon_year: yr,
          projected: round(Math.max(0, yhat)), lo: round(Math.max(0, yhat - resStd)), hi: round(yhat + resStd),
        });
      }
    }
  }

  // ---- 2. vitality (logistic) — closure risk, disaffiliation EXCLUDED ------
  // Disaffiliated churches (the 2019-23 schism) left for alignment, not decline, so
  // they are excluded from training. Closure risk = P(decline-driven closure).
  const feats: Array<{ g: string; v: ReturnType<typeof featvec>; status: string }> = [];
  for (const g of gcfas) {
    const f = series[g]; if (!f) continue;
    const v = featvec(f); if (!v) continue;
    const st = outcome(g);
    if (st === 'unverified') continue; // excluded from vitality + risk entirely
    feats.push({ g, v, status: st });
  }
  const train = feats.filter((r) => r.status !== 'disaffiliated');
  const Xtr = train.map((r) => [r.v!.cagr, r.v!.attRatio, r.v!.size, r.v!.bapRate, r.v!.netRate]);
  const Ytr = train.map((r) => (r.status === 'closed' ? 1 : 0));
  const model = trainLogistic(Xtr, Ytr);
  const FNAMES = ['membership_cagr', 'attendance_per_member', 'log_size', 'baptism_rate', 'net_change_rate'];
  const vitRows = feats.map((r) => {
    const x = [r.v!.cagr, r.v!.attRatio, r.v!.size, r.v!.bapRate, r.v!.netRate];
    const p = model.predict(x);
    const score = Math.round(p * 100);
    const contribs = model.contrib(x);
    const factors: Record<string, number> = {};
    FNAMES.forEach((nm, j) => (factors[nm] = round(contribs[j])));
    return {
      church_id: map[r.g], as_of_year: LATEST, risk_score: score, risk_tier: tier(score),
      prob_decline: round(p), factors, observed_status: r.status,
    };
  });

  // ---- 3. cohorts ----------------------------------------------------------
  const cohRows = gcfas.map((g) => {
    const f = series[g]; const c = ident.get(g);
    const latest = f?.['MEMBTOT'] ? f['MEMBTOT'][sortedYears(f['MEMBTOT']).slice(-1)[0]] : null;
    const band = sizeBand(latest);
    const eth = c?.church_ethnicity ?? null;
    const dist = c?.district_name ?? null;
    return { church_id: map[g], size_band: band, ethnicity: eth, district: dist, cohort_key: `${band}|${eth ?? 'NA'}` };
  });

  // ---- 4. growth drivers ---------------------------------------------------
  const driverPairs: Record<string, { x: number[]; y: number[] }> = {
    baptism_rate: { x: [], y: [] }, profession_rate: { x: [], y: [] },
    formation_rate: { x: [], y: [] }, attendance_ratio: { x: [], y: [] }, online_worship: { x: [], y: [] },
  };
  for (const g of gcfas) {
    const f = series[g]; if (!f?.['MEMBTOT']) continue;
    const mem = f['MEMBTOT'];
    for (const ys of sortedYears(mem)) {
      const t = ys, t3 = t + 3;
      if (mem[t] == null || mem[t3] == null || mem[t] < 10) continue;
      const growth = mem[t3] / mem[t] - 1;
      const push = (k: string, val: number | null) => { if (val != null && isFinite(val)) { driverPairs[k].x.push(val); driverPairs[k].y.push(growth); } };
      push('baptism_rate', f['NUMBAPT']?.[t] != null ? f['NUMBAPT'][t] / mem[t] : null);
      push('profession_rate', f['RECPROF']?.[t] != null ? f['RECPROF'][t] / mem[t] : null);
      push('formation_rate', f['CFTOTAL']?.[t] != null ? f['CFTOTAL'][t] / mem[t] : null);
      push('attendance_ratio', f['AVATTWOR']?.[t] != null ? f['AVATTWOR'][t] / mem[t] : null);
      push('online_worship', f['ONLNWOR']?.[t] != null ? (f['ONLNWOR'][t] > 0 ? 1 : 0) : null);
    }
  }
  const drivers = Object.entries(driverPairs)
    .map(([k, v]) => ({ factor: k, r: round(pearson(v.x, v.y)), n: v.x.length }))
    .filter((d) => d.r != null)
    .sort((a, b) => (b.r ?? 0) - (a.r ?? 0));

  // ---- 5. disaffiliation autopsy (IDEA #7): disaffiliated vs retained ------
  const grp = (st: string) => feats.filter((f) => f.status === st);
  const median = (xs: number[]) => { const s = xs.filter((v) => isFinite(v)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const profile = (st: string) => {
    const rows = grp(st);
    const sizes = rows.map((r) => series[r.g]?.['MEMBTOT'] ? series[r.g]['MEMBTOT'][sortedYears(series[r.g]['MEMBTOT']).slice(-1)[0]] : NaN).filter((v) => isFinite(v));
    const cagrs = rows.map((r) => r.v!.cagr).filter((v) => isFinite(v));
    const eth: Record<string, number> = {};
    rows.forEach((r) => { const e = ident.get(r.g)?.church_ethnicity ?? 'Unknown'; eth[e] = (eth[e] ?? 0) + 1; });
    return { n: rows.length, median_size: median(sizes), median_membership_cagr: round(median(cagrs)), by_ethnicity: eth };
  };
  const disaffReport = { disaffiliated: profile('disaffiliated'), active: profile('active'), closed: profile('closed') };

  // ---- 6. precomputed aggregates for the site (avoids paginating church_stat) --
  // Conference-wide yearly totals for the overview trend panels.
  // Two cuts. ALL = raw conference totals (includes churches that have since
  // closed or disaffiliated, so exits read as decline). ACTIVE-ONLY = only the
  // churches still active today, traced back through every year — this isolates
  // real decline *within* the continuing congregations from decline caused by
  // churches leaving or closing.
  const buildSeries = (keep: (g: string) => boolean, fields = ["MEMBTOT", "AVATTWOR", "GRANDTOT"]) => {
    const out: Record<string, { year: number; value: number }[]> = {};
    for (const fc of fields) {
      const byYear: Record<number, number> = {};
      for (const g of gcfas) {
        if (!keep(g)) continue;
        const m = series[g]?.[fc]; if (!m) continue;
        for (const y of sortedYears(m)) byYear[y] = (byYear[y] ?? 0) + m[y];
      }
      out[fc] = Object.entries(byYear).map(([year, value]) => ({ year: +year, value: round(value)! })).sort((a, b) => a.year - b.year);
    }
    return out;
  };
  // Conference cuts also carry APPPAID (per-church apportionment paid) so the finance
  // page can split apportionment giving by all churches vs. those who remained.
  const CONF_FIELDS = ["MEMBTOT", "AVATTWOR", "GRANDTOT", "APPPAID"];
  const confSeries = buildSeries(() => true, CONF_FIELDS);
  const confSeriesActive = buildSeries((g) => outcome(g) === 'active', CONF_FIELDS);

  // Same two cuts, scoped per 2025 district, for the /districts/[id] trend panels.
  const districtSeries: Record<string, { all: ReturnType<typeof buildSeries>; active: ReturnType<typeof buildSeries> }> = {};
  for (const dist of DISTRICTS_2025) {
    const inDist = (g: string) => district2025(ident.get(g)?.county_name, g) === dist;
    districtSeries[dist] = {
      all: buildSeries((g) => inDist(g)),
      active: buildSeries((g) => inDist(g) && outcome(g) === 'active'),
    };
  }
  // Per-church latest membership + worship attendance + 10-yr trend %, keyed by church_id.
  const churchMem: Record<string, { members: number | null; trend: number | null; worship: number | null; worshipTrend: number | null }> = {};
  // Latest value + 10-yr % change for one field's per-year series.
  const latestAndTrend = (s: Record<number, number> | undefined): { value: number | null; trend: number | null } => {
    if (!s || !Object.keys(s).length) return { value: null, trend: null };
    const yrs = sortedYears(s);
    const last = yrs[yrs.length - 1], value = s[last];
    const baseY = yrs.find((y) => y >= last - 10) ?? yrs[0];
    const base = s[baseY];
    const trend = base > 0 && baseY !== last ? Math.round(((value - base) / base) * 100) : null;
    return { value, trend };
  };
  for (const g of gcfas) {
    const mem = latestAndTrend(series[g]?.["MEMBTOT"]);
    const wor = latestAndTrend(series[g]?.["AVATTWOR"]);
    if (mem.value == null && wor.value == null) continue;
    churchMem[map[g]] = { members: mem.value, trend: mem.trend, worship: wor.value, worshipTrend: wor.trend };
  }

  // ---- district summary (2025 Central/North/South) for /districts ----------
  // Apportionment asked (TOTAPP) vs paid (APPPAID) read at each church's latest reported
  // year (per-church arrears differ); summed per 2025 district to give a payout rate.
  const vitTierByChurch = new Map(vitRows.map((v) => [v.church_id, v.risk_tier]));
  const pairedApp = (g: string): { asked: number | null; paid: number | null } => {
    const a = series[g]?.["TOTAPP"], p = series[g]?.["APPPAID"];
    if (!a && !p) return { asked: null, paid: null };
    const yrs = [...(a ? sortedYears(a) : []), ...(p ? sortedYears(p) : [])];
    const y = Math.max(...yrs);
    return { asked: a?.[y] ?? null, paid: p?.[y] ?? null };
  };
  type Dist = { churches: number; members: number; worship: number; apportioned: number; paid: number; risk: Record<string, number> };
  const mkDist = (): Dist => ({ churches: 0, members: 0, worship: 0, apportioned: 0, paid: 0, risk: { low: 0, moderate: 0, elevated: 0, high: 0 } });
  const districtSummary: Record<string, Dist> = Object.fromEntries(DISTRICTS_2025.map((d) => [d, mkDist()]));
  for (const g of gcfas) {
    if (outcome(g) !== 'active') continue;
    const dist = district2025(ident.get(g)?.county_name, g);
    if (!dist) continue;
    const d = districtSummary[dist];
    d.churches++;
    const mem = latestAndTrend(series[g]?.["MEMBTOT"]).value;
    const wor = latestAndTrend(series[g]?.["AVATTWOR"]).value;
    const { asked, paid } = pairedApp(g);
    if (mem != null) d.members += mem;
    if (wor != null) d.worship += wor;
    if (asked != null) d.apportioned += asked;
    if (paid != null) d.paid += paid;
    const t = vitTierByChurch.get(map[g]);
    if (t && d.risk[t] != null) d.risk[t]++;
  }

  // ---- summary + write -----------------------------------------------------
  const counts = { active: grp('active').length, closed: grp('closed').length, disaffiliated: grp('disaffiliated').length };
  console.log(`projections: ${projRows.length} rows`);
  console.log(`outcomes: ${JSON.stringify(counts)} (closure model trained on active+closed, disaffiliated excluded)`);
  console.log(`disaffiliation autopsy: disaff median size ${disaffReport.disaffiliated.median_size} vs active ${disaffReport.active.median_size}`);
  console.log(`logistic weights [${FNAMES.join(', ')}]: ${model.weights.map((w) => w.toFixed(2)).join(', ')}`);
  console.log('growth drivers (Pearson r with t->t+3 membership growth):');
  drivers.forEach((d) => console.log(`  ${d.factor}: r=${d.r} (n=${d.n})`));
  console.log('district summary (2025):');
  for (const [name, d] of Object.entries(districtSummary)) {
    const p = d.apportioned > 0 ? (d.paid / d.apportioned) * 100 : 0;
    console.log(`  ${name}: ${d.churches} churches, worship ${d.worship}, members ${d.members}, paid $${Math.round(d.paid).toLocaleString()}/$${Math.round(d.apportioned).toLocaleString()} = ${p.toFixed(1)}%`);
  }
  if (DRY) { console.log('** DRY — no writes **'); return; }

  await upsert(db, 'church_projection', projRows, 'church_id,field_code,horizon_year');
  await upsert(db, 'church_vitality', vitRows, 'church_id');
  await upsert(db, 'church_cohort', cohRows, 'church_id');
  const { error } = await db.from('model_meta').upsert([
    { key: 'growth_drivers', payload: { drivers, built_year: LATEST } },
    { key: 'disaffiliation_autopsy', payload: disaffReport },
    { key: 'outcome_counts', payload: counts },
    { key: 'conference_series', payload: confSeries },
    { key: 'conference_series_active', payload: confSeriesActive },
    { key: 'district_series', payload: districtSeries },
    { key: 'church_membership', payload: churchMem },
    { key: 'district_summary', payload: districtSummary },
  ], { onConflict: 'key' });
  if (error) throw error;
  console.log('Done.');
}

function round(n: number | null | undefined) { return n == null || !isFinite(n) ? null : Math.round(n * 1e4) / 1e4; }
main().catch((e) => { console.error(e); process.exit(1); });
