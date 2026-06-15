// Verify the transcribed audit data, then emit a standalone searchable/accessible HTML page.
// Run: node scripts/analysis/conference-financials/generate-financials-page.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN = process.argv[2] || "financials-2024.json";
const OUT = process.argv[3] || "conference-financials-2024.html";
const D = JSON.parse(fs.readFileSync(path.join(HERE, IN), "utf8"));
const stmt = (id) => D.statements.find((s) => s.id === id);
const rowsOf = (id) => (stmt(id)?.rows) || [];
const val = (id, label, yr = 0) => { const r = rowsOf(id).find((x) => x.label === label); return r ? r.v[yr] : NaN; };
const lineSum = (id, yr, pred) => rowsOf(id).filter((r) => r.v && !["subtotal", "total", "header"].includes(r.kind) && pred(r)).reduce((a, r) => a + r.v[yr], 0);

// ---------- VERIFICATION ----------
const checks = [];
// Skip a check when either operand is missing (NaN) so entity-specific checks no-op for other reports.
const chk = (name, got, want) => { if (!Number.isFinite(got) || !Number.isFinite(want)) return; checks.push({ name, ok: Math.round(got) === Math.round(want), got: Math.round(got), want: Math.round(want) }); };
// Generic structural check: every "subtotal"/"total" row whose JSON carries `sumOf` (a group name or "*")
// is reconciled against the sum of the line rows it covers. Works for any report.
for (const s of D.statements) {
  for (const r of s.rows) {
    if (!r.sumOf || !r.v) continue;
    for (const yr of [0, 1]) {
      const sum = s.rows.filter((x) => x.v && !["subtotal", "total", "header"].includes(x.kind) && (r.sumOf === "*" || x.group === r.sumOf)).reduce((a, x) => a + x.v[yr], 0);
      chk(`[${D.cols[yr]}] ${s.name}: ${r.label} = sum(${r.sumOf})`, sum, r.v[yr]);
    }
  }
}
for (const yr of [0, 1]) {
  const y = D.cols[yr];
  chk(`[${y}] balance sheet balances (assets = liab + net assets)`, val("position", "TOTAL ASSETS", yr), val("position", "TOTAL LIABILITIES AND NET ASSETS", yr));
  chk(`[${y}] liabilities + net assets = total assets`, val("position", "TOTAL LIABILITIES", yr) + val("position", "TOTAL NET ASSETS", yr), val("position", "TOTAL ASSETS", yr));
  chk(`[${y}] current assets sum`, lineSum("position", yr, (r) => r.group === "Current Assets"), val("position", "Total Current Assets", yr));
  chk(`[${y}] long-term assets sum`, lineSum("position", yr, (r) => r.group === "Long-Term Assets"), val("position", "Total Long-Term Assets", yr));
  chk(`[${y}] net assets = undesignated+designated+restricted`, val("position", "TOTAL NET ASSETS", yr), val("position", "Total Without Donor Restrictions", yr) + val("position", "Total With Donor Restrictions", yr));
  chk(`[${y}] undesignated detail sum`, lineSum("undesignated", yr, () => true), val("undesignated", "Total Undesignated", yr));
  chk(`[${y}] undesignated detail = balance-sheet undesignated`, val("undesignated", "Total Undesignated", yr), val("position", "Net Assets Without Donor Restrictions — Undesignated", yr));
  chk(`[${y}] designated funds sum -> Total Designated`, lineSum("designated", yr, () => true), val("designated", "Total Designated", yr));
  chk(`[${y}] perpetually-restricted sum`, lineSum("restricted", yr, (r) => r.group === "Perpetually Restricted"), val("restricted", "Total Perpetually Restricted", yr));
  chk(`[${y}] time/purpose-restricted sum`, lineSum("restricted", yr, (r) => r.group === "Time/Purpose Restricted"), val("restricted", "Total Time/Purpose Restricted", yr));
  chk(`[${y}] investments sum`, lineSum("investments", yr, () => true), val("investments", "Total Investments", yr));
  chk(`[${y}] property net = gross - accum dep`, val("property", "Subtotal (gross)", yr) + val("property", "Less Accumulated Depreciation", yr), val("property", "Total Property and Equipment, net", yr));
  chk(`[${y}] revenue - expenses = change before non-op`, val("activities", "Total Operating Support and Revenue", yr) - val("activities", "Total Operating Expenses", yr), val("activities", "Change in Net Assets Before Non-Operating Activity", yr));
  chk(`[${y}] change after non-op + beginning = ending net assets`, val("activities", "Change in Net Assets After Non-Operating Activity", yr) + val("activities", "Net Assets, Beginning of Year", yr), val("activities", "NET ASSETS, END OF YEAR", yr));
  chk(`[${y}] cash: net change + beginning = ending`, val("cashflows", "Net Decrease in Cash Flows", yr) + val("cashflows", "Cash and Cash Equivalents, Beginning of Year", yr), val("cashflows", "Cash and Cash Equivalents, End of Year", yr));
  chk(`[${y}] endowment components = total`, val("endowment", "  of which Without Donor Restrictions", yr) + val("endowment", "  of which Purpose Restricted", yr) + val("endowment", "  of which Perpetually Restricted", yr), val("endowment", "Endowment Net Assets, End of Year", yr));
  chk(`[${y}] liquidity available`, val("liquidity", "Total Financial Assets, Excluding Noncurrent Receivables", yr) + val("liquidity", "Less: Board Designations (Net of Trustees Property Transition)", yr) + val("liquidity", "Less: Donor Restrictions", yr), val("liquidity", "Financial Assets Available to Meet Cash Needs Within One Year", yr));
  // --- Board of Pensions-specific (skip for conference via NaN guard) ---
  chk(`[${y}] BoP operating support - expenses = operating loss`, val("activities", "Total Operating Support and Revenue", yr) - val("activities", "Total Operating Expenses", yr), val("activities", "Operating Loss", yr));
  chk(`[${y}] BoP operating loss + other income = change in net assets`, val("activities", "Operating Loss", yr) + val("activities", "Total Other Income (Expense)", yr), val("activities", "Change in Net Assets", yr));
  chk(`[${y}] BoP change + beginning = ending net assets`, val("activities", "Change in Net Assets", yr) + val("activities", "Net Assets, Beginning of Year", yr), val("activities", "Net Assets, End of Year", yr));
  chk(`[${y}] BoP cash: net change + beginning = ending`, val("cashflows", "Net Change in Cash Flows", yr) + val("cashflows", "Cash and Cash Equivalents, Beginning of Year", yr), val("cashflows", "Cash and Cash Equivalents, End of Year", yr));
  chk(`[${y}] BoP liquidity available`, val("liquidity", "Total Financial Assets", yr) + val("liquidity", "Less: Board Designations", yr) + val("liquidity", "Less: Donor Restrictions", yr), val("liquidity", "Financial Assets Available to Meet Cash Needs Within One Year", yr));
  chk(`[${y}] BoP net asset composition = total net assets`, val("funds", "Undesignated net assets (derived; balance sheet not provided)", yr) + val("funds", "Total Designated", yr) + val("funds", "Total Purpose Restricted", yr) + val("funds", "Total Perpetually Restricted", yr), val("funds", "Total Net Assets (per Statement of Activities)", yr));
}
console.log("\n=== TRANSCRIPTION VERIFICATION ===");
let fails = 0;
for (const c of checks) { if (!c.ok) { fails++; console.log(`  ✗ ${c.name}  got ${c.got.toLocaleString()} want ${c.want.toLocaleString()} (Δ ${(c.got - c.want).toLocaleString()})`); } }
console.log(fails === 0 ? `  ✓ all ${checks.length} checks passed` : `  ${fails} of ${checks.length} FAILED`);

