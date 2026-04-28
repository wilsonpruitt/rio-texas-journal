/**
 * Parse Business of the Annual Conference (BAC) PDFs and apply clergy
 * status changes. Handles three years where the question numbering
 * shifted between 2024 and 2025:
 *
 *                                       2023/2024     2025
 *   Transferred OUT                       §37          §37
 *   Membership terminated (withdrawal)    §42          §39
 *   Deceased                              §44          §41
 *   Retired                               §49          §49
 *
 * Within each section the row pattern is "Last, First Middle  date  ...".
 * Names with compound last names use a comma after the full surname
 * ("Mora Peña, Josue") so we split on the FIRST comma.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-bac.ts [--dry]
 */

import { execFileSync } from 'node:child_process';
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const PDFTOTEXT = '/usr/local/bin/pdftotext';

type Status = 'active' | 'retired' | 'withdrawn' | 'deceased' | 'transferred' | 'unknown';

type ParsedRow = {
  last: string;
  first: string;
  middle?: string;
  status: Status;
  effective?: string;
  priorStatus?: string;
  source: string;
};

const YEARS = [
  { year: 2023, file: '/Users/wilsonpruitt/rio-texas-journal/journals/2023-bac.pdf', q: { transferOut: 37, withdrawal: 42, deceased: 44 } },
  { year: 2024, file: '/Users/wilsonpruitt/rio-texas-journal/journals/2024-bac.pdf', q: { transferOut: 37, withdrawal: 42, deceased: 44 } },
  { year: 2025, file: '/Users/wilsonpruitt/rio-texas-journal/journals/2025-bac.pdf', q: { transferOut: 37, withdrawal: 39, deceased: 41 } },
];

