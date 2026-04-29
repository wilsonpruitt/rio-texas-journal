/**
 * Export the "Needs review" clergy (status='unknown') to CSV with
 * enough context for colleagues to fill in correct lifecycle status:
 *   canonical_name, credential_class, latest CONF REL year, earliest
 *   CONF REL year, latest appointment year, latest appointment church.
 *
 * Output: /Users/wilsonpruitt/rio-texas-journal/exports/needs-review.csv
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/export-needs-review.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { adminClient } from './parsers/era_b/lib/db.ts';

const db = adminClient();

type Clergy = { id: string; canonical_name: string; credential_class: string | null; status: string; status_history: { code: string; year: number }[] | null };

const all: Clergy[] = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await db.from('clergy').select('id, canonical_name, credential_class, status, status_history').eq('status', 'unknown').range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    all.push(...((data ?? []) as any));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

// Pull EVERY clergy row (active + retired + etc.) so we can suggest
// duplicates that span lifecycle buckets — e.g. an "unknown" Mary Smith
// is probably the same person as a "retired" Mary Robinson Smith.
const everyone: Clergy[] = [];
{
  let from = 0;
  while (true) {
    const { data } = await db.from('clergy').select('id, canonical_name, credential_class, status, status_history').range(from, from + 999);
    everyone.push(...((data ?? []) as Clergy[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

// Pull latest appointment per clergy.
const latestAppt = new Map<string, { year: number; church: string | null }>();
{
  let from = 0;
  while (true) {
    const { data } = await db.from('appointment')
      .select('clergy_id, journal_year, church:church_id(canonical_name)')
      .order('journal_year', { ascending: false })
      .range(from, from + 999);
    for (const row of (data ?? []) as any[]) {
      if (!latestAppt.has(row.clergy_id)) {
        latestAppt.set(row.clergy_id, { year: row.journal_year, church: row.church?.canonical_name ?? null });
      }
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

function csvEscape(s: any): string {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function normTok(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, '').trim();
}

// Build an index for duplicate suggestions:
//  - by surname (last token) → all clergy
//  - by first-name → all clergy
// Then for each unknown, find rows that share BOTH a surname token and
// a first-name token. Suggests potential maiden/married/middle-name
// duplicates.
const bySurname = new Map<string, Clergy[]>();
const byFirstName = new Map<string, Clergy[]>();
for (const c of everyone) {
  const tokens = c.canonical_name.trim().split(/\s+/).map(normTok).filter(Boolean);
  if (tokens.length < 2) continue;
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  if (!bySurname.has(last)) bySurname.set(last, []);
  bySurname.get(last)!.push(c);
  // Multi-word surnames also indexed by their last 2 tokens combined.
  if (tokens.length >= 3) {
    const last2 = `${tokens[tokens.length - 2]} ${last}`;
    if (!bySurname.has(last2)) bySurname.set(last2, []);
    bySurname.get(last2)!.push(c);
  }
  if (!byFirstName.has(first)) byFirstName.set(first, []);
  byFirstName.get(first)!.push(c);
}

function suggestDuplicates(target: Clergy): string[] {
  const tokens = target.canonical_name.trim().split(/\s+/).map(normTok).filter(Boolean);
  if (tokens.length < 2) return [];
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  const found = new Map<string, Clergy>();
  // Same surname, different given-name configuration (middle-name variations).
  for (const c of bySurname.get(last) ?? []) {
    if (c.id === target.id) continue;
    found.set(c.id, c);
  }
  // Same first name, similar (Levenshtein ≤2) surname — catches marriage
  // surname changes and spelling variants. Limit to clergy whose surname
  // shares the same starting letter to keep this cheap.
  for (const c of byFirstName.get(first) ?? []) {
    if (c.id === target.id) continue;
    const ct = c.canonical_name.trim().split(/\s+/).map(normTok).filter(Boolean);
    if (ct.length < 2) continue;
    const cLast = ct[ct.length - 1];
    if (cLast === last) { found.set(c.id, c); continue; }
    if (cLast[0] !== last[0]) continue;
    if (levenshtein(cLast, last) <= 2) found.set(c.id, c);
  }
  // Format: "Canonical Name [status]"
  return [...found.values()]
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name))
    .map((c) => `${c.canonical_name} [${c.status}]`);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1).fill(0).map((_, i) => i);
  const v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

const rows: string[] = [];
rows.push(['canonical_name', 'credential_class', 'earliest_year', 'latest_year', 'latest_appt_year', 'latest_appt_church', 'auto_suggested_duplicates', 'possible_duplicate_of', 'suggested_status', 'colleague_notes'].join(','));

const sorted = [...all].sort((a, b) => {
  // Sort by surname (last word).
  const aLast = a.canonical_name.split(/\s+/).pop() || a.canonical_name;
  const bLast = b.canonical_name.split(/\s+/).pop() || b.canonical_name;
  return aLast.localeCompare(bLast);
});

for (const c of sorted) {
  const hist = c.status_history ?? [];
  const sortedHist = [...hist].sort((a, b) => a.year - b.year);
  const earliest = sortedHist[0];
  const latest = sortedHist[sortedHist.length - 1];
  const appt = latestAppt.get(c.id);
  const dupes = suggestDuplicates(c);
  rows.push([
    csvEscape(c.canonical_name),
    csvEscape(c.credential_class),
    csvEscape(earliest ? `${earliest.code}:${earliest.year}` : ''),
    csvEscape(latest ? `${latest.code}:${latest.year}` : ''),
    csvEscape(appt?.year ?? ''),
    csvEscape(appt?.church ?? ''),
    csvEscape(dupes.slice(0, 5).join(' | ')), // auto_suggested_duplicates
    '',                                        // possible_duplicate_of (colleague fills)
    '',                                        // suggested_status
    '',                                        // colleague_notes
  ].join(','));
}

mkdirSync('/Users/wilsonpruitt/rio-texas-journal/exports', { recursive: true });
const outPath = '/Users/wilsonpruitt/rio-texas-journal/exports/needs-review.csv';
writeFileSync(outPath, rows.join('\n'));
console.log(`Wrote ${all.length} unknown clergy to ${outPath}`);
console.log(`  with credential_class:    ${all.filter((c) => c.credential_class).length}`);
console.log(`  with status_history:      ${all.filter((c) => (c.status_history ?? []).length > 0).length}`);
console.log(`  with latest appointment:  ${all.filter((c) => latestAppt.has(c.id)).length}`);
