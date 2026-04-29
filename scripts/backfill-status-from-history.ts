/**
 * For clergy whose `status` is 'unknown' (or otherwise unset), derive
 * the right lifecycle bucket from the latest entry in status_history.
 *
 * Mappings (UMC codes used in CONF REL timelines):
 *   RE/RD/RL/RA/RP/OR → retired   (retired Elder/Deacon/Local Pastor/Associate/etc.)
 *   TO                → transferred  (transferred out of conference)
 *   HN/HR/HL          → honorable_location
 *
 * Active codes (FE/FD/PE/PD/FL/PL/AM/AF/SY/OE/OD/OF/PM/TI) are left
 * alone — those clergy might still be active, or might be inactive but
 * not yet labeled. We only set status from history if the *latest* code
 * is unambiguously a terminal/inactive class.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-status-from-history.ts [--dry]
 */
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const db = adminClient();

const CODE_TO_STATUS: Record<string, string> = {
  RE: 'retired', RD: 'retired', RL: 'retired', RA: 'retired', RP: 'retired', OR: 'retired',
  TO: 'transferred',
  HN: 'honorable_location', HR: 'honorable_location', HL: 'honorable_location',
};

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

const counts: Record<string, number> = {};
let updated = 0;
for (const c of all) {
  // Only reclassify clergy currently labeled unknown. We don't want to
  // overwrite hand-curated statuses (withdrawn, transferred, deceased).
  if (c.status !== 'unknown') continue;
  const hist = c.status_history ?? [];
  if (hist.length === 0) continue;
  const latest = [...hist].sort((a, b) => b.year - a.year)[0];
  const target = CODE_TO_STATUS[latest.code];
  if (!target) continue;
  counts[`${latest.code}→${target}`] = (counts[`${latest.code}→${target}`] ?? 0) + 1;
  console.log(`  ${c.canonical_name}: unknown → ${target}  (latest: ${latest.code}:${latest.year})`);
  if (DRY) continue;
  const { error } = await db.from('clergy').update({ status: target }).eq('id', c.id);
  if (error) { console.error(`    ERROR: ${error.message}`); continue; }
  updated++;
}

console.log('\nBy code:');
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30)} ${n}`);
}
console.log(`\nTotal updated: ${updated}${DRY ? ' (dry)' : ''}`);
