/**
 * Parse Section I (Clergy Records) PDFs to backfill:
 *  - canonical clergy names (better-formatted than F-section captures)
 *  - status timelines (PM: 1977; FE: 1981; ...) into clergy.status_history
 *  - historical appointment rows (APPTS: 1977 ...; 1980 ...; ...) into
 *    the appointment table with parser_version='clergy_records_v1'
 *
 * Each record block looks like:
 *   Abel, Timothy David          PM: 1977; FE: 1981; FE: 1989; HN: 1990; ...
 *     Retired                    ED: ... ; ... ;
 *                                APPTS: 1977 In School, WI Conference; 1980 ...
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-clergy-records.ts [--dry] [year]
 */

import { execFileSync } from 'node:child_process';
import { adminClient } from './parsers/era_b/lib/db.ts';
import { canonicalize } from './parsers/era_b/lib/names.ts';

const DRY = process.argv.includes('--dry');
const YEAR_ARG = process.argv.find((a) => /^\d{4}$/.test(a));
const JOURNAL_YEAR = YEAR_ARG ? Number(YEAR_ARG) : 2025;
const PDF_FILE = `/Users/wilsonpruitt/rio-texas-journal/journals/${JOURNAL_YEAR}-clergy-record.pdf`;
const PARSER_VERSION = 'clergy_records_v1';

/**
 * Per-year format quirks.
 *  - twoColumn: 2024 ships clergy records in a 2-column layout. We split
 *    each line at COL_BOUNDARY, accumulate each column as its own text,
 *    and concatenate (left+right) before parsing so records stay
 *    contiguous.
 *  - corrupted: 2024's PDF substitutes glyphs for "ti"/"ft"/"tt" with
 *    random characters (X, 3, Z, ^). We restore them only when they
 *    appear sandwiched between lowercase letters so real names like
 *    "JoAnn", "McAllen", "DeKalb" are preserved.
 */
const YEAR_FORMAT: Record<number, { twoColumn: boolean; columnBoundary?: number; corrupted: boolean }> = {
  2025: { twoColumn: false, corrupted: false },
  2024: { twoColumn: true, columnBoundary: 74, corrupted: true },
};
const FORMAT = YEAR_FORMAT[JOURNAL_YEAR] ?? { twoColumn: false, corrupted: false };

function sanitize(text: string): string {
  if (!FORMAT.corrupted) return text;
  return text
    // ﬀ / ﬁ ligature unicode → plain
    .replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
    // mid-lowercase corruption: X/3 → ti, Z → ft, ^ → tt
    .replace(/([a-z])X(?=[a-z])/g, '$1ti')
    .replace(/([a-z])3(?=[a-z])/g, '$1ti')
    .replace(/([a-z])Z(?=[a-z])/g, '$1ft')
    .replace(/([a-z])\^(?=[a-z])/g, '$1tt');
}

/** For 2-column layouts, walk each PAGE separately, slicing each line at
 *  the column boundary and emitting left-column lines then right-column
 *  lines. This matches the natural reading order: top-left → bottom-left
 *  → top-right → bottom-right of page 1, then page 2, etc. Records that
 *  start on page N's left column complete on page N's left column (or
 *  spill to page N+1's left); right-column records similarly. */
function unifyColumns(text: string): string {
  if (!FORMAT.twoColumn) return text;
  const boundary = FORMAT.columnBoundary ?? 80;
  const pages = text.split('\f');
  const out: string[] = [];
  for (const page of pages) {
    const lines = page.split('\n');
    const left: string[] = [];
    const right: string[] = [];
    for (const line of lines) {
      const l = line.slice(0, boundary).replace(/\s+$/, '');
      const r = line.slice(boundary).replace(/\s+$/, '');
      left.push(l);
      right.push(r);
    }
    out.push(...left, ...right);
  }
  return out.join('\n');
}

type StatusEntry = { code: string; year: number };

type ApptHistory = { year: number; raw: string };

type EducationEntry = { institution: string; degree: string; raw: string };