// ---------- HTML ----------
const usd = (n) => (n < 0 ? "(" + Math.abs(n).toLocaleString() + ")" : n === 0 ? "—" : n.toLocaleString());
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- summary "where the assets are" (data-driven via D.summary, or default from the balance sheet) ----
const usdM = (n) => "$" + (n / 1e6).toFixed(1) + "M";
let summaryHeading, summaryBig, assetMapHead, assetMap, assetMapTotal, summaryNote;
if (D.summary) {
  summaryHeading = D.summary.heading;
  summaryBig = D.summary.bigNumbers.map((b) => ({ label: b.label, v: val(b.statement, b.row, 0) }));
  const mapS = stmt(D.summary.mapStatement);
  assetMapTotal = val(D.summary.mapStatement, D.summary.mapTotalRow, 0);
  assetMap = mapS.rows.filter((r) => r.v && !["subtotal", "total", "header"].includes(r.kind)).map((r) => ({ label: r.label, v: r.v[0] })).sort((a, b) => b.v - a.v);
  assetMapHead = D.summary.mapHeading || "Holding";
  summaryNote = D.summary.note || "";
} else {
  summaryHeading = "Where the conference's assets are";
  assetMapTotal = val("position", "TOTAL ASSETS", 0);
  summaryBig = [
    { label: "total assets", v: assetMapTotal },
    { label: "total net assets", v: val("position", "TOTAL NET ASSETS", 0) },
    { label: "total liabilities", v: val("position", "TOTAL LIABILITIES", 0) },
  ];
  const pr = rowsOf("position");
  assetMap = pr.slice(pr.findIndex((r) => r.label === "ASSETS") + 1, pr.findIndex((r) => r.label === "TOTAL ASSETS")).filter((r) => r.v && !r.kind).map((r) => ({ label: r.label, v: r.v[0] })).sort((a, b) => b.v - a.v);
  assetMapHead = "Asset (2024)";
  summaryNote = `The largest single pool of net assets is the board-designated <strong>Trustees Property Transition</strong> fund ($${val("designated", "Trustees Property Transition", 0).toLocaleString()}), reflecting closed-church property held by the conference. See the Designated Net Assets table for the full breakdown.`;
}

