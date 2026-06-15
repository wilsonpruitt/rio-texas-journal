// District spending trends across the 2025 merger — FIRST CUT (contribution-weighted split).
//
// Two measures:
//   (1) Conference apportionment (GCFA per-church TOTAPP/APPPAID) — EXACT re-bucket into new districts.
//   (2) District apportionment (journal recap 28b/29b, 7 old districts) — SPLIT into new districts
//       using a contribution-weight matrix W[old][new] derived from continuing churches' GCFA dollars.
// Two cohorts each:
//   - full      = every church that reported that year
//   - continuing = only the ~203 churches that survived into the 3 new districts
//
// Run: node scripts/analysis/district-spending/build-district-spending.mjs
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const NEW_DISTRICTS = ["North", "Central", "South"];
const OLD_DISTRICTS = ["Capital", "Coastal Bend", "Crossroads", "El Valle", "Hill Country", "Las Misiones", "West"];

// ---------- 1. churches.json: gcfa -> {county, ...} ----------
const churches = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/gcfa/churches.json"), "utf8"));
const byGcfa = new Map();
for (const c of churches) byGcfa.set(String(c.gcfa_number), c);

// ---------- 2. reconcile tsv: continuing churches gcfa -> {old, new} ----------
const tsv = fs.readFileSync(path.join(ROOT, "scripts/data/district-roster-reconcile.tsv"), "utf8").trim().split("\n");
const header = tsv[0].split("\t");
const col = (name) => header.indexOf(name);
const rosterNew = new Map();   // gcfa -> new district (authoritative, continuing churches)
const gcfaOld = new Map();     // gcfa -> old district (continuing churches)
const countyToNewVotes = {};   // county -> {new: count}
const countyToOldVotes = {};   // county -> {old: count}
for (let i = 1; i < tsv.length; i++) {
  const r = tsv[i].split("\t");
  const gcfa = (r[col("gcfa")] || "").trim();
  const nd = (r[col("new_district")] || "").trim();
  const od = (r[col("old_district")] || "").trim();
  const county = (r[col("county")] || "").trim();
  if (gcfa && NEW_DISTRICTS.includes(nd)) { rosterNew.set(gcfa, nd); if (OLD_DISTRICTS.includes(od)) gcfaOld.set(gcfa, od); }
  if (county && NEW_DISTRICTS.includes(nd)) { (countyToNewVotes[county] ??= {})[nd] = (countyToNewVotes[county]?.[nd] || 0) + 1; }
  if (county && OLD_DISTRICTS.includes(od)) { (countyToOldVotes[county] ??= {})[od] = (countyToOldVotes[county]?.[od] || 0) + 1; }
}
const majority = (votes) => votes ? Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0] : null;
const countyToNew = {}; for (const [c, v] of Object.entries(countyToNewVotes)) countyToNew[c.toUpperCase()] = majority(v);
const countyToOld = {}; for (const [c, v] of Object.entries(countyToOldVotes)) countyToOld[c.toUpperCase()] = majority(v);

// Pull in DISTRICT_2025_BY_COUNTY from the app lib so departed churches in counties absent from the
// continuing roster still resolve (covers ~47 counties incl. geographically inferred ones).
const d2025 = fs.readFileSync(path.join(ROOT, "src/lib/district-2025.ts"), "utf8");
for (const m of d2025.matchAll(/"([^"]+)"\s*:\s*"(North|Central|South)"/g)) {
  if (!countyToNew[m[1].toUpperCase()]) countyToNew[m[1].toUpperCase()] = m[2];
}

const newDistrictFor = (gcfa) => {
  if (rosterNew.has(gcfa)) return rosterNew.get(gcfa);
  const c = byGcfa.get(gcfa);
  if (c?.county_name) return countyToNew[c.county_name.toUpperCase()] || null;
  return null;
};
const oldDistrictFor = (gcfa) => {
  if (gcfaOld.has(gcfa)) return gcfaOld.get(gcfa);
  const c = byGcfa.get(gcfa);
  if (c?.county_name) return countyToOld[c.county_name.toUpperCase()] || null;
  return null;
};

