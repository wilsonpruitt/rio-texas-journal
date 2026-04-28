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

function parseEducation(raw: string): EducationEntry[] {
  const body = raw.replace(/^ED:\s*/i, '');
  const out: EducationEntry[] = [];
  for (const piece of body.split(/;\s*/)) {
    const p = piece.trim();
    if (!p) continue;
    // Try to split into institution + degree. The degree is usually the
    // trailing 1-3 capitalized/abbreviated tokens (M.Div, BA, D.Min, M.Th).
    const m = p.match(/^(.*?)\s+([BMD][\w. ]+?|Ph\.?D\.?|J\.?D\.?|D\.?Min\.?|M\.?Div\.?|M\.?A\.?|B\.?A\.?|B\.?S\.?|M\.?S\.?|M\.?Th\.?|D\.?D\.?|MDiv|DMin|DMA|MTS)$/i);
    let institution = p;
    let degree = '';
    if (m) {
      institution = m[1].trim();
      degree = m[2].trim();
    }
    // Normalize institution to a canonical short label when possible.
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
  return execFileSync('/usr/local/bin/pdftotext',
    ['-layout', '-nopgbrk', PDF_FILE, '-'],
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

function parseRecords(text: string): ClergyRec[] {
  const lines = text.split('\n');
  // Identify record-start indices: lines beginning at column 0 with "Last, First Middle".
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(NAME_LINE_RE);
    // Must NOT start with whitespace.
    if (!m) continue;
    if (lines[i][0] === ' ' || lines[i][0] === '\t') continue;
    starts.push(i);
  }
  const recs: ClergyRec[] = [];
  for (let s = 0; s < starts.length; s++) {
    const startIdx = starts[s];
    const endIdx = s + 1 < starts.length ? starts[s + 1] : lines.length;
    // Skip blocks that look too short (likely false-positive name matches).
    if (endIdx - startIdx < 1) continue;

    const headLine = lines[startIdx];
    const nameMatch = headLine.match(NAME_LINE_RE);
    if (!nameMatch) continue;
    const canonical = `${nameMatch[1].trim()}, ${nameMatch[2].split(/\s{2,}/)[0].trim()}`;

    // The right column of the head line typically starts the status history.
    const headRightCol = headLine.split(/\s{2,}/).slice(1).join('  ');
    let statusHistRaw = headRightCol;

    // Concatenate following lines until the next record. Capture:
    //   - second line indented = "  Current Appt" or "  Retired" or status
    //   - middle/right column may have ED:, APPTS:, or status continuation
    let currentAppt: string | null = null;
    let education: string | null = null;
    let apptRaw = '';
    let mode: 'status' | 'ed' | 'appts' | null = 'status';

    for (let i = startIdx + 1; i < endIdx; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      // Skip page footer / header lines.
      if (/Rio Texas Conference Journal|Clergy Records$|^I-\d+$|^\d+$/i.test(line.trim())) continue;
      // The "current appointment" line is the first indented line whose
      // content is short and isn't an ED:/APPTS: block.
      const left = line.slice(0, 28).trim();
      const right = line.slice(28).trim();
      if (currentAppt === null && left && !/^(ED|APPTS):/i.test(right) && !/^(ED|APPTS):/i.test(left)) {
        currentAppt = left;
      }
      // Detect ED: / APPTS: anywhere on the line.
      const fullStripped = line.trim();
      if (/^ED:/i.test(fullStripped) || /^ED:/i.test(right)) { mode = 'ed'; }
      if (/^APPTS:/i.test(fullStripped) || /^APPTS:/i.test(right)) { mode = 'appts'; }
      if (mode === 'status') statusHistRaw += ' ' + right;
      else if (mode === 'ed') education = (education ?? '') + ' ' + (right || fullStripped);
      else if (mode === 'appts') apptRaw += ' ' + (right || fullStripped);
    }

    const statusHistory = parseStatusHistory(statusHistRaw);
    const appts = parseApptList(apptRaw);
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

async function main() {
  const text = extractText();
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

    // Write APPTS rows. Each (year, raw) entry becomes an appointment row
    // with journal_year=year + role/status_code/years_at_appt = null.
    for (const a of r.appts) {
      // Skip non-church appointments.
      if (/^(Retired|Leave of Absence|Honorable Location|Sabbatical|Attend School|Attending School|In School|Incapacity|Medical Leave|Family Leave|No Salary Paying Unit|Suspended|Disability)/i.test(a.raw)) {
        apptsSkipped++;
        continue;
      }
      // Skip clearly out-of-conference (mentions "Conference" or "Conf -" of another).
      if (/^(WI|TX|NIL|NWTX|NM|East TX|North TX|Central TX|West TX|Northwest TX|Southwest TX|Texas|Oklahoma|Missouri|Kansas|Indiana|Illinois|Louisiana|Arkansas|Florida|Mississippi|Alabama|Tennessee|Georgia|North Carolina|South Carolina|Virginia|Western|Upper|Lower|Great|New)\b.*Conf/i.test(a.raw)) {
        apptsSkipped++;
        continue;
      }
      // Strip leading role designator: "Assoc. Pastor, X" / "Co-Pastor, X" / "District Superintendent, X".
      let bare = a.raw
        .replace(/^Assoc(iate)?\.?\s*Pastor[s]?(\s*\(PT\))?,\s*/i, '')
        .replace(/^Co-Pastor,\s*/i, '')
        .replace(/^District\s+Superintendent,?\s*/i, '')
        .replace(/^Chaplain,\s*/i, '')
        .replace(/^Exec\.?\s+Dir\.?,?\s*/i, '')
        .replace(/^Director.*?,\s*/i, '')
        .replace(/^Student\s+Local\s+Pastor,?\s*/i, '')
        .replace(/UMC$/i, '')
        .trim();
      // Multi-charge: split on " / "
      const parts = bare.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
      let matchedAny = false;
      for (const part of parts) {
        const candidates = [
          part,
          canonicalize(part),
          canonicalize(part).replace(/\s+UMC$/i, '').trim(),
        ].filter(Boolean);
        let churchId: string | null = null;
        for (const c of candidates) {
          const id = churchByKey.get(c.toLowerCase());
          if (id) { churchId = id; break; }
        }
        if (!churchId) continue;
        // Insert appointment row.
        const { error } = await db.from('appointment').insert({
          church_id: churchId,
          clergy_id: clergyId,
          journal_year: a.year,
          role: null,
          status_code: null,
          years_at_appt: null,
          fraction: null,
          source_pdf_page: null,
        });
        if (error) {
          // Likely duplicate (church_id, clergy_id, journal_year) — ignore.
          continue;
        }
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
