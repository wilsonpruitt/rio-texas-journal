/**
 * Conference finance parser — extracts the audited "Statement of Activities" for
 * the RIO TEXAS CONFERENCE UNITED METHODIST CHURCH entity (NOT the Board of
 * Pensions entity, which has its own SoA) from each journal PDF.
 *
 * The text layer is native (no OCR) in journals 2016–2024. Each statement reports
 * the completed fiscal year (journal year - 1) in its "Total" column plus a prior-
 * year comparison. On every data line the columns end "…Total PriorTotal", so the
 * current-FY value is the SECOND-TO-LAST number and the prior FY is the LAST.
 *
 * FY2024 comes from the 2025 journal's audited insert (scanned image) — seeded
 * manually below from a hand-read of that page, and cross-checked: the 2024
 * journal's FY2023 column must equal the 2025 audit's FY2023 comparison.
 *
 *   node --experimental-strip-types scripts/parsers/finance/parse-finance.ts
 *   -> writes scripts/data/conference-finance.json
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const JOURNAL_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const JOURNAL_DIR = new URL("../../../journals/", import.meta.url).pathname;
const OUT = new URL("../../data/conference-finance.json", import.meta.url).pathname;

// metric label -> regex + column mode.
//   "first": restriction-free line (Unrestricted == Total), so the 1st number is the
//            year's value in BOTH the 3-col (2016–2018) and 4-col (2019+) audit formats.
//   "total": line carries restricted $, so we need the Total column — which is the
//            2nd-to-last number in the 4-col format and the last number in the 3-col format.
// Labels changed across eras ("TOTAL SUPPORT AND REVENUE" -> "TOTAL OPERATING SUPPORT…").
const METRICS: { key: string; re: RegExp; mode: "first" | "total" }[] = [
  { key: "apportionment_rev", re: /^Apportionments\b/, mode: "first" },
  { key: "other_giving", re: /^Other Church Giving\b/, mode: "first" },
  { key: "insurance_income", re: /^Insurance Program( Income)?\b/, mode: "first" },
  { key: "grants", re: /^Grants\b/, mode: "first" },
  { key: "total_rev", re: /^TOTAL (OPERATING )?SUPPORT AND REVENUE\b/i, mode: "total" },
  { key: "program_exp", re: /^Program(\s|$|:)/, mode: "first" },
  { key: "gen_admin_exp", re: /^General and Administrative\b/, mode: "first" },
  { key: "total_exp", re: /^TOTAL (OPERATING )?EXPENSES\b/i, mode: "first" },
  { key: "net_assets_eoy", re: /^NET ASSETS,?\s+END OF YEAR\b/i, mode: "total" },
];

const parseNum = (tok: string): number | null => {
  const neg = tok.includes("(");
  const d = tok.replace(/[(),$\s]/g, "");
  if (!/\d/.test(d)) return null;
  const v = parseInt(d, 10);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
};

// all numeric tokens on a line, in order (dashes / blanks ignored)
const lineNums = (line: string): number[] =>
  (line.match(/\(?\$?\s?[\d][\d,]*\)?/g) ?? []).map(parseNum).filter((n): n is number => n != null);

function pages(pdf: string): string[] {
  const txt = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return txt.split("\f");
}

// is this page the CONFERENCE (not Board of Pensions / Foundation) Statement of Activities?
function isConferenceSoA(page: string): boolean {
  const u = page.toUpperCase();
  return u.includes("STATEMENT OF ACTIVITIES") &&
    u.includes("UNITED METHODIST CHURCH") &&
    !u.includes("BOARD OF PENSIONS") &&
    !u.includes("FOUNDATION") &&
    (u.includes("APPORTIONMENT") || u.includes("CHURCH REMITTANCES"));
}

type Row = { data_year: number; source: string } & Record<string, number | null>;

function parseYear(journalYear: number): Row | null {
  const pdf = `${JOURNAL_DIR}${journalYear}.pdf`;
  const page = pages(pdf).find(isConferenceSoA);
  if (!page) { console.warn(`  ${journalYear}: conference SoA page not found`); return null; }
  const fy = page.match(/For the Year Ended December 31,\s*(\d{4})/i);
  const dataYear = fy ? parseInt(fy[1], 10) : journalYear - 1;

  // Detect 4-column (prior-year comparison present) format from the net-assets line:
  // 4-col layouts carry [Without, With, Total, Prior] (>=4 numbers); 3-col carry
  // [Unrestricted, Restricted, Total] (3 numbers).
  const naLine = page.split("\n").map((l) => l.trim()).find((l) => /^NET ASSETS,?\s+END OF YEAR\b/i.test(l));
  const fourCol = naLine ? lineNums(naLine).length >= 4 : true;

  const row: Row = { data_year: dataYear, source: `journal-${journalYear}` };
  const prior: Record<string, number | null> = {};
  const seen = new Set<string>();
  for (const raw of page.split("\n")) {
    const line = raw.trim();
    for (const { key, re, mode } of METRICS) {
      if (seen.has(key) || !re.test(line)) continue;   // first match per metric wins
      const nums = lineNums(line);
      if (!nums.length) continue;
      if (mode === "first") {
        row[key] = nums[0];                            // Unrestricted == Total
      } else {
        row[key] = fourCol ? nums[nums.length - 2] : nums[nums.length - 1]; // Total column
        prior[key] = fourCol ? nums[nums.length - 1] : null;                // prior FY (4-col only)
      }
      seen.add(key);
    }
  }
  // attach the prior-year comparison for cross-checking
  (row as any)._prior_year = dataYear - 1;
  (row as any)._prior = prior;
  return row;
}

// FY2024 — hand-read from the 2025 journal's audited insert (scanned image).
const FY2024: Row = {
  data_year: 2024, source: "audit-2025-image",
  apportionment_rev: 6_014_687, other_giving: 357_417, insurance_income: 1_283_117, grants: 561_281,
  total_rev: 12_266_985, program_exp: 9_285_979, gen_admin_exp: 1_789_417, total_exp: 11_075_396,
  net_assets_eoy: 29_498_188,
};

const rows: Row[] = [];
for (const y of JOURNAL_YEARS) {
  const r = parseYear(y);
  if (r) rows.push(r);
}
rows.push(FY2024);
rows.sort((a, b) => a.data_year - b.data_year);

// cross-check: each row's prior-year comparison should match the previous row's primary
console.log("\nFY    apportion   totalRev   totalExp   netAssetsEOY   (prior-yr cross-check)");
const byYear = new Map(rows.map((r) => [r.data_year, r]));
for (const r of rows) {
  const fmt = (n: number | null | undefined) => (n == null ? "      —" : n.toLocaleString().padStart(11));
  let check = "";
  const prevPrimary = byYear.get(r.data_year - 1)?.net_assets_eoy;
  const priorClaim = (r as any)._prior?.net_assets_eoy;
  if (prevPrimary != null && priorClaim != null) {
    check = prevPrimary === priorClaim ? "✓ net-assets" : `⚠ prior NA ${priorClaim.toLocaleString()} vs ${prevPrimary.toLocaleString()}`;
  }
  console.log(`${r.data_year}  ${fmt(r.apportionment_rev)} ${fmt(r.total_rev)} ${fmt(r.total_exp)} ${fmt(r.net_assets_eoy)}   ${check}`);
}

// strip internal cross-check fields; drop years whose net assets failed to parse sanely
// (the oldest 3-col audit format, FY2015, mis-slices — apportionments are fine but the
// P&L/balance lines aren't reliable, so we exclude it rather than ship rough numbers).
const clean = rows
  .map(({ _prior, _prior_year, ...keep }: any) => keep)
  .filter((r: Row) => r.net_assets_eoy != null && (r.net_assets_eoy as number) > 1_000_000);

const APP_OUT = new URL("../../../src/data/conference-finance.json", import.meta.url).pathname;
writeFileSync(OUT, JSON.stringify(clean, null, 2));
writeFileSync(APP_OUT, JSON.stringify(clean, null, 2));
console.log(`\nWrote ${clean.length} years (${clean[0].data_year}–${clean[clean.length - 1].data_year}) -> ${OUT}`);
console.log(`Also wrote -> ${APP_OUT}`);
