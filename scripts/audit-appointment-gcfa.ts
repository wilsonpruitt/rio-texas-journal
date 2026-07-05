/**
 * PAR Phase 0 — audit the appointment -> GCFA linkage.
 *
 * Pastor PAR needs appointment.church_id -> church.gcfa_number -> RECPROF panel.
 * The clergy-record importer matched churches by name and auto-created gcfa-less
 * "closed" stubs on miss, so before modeling we need to know: of the appointment
 * stints that overlap the GCFA data window, how many land on a church we can score?
 *
 * Read-only. Prints match rates, the unmatched churches worth hand-mapping,
 * and the role/status/fraction distributions Phase 2 filters depend on.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/audit-appointment-gcfa.ts
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { existsSync, readFileSync } from "node:fs";

const MAP_PATH = new URL("./data/par/church-match-map.json", import.meta.url).pathname;
const mapFile = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, "utf8")) : {};
const matchMap: Record<string, string> = mapFile.byChurchId ?? {};
const nonChurchIds = new Set<string>(mapFile.nonChurchIds ?? []);

const db = adminClient();

// GCFA data years available for scoring (2024 partial; 2014 predecessor-conference).
const DATA_MIN = 2014;
const DATA_MAX = 2024;

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

type Church = { id: string; canonical_name: string; gcfa_number: string | null; status: string };
type Appt = {
  id: string; church_id: string; clergy_id: string; journal_year: number;
  role: string | null; status_code: string | null; years_at_appt: number | null; fraction: string | null;
};

const churches = await fetchAll<Church>("church", "id, canonical_name, gcfa_number, status");
const appts = await fetchAll<Appt>("appointment", "id, church_id, clergy_id, journal_year, role, status_code, years_at_appt, fraction");
const churchById = new Map(churches.map((c) => [c.id, c]));
// Effective gcfa resolution: direct link, else the Phase 0 reconcile map.
const gcfaOf = (churchId: string): string | null =>
  churchById.get(churchId)?.gcfa_number ?? matchMap[churchId] ?? null;

console.log(`churches: ${churches.length} (${churches.filter((c) => c.gcfa_number).length} with gcfa_number)`);
console.log(`appointment rows: ${appts.length} | distinct clergy: ${new Set(appts.map((a) => a.clergy_id)).size} | journal_year ${Math.min(...appts.map((a) => a.journal_year))}–${Math.max(...appts.map((a) => a.journal_year))}`);

// A row is a stint: [journal_year, journal_year + years_at_appt). Open-ended rows
// (no years_at_appt: the clergy's current appointment, or a lone 2025 Section F row)
// are treated as running through DATA_MAX.
const stintEnd = (a: Appt) => a.years_at_appt != null ? a.journal_year + a.years_at_appt : DATA_MAX + 1;
const overlapsData = (a: Appt) => a.journal_year <= DATA_MAX && stintEnd(a) > DATA_MIN;

const inWindow = appts.filter(overlapsData);
const matched = inWindow.filter((a) => gcfaOf(a.church_id));
const nonChurch = inWindow.filter((a) => !gcfaOf(a.church_id) && nonChurchIds.has(a.church_id));
const localDenom = inWindow.length - nonChurch.length;
console.log(`\nstints overlapping GCFA window ${DATA_MIN}–${DATA_MAX}: ${inWindow.length}`);
console.log(`  extension/administrative (not local-church, excluded from PAR): ${nonChurch.length}`);
console.log(`  local-church stints: ${localDenom}`);
console.log(`  -> resolvable to gcfa_number: ${matched.length} (${((matched.length / localDenom) * 100).toFixed(1)}% of local-church stints)`);

// Per start-year match rate (recent years matter most for PAR).
console.log(`\nmatch rate by stint start year (in-window stints):`);
const byYear = new Map<number, { n: number; ok: number }>();
for (const a of inWindow) {
  const t = byYear.get(a.journal_year) ?? { n: 0, ok: 0 };
  t.n++;
  if (gcfaOf(a.church_id)) t.ok++;
  byYear.set(a.journal_year, t);
}
for (const [y, t] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${y}: ${t.ok}/${t.n} (${((t.ok / t.n) * 100).toFixed(0)}%)`);
}

// Unmatched churches ranked by how many in-window stints they'd unlock.
const unmatched = new Map<string, { name: string; status: string; n: number; years: Set<number> }>();
for (const a of inWindow) {
  const c = churchById.get(a.church_id);
  if (!c || gcfaOf(c.id) || nonChurchIds.has(c.id)) continue;
  const u = unmatched.get(c.id) ?? { name: c.canonical_name, status: c.status, n: 0, years: new Set<number>() };
  u.n++;
  u.years.add(a.journal_year);
  unmatched.set(c.id, u);
}
const unmatchedRanked = [...unmatched.values()].sort((a, b) => b.n - a.n);
console.log(`\nunmatched churches (no gcfa_number) with in-window stints: ${unmatchedRanked.length}`);
console.log(`top 40 by stint count (candidates for HAND_MAP):`);
for (const u of unmatchedRanked.slice(0, 40)) {
  const yrs = [...u.years].sort((a, b) => a - b);
  console.log(`  ${String(u.n).padStart(3)}  ${u.name}  [${u.status}]  (${yrs[0]}–${yrs[yrs.length - 1]})`);
}

// Distributions Phase 2 filters need.
const dist = (label: string, get: (a: Appt) => string | number | null, rows: Appt[]) => {
  const m = new Map<string, number>();
  for (const a of rows) {
    const v = get(a);
    m.set(v == null ? "(null)" : String(v), (m.get(v == null ? "(null)" : String(v)) ?? 0) + 1);
  }
  console.log(`\n${label}:`);
  for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
};
dist("role distribution (in-window stints)", (a) => a.role, inWindow);
dist("status_code distribution (in-window stints)", (a) => a.status_code, inWindow);
dist("fraction distribution (in-window stints)", (a) => a.fraction, inWindow);
dist("years_at_appt distribution (in-window stints)", (a) => a.years_at_appt, inWindow);

// Multi-point signal: same clergy holding 2+ gcfa-matched churches in overlapping years.
let multiPoint = 0;
const byClergy = new Map<string, Appt[]>();
for (const a of matched) {
  (byClergy.get(a.clergy_id) ?? byClergy.set(a.clergy_id, []).get(a.clergy_id)!).push(a);
}
for (const rows of byClergy.values()) {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.church_id !== b.church_id && a.journal_year < stintEnd(b) && b.journal_year < stintEnd(a)) { multiPoint++; break; }
    }
  }
}
console.log(`\nclergy-stints overlapping another church for the same clergy (multi-point charges / dual roles): ${multiPoint}`);

// Duplicate stint rows: same clergy+church with overlapping intervals (Section I vs F double-entry).
let dupPairs = 0;
for (const rows of byClergy.values()) {
  const byChurch = new Map<string, Appt[]>();
  for (const a of rows) (byChurch.get(a.church_id) ?? byChurch.set(a.church_id, []).get(a.church_id)!).push(a);
  for (const g of byChurch.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.journal_year - b.journal_year);
    for (let i = 1; i < g.length; i++) if (g[i].journal_year < stintEnd(g[i - 1])) dupPairs++;
  }
}
console.log(`same clergy+church overlapping rows (dup/continuation rows to merge in Phase 2): ${dupPairs}`);