type ClergyRec = {
  canonical: string;        // "Last, First Middle"
  displayName: string;       // "First Middle Last"
  currentAppt: string | null; // text in line after the name
  statusHistory: StatusEntry[];
  appts: ApptHistory[];
  education: string | null;
  educationEntries: EducationEntry[];
  pdfPage: number | null;
};

/** Normalize the most common UMC seminaries / divinity schools to a
 *  canonical short label so we can group later (e.g. count "Perkins
 *  alumni"). For everything else, use the raw string unchanged. */
const SEMINARY_NORMALIZE: Array<[RegExp, string]> = [
  [/Southern Methodist University/i, 'Southern Methodist University'],
  [/Perkins(\s+School\s+of\s+Theology)?/i, 'Perkins School of Theology'],
  [/Candler(\s+School\s+of\s+Theology)?/i, 'Candler School of Theology'],
  [/Asbury\s+(Theological\s+)?Seminary/i, 'Asbury Theological Seminary'],
  [/Duke\s+Divinity/i, 'Duke Divinity School'],
  [/Drew\s+(Theological)?(\s+University)?/i, 'Drew Theological School'],
  [/Garrett[- ]?Evangelical/i, 'Garrett-Evangelical Theological Seminary'],
  [/Iliff(\s+School\s+of\s+Theology)?/i, 'Iliff School of Theology'],
  [/Saint Paul\s+(School\s+of\s+Theology)?/i, 'Saint Paul School of Theology'],
  [/United\s+Theological/i, 'United Theological Seminary'],
  [/Methodist\s+Theological\s+School/i, 'Methodist Theological School in Ohio'],
  [/Wesley\s+(Theological\s+)?Seminary/i, 'Wesley Theological Seminary'],
  [/Boston\s+University\s+(School of Theology)?/i, 'Boston University School of Theology'],
  [/Princeton\s+(Theological)?(\s+Seminary)?/i, 'Princeton Theological Seminary'],
  [/Yale\s+Divinity/i, 'Yale Divinity School'],
  [/Austin\s+Presbyterian/i, 'Austin Presbyterian Theological Seminary'],
  [/(Course\s+of\s+Study|COS)\b/i, 'Course of Study'],
];

// Degree patterns anchored to END of the entry (greedy institution match).
// Order matters — longer/more-specific patterns first.
const DEGREE_END_RE = /\s+(D\.?\s?Min\.?|D\.?\s?M\.?A\.?|D\.?\s?D\.?\s?S\.?|Ph\.?\s?D\.?|J\.?\s?D\.?|D\.?\s?D\.?|M\.?\s?Div\.?|M\.?\s?Th\.?|M\.?\s?T\.?S\.?|M\.?\s?A\.?|M\.?\s?S\.?|M\.?\s?Ed\.?|M\.?\s?M\.?|M\.?\s?S\.?M\.?|M\.?\s?S\.?N\.?|M\.?\s?B\.?A\.?|B\.?\s?Th\.?|B\.?\s?D\.?|B\.?\s?A\.?|B\.?\s?S\.?|B\.?\s?M\.?|D\.?\s?Edu\.?|MDiv|DMin|MTS|MA|BA|BS|BD)\.?$/i;

function parseEducation(raw: string): EducationEntry[] {
  const body = raw.replace(/^ED:\s*/i, '');
  const out: EducationEntry[] = [];
  for (const piece of body.split(/;\s*/)) {
    const p = piece.trim();
    if (!p) continue;
    const m = p.match(DEGREE_END_RE);
    let institution = p;
    let degree = '';
    if (m && typeof m.index === 'number') {
      institution = p.slice(0, m.index).trim();
      degree = m[1].trim();
    }
    if (!institution) institution = p;
    let normalized = institution;
    for (const [re, label] of SEMINARY_NORMALIZE) {
      if (re.test(institution)) { normalized = label; break; }
    }
    out.push({ institution: normalized, degree, raw: p });
  }
  return out;
}

const NAME_LINE_RE = /^([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)*),\s+(.+)$/;