// ---------- 3. stream GCFA apportionment (TOTAPP/APPPAID), 2014-2024 ----------
const YEARS = []; for (let y = 2014; y <= 2024; y++) YEARS.push(y);
const app = new Map(); // gcfa -> year -> {totapp, apppaid}
await new Promise((resolve) => {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(ROOT, "scripts/data/gcfa/church_stats.jsonl")) });
  rl.on("line", (line) => {
    if (!line.includes("TOTAPP") && !line.includes("APPPAID")) return;
    let o; try { o = JSON.parse(line); } catch { return; }
    if (o.field_code !== "TOTAPP" && o.field_code !== "APPPAID") return;
    if (o.data_year < 2014 || o.data_year > 2024) return;
    if (o.value_numeric == null) return;
    const g = String(o.gcfa_number);
    const yr = app.get(g) ?? new Map(); app.set(g, yr);
    const cell = yr.get(o.data_year) ?? { totapp: 0, apppaid: 0 }; yr.set(o.data_year, cell);
    if (o.field_code === "TOTAPP") cell.totapp = o.value_numeric; else cell.apppaid = o.value_numeric;
  });
  rl.on("close", resolve);
});

// ---------- 4. MEASURE 1: conference apportionment by NEW district (exact GCFA re-bucket) ----------
const blank = () => ({ North: 0, Central: 0, South: 0, _unassigned: 0 });
const conf = {}; // year -> field -> cohort -> {North,Central,South}
const confTotalByYear = {}; // data_year -> sum totapp (for calibration)
for (const y of YEARS) {
  conf[y] = { totapp: { full: blank(), continuing: blank() }, apppaid: { full: blank(), continuing: blank() } };
  confTotalByYear[y] = 0;
}
for (const [gcfa, yr] of app) {
  const nd = newDistrictFor(gcfa);
  const isContinuing = rosterNew.has(gcfa);
  for (const [y, cell] of yr) {
    confTotalByYear[y] += cell.totapp;
    for (const f of ["totapp", "apppaid"]) {
      const v = cell[f];
      if (nd) { conf[y][f].full[nd] += v; if (isContinuing) conf[y][f].continuing[nd] += v; }
      else conf[y][f].full._unassigned += v;
    }
  }
}

// ---------- 5. calibrate recap journal_year -> data_year against GCFA conference totals ----------
const recap = JSON.parse(fs.readFileSync(path.join(HERE, "recap.json"), "utf8"));
const calib = recap.years.map((ry) => {
  let best = null;
  for (const y of YEARS) {
    const diff = Math.abs(confTotalByYear[y] - ry.totals.ap_conf);
    if (!best || diff < best.diff) best = { data_year: y, diff, gcfa: confTotalByYear[y] };
  }
  return { journal_year: ry.journal_year, recap_ap_conf: ry.totals.ap_conf, best_match_data_year: best.data_year, gcfa_totapp: Math.round(best.gcfa), pct_diff: (best.diff / ry.totals.ap_conf * 100) };
});

// ---------- 6. contribution-weight matrix W[old][new] from continuing churches ----------
// weight basis: each continuing church's average conference apportionment (TOTAPP) over the recap window.
const WINDOW = [2021, 2022, 2023];
const churchBasis = (gcfa) => {
  const yr = app.get(gcfa); if (!yr) return 0;
  let s = 0, n = 0; for (const y of WINDOW) { const c = yr.get(y); if (c) { s += c.totapp; n++; } }
  return n ? s / n : 0;
};
// numerator: continuing dollars old->new ; denom_all: ALL churches' dollars in old (for continuing-fraction)
const Wnum = {}; const denomCont = {}; const denomAll = {};
for (const o of OLD_DISTRICTS) { Wnum[o] = { North: 0, Central: 0, South: 0 }; denomCont[o] = 0; denomAll[o] = 0; }
for (const [gcfa] of app) {
  const o = oldDistrictFor(gcfa); if (!o || !OLD_DISTRICTS.includes(o)) continue;
  const basis = churchBasis(gcfa); if (basis <= 0) continue;
  denomAll[o] += basis;
  if (rosterNew.has(gcfa)) { Wnum[o][rosterNew.get(gcfa)] += basis; denomCont[o] += basis; }
}
const Wnorm = {}; // rows sum to 1 over continuing destinations
const contFrac = {}; // continuing $ / all $ within old district
for (const o of OLD_DISTRICTS) {
  Wnorm[o] = {}; const d = denomCont[o] || 1;
  for (const n of NEW_DISTRICTS) Wnorm[o][n] = (Wnum[o][n] || 0) / d;
  contFrac[o] = denomAll[o] ? denomCont[o] / denomAll[o] : 0;
}

