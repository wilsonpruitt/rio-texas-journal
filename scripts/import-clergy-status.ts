/**
 * Apply clergy status changes from Section E (Business of the Annual
 * Conference). Add to RECORDS as you transcribe screenshots. Idempotent —
 * matching by last+first name (with optional middle disambiguation), the
 * script will skip records whose status is already set correctly.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-clergy-status.ts [--dry]
 *
 * Categories ↔ status:
 *   39a "Withdrew to unite with another denomination"  → withdrawn
 *   39b "Withdrew from the ordained ministerial office" → withdrawn
 *   38d "Reached mandatory retirement age"              → retired
 *   38b "Voluntary discontinuance"                      → withdrawn
 *   38c "Involuntary discontinuance"                    → withdrawn
 */

import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');

type Record = {
  last: string;
  first: string;
  middle?: string;
  status: 'withdrawn' | 'retired' | 'deceased' | 'transferred';
  effective?: string; // YYYY-MM-DD
  priorStatus?: string; // FE / RE / PE / RA etc.
  source: string; // free-form note (e.g., "39a 2025 → GMC – MTXC")
};

const RECORDS: Record[] = [
  // ========== 2025 journal, §39a — Withdrew to unite with another denomination ==========
  { last: 'Alsbrook', first: 'John',           status: 'withdrawn', effective: '2024-07-01', priorStatus: 'RA', source: '2025 §39a → GMC – MTXC' },
  { last: 'Clopton',  first: 'Robert',         status: 'withdrawn', effective: '2024-12-01', priorStatus: 'RA', source: '2025 §39a' },
  { last: 'Fitzgold', first: 'Katy',           status: 'withdrawn', effective: '2024-07-01', priorStatus: 'FE', source: '2025 §39a' },
  { last: 'Leggett',  first: 'Richard',        status: 'withdrawn', effective: '2024-09-01', priorStatus: 'FE', source: '2025 §39a → GMC' },
  { last: 'Mertz',    first: 'Austin',         status: 'withdrawn', effective: '2024-11-01', priorStatus: 'PE', source: '2025 §39a → GMC' },
  { last: 'Pifer',    first: 'Carol',          status: 'withdrawn', effective: '2024-07-12', priorStatus: 'RE', source: '2025 §39a' },
  { last: 'Reese',    first: 'Henry',  middle: 'III', status: 'withdrawn', effective: '2024-10-15', priorStatus: 'FE', source: '2025 §39a' },
  { last: 'Teeter',   first: 'Rusty',          status: 'withdrawn', effective: '2025-01-01', priorStatus: 'FE', source: '2025 §39a' },
  { last: 'Wells',    first: 'Earl',           status: 'withdrawn', effective: '2024-10-01', priorStatus: 'RE', source: '2025 §39a' },
];

const db = adminClient();

async function fetchAllClergy() {
  const out: { id: string; canonical_name: string; status: string }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from('clergy').select('id, canonical_name, status').range(from, from + 999) as any;
    if (error) throw error;
    out.push(...(data as any[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function tokenize(name: string): string[] {
  return name.replace(/[.'’"]/g, '').split(/\s+/).map((s) => s.toLowerCase()).filter(Boolean);
}

function matchScore(rec: Record, candidate: string): number {
  const tokens = tokenize(candidate);
  if (tokens.length < 2) return 0;
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  if (last !== rec.last.toLowerCase()) return 0;
  if (first !== rec.first.toLowerCase()) return 0;
  let score = 100;
  if (rec.middle) {
    const middle = tokens.slice(1, -1).join(' ');
    if (middle && middle.includes(rec.middle.toLowerCase())) score += 10;
  }
  // Bonus for closer length match
  return score;
}

async function main() {
  const all = await fetchAllClergy();
  let applied = 0;
  let skippedAlready = 0;
  const unmatched: Record[] = [];
  const ambiguous: { rec: Record; matches: typeof all }[] = [];

  for (const rec of RECORDS) {
    const candidates = all
      .map((c) => ({ c, score: matchScore(rec, c.canonical_name) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (candidates.length === 0) {
      unmatched.push(rec);
      continue;
    }
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      ambiguous.push({ rec, matches: candidates.map((x) => x.c) });
      continue;
    }
    const target = candidates[0].c;
    if (target.status === rec.status) {
      skippedAlready++;
      continue;
    }
    console.log(`  ${rec.last}, ${rec.first}${rec.middle ? ' ' + rec.middle : ''} → ${rec.status} (was ${target.status}, ${target.canonical_name})`);
    if (!DRY) {
      const { error } = await db.from('clergy').update({ status: rec.status }).eq('id', target.id);
      if (error) console.error(`    ✗ ${error.message}`);
      else applied++;
    }
  }
  console.log(`\napplied: ${applied}, skipped (already): ${skippedAlready}, unmatched: ${unmatched.length}, ambiguous: ${ambiguous.length}`);
  for (const u of unmatched) console.log(`  unmatched: ${u.last}, ${u.first}${u.middle ? ' ' + u.middle : ''} (${u.source})`);
  for (const a of ambiguous) {
    console.log(`  ambiguous: ${a.rec.last}, ${a.rec.first} → ${a.matches.map((m) => m.canonical_name).join(' | ')}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