function extractText(): string {
  // Keep page form feeds (no -nopgbrk) so we can split per page below
  // — needed for two-column layouts where we read each page's left
  // column then right column to match the natural reading order.
  return execFileSync('/usr/local/bin/pdftotext',
    ['-layout', PDF_FILE, '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Split a "Last, First Middle" leading name into the displayed "First Middle Last" form. */
function flipName(formal: string): string {
  const m = formal.match(/^(.+?),\s*(.+)$/);
  if (!m) return formal.trim();
  const last = m[1].trim();
  const rest = m[2].trim();
  return `${rest} ${last}`;
}

/** Parse "PM: 1977; FE: 1981; ..." → array of {code, year}. */
function parseStatusHistory(s: string): StatusEntry[] {
  const out: StatusEntry[] = [];
  for (const m of s.matchAll(/\b([A-Z]{2,4})\s*:\s*(\d{4})/g)) {
    out.push({ code: m[1], year: Number(m[2]) });
  }
  return out;
}

/** Parse "APPTS: 1977 X; 1980 Y; 1981 Z..." → array of {year, raw}. */
function parseApptList(s: string): ApptHistory[] {
  const body = s.replace(/^APPTS:\s*/i, '');
  // Split on semicolons; each entry should start with a 4-digit year.
  const out: ApptHistory[] = [];
  for (const piece of body.split(/;\s*/)) {
    const p = piece.trim();
    if (!p) continue;
    const m = p.match(/^(\d{4})\s+(.+)$/);
    if (!m) continue;
    out.push({ year: Number(m[1]), raw: m[2].trim() });
  }
  return out;
}

// Pre-comma surname can be 1-3 capitalized words ("Mora Peña", "Lueg, Jr").
// Post-comma must be a capitalized first name. Disqualifies APPTS-bleed
// fragments like "District Superintendent, Southern District".
const STRICT_NAME_LINE_RE =
  /^([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2}),\s+([A-Z][A-Za-z'’.-]+)(.*)$/;

const STATUS_CODE_RE = /^[A-Z]{2,4}:\s*\d{4}/;

function parseRecords(text: string): ClergyRec[] {
  const lines = text.split('\n');

  // Identify record-start indices. We allow leading whitespace because
  // 2024-style PDFs ship the entire body indented; gate against junk
  // APPTS-bleed fragments by requiring a status-code line ("PM:/FE:/...")
  // within the next 6 lines.
  const starts: number[] = [];
  const NAME_NOISE_WORDS = /^(District|Pastor|Director|Chaplain|Assoc|Co-Pastor|Honorable|Leave|Retired|Sabbatical|Suspended|Faith|Texas|Rio|Hill|Coastal|Central|North|South|West|East|Capital|Las|El|United|Methodist|School|Conference|Center|Hospital|Department|Office|Board|Council|University|College|Seminary|Mission|Theological|Christian|First|Second|Third|Saint|St)\b/;
  const APPT_WORDS_RE = /\b(Conference|District|School|Center|Hospital|Seminary|University|Foundation|Council|Office|Board)\b/;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/^\s+/, '');
    if (!trimmed) continue;
    const m = trimmed.match(STRICT_NAME_LINE_RE);
    if (!m) continue;
    if (NAME_NOISE_WORDS.test(m[1])) continue;
    // Skip if the post-comma chunk reads like an APPTS phrase.
    const postComma = m[2] + ' ' + m[3].slice(0, 40);
    if (APPT_WORDS_RE.test(postComma)) continue;
    // Confirm via a status timeline either on the SAME line (2025 has
    // "Last, First Middle    PM: 1977; ...") or within the next 6 lines
    // (2024 puts the timeline on its own line below).
    let hasStatus = /\b[A-Z]{2,4}:\s*\d{4}/.test(trimmed);
    if (!hasStatus) {
      for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        const tj = lines[j].trim();
        if (STATUS_CODE_RE.test(tj) || /\b[A-Z]{2,4}:\s*\d{4}/.test(tj)) { hasStatus = true; break; }
      }
    }
    if (!hasStatus) continue;
    starts.push(i);
  }

  const recs: ClergyRec[] = [];
  for (let s = 0; s < starts.length; s++) {
    const startIdx = starts[s];
    const endIdx = s + 1 < starts.length ? starts[s + 1] : lines.length;

    const headLine = lines[startIdx].replace(/^\s+/, '');
    const nameMatch = headLine.match(STRICT_NAME_LINE_RE);
    if (!nameMatch) continue;
    const surname = nameMatch[1].trim();
    const firstAndAfter = (nameMatch[2] + nameMatch[3]).trim();
    const firstParts = firstAndAfter.split(/\s{2,}/);
    const firstChunk = firstParts[0].trim();
    let tailChunks = firstParts.slice(1).join('  ').trim();
    const canonical = `${surname}, ${firstChunk}`;
    // If the head-line tail is the status timeline (2025 format), strip
    // it from the currentAppt slot so we capture currentAppt from a
    // following line instead.
    let initialStatus = '';
    if (/^[A-Z]{2,4}:\s*\d{4}/.test(tailChunks) || / [A-Z]{2,4}:\s*\d{4}/.test(tailChunks)) {
      initialStatus = tailChunks;
      tailChunks = '';
    }

    // Walk the lines to find: status timeline, ED, APPTS, currentAppt.
    let statusLine = initialStatus;
    let currentAppt = tailChunks || null;
    let education: string | null = null;
    let apptRaw = '';
    let mode: 'none' | 'ed' | 'appts' = 'none';

    for (let i = startIdx + 1; i < endIdx; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const trimmed = line.trim();
      if (/Rio Texas Conference Journal|Clergy Records$|^I-\d+$|^\d+$/i.test(trimmed)) continue;

      // Status timeline: starts with PM:/FE:/etc.
      if (STATUS_CODE_RE.test(trimmed)) {
        statusLine += ' ' + trimmed;
        // Status often spans 2 lines; once we're seeing PM/FE codes, keep
        // accumulating until we hit ED/APPTS/blank.
        continue;
      }
      if (/^ED:/i.test(trimmed)) { mode = 'ed'; education = trimmed.replace(/^ED:\s*/i, ''); continue; }
      if (/^APPTS:/i.test(trimmed)) { mode = 'appts'; apptRaw = trimmed.replace(/^APPTS:\s*/i, ''); continue; }

      if (mode === 'ed') education = (education ?? '') + ' ' + trimmed;
      else if (mode === 'appts') apptRaw += ' ' + trimmed;
      else if (statusLine && /^[A-Z]{2,4}:\s*\d{4}/.test(trimmed)) {
        // continuation of status
        statusLine += ' ' + trimmed;
      }
      // Otherwise: probably a current-appt continuation line. If currentAppt
      // is null, capture this short line.
      else if (!currentAppt && trimmed.length < 60 && !/[;:]/.test(trimmed)) {
        currentAppt = trimmed;
      }
    }

    const statusHistory = parseStatusHistory(statusLine || tailChunks);
    const appts = parseApptList(apptRaw ? `APPTS: ${apptRaw}` : '');
    const educationEntries = education ? parseEducation(education.trim()) : [];

    recs.push({
      canonical,
      displayName: flipName(canonical),
      currentAppt,
      statusHistory,
      appts,
      education: education?.trim() ?? null,
      educationEntries,
      pdfPage: null,
    });
  }
  return recs;
}

/** Resolve a single APPTS-entry church text to a church_id, creating a
 *  closed-status row if the historical church isn't in our DB. */
async function resolveChurchForAppts(
  rawPart: string,
  churchByKey: Map<string, string>,
  db: ReturnType<typeof adminClient>,
): Promise<string | null> {
  const cleaned = rawPart.replace(/UMC$/i, '').trim();
  if (!cleaned || cleaned.length < 3) return null;
  // Reject non-church fragments that survived the upstream filter.
  if (/^(Leave|Retired|Sabbatical|Attend|School|Honorable|Suspended|Family|Personal|Transitional|Bishop|Ineligible|Asst\.|Mission)/i.test(cleaned)) return null;

  const transforms: Array<(s: string) => string> = [
    (s) => s,
    (s) => canonicalize(s),
    (s) => canonicalize(s).replace(/\s+UMC$/i, '').trim(),
    (s) => canonicalize(s).replace(/^V:/i, 'Victoria:'),
    (s) => canonicalize(s).replace(/^Mc:/i, 'McAllen:'),
    (s) => canonicalize(s).replace(/^MC:/, 'McAllen:'),
    (s) => canonicalize(s).replace(/^B:/, 'Brownsville:'),
    (s) => canonicalize(s).replace(/^P:/, 'Pharr:'),
    (s) => canonicalize(s).replace(/^L:/, 'Laredo:'),
    (s) => canonicalize(s).replace(/^E:/, 'Edinburg:'),
    // "X: First" (no UMC) — what we store
    (s) => canonicalize(s).replace(/UMC$/i, '').trim(),
    // strip ": First" suffix — sometimes the canonical_name is just the city
    (s) => canonicalize(s).replace(/\s+UMC$/i, '').replace(/:\s*First$/i, '').trim(),
    // append ": First" — sometimes the canonical_name needs it
    (s) => /:/.test(s) ? s : (canonicalize(s).replace(/UMC$/i, '').trim() + ': First'),
    // Normalize apostrophe on plural-possessive: "St. Lukes" → "St. Luke's"
    (s) => s.replace(/(St\.?\s+\w+)s\b/i, "$1's"),
    // Hyphen → colon: "Brownsville-First" → "Brownsville: First"
    (s) => s.replace(/^([A-Z][A-Za-z]+)-([A-Z])/, '$1: $2'),
  ];
  for (const t of transforms) {
    const v = t(cleaned).trim();
    const id = churchByKey.get(v.toLowerCase());
    if (id) return id;
  }
  // Suffix match: "Boerne: First" might be stored as just "Boerne".
  const lower = cleaned.toLowerCase();
  for (const [key, id] of churchByKey) {
    if (key.length < 5) continue;
    // either DB key endsWith ": " + lower, or lower endsWith ": " + DB key
    if (key.endsWith(': ' + lower) || lower.endsWith(': ' + key)) return id;
  }

  // Auto-create as closed church.
  const canonical = canonicalize(cleaned).replace(/\s+UMC$/i, '').trim();
  if (!canonical || canonical.length < 3) return null;
  if (/^[A-Z]{1,3}$/.test(canonical)) return null; // single abbreviation
  const city = canonical.includes(':') ? canonical.split(':')[0].trim() : canonical;
  const { data: ins, error } = await db.from('church')
    .insert({ canonical_name: canonical, city, status: 'closed' })
    .select('id')
    .single();
  if (error) return null;
  churchByKey.set(canonical.toLowerCase(), ins.id);
  return ins.id;
}

async function main() {
  const rawText = extractText();
  // 2024-style PDFs need column-unification + glyph repair before record parse.
  const text = sanitize(unifyColumns(rawText));
  const recs = parseRecords(text);
  console.log(`Parsed ${recs.length} clergy records from ${JOURNAL_YEAR}-clergy-record.pdf`);

  // Quick stats
  const withAppts = recs.filter((r) => r.appts.length > 0).length;
  const totalAppts = recs.reduce((s, r) => s + r.appts.length, 0);
  console.log(`  with APPTS: ${withAppts}, total APPTS entries: ${totalAppts}`);
  console.log(`  with status history: ${recs.filter((r) => r.statusHistory.length > 0).length}`);
  console.log(`  with current appt: ${recs.filter((r) => r.currentAppt).length}`);
  console.log('\nSample (first 3):');
  for (const r of recs.slice(0, 3)) {
    console.log(`  ${r.canonical}`);
    console.log(`    display: ${r.displayName}`);
    console.log(`    current: ${r.currentAppt}`);
    console.log(`    status: ${r.statusHistory.map((s) => `${s.code}:${s.year}`).join(', ')}`);
    console.log(`    appts:   ${r.appts.length} entries — ${r.appts.slice(0, 3).map((a) => `${a.year}:${a.raw.slice(0, 40)}`).join(' | ')}...`);
  }

  if (DRY) return;

  // ---- Match against existing clergy and apply ----
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

  const allClergy = await fetchAll<{ id: string; canonical_name: string; status: string }>(
    'clergy', 'id, canonical_name, status');
  const byKey = new Map<string, string>();
  function key(name: string): string {
    return name.replace(/[.,'’"]/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
  }
  for (const c of allClergy) byKey.set(key(c.canonical_name), c.id);

  const allChurches = await fetchAll<{ id: string; canonical_name: string }>(
    'church', 'id, canonical_name');
  const churchByKey = new Map<string, string>();
  for (const c of allChurches) churchByKey.set(c.canonical_name.toLowerCase(), c.id);

  let nameMatched = 0, nameCreated = 0, statusUpdated = 0;
  let apptsWritten = 0, apptsUnmatched = 0, apptsSkipped = 0;

  for (const r of recs) {
    // Match clergy by display name first, then by Last+First.
    let clergyId = byKey.get(key(r.displayName)) ?? null;
    if (!clergyId) {
      // Try first+last combination (drop middles).
      const tokens = r.displayName.split(/\s+/);
      if (tokens.length >= 2) {
        const fl = `${tokens[0]} ${tokens[tokens.length - 1]}`;
        clergyId = byKey.get(key(fl)) ?? null;
      }
    }
    if (!clergyId) {
      // Skip records whose displayName looks like an APPTS-list fragment
      // or a status timeline rather than a real person's name.
      if (
        /\[(RG|SWTX|RG-Hispanic)\]/i.test(r.displayName) ||
        /;\s*\d{4}\b/.test(r.displayName) ||
        /^[A-Z]{2,4}:\s*\d{4}/.test(r.displayName) ||
        r.displayName.includes(' Appt') ||
        r.displayName.length > 80
      ) {
        continue;
      }
      // Create new — likely a historical retiree never seen elsewhere.
      const { data: ins, error } = await db.from('clergy')
        .insert({ canonical_name: r.displayName, status: 'unknown' })
        .select('id').single();
      if (error) { console.error(`  ✗ create ${r.displayName}: ${error.message}`); continue; }
      clergyId = ins.id;
      byKey.set(key(r.displayName), clergyId);
      nameCreated++;
    } else {
      nameMatched++;
    }

    // Update status_history (and education_history if migration 0015 applied).
    const updates: Record<string, unknown> = {};
    if (r.statusHistory.length > 0) updates.status_history = r.statusHistory;
    if (r.educationEntries.length > 0) updates.education_history = r.educationEntries;
    if (Object.keys(updates).length > 0) {
      const { error } = await db.from('clergy').update(updates).eq('id', clergyId);
      if (error && /education_history/.test(error.message)) {
        // Migration 0015 not applied yet — fall back to status only.
        if (r.statusHistory.length > 0) {
          await db.from('clergy').update({ status_history: r.statusHistory }).eq('id', clergyId);
        }
      } else if (error) {
        console.error(`  ✗ ${r.displayName}: ${error.message}`);
      }
      statusUpdated++;
    }

    // Add the formal "Last, First" form as a clergy_alias.
    if (r.canonical !== r.displayName) {
      await db.from('clergy_alias').upsert(
        { clergy_id: clergyId, alias: r.canonical, journal_year: JOURNAL_YEAR },
        { onConflict: 'alias,journal_year', ignoreDuplicates: true },
      );
    }

    // Sort APPTS so we can compute years_at_appt = next.year - this.year.
    const apptsSorted = [...r.appts].sort((a, b) => a.year - b.year);

    // Write APPTS rows. Each (year, raw) entry becomes an appointment row
    // with journal_year=year and years_at_appt computed from the next entry.
    for (let ai = 0; ai < apptsSorted.length; ai++) {
      const a = apptsSorted[ai];
      const next = apptsSorted[ai + 1];
      const yearsAtAppt = next ? Math.max(1, next.year - a.year) : null;

      // Normalize whitespace (PDF text wraps with extra spaces / newlines).
      const normalized = a.raw.replace(/\s+/g, ' ').trim();

      // Skip non-church appointments.
      if (/^(Retired|Leave of Absence|Honorable Location|Sabbatical|Attend School|Attending School|In School|Incapacity|Medical Leave|Family Leave|No Salary Paying Unit|Suspended|Disability|Transitional Leave)/i.test(normalized)) {
        apptsSkipped++;
        continue;
      }
      // Skip clearly out-of-conference (mentions "Conference" or "Conf -" of another).
      if (/^(WI|TX|NIL|NWTX|NM|East TX|North TX|Central TX|West TX|Northwest TX|Southwest TX|Texas|Oklahoma|Missouri|Kansas|Indiana|Illinois|Louisiana|Arkansas|Florida|Mississippi|Alabama|Tennessee|Georgia|North Carolina|South Carolina|Virginia|Western|Upper|Lower|Great|New|LRA|Wisconsin|Oregon|Mexico|Puerto Rico)\b.*Conf/i.test(normalized)) {
        apptsSkipped++;
        continue;
      }
      // Skip pre-2015 Rio Grande Conference appointments (different conference
      // before the merger; they're tagged "[RG]" in the journal).
      if (/\[RG\]|\bRio Grande Appt\b/i.test(normalized)) {
        apptsSkipped++;
        continue;
      }
      // Skip placeholder rows.
      if (/^NO Appointment Name|GBGM|TBS|To Be Supplied/i.test(normalized)) {
        apptsSkipped++;
        continue;
      }
      // Strip leading role designators: "Assoc. Pastor, X" / "Co-Pastor, X" / etc.
      let bare = normalized
        .replace(/^Assoc(iate)?\.?\s*Pastor[s]?(\s*\(PT\))?,?\s*/i, '')
        .replace(/^Co-Pastor,?\s*/i, '')
        .replace(/^District\s+Superintendent,?\s*/i, '')
        .replace(/^Chaplain,?\s*/i, '')
        .replace(/^Exec\.?\s+Dir\.?,?\s*/i, '')
        .replace(/^Director.*?,\s*/i, '')
        .replace(/^Student\s+Local\s+Pastor,?\s*/i, '')
        .replace(/^Interim\s+Pastor,?\s*/i, '')
        .trim();
      // Multi-charge: split on " / "
      const parts = bare.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
      let matchedAny = false;
      for (const part of parts) {
        const churchId = await resolveChurchForAppts(part, churchByKey, db);
        if (!churchId) continue;
        // Skip if a row for this (clergy, church, year) already exists —
        // prefer richer F-section data (with role/status_code/years_at_appt)
        // over the bare-bones Section I row.
        const { data: existing } = await db.from('appointment')
          .select('id')
          .eq('clergy_id', clergyId).eq('church_id', churchId).eq('journal_year', a.year)
          .maybeSingle();
        if (existing) { matchedAny = true; continue; }
        const { error } = await db.from('appointment').insert({
          church_id: churchId,
          clergy_id: clergyId,
          journal_year: a.year,
          role: null,
          status_code: null,
          years_at_appt: yearsAtAppt,
          fraction: null,
          source_pdf_page: null,
        });
        if (error) continue;
        apptsWritten++;
        matchedAny = true;
      }
      if (!matchedAny) apptsUnmatched++;
    }
  }

  console.log(`\nNames: matched=${nameMatched}, created=${nameCreated}`);
  console.log(`Status histories updated: ${statusUpdated}`);
  console.log(`Appointments: written=${apptsWritten}, unmatched=${apptsUnmatched}, skipped (non-church)=${apptsSkipped}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
