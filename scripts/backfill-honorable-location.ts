/**
 * Set status='honorable_location' for clergy whose latest status_history
 * code is HN or HR. Run once after migration 0017 is applied.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-honorable-location.ts [--dry]
 */
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const HONORABLE_CODES = new Set(['HN', 'HR', 'HL']);

const db = adminClient();

const all: { id: string; canonical_name: string; status: string; status_history: { code: string; year: number }[] | null }[] = [];
let from = 0;
while (true) {
  const { data, error } = await db
    .from('clergy')
    .select('id, canonical_name, status, status_history')
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...((data ?? []) as any));
  if (!data || data.length < 1000) break;
  from += 1000;
}

let candidates = 0;
let updated = 0;
for (const c of all) {
  const hist = c.status_history ?? [];
  if (hist.length === 0) continue;
  const latest = [...hist].sort((a, b) => b.year - a.year)[0];
  if (!HONORABLE_CODES.has(latest.code)) continue;
  candidates++;
  if (c.status === 'honorable_location') continue;
  console.log(`  ${c.canonical_name}: ${c.status} → honorable_location (latest: ${latest.code}:${latest.year})`);
  if (DRY) continue;
  const { error } = await db.from('clergy').update({ status: 'honorable_location' }).eq('id', c.id);
  if (error) { console.error(`    ERROR: ${error.message}`); continue; }
  updated++;
}
console.log(`\nCandidates with HN/HR/HL: ${candidates}, updated: ${updated}${DRY ? ' (dry)' : ''}`);
