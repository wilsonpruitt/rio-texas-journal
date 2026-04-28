/**
 * Survey clergy + church tables for likely-duplicate records and report
 * patterns. Read-only — no DB writes.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/dedup-survey.ts
 */
import { adminClient } from './parsers/era_b/lib/db.ts';

function normalizeClergy(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^(Rev|Dr|Mr|Mrs|Ms|Pastor)\.?\s+/i, '')
    .replace(/\s+(Jr|Sr|III|II|IV)\.?$/i, '')
    .replace(/[.'’"]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeChurch(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/\s+UMC$/i, '')
    .replace(/[.'’"]/g, '')
    .toLowerCase()
    .trim();
}

const db = adminClient();

// === Clergy survey ===
console.log('=== CLERGY ===');
async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await db.from(table).select(cols).range(from, from + pageSize - 1) as any;
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
const clergy = await fetchAll<{ id: string; canonical_name: string }>('clergy', 'id, canonical_name');
const total = clergy.length;
console.log(`Total: ${total}`);

const groups = new Map<string, { id: string; canonical_name: string }[]>();
for (const c of clergy) {
  const k = normalizeClergy(c.canonical_name);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(c);
}
const clergyDupes = Array.from(groups.entries()).filter(([_, v]) => v.length > 1);
console.log(`Strict-norm collision groups: ${clergyDupes.length} (covering ${clergyDupes.reduce((s, [_, v]) => s + v.length, 0)} records)`);
console.log('\nSample groups (top 15 by size):');
clergyDupes.sort((a, b) => b[1].length - a[1].length);
for (const [norm, members] of clergyDupes.slice(0, 15)) {
  console.log(`  [${members.length}] "${norm}": ${members.map((m) => m.canonical_name).join(' | ')}`);
}

// Fuzzy: just first + last word, lowercased.
function firstLast(name: string): string {
  const parts = normalizeClergy(name).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts.join(' ');
  return `${parts[0]} ${parts[parts.length - 1]}`;
}
const fgroups = new Map<string, { id: string; canonical_name: string }[]>();
for (const c of clergy) {
  const k = firstLast(c.canonical_name);
  if (k.length < 4) continue;
  if (!fgroups.has(k)) fgroups.set(k, []);
  fgroups.get(k)!.push(c);
}
const fdupes = Array.from(fgroups.entries()).filter(([_, v]) => v.length > 1);
console.log(`\nFirst-Last collision groups: ${fdupes.length} (covering ${fdupes.reduce((s, [_, v]) => s + v.length, 0)} records)`);
fdupes.sort((a, b) => b[1].length - a[1].length);
for (const [norm, members] of fdupes.slice(0, 25)) {
  console.log(`  [${members.length}] "${norm}": ${members.map((m) => m.canonical_name).join(' | ')}`);
}

// Outliers — names that look bogus.
const bogus = clergy.filter((c) => {
  const n = c.canonical_name;
  if (/^[\d,.\-$]+$/.test(n)) return true;
  if (n.split(/\s+/).length === 1 && n.length < 4) return true;
  if (/^(Pastor|Senior|Associate|Assoc)\b/i.test(n)) return true;
  if (/UMC|District|Statistics|Conference/i.test(n)) return true;
  if (n.length > 70) return true;
  return false;
});
console.log(`\nLikely bogus clergy names: ${bogus.length}`);
for (const b of bogus.slice(0, 20)) console.log(`  "${b.canonical_name}"`);

// === Church survey ===
console.log('\n=== CHURCHES ===');
const { data: churches } = await db.from('church').select('id, canonical_name, status');
console.log(`Total: ${churches!.length}`);
const cgroups = new Map<string, typeof churches>();
for (const c of churches!) {
  const k = normalizeChurch(c.canonical_name);
  if (!cgroups.has(k)) cgroups.set(k, [] as any);
  cgroups.get(k)!.push(c);
}
const churchDupes = Array.from(cgroups.entries()).filter(([_, v]) => v!.length > 1);
console.log(`Normalize-collision groups: ${churchDupes.length}`);
churchDupes.sort((a, b) => b[1]!.length - a[1]!.length);
for (const [norm, members] of churchDupes.slice(0, 25)) {
  console.log(`  [${members!.length}] "${norm}": ${members!.map((m: any) => `${m.canonical_name}[${m.status}]`).join(' | ')}`);
}

// Numeric / bogus church names
const bogusCh = churches!.filter((c) => {
  const n = c.canonical_name;
  if (/^[\d,.\-$]+$/.test(n)) return true;
  if (n.split(/\s+/).length === 1 && n.length < 4) return true;
  if (/^(STATISTICS|TOTALS?|District)\b/i.test(n)) return true;
  return false;
});
console.log(`\nLikely bogus churches: ${bogusCh.length}`);
for (const b of bogusCh) console.log(`  "${b.canonical_name}" [${b.status}]`);
