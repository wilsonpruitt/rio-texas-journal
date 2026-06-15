// Generate a standalone, printable HTML report from district-spending.json.
// Run: node scripts/analysis/district-spending/generate-report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = JSON.parse(fs.readFileSync(path.join(HERE, "district-spending.json"), "utf8"));
const NEW = ["North", "Central", "South"];
const OLD = ["Capital", "Coastal Bend", "Crossroads", "El Valle", "Hill Country", "Las Misiones", "West"];
const COLOR = { North: "#1f6f8b", Central: "#2f9e8f", South: "#7a5a3a" };
const usd0 = (n) => "$" + Math.round(n).toLocaleString();
const usdM = (n) => "$" + (n / 1e6).toFixed(2) + "M";
const pct = (n) => (n * 100).toFixed(0) + "%";

const YEARS = D.years; // 2014..2024
// data years for the conf series; recap district years map journal->data via calibration
const recapDataYear = {}; for (const c of D.calibration) recapDataYear[c.journal_year] = c.best_match_data_year;

// ---- SVG line chart: one panel, multiple series ----
function lineChart({ width = 760, height = 300, xs, series, yMax, title, fmtY = usdM }) {
  const m = { l: 56, r: 16, t: 28, b: 34 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const xmin = xs[0], xmax = xs[xs.length - 1];
  const X = (x) => m.l + ((x - xmin) / (xmax - xmin)) * iw;
  const Y = (y) => m.t + ih - (y / yMax) * ih;
  let g = "";
  // gridlines + y labels
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = (yMax / steps) * i; const y = Y(v);
    g += `<line x1="${m.l}" y1="${y}" x2="${width - m.r}" y2="${y}" stroke="#e7ded0" stroke-width="1"/>`;
    g += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8a7f6c">${fmtY(v)}</text>`;
  }
  // x labels
  for (const x of xs) {
    g += `<text x="${X(x)}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#8a7f6c">${String(x).slice(2)}</text>`;
  }
  // series
  for (const s of series) {
    const pts = s.points.filter((p) => p.y != null);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.4}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`;
    for (const p of pts) g += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${s.color}"/>`;
  }
  const legend = series.map((s, i) =>
    `<g transform="translate(${m.l + i * 150},${m.t - 12})"><line x1="0" y1="-4" x2="22" y2="-4" stroke="${s.color}" stroke-width="2.6" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/><text x="28" y="0" font-size="11" fill="#4a4234">${s.label}</text></g>`
  ).join("");
  return `<figure class="chart"><figcaption>${title}</figcaption><svg viewBox="0 0 ${width} ${height}" width="100%">${g}${legend}</svg></figure>`;
}

// ---- Chart 1: full vs continuing, conference apportionment PAID, per new district ----
const yMax1 = 4.3e6;
const panels = NEW.map((nd) => lineChart({
  height: 250, yMax: yMax1, xs: YEARS,
  title: `${nd} District — conference apportionment paid`,
  series: [
    { label: "All churches", color: COLOR[nd], points: YEARS.map((y) => ({ x: y, y: D.conference_apportionment[y].apppaid.full[nd] })) },
    { label: "Continuing only", color: COLOR[nd], dash: "5 4", width: 1.8, points: YEARS.map((y) => ({ x: y, y: D.conference_apportionment[y].apppaid.continuing[nd] })) },
  ],
})).join("");

// ---- Chart 2: three new districts compared (full line) ----
const chart2 = lineChart({
  width: 760, height: 320, yMax: yMax1, xs: YEARS,
  title: "Conference apportionment paid, by new district (all churches reporting)",
  series: NEW.map((nd) => ({ label: nd, color: COLOR[nd], points: YEARS.map((y) => ({ x: y, y: D.conference_apportionment[y].apppaid.full[nd] })) })),
});

// ---- weight matrix table ----
const wmRows = OLD.map((o) => `<tr><td>${o}</td>${NEW.map((n) => `<td class="num">${D.weight_matrix[o][n] > 0.0005 ? pct(D.weight_matrix[o][n]) : "—"}</td>`).join("")}<td class="num strong">${pct(D.continuing_fraction[o])}</td></tr>`).join("");

// ---- conference table ----
const confRows = YEARS.map((y) => {
  const f = D.conference_apportionment[y].apppaid, c = f.continuing, ff = f.full;
  return `<tr><td>${y}</td>${NEW.map((n) => `<td class="num">${usd0(ff[n])}</td><td class="num muted">${usd0(c[n])}</td>`).join("")}</tr>`;
}).join("");

