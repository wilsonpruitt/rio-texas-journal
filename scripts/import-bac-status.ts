/**
 * Parse multiple status-change sections from a BAC PDF and apply the
 * appropriate clergy.status to each name found:
 *
 *   - "Deceased"                              → status='deceased'
 *   - "Honorable location" (not retired)      → status='honorable_location'
 *   - "Honorable location–retired"            → status='retired' (already retired
 *                                                 takes priority over honorable)
 *   - "Transferred out / to other annual conference" → status='transferred'
 *   - "Withdrawn" / "Discontinued" / "Conference membership terminated"
 *                                              → status='withdrawn'
 *   - "Located" / "Administrative location"   → status='withdrawn'
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-bac-status.ts [--dry] [year]
 */
import { execFileSync } from 'node:child_process';
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const YEAR_ARG = process.argv.find((a) => /^\d{4}$/.test(a));
const YEAR = YEAR_ARG ? Number(YEAR_ARG) : 2025;
const PDF = `/Users/wilsonpruitt/rio-texas-journal/journals/${YEAR}-bac.pdf`;

type StatusType = 'deceased' | 'honorable_location' | 'transferred' | 'withdrawn';

const SECTIONS: Array<{ status: StatusType; headingPatterns: RegExp[] }> = [
  {
    status: 'deceased',
    headingPatterns: [
      /^\s*\d+\.\s+(?:What\s+)?[Dd]eceased\b/,
      /^\s*\d+\.\s+List of members.+passed away/i,
      /^\s*\d+\.\s+.*who\s+have\s+died/i,
    ],
  },
  {
    status: 'honorable_location',
    headingPatterns: [
      /^\s*\d+\.\s+.*(?:granted|recognized).*honorable\s+location(?!\s*[–-]?\s*retired)/i,
      /^\s*\d+\.\s+Who\s+are\s+on\s+location/i,
    ],
  },
  {
    status: 'transferred',
    headingPatterns: [
      /^\s*\d+\.\s+.*transferred\s+out\s+to\s+other/i,
      /^\s*\d+\.\s+.*appointments\s+in\s+other\s+Annual\s+Conferences/i,
    ],
  },
  {
    status: 'withdrawn',
    headingPatterns: [
      /^\s*\d+\.\s+.*conference\s+membership\s+terminated/i,
      /^\s*\d+\.\s+.*withdrawn\s+(?:from|to)/i,
      /^\s*\d+\.\s+.*surrendered\s+(?:their\s+)?credentials/i,
      /^\s*\d+\.\s+.*[Dd]iscontinued\s+as\s+provisional/i,
      /^\s*\d+\.\s+.*[Aa]dministrative\s+location\b/i,
    ],
  },
];

