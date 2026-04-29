/**
 * Parse BAC §46 (Full members), §47 (Associate members), §48 (Local
 * pastors) from a journal year's BAC PDF and mark all listed clergy
 * as status='retired'.
 *
 * Each section has two sub-formats:
 *   (1) "This year"  — tabular: Last  First  Middle  MM-DD-YYYY
 *   (2) "Previously" — comma-separated paragraph of "First [Middle] Last
 *                       [Suffix]" entries
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-retirements.ts [--dry] [year]
 */
import { execFileSync } from 'node:child_process';
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const YEAR_ARG = process.argv.find((a) => /^\d{4}$/.test(a));
const YEAR = YEAR_ARG ? Number(YEAR_ARG) : 2025;
const PDF = `/Users/wilsonpruitt/rio-texas-journal/journals/${YEAR}-bac.pdf`;

function extractText(): string {
  return execFileSync('/usr/local/bin/pdftotext',
    ['-layout', PDF, '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Find the retirement Q&A blocks. The section number floats year to
 *  year (§46 in 2025, §49 in 2024, etc.) so we anchor on the heading
 *  text. Three section types matter:
 *    - members in full connection (Elders + Deacons)
 *    - associate members
 *    - local pastors
 *  Returns the concatenated text of all three blocks. */
function findRetirementSections(text: string): string {
  const lines = text.split('\n');
  // Heading patterns that mark section starts.
  const startPatterns: RegExp[] = [
    /members\s+in\s+full\s+connection\s+(?:who\s+have|have)\s+been\s+retired/i,
    /(?:What\s+)?associate\s+members\s+(?:who\s+have|have)\s+been\s+retired/i,
    /(?:Who\s+have\s+been|been)\s+recognized\s+as\s+retired\s+local\s+pastors/i,
  ];
  // Patterns that mark the *next* section (any of these ends the current block).
  const endPatterns: RegExp[] = [
    /^\s*\d+\.\s+(What|Who|List|How|Are)/i, // a new top-level question
  ];

  const sections: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isStart = startPatterns.some((re) => re.test(line));
    if (!isStart) continue;
    let j = i + 1;
    while (j < lines.length) {
      const t = lines[j];
      if (endPatterns.some((re) => re.test(t))) break;
      j++;
    }
    sections.push(lines.slice(i, j).join('\n'));
    i = j - 1;
  }
  return sections.join('\n\n');
}

type ParsedName = { first: string; middle: string | null; last: string };

/** "This year" table rows: Last  First [Middle]  MM-DD-YYYY */
function parseTableRows(block: string): ParsedName[] {
  const out: ParsedName[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.replace(/\s+$/, '');
    if (!trimmed.trim()) continue;
    if (/^\s*Last\s+Name/i.test(trimmed)) continue;
    if (/^\s*Name/i.test(trimmed)) continue;
    if (/^\s*\d+\.\s/.test(trimmed)) continue;
    const cols = trimmed.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (cols.length < 3) continue;
    const last = cols[0];
    if (!/^[A-Z]/.test(last)) continue;
    // Find date column (MM-DD-YYYY or MM/DD/YYYY)
    const dateIdx = cols.findIndex((c) => /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(c));
    if (dateIdx < 0) continue;
    const nameCols = cols.slice(0, dateIdx);
    if (nameCols.length < 2) continue;
    out.push({
      last: nameCols[0].replace(/,?\s*(Jr|Sr|II|III|IV)\.?$/i, '').trim(),
      first: nameCols[1],
      middle: nameCols.length >= 3 ? nameCols[2] : null,
    });
  }
  return out;
}

/** "Previously" paragraph: "Timothy David Abel, Sue Abold, Jesse A. Adams, Jr., Laura Smith Adam, ..." */
function parsePreviouslyParagraph(block: string): ParsedName[] {
  // Strip newlines; collapse whitespace.
  const flat = block.replace(/\s+/g, ' ').trim();
  // Skip the header text before names start. Names start after "Previously".
  const m = flat.match(/Previously[?:]?\s+(.+)$/i);
  if (!m) return [];
  const names = m[1].split(/,\s*(?=[A-Z])/);
  const out: ParsedName[] = [];
  for (const raw of names) {
    let n = raw.trim().replace(/\s+/g, ' ');
    // Strip trailing suffixes like "Jr.", "Sr.", "III"
    n = n.replace(/\s+(Jr|Sr|II|III|IV)\.?\s*$/i, '');
    if (!n || n.length < 4) continue;
    if (!/^[A-Z]/.test(n)) continue;
    // "First [Middle…] Last" — last token is surname, first token is given name.
    const tokens = n.split(/\s+/);
    if (tokens.length < 2) continue;
    const last = tokens[tokens.length - 1];
    const first = tokens[0];
    const middle = tokens.length >= 3 ? tokens.slice(1, -1).join(' ') : null;
    out.push({ first, middle, last });
  }
  return out;
}

const text = extractText();
const block = findRetirementSections(text);
if (!block) {
  console.error(`§46-48 not found in ${PDF}`);
  process.exit(1);
}

// Find each "Previously" paragraph. Markers seen: "(2)  Previously",
// "(3) Previously", "d) Previously", "b) Previously". Take everything
// until the next "This year" sub-heading or top-level question. We
// deliberately let mid-paragraph "(Jack)" / "Jr.," etc. pass through.
const previouslyBlocks: string[] = [];
{
  const lines = block.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (/^\s*(?:\([0-9a-z]\)|[a-z]\))\s+Previously\b/i.test(lines[i])) {
      const start = i;
      i++;
      while (i < lines.length &&
             !/^\s*\d+\.\s+(?:What|Who|List|How)/i.test(lines[i]) &&
             !/^\s*(?:\([0-9a-z]\)|[a-z]\))\s+(?:This\s+year|Previously)\b/i.test(lines[i]) &&
             !/^\s*(?:Deacons|Elders)\s*$/i.test(lines[i])) i++;
      previouslyBlocks.push(lines.slice(start, i).join('\n'));
      continue;
    }
    i++;
  }
}

