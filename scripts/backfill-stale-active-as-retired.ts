/**
 * Auto-retire clergy whose ordination is 40+ years old and whose last
 * known status code is still active-class — they've aged into mandatory
 * retirement (¶358.1, retirement at 72; most ordinations happen at 25-
 * 35, so 40 years post-ordination guarantees retirement).
 *
 * Rule:
 *   - clergy.status = 'unknown'
 *   - latest status_history entry is an active-class code
 *   - earliest status_history year ≤ CURRENT_YEAR − 40 (career age)
 *   - no appointment row with journal_year ≥ CURRENT_YEAR − 5
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-stale-active-as-retired.ts [--dry]
 */
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const db = adminClient();

const CURRENT_YEAR = 2025;
const CAREER_LENGTH_THRESHOLD = CURRENT_YEAR - 40; // 1985 — career started by then
const ACTIVE_RECENT_THRESHOLD = CURRENT_YEAR - 5;  // 2020 — any appointment since then?

const ACTIVE_CODES = new Set(['FE','FD','PE','PD','FL','PL','AM','SY','OE','OD','OF','PM','TI']);

// Pull active-or-unknown clergy.
const all: { id: string; canonical_name: string; status: string; status_history: { code: string; year: number }[] | null }[] = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('clergy')
      .select('id, canonical_name, status, status_history')
      .eq('status', 'unknown')
      .range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    all.push(...((data ?? []) as any));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

// For each candidate, check appointments.
let updated = 0;
let candidates = 0;
let recentActive = 0;
for (const c of all) {
  const hist = c.status_history ?? [];
  if (hist.length === 0) continue;
  const sorted = [...hist].sort((a, b) => a.year - b.year);
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  if (!ACTIVE_CODES.has(latest.code)) continue;
  if (earliest.year > CAREER_LENGTH_THRESHOLD) continue;
  candidates++;

  // Check: any appointment ≥ 2010?
  const { data: recentAppts } = await db
    .from('appointment')
    .select('journal_year')
    .eq('clergy_id', c.id)
    .gte('journal_year', ACTIVE_RECENT_THRESHOLD)
    .limit(1);
  if ((recentAppts ?? []).length > 0) { recentActive++; continue; }

  console.log(`  ${c.canonical_name}: unknown → retired  (career ${earliest.code}:${earliest.year} → ${latest.code}:${latest.year})`);
  if (DRY) continue;
  const { error } = await db.from('clergy').update({ status: 'retired' }).eq('id', c.id);
  if (error) { console.error(`    ERROR: ${error.message}`); continue; }
  updated++;
}

console.log(`\nCandidates with stale active-class latest code: ${candidates}`);
console.log(`Skipped (had recent appointment): ${recentActive}`);
console.log(`Updated to retired: ${updated}${DRY ? ' (dry)' : ''}`);
