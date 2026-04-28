/**
 * Clergy dedup pass. Three stages:
 *   1. Strip "Associate Pastor, X" prefix from any clergy.canonical_name,
 *      then merge with an existing X record if one is present.
 *   2. Delete obviously bogus clergy records (numeric-only, embedded
 *      stat-row leakage, single-letter, empty). None of these have
 *      appointment rows after stage 1.
 *   3. Merge first-last collisions where one record has a more complete
 *      name than the other (e.g. "Adam Knapp" + "Adam Ray Knapp" → keep
 *      the longer one). Move clergy_alias + appointment rows to the
 *      keeper, then delete the loser.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/dedup-clergy.ts [--dry]
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

type Clergy = { id: string; canonical_name: string; status?: string };

async function loadAll() {
  const clergy = await fetchAll<Clergy>('clergy', 'id, canonical_name, status');
  const appts = await fetchAll<{ clergy_id: string }>('appointment', 'clergy_id');
  const apptByClergy = new Map<string, number>();
  for (const a of appts) apptByClergy.set(a.clergy_id, (apptByClergy.get(a.clergy_id) || 0) + 1);
  return { clergy, apptByClergy };
}

function isJunk(n: string): boolean {
  if (!n) return true;
  if (/^[\d,.\-$\s]+$/.test(n)) return true;
  if (n.length < 4) return true;
  // Any digit run anywhere is suspicious — clergy names don't contain
  // numbers in this dataset (no "Smith III" already handled by the suffix
  // strip; numbers come from row-data leakage).
  if (/\d/.test(n)) return true;
  // Bare "-" tokens are stat-empty markers leaked into names.
  if (/\s-\s|\s-$/.test(n)) return true;
  // Slash usually means two pastors got concatenated ("Adam Knapp / Danielle Knapp").
  if (/\s\/\s/.test(n)) return true;
  if (/Statistics|Conference|District/i.test(n) && !/[a-z],/.test(n)) return true;
  return false;
}

function normalize(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^(Rev|Dr|Mr|Mrs|Ms|Pastor)\.?\s+/i, '')
    .replace(/\s+(Jr|Sr|III|II|IV)\.?$/i, '')
    .replace(/[.'’"]/g, '')
    .toLowerCase()
    .trim();
}

function firstLast(name: string): string {
  const parts = normalize(name).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts.join(' ');
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/** Move all FK references from loserId to keeperId, then delete loser. */
async function mergeClergy(loserId: string, keeperId: string, loserName: string): Promise<void> {
  if (DRY) return;
  // appointments
  await db.from('appointment').update({ clergy_id: keeperId }).eq('clergy_id', loserId);
  // aliases — keep loser's name as alias on keeper, then move other aliases
  await db.from('clergy_alias').update({ clergy_id: keeperId }).eq('clergy_id', loserId);
  await db.from('clergy_alias').upsert(
    { clergy_id: keeperId, alias: loserName, journal_year: null as any },
    { onConflict: 'alias,journal_year', ignoreDuplicates: true },
  );
  await db.from('clergy').delete().eq('id', loserId);
}

// ============= STAGE 1 =============
async function stage1AssocPastorPrefix() {
  console.log('\n=== STAGE 1: strip "Associate Pastor, " prefix ===');
  const { clergy } = await loadAll();
  const targets = clergy.filter((c) => /^(Assoc(?:iate)?|Asst)[.:]?\s*Pastor,?\s+/i.test(c.canonical_name));
  console.log(`found ${targets.length} records to clean`);
  const byName = new Map(clergy.map((c) => [c.canonical_name.toLowerCase(), c.id]));
  for (const t of targets) {
    const cleaned = t.canonical_name.replace(/^(Assoc(?:iate)?|Asst)[.:]?\s*Pastor,?\s+/i, '').trim();
    const existingId = byName.get(cleaned.toLowerCase());
    if (existingId && existingId !== t.id) {
      console.log(`  merge: "${t.canonical_name}" → existing "${cleaned}"`);
      if (!DRY) await mergeClergy(t.id, existingId, t.canonical_name);
    } else {
      console.log(`  rename: "${t.canonical_name}" → "${cleaned}"`);
      if (!DRY) await db.from('clergy').update({ canonical_name: cleaned }).eq('id', t.id);
    }
  }
}

// ============= STAGE 2 =============
async function stage2DeleteJunk() {
  console.log('\n=== STAGE 2: delete junk records ===');
  const { clergy, apptByClergy } = await loadAll();
  const junk = clergy.filter((c) => isJunk(c.canonical_name) && !apptByClergy.has(c.id));
  console.log(`deleting ${junk.length} bogus records (none have appointments)`);
  if (!DRY && junk.length > 0) {
    const ids = junk.map((c) => c.id);
    // Chunk the deletes to avoid overlong queries.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      await db.from('clergy_alias').delete().in('clergy_id', chunk);
      await db.from('clergy').delete().in('id', chunk);
    }
  }
}

// ============= STAGE 3 =============
async function stage3FuzzyMerge() {
  console.log('\n=== STAGE 3: merge first-last duplicates ===');
  const { clergy, apptByClergy } = await loadAll();
  const groups = new Map<string, Clergy[]>();
  for (const c of clergy) {
    const k = firstLast(c.canonical_name);
    if (k.length < 4) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  let merges = 0;
  let skipped = 0;
  for (const [_, members] of groups) {
    if (members.length < 2) continue;
    // Pick keeper: prefer the one with appointments; else longest name.
    const sorted = [...members].sort((a, b) => {
      const aA = apptByClergy.has(a.id) ? 1 : 0;
      const bA = apptByClergy.has(b.id) ? 1 : 0;
      if (aA !== bA) return bA - aA;
      return b.canonical_name.length - a.canonical_name.length;
    });
    const keeper = sorted[0];
    const losers = sorted.slice(1);

    // Skip if multiple keepers have appointments — that requires manual review.
    const apptCount = members.filter((m) => apptByClergy.has(m.id)).length;
    if (apptCount > 1) {
      console.log(`  ⚠ skip (${apptCount} have appts): ${members.map((m) => m.canonical_name).join(' | ')}`);
      skipped++;
      continue;
    }

    for (const l of losers) {
      console.log(`  merge "${l.canonical_name}" → "${keeper.canonical_name}"`);
      if (!DRY) await mergeClergy(l.id, keeper.id, l.canonical_name);
      merges++;
    }
  }
  console.log(`merged ${merges} records, skipped ${skipped} ambiguous groups`);
}

// Order: junk → prefix-fix → fuzzy merge. Junk first so fuzzy matching
// doesn't pull stat-row leakage records into legitimate name groups.
await stage2DeleteJunk();
await stage1AssocPastorPrefix();
await stage3FuzzyMerge();

const final = await loadAll();
console.log(`\nFinal clergy count: ${final.clergy.length}`);
console.log(`  with appointments: ${[...final.apptByClergy.keys()].length}`);