function extractText(): string {
  return execFileSync('/usr/local/bin/pdftotext', ['-layout', PDF, '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function findSectionBlocks(text: string): { status: StatusType; block: string }[] {
  const lines = text.split('\n');
  const blocks: { status: StatusType; block: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const sec of SECTIONS) {
      if (!sec.headingPatterns.some((re) => re.test(lines[i]))) continue;
      // Take this line + everything until the next top-level numbered question.
      let j = i + 1;
      while (j < lines.length && !/^\s*\d+\.\s+(?:What|Who|List|How|Are|The)/i.test(lines[j])) j++;
      blocks.push({ status: sec.status, block: lines.slice(i, j).join('\n') });
      i = j - 1;
      break;
    }
  }
  return blocks;
}

type ParsedName = { first: string; middle: string | null; last: string };

/** Extract names from a section block. Handles both:
 *  - Tabular rows: "Last  First [Middle]  ClergyStatus  [Date]  …"
 *  - Comma-list paragraphs: "First Middle Last, First Middle Last, …"
 *  - "Previously" sub-paragraphs (only valid for retirement-style cumulative
 *    lists; we don't bother distinguishing here since the names are dropped
 *    into the same set anyway).
 */
function parseNamesFromBlock(block: string): ParsedName[] {
  const out: ParsedName[] = [];
  // 1) Tabular rows. Anchor on either a date OR a known clergy-status code.
  const STATUS = /^(FE|FD|PE|PD|FL|PL|RE|RD|RL|RA|RP|OE|OD|OF|OR|AM|SY|PM|TO|TI|HN|HR|HL|AF)$/;
  for (const line of block.split('\n')) {
    const trimmed = line.replace(/\s+$/, '');
    if (!trimmed.trim()) continue;
    if (/^\s*Last\s+Name|^\s*Name\b/i.test(trimmed)) continue;
    let cols = trimmed.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    // Variant A: "Lastname, Firstname Middlename" comma-form → split.
    // Variant B: "Firstname Middle Lastname" all in cols[0], dates in
    //   subsequent cols → treat last token as surname, first as given.
    if (cols[0].includes(',')) {
      const [lastPart, restPart] = cols[0].split(/,\s*/);
      if (lastPart && restPart) {
        cols = [lastPart.trim(), ...restPart.trim().split(/\s+/), ...cols.slice(1)];
      }
    } else if (/^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(cols[0])) {
      // cols[0] is a multi-word name like "Michael Jonathan Quist".
      // Reverse to "Last First Middle" so downstream code can keep
      // treating cols[0] as surname.
      const tokens = cols[0].split(/\s+/);
      const last = tokens[tokens.length - 1];
      const givens = tokens.slice(0, -1);
      cols = [last, ...givens, ...cols.slice(1)];
    }
    const last = cols[0].replace(/,?\s*(Jr|Sr|II|III|IV)\.?$/i, '').trim();
    if (!/^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)?$/.test(last)) continue;
    if (/Conference|Ministry|System|Healthcare|Foundation/i.test(last)) continue;
    const dateIdx = cols.findIndex((c) => /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(c) || /^\d{4}$/.test(c));
    const statusIdx = cols.findIndex((c) => STATUS.test(c.split(/\s+/)[0]));
    const splitIdx = dateIdx > 0 ? dateIdx : statusIdx;
    if (splitIdx < 0 || splitIdx > 5) continue;
    const nameCols = cols.slice(0, splitIdx);
    if (nameCols.length < 2) continue;
    const first = nameCols[1];
    const middle = nameCols.length >= 3 ? nameCols.slice(2).join(' ') : null;
    if (!/^[A-Z]/.test(first)) continue;
    out.push({ last, first, middle });
  }
  // 2) Comma-list paragraphs (used in "Previously" sub-blocks).
  // Strategy: for any paragraph containing 3+ commas with capitalized
  // patterns, split & parse.
  const flat = block.replace(/\s+/g, ' ').trim();
  const previouslyMatch = flat.match(/Previously[?:]?\s+([\s\S]+?)(?:\(\d\)|\(\w\)|$)/i);
  if (previouslyMatch) {
    const names = previouslyMatch[1].split(/,\s*(?=[A-Z])/);
    for (const raw of names) {
      let n = raw.trim().replace(/\s+/g, ' ').replace(/\s+(Jr|Sr|II|III|IV)\.?\s*$/i, '');
      if (!n || n.length < 4 || !/^[A-Z]/.test(n)) continue;
      const tokens = n.split(/\s+/);
      if (tokens.length < 2) continue;
      // Reject tokens that look like header text.
      if (/Date|Effective|Status|Conference/.test(n)) continue;
      out.push({
        last: tokens[tokens.length - 1],
        first: tokens[0],
        middle: tokens.length >= 3 ? tokens.slice(1, -1).join(' ') : null,
      });
    }
  }
  return out;
}