// ---------- 7. MEASURE 2: district apportionment split into new districts ----------
const dist = recap.years.map((ry) => {
  const out = { journal_year: ry.journal_year };
  for (const f of ["ap_dist", "paid_dist"]) {
    const full = blank(), continuing = blank();
    for (const o of OLD_DISTRICTS) {
      const total = ry.by_district[f][o] || 0;
      for (const n of NEW_DISTRICTS) {
        const share = Wnorm[o][n];
        full[n] += total * share;                 // distribute whole old-district total by continuing splits
        continuing[n] += total * share * contFrac[o]; // continuing churches' estimated portion
      }
    }
    out[f] = { full, continuing };
  }
  return out;
});

// ---------- 8. write + report ----------
const output = { generated_for: "first-cut contribution-weighted split", years: YEARS, calibration: calib, weight_matrix: Wnorm, continuing_fraction: contFrac, conference_apportionment: conf, district_apportionment: dist };
fs.writeFileSync(path.join(HERE, "district-spending.json"), JSON.stringify(output, null, 2));

const usd = (n) => "$" + Math.round(n).toLocaleString();
const pct = (n) => (n * 100).toFixed(1) + "%";
console.log("\n=== RECAP DATA-YEAR CALIBRATION (recap 28a vs GCFA TOTAPP sum) ===");
for (const c of calib) console.log(`  journal ${c.journal_year}: recap=${usd(c.recap_ap_conf)}  best GCFA data_year=${c.best_match_data_year} (${usd(c.gcfa_totapp)}, ${c.pct_diff.toFixed(1)}% off)`);

console.log("\n=== CONTRIBUTION-WEIGHT MATRIX  W[old -> new]  (by continuing-church apportionment $) ===");
console.log("  old district     North   Central   South   | continuing-$ share of old");
for (const o of OLD_DISTRICTS) console.log(`  ${o.padEnd(14)} ${pct(Wnorm[o].North).padStart(7)} ${pct(Wnorm[o].Central).padStart(8)} ${pct(Wnorm[o].South).padStart(8)}   |  ${pct(contFrac[o])}`);

console.log("\n=== MEASURE 1: CONFERENCE APPORTIONMENT PAID, by NEW district (exact GCFA re-bucket) ===");
console.log("  year |        North           Central            South        (full / continuing)");
for (const y of YEARS) {
  const f = conf[y].apppaid.full, c = conf[y].apppaid.continuing;
  console.log(`  ${y} | ${usd(f.North)}/${usd(c.North)}  ${usd(f.Central)}/${usd(c.Central)}  ${usd(f.South)}/${usd(c.South)}`);
}

console.log("\n=== MEASURE 2: DISTRICT APPORTIONMENT PAID (29b), split into NEW district ===");
console.log("  journal |       North             Central             South          (full / continuing)");
for (const d of dist) {
  const f = d.paid_dist.full, c = d.paid_dist.continuing;
  console.log(`  ${d.journal_year}    | ${usd(f.North)}/${usd(c.North)}   ${usd(f.Central)}/${usd(c.Central)}   ${usd(f.South)}/${usd(c.South)}`);
}
console.log("\nWrote scripts/analysis/district-spending/district-spending.json");