// Parse table rows from the entire block (matches "This year" rows).
const tableNames = parseTableRows(block);
const prevNames: ParsedName[] = [];
for (const pb of previouslyBlocks) prevNames.push(...parsePreviouslyParagraph(pb));

console.log(`Parsed ${tableNames.length} "This year" + ${prevNames.length} "Previously" retirement names from ${YEAR} BAC §46-48`);

// Resolve names against clergy table.
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

function normTok(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, '').trim();
}

// Build lookup: (surname, given-name-token) → clergy. Multi-word surnames covered too.
const byKey = new Map<string, { id: string; status: string; canonical: string }[]>();
function pushKey(key: string, entry: { id: string; status: string; canonical: string }) {
  if (!byKey.has(key)) byKey.set(key, []);
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
    for (const tok of tokens.slice(0, sliceEnd)) pushKey(`${surname}|${tok}`, entry);
  }
}

let matched = 0, ambiguous = 0, unmatched = 0, alreadyRetired = 0, updated = 0;
const allNames = [...tableNames, ...prevNames];
const seen = new Set<string>();
for (const r of allNames) {
  const last = normTok(r.last);
  const first = normTok(r.first);
  const middle = r.middle ? normTok(r.middle) : null;
  const dedupKey = `${last}|${first}|${middle ?? ''}`;
  if (seen.has(dedupKey)) continue;
  seen.add(dedupKey);

  const hits = byKey.get(`${last}|${first}`) ?? [];
  if (hits.length === 0) {
    unmatched++;
    continue;
  }
  // Disambiguate by middle name and status preference.
  let candidates = hits;
  if (candidates.length > 1 && middle) {
    const narrow = candidates.filter((h) => normTok(h.canonical).includes(middle));
    if (narrow.length > 0) candidates = narrow;
  }
  // Prefer rows whose status is unknown/active/extension (eligible for retirement transition).
  const eligible = candidates.filter((c) => c.status === 'unknown' || c.status === 'active' || c.status === 'extension_ministry');
  if (eligible.length > 0) candidates = eligible;
  // Prefer cleanest canonical name.
  candidates = [...candidates].sort((a, b) => {
    const aHasComma = a.canonical.includes(',') ? 1 : 0;
    const bHasComma = b.canonical.includes(',') ? 1 : 0;
    if (aHasComma !== bHasComma) return aHasComma - bHasComma;
    const aLen = a.canonical.split(/\s+/).length;
    const bLen = b.canonical.split(/\s+/).length;
    if (aLen !== bLen) return aLen - bLen;
    return a.canonical.length - b.canonical.length;
  });
  const target = candidates[0];
  matched++;
  if (target.status === 'retired') { alreadyRetired++; continue; }
  if (target.status === 'deceased') continue; // deceased trumps retired
  console.log(`  ${target.canonical}: ${target.status} → retired`);
  if (DRY) continue;
  const { error } = await db.from('clergy').update({ status: 'retired' }).eq('id', target.id);
  if (error) { console.error(`    ERROR: ${error.message}`); continue; }
  updated++;
}

console.log(`\nResults: matched=${matched}, already-retired=${alreadyRetired}, unmatched=${unmatched}, updated=${updated}${DRY ? ' (dry)' : ''}`);
