/**
 * Parse BAC §74 ("Appointments to Extension Ministries") from a journal
 * year's BAC PDF and mark those clergy as status='extension_ministry'.
 *
 * §74 has three sub-tables (a, b, c) for connectional, BHEM-endorsed,
 * and other valid extension placements respectively. Each row is:
 *   Last  First  [Middle]  ClergyStatus  [EffectiveDate]  Assignment...
 *
 * We anchor on the clergy-status code (FE/FD/PE/PD/FL/PL/RE/OE/OD/...)
 * to split the row, then resolve names against the clergy table.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-extension-ministry.ts [--dry] [year]
 */
import { execFileSync } from 'node:child_process';
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const YEAR_ARG = process.argv.find((a) => /^\d{4}$/.test(a));
const YEAR = YEAR_ARG ? Number(YEAR_ARG) : 2025;
const PDF = `/Users/wilsonpruitt/rio-texas-journal/journals/${YEAR}-bac.pdf`;

const STATUS_CODES = new Set(['FE','FD','PE','PD','FL','PL','RE','RD','RL','RA','RP','OE','OD','OF','OR','AM','SY','HN','HR','HL']);

function extractText(): string {
  return execFileSync('/usr/local/bin/pdftotext',
    ['-layout', PDF, '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function findSection74(text: string): string {
  const lines = text.split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start < 0 && /^74\.\s+What clergy members are appointed to extension ministries/.test(lines[i].trim())) {
      start = i;
      continue;
    }
    if (start >= 0 && /^75\.\s+/.test(lines[i].trim())) { end = i; break; }
  }
  if (start < 0) return '';
  return lines.slice(start, end > 0 ? end : undefined).join('\n');
}

type Row = { last: string; first: string; middle: string | null; statusCode: string; assignment: string };

// Pattern: capture two leading whitespace-delimited groups (last, first),
// optionally a third (middle), then the status code as a standalone token.
// Last/first/middle can be multi-word ("De Leon", "First Name", etc.) but
// in practice the BAC uses ≥2 spaces between columns, so we split on
// /\s{2,}/.
function parseRow(line: string): Row | null {
  const trimmed = line.replace(/\s+$/, '');
  if (!trimmed.trim()) return null;
  // Reject header rows
  if (/^\s*Last\b/.test(trimmed) || /^\s*Name\b/.test(trimmed)) return null;
  // Split on runs of 2+ spaces
  const cols = trimmed.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (cols.length < 3) return null;
  // Find the status-code column. Column may also contain "FE   07/01/2025"
  // etc. — we accept a column whose first token is a known status code.
  let codeIdx = -1;
  for (let i = 0; i < cols.length; i++) {
    const first = cols[i].split(/\s+/)[0];
    if (STATUS_CODES.has(first)) { codeIdx = i; break; }
  }
  if (codeIdx < 0) return null;
  // Names are the columns BEFORE codeIdx (1-3 columns: last, first, [middle])
  const nameCols = cols.slice(0, codeIdx);
  if (nameCols.length < 2 || nameCols.length > 3) return null;
  const last = nameCols[0];
  const first = nameCols[1];
  const middle = nameCols.length === 3 ? nameCols[2] : null;
  // Heuristic: surnames are short capitalized; reject if `last` looks like
  // an assignment fragment ("Rio Texas Conference", "Methodist Healthcare").
  if (/Conference|Ministry|System|Healthcare|Foundation|Hospital/i.test(last)) return null;
  if (!/^[A-Z]/.test(last)) return null;
  const codeCol = cols[codeIdx];
  const statusCode = codeCol.split(/\s+/)[0];
  // Assignment = remainder after the code column
  const assignment = cols.slice(codeIdx + 1).join(' | ').trim();
  return { last, first, middle, statusCode, assignment };
}

const text = extractText();
const sectionText = findSection74(text);
if (!sectionText) {
  console.error(`§74 not found in ${PDF}`);
  process.exit(1);
}

const lines = sectionText.split('\n');
const rows: Row[] = [];
for (const line of lines) {
  const r = parseRow(line);
  if (r) rows.push(r);
}

console.log(`Parsed ${rows.length} extension-ministry rows from ${YEAR} BAC §74`);
for (const r of rows.slice(0, 5)) {
  console.log(`  ${r.last}, ${r.first}${r.middle ? ' ' + r.middle : ''} [${r.statusCode}] — ${r.assignment.slice(0, 80)}`);
}