function extract(file: string): string {
  return execFileSync(PDFTOTEXT, ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Find the line range belonging to question N — from the line that starts
 *  with "N." up to (but not including) the line that starts with "(N+1)." */
function sectionRange(lines: string[], q: number): [number, number] {
  const headerRe = new RegExp(`^\\s*${q}\\.\\s+\\S`);
  const startIdx = lines.findIndex((l) => headerRe.test(l));
  if (startIdx < 0) return [-1, -1];
  // Find the next section header — number > q, dot, space, non-numeric.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)\.\s+\S/);
    if (m && Number(m[1]) > q) { endIdx = i; break; }
  }
  return [startIdx, endIdx];
}

/** Parse "Last, First Middle  optional-fields..." rows. */
function parseDataLine(line: string, year: number, source: string, status: Status): ParsedRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Skip headers + footers.
  if (/^Name\b|^Last Name\b|Clergy Status$|Date Effective|Date of Death|Date of Birth/i.test(trimmed)) return null;
  if (/^[a-z]\)|^\(\d+\)/.test(trimmed)) return null;
  if (/^Active:|^Retired:|^Effective:|^Other:/i.test(trimmed)) return null;
  if (/Rio Texas Conference Journal|Business of the Annual Conference|^E\s*-\s*\d+/i.test(trimmed)) return null;
  if (/^\d+\s*$/.test(trimmed)) return null;
  if (/^March\s+\d{4}/.test(trimmed)) return null;

  // Two formats observed:
  //   2023/2024: "Last, First Middle    date   status   ..."
  //   2025:     "Last           First           Middle           date   status   ..."
  // The 2025 BAC (which we already saw) uses column-aligned layout
  // without commas. The older years use "Last, First" with comma.
  let last = '';
  let first = '';
  let middle = '';
  const tokens = trimmed.split(/\s{2,}/).filter(Boolean);
  if (/^[A-Z][^,]*?,/.test(trimmed)) {
    // Comma form: "Last, First Middle" or "Last, Suffix  First Middle"
    const first2 = trimmed.split(',', 2);
    last = first2[0].trim();
    const rest = first2[1].trim().split(/\s{2,}/);
    let nameTokens = rest[0].trim().split(/\s+/);
    // If first token after the comma is a suffix, attach it to last and
    // shift the column reads forward by 1.
    let firstColIdx = 0;
    let middleColIdx = -1;
    if (nameTokens[0] && SUFFIX_RE.test(nameTokens[0].replace(/\.$/, ''))) {
      last = `${last} ${nameTokens[0]}`;
      firstColIdx = 1;
      middleColIdx = 2;
    }
    if (firstColIdx === 0) {
      first = nameTokens[0] || '';
      middle = nameTokens.slice(1).join(' ');
    } else {
      first = (rest[firstColIdx] || '').trim().split(/\s+/)[0] || '';
      const midCol = rest[middleColIdx];
      // Middle column is only middle if it's not a date.
      if (midCol && !/^\d/.test(midCol)) middle = midCol.trim();
    }
    // Effective date may be in rest[1].
    const restAfter = rest.slice(1).join('  ');
    const dateMatch = restAfter.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/);
    const priorMatch = restAfter.match(/\b(FE|FD|RE|RD|RA|RH|RL|RP|RM|PE|PD|FL|PL|OE|OF|OD|OP|AM|HL|HM)\b/);
    if (!last || !first) return null;
    return {
      last,
      first,
      middle: middle || undefined,
      status,
      effective: dateMatch ? normalizeDate(dateMatch[1]) : undefined,
      priorStatus: priorMatch ? priorMatch[1] : undefined,
      source: `${year} ${source}`,
    };
  } else if (tokens.length >= 3 && /^[A-Z]/.test(tokens[0])) {
    // Column form: "Last  First  Middle  date  status..."
    last = tokens[0];
    first = tokens[1];
    // Middle could be empty (column-aligned space).
    let dateIdx = -1;
    for (let i = 2; i < tokens.length; i++) {
      if (/(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/.test(tokens[i])) { dateIdx = i; break; }
    }
    if (dateIdx > 2) middle = tokens.slice(2, dateIdx).join(' ');
    const dateMatch = dateIdx >= 0 ? tokens[dateIdx].match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/) : null;
    const priorMatch = tokens.slice(dateIdx + 1).join(' ').match(/\b(FE|FD|RE|RD|RA|RH|RL|RP|RM|PE|PD|FL|PL|OE|OF|OD|OP|AM|HL|HM)\b/);
    if (!last || !first || !/[A-Za-z]/.test(last) || !/[A-Za-z]/.test(first)) return null;
    if (last.length < 2 || first.length < 2) return null;
    return {
      last,
      first,
      middle: middle || undefined,
      status,
      effective: dateMatch ? normalizeDate(dateMatch[1]) : undefined,
      priorStatus: priorMatch ? priorMatch[1] : undefined,
      source: `${year} ${source}`,
    };
  }
  return null;
}

function normalizeDate(d: string): string {
  // Accept MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD; output YYYY-MM-DD.
  const a = d.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (a) return `${a[3]}-${a[1]}-${a[2]}`;
  const b = d.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (b) return `${b[1]}-${b[2]}-${b[3]}`;
  return d;
}

function parseSection(text: string, q: number, status: Status, sourceLabel: string, year: number): ParsedRow[] {
  const lines = text.split('\n');
  const [s, e] = sectionRange(lines, q);
  if (s < 0) return [];
  const out: ParsedRow[] = [];
  for (let i = s; i < e; i++) {
    const row = parseDataLine(lines[i], year, sourceLabel, status);
    if (row) out.push(row);
  }
  return out;
}

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

const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)$/i;

/** Strip Jr./Sr./III etc from a token list. */
function stripSuffixes(tokens: string[]): string[] {
  return tokens.filter((t) => !SUFFIX_RE.test(t.replace(/\.$/, '')));
}

