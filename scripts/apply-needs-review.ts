/**
 * Apply colleague review decisions from a CSV exported by
 * scripts/export-needs-review.ts.
 *
 * For each row:
 *   - If possible_duplicate_of is set → merge this clergy into the named
 *     keeper (move appointments, union status_history & education_history,
 *     delete the dirty row).
 *   - Else if suggested_status='delete' → delete the clergy row entirely
 *     (along with any orphan appointments).
 *   - Else if suggested_status is a known lifecycle value → update status.
 *   - Else (empty or unrecognized) → skip with a warning.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/apply-needs-review.ts <csv-path> [--dry]
 */
import { readFileSync } from 'node:fs';
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const CSV_PATH = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ?? '';
if (!CSV_PATH) {
  console.error('Usage: apply-needs-review.ts <csv-path> [--dry]');
  process.exit(1);
}

const VALID_STATUSES = new Set([
  'active', 'retired', 'withdrawn', 'deceased', 'transferred',
  'honorable_location', 'extension_ministry', 'unknown',
]);

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') {}
      else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const csvText = readFileSync(CSV_PATH, 'utf8');
const rows = parseCSV(csvText);
const header = rows[0];
const colName = header.indexOf('canonical_name');
const colDup = header.indexOf('possible_duplicate_of');
const colStatus = header.indexOf('suggested_status');

const db = adminClient();

// Cache all clergy keyed by canonical_name (for merge-keeper lookup).
const allClergy: { id: string; canonical_name: string; status: string; status_history: any[] | null; education_history: any[] | null }[] = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await db.from('clergy').select('id, canonical_name, status, status_history, education_history').range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    allClergy.push(...((data ?? []) as any));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}
const byName = new Map<string, typeof allClergy[number]>();
for (const c of allClergy) byName.set(c.canonical_name.trim(), c);

function findClergyByName(name: string): typeof allClergy[number] | null {
  // Strip "[status]" bracket that often comes copy-pasted from the
  // auto_suggested_duplicates column.
  let trimmed = name.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
  if (byName.has(trimmed)) return byName.get(trimmed)!;
  const lower = trimmed.toLowerCase();
  for (const c of allClergy) if (c.canonical_name.toLowerCase() === lower) return c;
  return null;
}

let merged = 0, deleted = 0, statused = 0, skipped = 0, notFound = 0;

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const name = (r[colName] ?? '').trim();
  if (!name) continue;
  const dupOf = (r[colDup] ?? '').trim();
  const sug = (r[colStatus] ?? '').trim().toLowerCase();

  const subject = findClergyByName(name);
  if (!subject) { notFound++; console.warn(`  NOT FOUND: ${name}`); continue; }

  // 1) Merge takes priority.
  if (dupOf) {
    const keeper = findClergyByName(dupOf);
    if (!keeper) {
      console.warn(`  MERGE TARGET NOT FOUND: ${name} → "${dupOf}"`);
      skipped++;
      continue;
    }
    if (keeper.id === subject.id) { skipped++; continue; }
    console.log(`  MERGE  ${subject.canonical_name}  →  ${keeper.canonical_name}`);
    if (DRY) { merged++; continue; }
    // Move appointments. On unique-constraint conflict, drop the dup.
    const { data: appts } = await db.from('appointment').select('id').eq('clergy_id', subject.id);
    for (const a of (appts ?? []) as any[]) {
      const { error: eMove } = await db.from('appointment').update({ clergy_id: keeper.id }).eq('id', a.id);
      if (eMove) await db.from('appointment').delete().eq('id', a.id);
    }
    // Union histories.
    const cleanHist = keeper.status_history ?? [];
    const dirtyHist = subject.status_history ?? [];
    const seen = new Set(cleanHist.map((h: any) => `${h.code}:${h.year}`));
    const mergedHist = [...cleanHist];
    for (const h of dirtyHist) {
      const k = `${h.code}:${h.year}`;
      if (!seen.has(k)) { mergedHist.push(h); seen.add(k); }
    }
    mergedHist.sort((a: any, b: any) => a.year - b.year);
    const cleanEdu = keeper.education_history ?? [];
    const dirtyEdu = subject.education_history ?? [];
    const eduSeen = new Set(cleanEdu.map((e: any) => e.raw ?? JSON.stringify(e)));
    const mergedEdu = [...cleanEdu];
    for (const e of dirtyEdu) {
      const k = (e as any).raw ?? JSON.stringify(e);
      if (!eduSeen.has(k)) { mergedEdu.push(e); eduSeen.add(k); }
    }
    // Status: prefer keeper's existing if not unknown, else subject's.
    const finalStatus = keeper.status !== 'unknown' ? keeper.status : (subject.status !== 'unknown' ? subject.status : 'unknown');
    const { error: e2 } = await db.from('clergy').update({
      status_history: mergedHist,
      education_history: mergedEdu,
      status: finalStatus,
    }).eq('id', keeper.id);
    if (e2) { console.error(`    update keeper ERROR: ${e2.message}`); continue; }
    const { error: e3 } = await db.from('clergy').delete().eq('id', subject.id);
    if (e3) { console.error(`    delete subject ERROR: ${e3.message}`); continue; }
    keeper.status_history = mergedHist;
    keeper.education_history = mergedEdu;
    keeper.status = finalStatus;
    merged++;
    continue;
  }

  // 2) Delete.
  if (sug === 'delete' || sug === 'delete-mangled') {
    console.log(`  DELETE ${subject.canonical_name}`);
    if (DRY) { deleted++; continue; }
    await db.from('appointment').delete().eq('clergy_id', subject.id);
    const { error } = await db.from('clergy').delete().eq('id', subject.id);
    if (error) { console.error(`    delete ERROR: ${error.message}`); continue; }
    deleted++;
    continue;
  }

  // 3) Status update.
  if (sug && VALID_STATUSES.has(sug)) {
    if (subject.status === sug) { skipped++; continue; }
    console.log(`  STATUS ${subject.canonical_name}: ${subject.status} → ${sug}`);
    if (DRY) { statused++; continue; }
    const { error } = await db.from('clergy').update({ status: sug }).eq('id', subject.id);
    if (error) { console.error(`    update ERROR: ${error.message}`); continue; }
    statused++;
    continue;
  }

  // 4) Unrecognized — skip with warning.
  if (sug) {
    console.warn(`  UNRECOGNIZED suggested_status="${sug}" for ${subject.canonical_name} — skipped`);
  }
  skipped++;
}

console.log(`\nDone. merged=${merged}, deleted=${deleted}, status-updated=${statused}, skipped=${skipped}, not-found=${notFound}${DRY ? ' (dry)' : ''}`);
