/**
 * Populate clergy.credential_class from the latest entry in
 * status_history. For clergy with no history, fall back to the most
 * recent appointment's status_code.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-credential-class.ts [--dry]
 */
import { adminClient } from './parsers/era_b/lib/db.ts';
import { CREDENTIAL_LABEL } from '../src/lib/credential-classes.ts';

const DRY = process.argv.includes('--dry');
const db = adminClient();
const VALID_CODES = new Set(Object.keys(CREDENTIAL_LABEL));

type Clergy = {
  id: string;
  canonical_name: string;
  credential_class: string | null;
  status_history: { code: string; year: number }[] | null;
};

const all: Clergy[] = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('clergy')
      .select('id, canonical_name, credential_class, status_history')
      .range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    all.push(...((data ?? []) as Clergy[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

// Pull the latest appointment's status_code per clergy as a fallback.
const apptCode = new Map<string, string>();
{
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('appointment')
      .select('clergy_id, status_code, journal_year')
      .order('journal_year', { ascending: false })
      .range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    for (const row of (data ?? []) as any[]) {
      if (!row.status_code) continue;
      if (!apptCode.has(row.clergy_id)) apptCode.set(row.clergy_id, row.status_code);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

let fromHistory = 0;
let fromAppt = 0;
let noSignal = 0;
let updated = 0;
const counts: Record<string, number> = {};
for (const c of all) {
  let code: string | null = null;
  const hist = c.status_history ?? [];
  if (hist.length > 0) {
    // Walk newest → oldest, skipping non-credential codes that crept
    // in from parse bugs (PPTS, TS, DI, etc.).
    const sorted = [...hist].sort((a, b) => b.year - a.year);
    for (const e of sorted) {
      if (VALID_CODES.has(e.code)) { code = e.code; break; }
    }
    if (code) fromHistory++;
  }
  if (!code) {
    const fallback = apptCode.get(c.id);
    if (fallback && VALID_CODES.has(fallback)) { code = fallback; fromAppt++; }
    else noSignal++;
  }
  if (code) counts[code] = (counts[code] ?? 0) + 1;
  // If no valid signal but the row currently holds a junk code, clear it.
  const target = code ?? null;
  if (c.credential_class === target) continue;
  if (DRY) continue;
  const { error } = await db.from('clergy').update({ credential_class: target }).eq('id', c.id);
  if (error) { console.error(`  ${c.canonical_name} ERROR: ${error.message}`); continue; }
  updated++;
}

console.log(`Total clergy: ${all.length}`);
console.log(`  derived from status_history: ${fromHistory}`);
console.log(`  derived from latest appointment: ${fromAppt}`);
console.log(`  no signal (skipped): ${noSignal}`);
console.log(`  updated: ${updated}${DRY ? ' (dry)' : ''}`);
console.log('\nBy credential code:');
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(6)} ${n}`);
}
