/**
 * Detect membership-roll audits — signal vs. noise in "decline".
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/detect-membership-audits.ts
 *   (optional) ... detect-membership-audits.ts --csv > exports/membership-audits.csv
 *
 * WHY: A large share of apparent UMC membership "decline" — especially 2019–2024
 * — is not people leaving. It is churches finally cleaning their rolls of
 * long-inactive/deceased/moved members (often triggered by disaffiliation-era
 * charge-conference reviews). Treating an audit year as attrition badly misreads
 * a church's health; average worship attendance is the truer signal.
 *
 * METHOD (ported from the Compass project, generalized): start from the
 * beginning roll, add real receptions, subtract ONLY ordinary attrition
 * (withdrawn + transfers + deaths), and compare to the reported year-end roll.
 * Whatever extra the roll shrank by is the audit-type reduction — no matter how
 * (or whether) it was recorded:
 *
 *   audit_reduction(Y) = max(0, begin + receivedReal - attrition - end)
 *
 * Because it derives the reduction from begin/end and ordinary lines only, it
 * counts each audit once whether the church booked it as a charge-conference
 * removal (3a), a correction (3c), or simply restated its year-end total
 * (recording it in no line at all — the most common pattern). The mechanism
 * breakdown below is for transparency only and never affects the magnitude.
 *
 * A year is flagged when audit_reduction ≥ 40 AND ≥ 8% of the beginning roll.
 *
 * Field codes (Section J membership table):
 *   1  begin   2a-2g received (2d = correction)   3a-3f removed
 *   (3a charge-conf, 3c correction)   4  year-end
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";

const db = adminClient();

const RECEIVED_REAL = ["2a", "2b", "2c", "2e", "2f", "2g"]; // excludes 2d (correction)
const ATTRITION = ["3b", "3d", "3e", "3f"]; // ordinary: withdrawn + transfers + death
const ALL_CODES = ["1", ...RECEIVED_REAL, ...ATTRITION, "3a", "3c", "4"];

const MIN_REDUCTION = 40;
const MIN_FRACTION = 0.08;

type Row = { church_id: string; data_year: number; field_code: string; value_numeric: number | null };

async function fetchAll(): Promise<Row[]> {
  const all: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("church_stat")
      .select("church_id, data_year, field_code, value_numeric")
      .in("field_code", ALL_CODES)
      .order("church_id", { ascending: true })
      .order("data_year", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return all;
}

async function churchNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("church")
      .select("id, canonical_name")
      .in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const c of data ?? []) map.set(c.id, c.canonical_name);
  }
  return map;
}

async function main() {
  const wantCsv = process.argv.includes("--csv");
  const rows = await fetchAll();

  // church_id -> year -> code -> value
  const byChurch = new Map<string, Map<number, Record<string, number>>>();
  for (const r of rows) {
    if (r.value_numeric == null) continue;
    if (!byChurch.has(r.church_id)) byChurch.set(r.church_id, new Map());
    const years = byChurch.get(r.church_id)!;
    if (!years.has(r.data_year)) years.set(r.data_year, {});
    years.get(r.data_year)![r.field_code] = r.value_numeric;
  }

  const names = await churchNames([...byChurch.keys()]);
  const sum = (g: Record<string, number>, codes: string[]) =>
    codes.reduce((n, c) => n + (g[c] ?? 0), 0);

  type Flag = { church: string; year: number; reduction: number; pct: number; begin: number; end: number; mechanism: string };
  const flags: Flag[] = [];

  for (const [churchId, years] of byChurch) {
    for (const [year, g] of years) {
      const prev = years.get(year - 1);
      // Require real prior-year continuity (this year's begin = last year's end).
      const begin = prev?.["4"] ?? null;
      const end = g["4"] ?? null;
      if (begin == null || end == null || begin <= 0) continue;

      const receivedReal = sum(g, RECEIVED_REAL);
      const attrition = sum(g, ATTRITION);
      const chargeConf = g["3a"] ?? 0;
      const correction = g["3c"] ?? 0;
      // Skip years with no reported membership flow at all — the older journals'
      // parse often lacks the received/removed lines, so begin−end alone would
      // misread ordinary decline as an audit. Without flow data we can't tell.
      if (receivedReal + attrition + chargeConf + correction === 0) continue;

      const auditReduction = Math.max(0, begin + receivedReal - attrition - end);

      if (auditReduction >= MIN_REDUCTION && auditReduction >= MIN_FRACTION * begin) {
        // Transparency only — how the reduction was booked. Does not affect size.
        const restated = Math.max(0, auditReduction - chargeConf - correction);
        const parts: string[] = [];
        if (chargeConf > 0) parts.push(`charge-conf ${chargeConf}`);
        if (correction > 0) parts.push(`correction ${correction}`);
        if (restated > 0) parts.push(`restated ${Math.round(restated)}`);
        flags.push({
          church: names.get(churchId) ?? churchId,
          year,
          reduction: Math.round(auditReduction),
          pct: Math.round((auditReduction / begin) * 1000) / 10,
          begin,
          end,
          mechanism: parts.join(" + "),
        });
      }
    }
  }

  flags.sort((a, b) => b.year - a.year || b.reduction - a.reduction);

  if (wantCsv) {
    console.log("church,year,begin_members,end_members,audit_reduction,pct_of_roll,mechanism");
    for (const f of flags) {
      console.log(`"${f.church}",${f.year},${f.begin},${f.end},${f.reduction},${f.pct},"${f.mechanism}"`);
    }
    return;
  }

  console.log(`\nFlagged ${flags.length} likely membership-audit church-years (reduction ≥ ${MIN_REDUCTION} and ≥ ${MIN_FRACTION * 100}% of roll).\n`);
  const byYear = new Map<number, number>();
  for (const f of flags) byYear.set(f.year, (byYear.get(f.year) ?? 0) + 1);
  console.log("By year:", [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}:${n}`).join("  "));
  console.log("\nTop 25:");
  for (const f of flags.slice(0, 25)) {
    console.log(`  ${f.year}  ${String(f.reduction).padStart(4)} (${f.pct}% of ${f.begin})  ${f.church}  [${f.mechanism}]`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