function renderStatement(s) {
  let body = "", grp = null;
  for (const r of s.rows) {
    if (r.kind === "header") { body += `<tr class="hdr"><th colspan="3" scope="colgroup">${esc(r.label)}</th></tr>`; grp = null; continue; }
    if (r.group && r.group !== grp) { grp = r.group; body += `<tr class="grp"><td colspan="3">${esc(grp)}</td></tr>`; }
    const cls = r.kind === "total" ? "total" : r.kind === "subtotal" ? "sub" : r.kind === "placeholder" ? "placeholder" : "";
    const text = `${s.name} ${r.label} ${r.group || ""}`.toLowerCase();
    body += `<tr class="${cls}" data-text="${esc(text)}"><td class="lbl">${esc(r.label)}</td>` +
      (r.v ? `<td class="num">${usd(r.v[0])}</td><td class="num old">${usd(r.v[1])}</td>` : `<td class="num"></td><td class="num"></td>`) + `</tr>`;
  }
  return `<section class="stmt" id="${s.id}" data-name="${esc(s.name.toLowerCase())}">
    <h2>${esc(s.name)}</h2><p class="st-sub">${esc(s.subtitle)}</p>
    <table><thead><tr><th scope="col">Line item</th><th scope="col" class="num">2024</th><th scope="col" class="num old">2023</th></tr></thead>
    <tbody>${body}</tbody></table></section>`;
}