function matches(rec: ParsedRow, candidate: string): boolean {
  const candTokens = stripSuffixes(tokenize(candidate));
  if (candTokens.length < 2) return false;
  // Try last-word and last-two-words for compound surnames.
  const candLast1 = candTokens[candTokens.length - 1];
  const candLast2 = candTokens.length >= 3 ? `${candTokens[candTokens.length - 2]} ${candTokens[candTokens.length - 1]}` : null;
  const candFirst = candTokens[0];

  // Strip suffixes from rec.last as well: "Smith Sr." → "Smith"
  const recLastTokens = stripSuffixes(rec.last.replace(/[.,]$/, '').toLowerCase().split(/\s+/));
  const recLastFull = recLastTokens.join(' ');
  const recLastWord = recLastTokens[recLastTokens.length - 1] || '';
  const recFirst = rec.first.toLowerCase();

  if (candFirst !== recFirst) return false;
  if (candLast1 === recLastWord) return true;
  if (candLast2 && candLast2 === recLastFull) return true;
  // Compound: candidate is "Josue Mora Peña" → last2 = "mora peña". rec.last = "Mora Peña" → recLastFull = "mora peña". Match.
  if (candTokens.slice(-recLastTokens.length).join(' ') === recLastFull) return true;
  return false;
}

async function main() {
  const all = await fetchAllClergy();
  const allRows: ParsedRow[] = [];

  for (const y of YEARS) {
    console.log(`\n=== ${y.year} BAC ===`);
    const text = extract(y.file);
    const transferOut = parseSection(text, y.q.transferOut, 'transferred', `§${y.q.transferOut}`, y.year);
    const withdraw = parseSection(text, y.q.withdrawal, 'withdrawn', `§${y.q.withdrawal}`, y.year);
    const deceased = parseSection(text, y.q.deceased, 'deceased', `§${y.q.deceased}`, y.year);
    console.log(`  transferred: ${transferOut.length}, withdrawn: ${withdraw.length}, deceased: ${deceased.length}`);
    allRows.push(...transferOut, ...withdraw, ...deceased);
  }

  // Status priority — if a clergyperson appears in multiple years, use the
  // most "terminal" status. deceased > withdrawn > transferred > retired.
  const priority: Record<Status, number> = {
    deceased: 5, withdrawn: 4, transferred: 3, retired: 2, active: 1, unknown: 0,
  };
  const byKey = new Map<string, ParsedRow>();
  for (const r of allRows) {
    const k = `${r.last.toLowerCase()}|${r.first.toLowerCase()}`;
    const existing = byKey.get(k);
    if (!existing || priority[r.status] > priority[existing.status]) byKey.set(k, r);
  }
  const finalRows = Array.from(byKey.values());
  console.log(`\nUnique clergy after dedup: ${finalRows.length}`);

  // Apply
  let applied = 0;
  let already = 0;
  let createdNew = 0;
  const unmatched: ParsedRow[] = [];
  for (const rec of finalRows) {
    const candidates = all.filter((c) => matches(rec, c.canonical_name));
    if (candidates.length === 0) {
      unmatched.push(rec);
      // Create new with the BAC name
      const fullName = [rec.first, rec.middle, rec.last].filter(Boolean).join(' ');
      if (!DRY) {
        const { error } = await db.from('clergy').insert({ canonical_name: fullName, status: rec.status });
        if (!error) createdNew++;
      }
      continue;
    }
    // Pick the candidate that best matches. If multiple, prefer one without status already set.
    const target = candidates.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1))[0];
    if (target.status === rec.status) { already++; continue; }
    if (!DRY) {
      await db.from('clergy').update({ status: rec.status }).eq('id', target.id);
    }
    applied++;
  }
  console.log(`\napplied: ${applied}, already: ${already}, new records: ${createdNew}, unmatched: ${unmatched.length}`);
  if (DRY && unmatched.length) {
    console.log('\n--- unmatched ---');
    for (const u of unmatched) {
      console.log(`  ${u.last}, ${u.first}${u.middle ? ' ' + u.middle : ''} → ${u.status} (${u.source})`);
    }
  }

  // Final tally
  if (!DRY) {
    const counts: Record<string, number> = {};
    const refreshed = await fetchAllClergy();
    for (const c of refreshed) counts[c.status] = (counts[c.status] || 0) + 1;
    console.log('\nclergy status distribution:', counts);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