// Resolve to clergy.id by name. Build a lookup of all clergy.
const db = adminClient();
const allClergy: { id: string; canonical_name: string; status: string }[] = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await db.from('clergy').select('id, canonical_name, status').range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    allClergy.push(...((data ?? []) as any));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

// Normalize for matching: lowercase, strip diacritics & punctuation.
function normTok(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, '').trim();
}

// canonical_name in DB is "First Middle Last". Build a lookup keyed by
// (surname, any-given-name-token). One clergy generates multiple keys:
// "Larry Ray Altman" → altman|larry AND altman|ray. For potential
// multi-word surnames ("Jaime Derio De Leon") also generate keys using
// the last 2 tokens as surname.
const byKey = new Map<string, { id: string; status: string; canonical: string }[]>();
function pushKey(key: string, entry: { id: string; status: string; canonical: string }) {
  if (!byKey.has(key)) byKey.set(key, []);
  // Dedup by id within a key bucket.
  if (!byKey.get(key)!.some((h) => h.id === entry.id)) byKey.get(key)!.push(entry);
}
for (const c of allClergy) {
  const tokens = c.canonical_name.trim().split(/\s+/).map(normTok).filter(Boolean);
  if (tokens.length < 2) continue;
  const entry = { id: c.id, status: c.status, canonical: c.canonical_name };
  const surnameForms: string[] = [tokens[tokens.length - 1]];
  if (tokens.length >= 3) surnameForms.push(`${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`);
  for (const surname of surnameForms) {
    const sliceEnd = surname.includes(' ') ? tokens.length - 2 : tokens.length - 1;
    for (const tok of tokens.slice(0, sliceEnd)) {
      pushKey(`${surname}|${tok}`, entry);
    }
  }
}

let matched = 0, ambiguous = 0, unmatched = 0, updated = 0, alreadyTagged = 0;
for (const r of rows) {
  const last = normTok(r.last);
  const first = normTok(r.first);
  const key = `${last}|${first}`;
  const hits = byKey.get(key) ?? [];
  if (hits.length === 0) {
    unmatched++;
    console.log(`  UNMATCHED: ${r.last}, ${r.first} ${r.middle ?? ''} [${r.statusCode}] — ${r.assignment.slice(0, 60)}`);
    continue;
  }
  // Disambiguate: prefer hits whose current status is active/unknown
  // (extension ministry is an active classification — retired/withdrawn
  // clergy with the same name are wrong). Then narrow with middle name
  // if one was supplied. Final fallback: pick the canonical name with
  // the fewest tokens and no commas, which usually rejects parser-dup
  // artifacts like "Ray Jose h Altman" or "John Abner, III Lee".
  let candidates = hits.filter((h) => h.status === 'active' || h.status === 'unknown' || h.status === 'extension_ministry');
  if (candidates.length === 0) candidates = hits;
  if (candidates.length > 1 && r.middle) {
    const mLow = normTok(r.middle);
    const narrow = candidates.filter((h) => normTok(h.canonical).includes(mLow));
    if (narrow.length > 0) candidates = narrow;
  }
  if (candidates.length > 1) {
    candidates = [...candidates].sort((a, b) => {
      const aHasComma = a.canonical.includes(',') ? 1 : 0;
      const bHasComma = b.canonical.includes(',') ? 1 : 0;
      if (aHasComma !== bHasComma) return aHasComma - bHasComma;
      const aLen = a.canonical.split(/\s+/).length;
      const bLen = b.canonical.split(/\s+/).length;
      if (aLen !== bLen) return aLen - bLen;
      return a.canonical.length - b.canonical.length;
    });
    console.log(`  RESOLVED-AMBIGUOUS: ${r.last}, ${r.first} → picked ${candidates[0].canonical} (other: ${candidates.slice(1).map((h) => h.canonical).join(' / ')})`);
  }
  const target = candidates[0];
  matched++;
  if (target.status === 'extension_ministry') { alreadyTagged++; continue; }
  console.log(`  ${target.canonical}: ${target.status} → extension_ministry [${r.statusCode}, ${r.assignment.slice(0, 50)}]`);
  if (DRY) continue;
  const { error } = await db.from('clergy').update({ status: 'extension_ministry' }).eq('id', target.id);
  if (error) { console.error(`    ERROR: ${error.message}`); continue; }
  updated++;
}

console.log(`\nResults: matched=${matched}, ambiguous=${ambiguous}, unmatched=${unmatched}, already-tagged=${alreadyTagged}, updated=${updated}${DRY ? ' (dry)' : ''}`);