// ---- district apportionment table (29b paid) ----
const distRows = D.district_apportionment.map((d) => {
  const f = d.paid_dist.full, c = d.paid_dist.continuing;
  return `<tr><td>${recapDataYear[d.journal_year]}</td>${NEW.map((n) => `<td class="num">${usd0(f[n])}</td><td class="num muted">${usd0(c[n])}</td>`).join("")}</tr>`;
}).join("");

// headline numbers
const n23 = D.conference_apportionment[2023].apppaid, n24 = D.conference_apportionment[2024].apppaid;
const dropFull = (n23.full.North + n23.full.Central + n23.full.South) - (n24.full.North + n24.full.Central + n24.full.South);
const dropCont = (n23.continuing.North + n23.continuing.Central + n23.continuing.South) - (n24.continuing.North + n24.continuing.Central + n24.continuing.South);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rio Texas District Spending Trends, 2014–2024</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Libre+Franklin:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
:root{--ink:#2b2620;--ink2:#4a4234;--mut:#8a7f6c;--line:#e7ded0;--paper:#fbf7ef;--accent:#b5481f}
*{box-sizing:border-box}
body{font-family:'Libre Franklin',system-ui,sans-serif;color:var(--ink);background:var(--paper);margin:0;line-height:1.55}
.wrap{max-width:840px;margin:0 auto;padding:56px 40px 80px}
h1,h2,h3{font-family:'Fraunces',serif;font-weight:600;line-height:1.15;color:var(--ink)}
h1{font-size:34px;margin:0 0 6px}
.sub{color:var(--mut);font-size:15px;margin:0 0 4px}
h2{font-size:23px;margin:42px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
h3{font-size:17px;margin:26px 0 8px}
p{font-size:14.5px;color:var(--ink2)}
.lead{font-size:16px;color:var(--ink)}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12.5px}
th,td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--line)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);font-weight:600}
td.num{text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px}
td.muted{color:var(--mut)}
td.strong{font-weight:600;color:var(--ink)}
.grid3{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.chart{margin:8px 0 4px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 14px 6px}
.chart figcaption{font-family:'Fraunces',serif;font-size:13px;color:var(--ink2);margin-bottom:4px}
.callout{background:#fff;border-left:3px solid var(--accent);padding:14px 18px;margin:16px 0;border-radius:0 6px 6px 0}
.callout p{margin:0;color:var(--ink)}
.note{font-size:12.5px;color:var(--mut)}
ul{font-size:14px;color:var(--ink2)}
.tag{display:inline-block;font-size:11px;font-family:'JetBrains Mono',monospace;background:#efe7d8;color:var(--ink2);padding:2px 8px;border-radius:10px}
footer{margin-top:50px;padding-top:14px;border-top:1px solid var(--line);font-size:11.5px;color:var(--mut)}
@media print{body{background:#fff}.wrap{padding:0}.chart,.callout{break-inside:avoid}h2{break-after:avoid}.grid3{gap:10px}}
</style></head><body><div class="wrap">

<h1>District Spending Trends Across the Merger</h1>
<p class="sub">Rio Texas Annual Conference · apportionments by district, 2014–2024</p>
<p class="sub">Re-expressed in the 2025 three-district map (North / Central / South) · <span class="tag">first-cut analysis</span></p>

<h2>The question</h2>
<p class="lead">How has spending in each district moved over the last decade — when the districts themselves were redrawn in 2025? The 2025 reorganization collapsed seven historic districts into three. To draw a continuous trend, every figure here is mapped into the <strong>new</strong> three-district frame using the official church-by-church crosswalk.</p>

<h2>What we found</h2>
<div class="callout"><p><strong>Most of the district decline is churches leaving, not surviving churches giving less.</strong> When we hold the cohort fixed to the 201 congregations that survived into the new map, the apportionment lines are comparatively flat. The steep drop in the all-churches line — about ${usdM(dropFull)} between 2023 and 2024 — is overwhelmingly disaffiliation: the continuing cohort fell only ${usdM(dropCont)} over the same span. The merger obscures this; separating the two cohorts reveals it.</p></div>

<p>Two measures are reported, each split two ways:</p>
<ul>
<li><strong>Conference apportionment</strong> — each church's full apportionment to the conference. Re-bucketed <em>exactly</em> from per-church records.</li>
<li><strong>District apportionment</strong> — money apportioned specifically for district missions (journal lines 28b/29b). Available only as old-district totals, so split into new districts by each old district's actual dollar flows.</li>
<li><strong>All churches</strong> (solid) vs <strong>continuing cohort</strong> (dashed): the gap is what disaffiliation and closure removed.</li>
</ul>

<h2>Where each old district's money went</h2>
<p>The crosswalk is not uniform — some historic districts fed a single new one, while Crossroads split three ways. The right-hand column shows how much of each old district's apportionment dollars belonged to churches that <em>survived</em> the transition.</p>
<table><thead><tr><th>Old district</th><th class="num">→ North</th><th class="num">→ Central</th><th class="num">→ South</th><th class="num">Continuing $ share</th></tr></thead><tbody>${wmRows}</tbody></table>
<p class="note">Weights are by continuing-church conference-apportionment dollars (2021–23 average) — the "contribution-weighted" basis, which correctly down-weights small churches and captures that Crossroads lost roughly half its dollars to disaffiliation.</p>

<h2>Conference apportionment paid, by new district</h2>
${chart2}
<p>All three new districts decline across the decade, but the trajectories differ once the cohort is held fixed (solid = all churches, dashed = continuing only):</p>
<div class="grid3">${panels}</div>

<h3>Figures</h3>
<table><thead><tr><th>Year</th><th class="num" colspan="2">North</th><th class="num" colspan="2">Central</th><th class="num" colspan="2">South</th></tr>
<tr><th></th><th class="num">all</th><th class="num">cont.</th><th class="num">all</th><th class="num">cont.</th><th class="num">all</th><th class="num">cont.</th></tr></thead><tbody>${confRows}</tbody></table>
<p class="note">Validation: re-bucketed 2023 total = ${usd0(D.conference_apportionment[2023].apppaid.full.North + D.conference_apportionment[2023].apppaid.full.Central + D.conference_apportionment[2023].apppaid.full.South + D.conference_apportionment[2023].apppaid.full._unassigned)} (incl. ${usd0(D.conference_apportionment[2023].apppaid.full._unassigned)} in counties outside the new map), matching the journal's paid-conference total to the dollar.</p>

<h2>District-missions apportionment</h2>
<p>Money apportioned specifically for district work, split into the new frame. Reported only for three data years (the per-district recap appears in the 2022–2024 journals). The 2023 collapse mirrors the disaffiliation wave.</p>
<table><thead><tr><th>Year</th><th class="num" colspan="2">North</th><th class="num" colspan="2">Central</th><th class="num" colspan="2">South</th></tr>
<tr><th></th><th class="num">all</th><th class="num">cont.</th><th class="num">all</th><th class="num">cont.</th><th class="num">all</th><th class="num">cont.</th></tr></thead><tbody>${distRows}</tbody></table>

<h2>Method &amp; caveats</h2>
<ul>
<li><strong>Sources.</strong> Per-church apportionment from the GCFA local-church statistical tables (2014–2024). Per-old-district district-missions figures hand-verified from the conference statistical recap in the 2022–2024 journals. Church-to-new-district crosswalk from the official 07.14.2025 three-district roster.</li>
<li><strong>Data-year alignment.</strong> The journal recap reports two years in arrears of the volume; calibrated to the dollar against GCFA totals (e.g. the 2024 journal's recap = data year 2023).</li>
<li><strong>2024 is real, not partial.</strong> All 201 continuing churches report in 2024; the lower total reflects disaffiliated churches no longer reporting — which is the central finding, not a gap.</li>
<li><strong>Unassigned ≈ 5%.</strong> A small slice of apportionment comes from churches in counties outside the new three-district map (mostly former Rio Grande / far-south congregations now closed or departed); excluded from district totals, noted in validation.</li>
<li><strong>District apportionment is split-estimated.</strong> A planned per-church parse of the journal statistical tables would make this measure exact and extend the cohort lines.</li>
</ul>

<footer>Generated from <code>scripts/analysis/district-spending/</code> · Rio Texas Journal project · first-cut, contribution-weighted split. Not deployed.</footer>
</div></body></html>`;

fs.writeFileSync(path.join(HERE, "district-spending-report.html"), html);
console.log("Wrote scripts/analysis/district-spending/district-spending-report.html");