const text = extractText();
const blocks = findSectionBlocks(text);
console.log(`${YEAR}: found ${blocks.length} status-section blocks`);
const namesByStatus = new Map<StatusType, ParsedName[]>();
for (const b of blocks) {
  const ns = parseNamesFromBlock(b.block);
  if (!namesByStatus.has(b.status)) namesByStatus.set(b.status, []);
  namesByStatus.get(b.status)!.push(...ns);
}
for (const [s, ns] of namesByStatus) console.log(`  ${s.padEnd(20)} ${ns.length} names`);

// Resolve names against clergy.
const db = adminClient();
const allClergy: { id: string; canonical_name: string; status: string }[] = [];
{
  let from = 0;
  while (true) {
    const { data } = await db.from('clergy').select('id, canonical_name, status').range(from, from + 999);
    allClergy.push(...((data ?? []) as any));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

function normTok(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, '').trim();
}

const byKey = new Map<string, { id: string; status: string; canonical: string }[]>();
for (const c of allClergy) {
  const tokens = c.canonical_name.trim().split(/\s+/).map(normTok).filter(Boolean);
  if (tokens.length < 2) continue;
  const entry = { id: c.id, status: c.status, canonical: c.canonical_name };
  const surnameForms = [tokens[tokens.length - 1]];
  if (tokens.length >= 3) surnameForms.push(`${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`);
  for (const surname of surnameForms) {
    const sliceEnd = surname.includes(' ') ? tokens.length - 2 : tokens.length - 1;
    for (const tok of tokens.slice(0, sliceEnd)) {
      const k = `${surname}|${tok}`;
      if (!byKey.has(k)) byKey.set(k, []);
      if (!byKey.get(k)!.some((h) => h.id === entry.id)) byKey.get(k)!.push(entry);
    }
  }
}

// Status-priority hierarchy: deceased > retired > honorable_location > withdrawn > transferred > others.
// Deceased always wins. Don't overwrite a more-specific status with a less-specific one.
const PRIORITY: Record<string, number> = {
  deceased: 100,
  retired: 80,
  withdrawn: 70,
  transferred: 60,
  honorable_location: 50,
  extension_ministry: 40,
  active: 30,
  unknown: 0,
};

let totalUpdates = 0;
const totals: Record<string, number> = {};
for (const [target, names] of namesByStatus) {
  let updated = 0;
  const seen = new Set<string>();
  for (const r of names) {
    const last = normTok(r.last);
    const first = normTok(r.first);
    const middle = r.middle ? normTok(r.middle) : null;
    const dedupKey = `${last}|${first}|${middle ?? ''}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const hits = byKey.get(`${last}|${first}`) ?? [];
    if (hits.length === 0) continue;
    let candidates = hits;
    if (candidates.length > 1 && middle) {
      const narrow = candidates.filter((h) => normTok(h.canonical).includes(middle));
      if (narrow.length > 0) candidates = narrow;
    }
    // Prefer cleanest canonical name.
    candidates = [...candidates].sort((a, b) => {
      const aHasComma = a.canonical.includes(',') ? 1 : 0;
      const bHasComma = b.canonical.includes(',') ? 1 : 0;
      if (aHasComma !== bHasComma) return aHasComma - bHasComma;
      return a.canonical.split(/\s+/).length - b.canonical.split(/\s+/).length;
    });
    const t = candidates[0];
    const targetPriority = PRIORITY[target] ?? 50;
    const currentPriority = PRIORITY[t.status] ?? 0;
    if (currentPriority >= targetPriority) continue;
    if (DRY) { updated++; continue; }
    const { error } = await db.from('clergy').update({ status: target }).eq('id', t.id);
    if (error) { console.error(`  ${t.canonical} ERROR: ${error.message}`); continue; }
    updated++;
  }
  totals[target] = (totals[target] ?? 0) + updated;
  totalUpdates += updated;
  console.log(`  → ${target}: ${updated} updates`);
}

console.log(`Total updates this year: ${totalUpdates}${DRY ? ' (dry)' : ''}`);
