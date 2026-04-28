/**
 * Church dedup pass: merge column-truncation duplicates.
 *
 * Era A wide-table sub-tables sometimes use a narrower name column on
 * pages with extra value columns, truncating the church name by one or
 * two trailing characters. Those truncated rows got created as separate
 * 'closed' churches during ingest. Merge them into the canonical
 * (longer / active) record.
 *
 * Safety rules:
 *   - Diff must be 1-2 trailing characters with no added space.
 *   - Diff must complete a word (not split a word boundary).
 *   - The longer name's trailing char(s) shouldn't be just punctuation.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/dedup-churches.ts [--dry]
 */

import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const db = adminClient();

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999) as any;
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

type Church = { id: string; canonical_name: string; status: string; city: string | null };

async function mergeChurch(loserId: string, keeperId: string, loserName: string, journal_year: number = 2024): Promise<void> {
  if (DRY) return;

  // Move stat rows: collision on (church_id, data_year, field_code).
  const { data: keepStats } = await db.from('church_stat')
    .select('data_year, field_code').eq('church_id', keeperId);
  const keepKeys = new Set((keepStats || []).map((s: any) => `${s.data_year}|${s.field_code}`));
  const { data: lossStats } = await db.from('church_stat')
    .select('id, data_year, field_code').eq('church_id', loserId);
  const moveIds: string[] = [];
  const dropIds: string[] = [];
  for (const s of lossStats || []) {
    if (keepKeys.has(`${s.data_year}|${s.field_code}`)) dropIds.push(s.id);
    else moveIds.push(s.id);
  }
  if (moveIds.length) await db.from('church_stat').update({ church_id: keeperId }).in('id', moveIds);
  if (dropIds.length) await db.from('church_stat').delete().in('id', dropIds);

  // district_history: collision on (church_id, data_year)
  const { data: keepDH } = await db.from('district_history')
    .select('data_year').eq('church_id', keeperId);
  const keepDHYears = new Set((keepDH || []).map((d: any) => d.data_year));
  const { data: lossDH } = await db.from('district_history')
    .select('data_year').eq('church_id', loserId);
  for (const d of lossDH || []) {
    if (keepDHYears.has(d.data_year)) {
      await db.from('district_history').delete().eq('church_id', loserId).eq('data_year', d.data_year);
    } else {
      await db.from('district_history').update({ church_id: keeperId }).eq('church_id', loserId).eq('data_year', d.data_year);
    }
  }

  // Move appointments + aliases.
  await db.from('appointment').update({ church_id: keeperId }).eq('church_id', loserId);
  await db.from('church_alias').update({ church_id: keeperId }).eq('church_id', loserId);
  await db.from('church_alias').upsert(
    { church_id: keeperId, alias: loserName, source_section: 'J', journal_year },
    { onConflict: 'alias,journal_year,source_section', ignoreDuplicates: true },
  );

  await db.from('church').delete().eq('id', loserId);
}

function isTruncationOf(short: string, long: string): boolean {
  if (long.length <= short.length) return false;
  if (long.length - short.length > 2) return false;
  // Long must START with short
  if (!long.toLowerCase().startsWith(short.toLowerCase())) return false;
  // The added chars cannot include a space (would mean a new word).
  const tail = long.slice(short.length);
  if (/\s/.test(tail)) return false;
  // Tail can't be only punctuation (e.g. " Heights" got blocked above; ":" alone is suspect).
  if (/^[.:,;]+$/.test(tail)) return false;
  return true;
}

const churches = await fetchAll<Church>('church', 'id, canonical_name, status, city');
console.log(`total churches: ${churches.length}`);

const merges: Array<{ loser: Church; keeper: Church }> = [];
for (const a of churches) {
  for (const b of churches) {
    if (a.id === b.id) continue;
    if (!isTruncationOf(a.canonical_name, b.canonical_name)) continue;
    // a is shorter (truncated), b is longer (canonical).
    // Don't merge two actives; an active+closed pair is the typical truncation case.
    if (a.status === 'active' && b.status === 'active') continue;
    merges.push({ loser: a, keeper: b });
  }
}
console.log(`truncation merges: ${merges.length}`);

// Deduplicate — a single loser can only merge into one keeper.
const seenLoser = new Set<string>();
const finalMerges = merges.filter((m) => {
  if (seenLoser.has(m.loser.id)) return false;
  seenLoser.add(m.loser.id);
  return true;
});

for (const m of finalMerges) {
  console.log(`  "${m.loser.canonical_name}"[${m.loser.status}] → "${m.keeper.canonical_name}"[${m.keeper.status}]`);
  await mergeChurch(m.loser.id, m.keeper.id, m.loser.canonical_name);
}
console.log(`merged ${finalMerges.length} churches`);

// Also fix the leaked-pastor-name churches manually.
console.log('\n--- pastor-name leakage cleanup ---');
const leakedPatterns = [
  { from: 'San Juan: Los Wesleyanos Gricelda Garcia Careaga', to: 'San Juan: Los Wesleyanos' },
  { from: 'Granite Shoals: Grace UMC Donna Jo Shaw', to: 'Granite Shoals: Grace UMC' },
];
for (const { from, to } of leakedPatterns) {
  const loser = churches.find((c) => c.canonical_name === from);
  const keeper = churches.find((c) => c.canonical_name === to);
  if (loser && keeper) {
    console.log(`  "${from}" → "${to}"`);
    await mergeChurch(loser.id, keeper.id, from);
  } else if (loser && !keeper) {
    // No matching keeper — just rename (drop the pastor suffix).
    console.log(`  rename "${from}" → "${to}"`);
    if (!DRY) await db.from('church').update({ canonical_name: to }).eq('id', loser.id);
  }
}

const final = await fetchAll<Church>('church', 'id, canonical_name, status, city');
console.log(`\nfinal church count: ${final.length}`);
console.log(`  active: ${final.filter((c) => c.status === 'active').length}`);
console.log(`  closed: ${final.filter((c) => c.status === 'closed').length}`);
console.log(`  disaffiliated: ${final.filter((c) => c.status === 'disaffiliated').length}`);