const nav = D.statements.map((s) => `<a href="#${s.id}">${esc(s.name.replace(/^(Note \d+ — |Statement of )/, ""))}</a>`).join("") + `<a href="#notes">Notes</a>`;
const assetMapHtml = assetMap.map((a) => `<tr data-text="${esc((a.label).toLowerCase())}"><td>${esc(a.label)}</td><td class="num">${usd(a.v)}</td><td class="num muted">${(a.v / assetMapTotal * 100).toFixed(1)}%</td></tr>`).join("");
const summaryBigHtml = summaryBig.map((b) => `<div><b>${usdM(b.v)}</b> ${esc(b.label)}</div>`).join("");
const narrativeHtml = D.narrative.map((n) => `<section class="stmt note-text" data-name="${esc(n.name.toLowerCase())}"><h2>${esc(n.name)}</h2><p data-text="${esc((n.name + " " + n.text).toLowerCase())}">${esc(n.text)}</p></section>`).join("");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(D.title)} (FY2024)</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Libre+Franklin:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
:root{--ink:#2b2620;--ink2:#4a4234;--mut:#8a7f6c;--line:#e7ded0;--paper:#fbf7ef;--accent:#1f6f8b;--hit:#fff6d6}
*{box-sizing:border-box}body{font-family:'Libre Franklin',system-ui,sans-serif;color:var(--ink);background:var(--paper);margin:0;line-height:1.5}
.wrap{max-width:920px;margin:0 auto;padding:40px 28px 90px}
h1{font-family:'Fraunces',serif;font-size:30px;margin:0 0 4px}
.sub{color:var(--mut);font-size:14px;margin:0}
h2{font-family:'Fraunces',serif;font-size:21px;margin:0 0 2px}
.st-sub{color:var(--mut);font-size:13px;margin:0 0 10px}
.searchbar{position:sticky;top:0;z-index:5;background:var(--paper);padding:14px 0;border-bottom:1px solid var(--line);margin-bottom:8px}
#q{width:100%;font-size:16px;padding:11px 14px;border:1.5px solid var(--line);border-radius:9px;background:#fff;font-family:inherit}
#q:focus{outline:2px solid var(--accent);border-color:var(--accent)}
#count{font-size:12.5px;color:var(--mut);margin-top:6px}
nav.toc{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 26px}
nav.toc a{font-size:12px;text-decoration:none;color:var(--ink2);background:#efe7d8;padding:4px 10px;border-radius:12px}
nav.toc a:hover{background:#e2d6c0}
.summary{background:#fff;border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:8px 0 24px}
.summary h2{font-size:18px}
.big{display:flex;gap:26px;flex-wrap:wrap;margin:10px 0 4px}
.big div{font-size:13px;color:var(--mut)}.big b{display:block;font-family:'Fraunces',serif;font-size:22px;color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:6px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);border-bottom:1.5px solid var(--line);padding:6px 8px}
td{padding:5px 8px;border-bottom:1px solid #efe8da}
td.lbl{color:var(--ink2)}
.num{text-align:right;font-family:'JetBrains Mono',monospace;font-size:12.5px;white-space:nowrap}
.old{color:var(--mut)}.muted{color:var(--mut)}
tr.hdr th{font-family:'Fraunces',serif;font-size:13px;color:var(--ink);text-transform:none;letter-spacing:0;padding-top:12px;border-bottom:1px solid var(--line)}
tr.grp td{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);padding-top:10px;border:0}
tr.sub td{font-weight:600;border-top:1px solid var(--line)}
tr.total td{font-weight:600;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink);background:#fbf4e6}
tr.placeholder td{font-style:italic;color:var(--mut)}
mark{background:var(--hit);padding:0 1px}
.stmt{margin:30px 0;scroll-margin-top:84px}
.note-text p{font-size:14px;color:var(--ink2);background:#fff;border-left:3px solid var(--accent);padding:12px 16px;border-radius:0 6px 6px 0}
.hide{display:none !important}
footer{margin-top:50px;padding-top:14px;border-top:1px solid var(--line);font-size:11.5px;color:var(--mut)}
@media print{.searchbar,nav.toc{display:none}body{background:#fff}}
</style></head><body><div class="wrap">

<h1>${esc(D.title)}</h1>
<p class="sub">${esc(D.as_of)} · audited · all figures in US dollars</p>

<div class="searchbar">
  <label for="q" class="sub" style="display:block;margin-bottom:6px">Search every fund, asset, and line item</label>
  <input id="q" type="search" placeholder="e.g. Harvey, endowment, Mt. Wesley, Lily, district, property…" autocomplete="off" aria-describedby="count">
  <div id="count" aria-live="polite"></div>
</div>

<nav class="toc" aria-label="Statements">${nav}<a href="#assets-map">Where the assets are</a></nav>

<section class="summary" id="assets-map">
  <h2>${esc(summaryHeading)}</h2>
  <div class="big">${summaryBigHtml}</div>
  <table><thead><tr><th>${esc(assetMapHead)}</th><th class="num">Amount</th><th class="num">% of total</th></tr></thead><tbody>${assetMapHtml}</tbody></table>
  ${summaryNote ? `<p class="sub" style="margin-top:8px">${summaryNote}</p>` : ""}
</section>

${D.statements.map(renderStatement).join("")}
<h2 id="notes" style="scroll-margin-top:84px;border-top:2px solid var(--line);padding-top:18px">Notes to the Financial Statements</h2>
${narrativeHtml}

<footer>${esc(D.source)} Verified: ${fails === 0 ? `all ${checks.length} internal cross-checks (fund subtotals, statement chains, and reconciliations) reconcile.` : `${fails} cross-checks did not reconcile — see build log.`} Generated from <code>scripts/analysis/conference-financials/</code>.</footer>
</div>

<script>
const q=document.getElementById('q'),count=document.getElementById('count');
const rows=[...document.querySelectorAll('tr[data-text]')];
const paras=[...document.querySelectorAll('p[data-text]')];
const sections=[...document.querySelectorAll('section')];
function clearMarks(el){el.querySelectorAll('mark').forEach(m=>m.replaceWith(document.createTextNode(m.textContent)));}
function run(){
  const term=q.value.trim().toLowerCase();
  rows.forEach(clearMarks);
  if(!term){rows.forEach(r=>r.classList.remove('hide'));paras.forEach(p=>p.parentElement.classList.remove('hide'));sections.forEach(s=>s.classList.remove('hide'));count.textContent='';return;}
  let n=0;
  rows.forEach(r=>{const hit=r.dataset.text.includes(term);r.classList.toggle('hide',!hit);if(hit){n++;const lbl=r.querySelector('.lbl');if(lbl){const i=lbl.textContent.toLowerCase().indexOf(term);if(i>=0){const t=lbl.textContent;lbl.innerHTML='';lbl.append(t.slice(0,i));const m=document.createElement('mark');m.textContent=t.slice(i,i+term.length);lbl.append(m,t.slice(i+term.length));}}}});
  paras.forEach(p=>{const hit=p.dataset.text.includes(term);p.parentElement.classList.toggle('hide',!hit);if(hit)n++;});
  // keep section visible only if it has any visible row/para or its name matches
  sections.forEach(s=>{const nameHit=(s.dataset.name||'').includes(term);const anyVisible=[...s.querySelectorAll('tr[data-text]:not(.hide), p[data-text]')].some(e=>!e.classList.contains('hide')&&!e.parentElement.classList.contains('hide'));s.classList.toggle('hide',!nameHit&&!anyVisible);});
  count.textContent=n+' line'+(n===1?'':'s')+' match “'+q.value.trim()+'”';
}
q.addEventListener('input',run);
</script>
</body></html>`;

fs.writeFileSync(path.join(HERE, OUT), html);
console.log(`\nWrote scripts/analysis/conference-financials/${OUT}`);
