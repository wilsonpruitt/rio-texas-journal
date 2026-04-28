/**
 * Parse Section F Appointments (Era B / 2025 journal).
 *
 * Section F lists, per district, every active appointment with the pastor's
 * name, years at appointment, status code, optional half-time fraction,
 * mailing address, and phone. Page range PDF 119–128 covers CE / NO / SO.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/parsers/era_b/parse-appointments.ts
 */

import { execFileSync } from 'node:child_process';
import { adminClient } from './lib/db.ts';
import { canonicalize } from './lib/names.ts';

const PDF_PATH =
  process.env.RTXJ_PDF_2025 ||
  '/Users/wilsonpruitt/Downloads/2025+Rio+TX+Journal+Web+Updated.pdf';

const FIRST_PAGE = 119;
const LAST_PAGE = 128;
const JOURNAL_YEAR = 2025;
const SOURCE_SECTION = 'F';
const PARSER_VERSION = 'era_b_v1';

// Pastor pattern: "Name (Years) STATUS [optional fraction]"
const PASTOR_RE = /^(.*?)\s*\((\d+)\)\s*([A-Z]{2,4})(?:\s*\[(\d+\/\d+)\])?$/;
// Tolerant variant: accept "(N/M)" round-bracket fractions and "N/M]" stripped brackets.
const PASTOR_LOOSE_RE = /^(.*?)\s*\((\d+)\)\s*([A-Z]{2,4})\s*[\[(]?(\d+\/\d+)[\])]?$/;
const ASSOC_SPLIT_RE = /Assoc[.:]\s*Pastor[s]?,?\s*/gi;

const DISTRICT_BY_LABEL: Record<string, string> = {
  'CENTRAL DISTRICT': 'CE',
  'NORTH DISTRICT': 'NO',
  'SOUTH DISTRICT': 'SO',
};

type RawRecord = {
  district: string;
  pdfPage: number;
  appointment: string;
  pastor: string;
  address: string;
  phone: string;
};

type PastorEntry = {
  name: string;
  years: number;
  statusCode: string;
  fraction: string | null;
  role: string; // 'Senior Pastor' | 'Associate Pastor' | 'Superintendent'
};

function extractText(first: number, last: number): string {
  return execFileSync(
    'pdftotext',
    ['-layout', '-nopgbrk', '-f', String(first), '-l', String(last), PDF_PATH, '-'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

function isHeaderLine(line: string): boolean {
  if (/^\s*Appointment\s+Name\s+\(Years\s+at/.test(line)) return true;
  if (/Appointment\)\s*Status\s*$/.test(line)) return true;
  if (/^\s*Rio Texas Conference Journal/.test(line)) return true;
  return false;
}

function extractRecords(): RawRecord[] {
  const text = extractText(FIRST_PAGE, LAST_PAGE);
  const lines = text.split('\n');

  // Bucket by page footer.
  const buckets: string[][] = [[]];
  for (const line of lines) {
    buckets[buckets.length - 1].push(line);
    if (/Rio Texas Conference Journal 2025/.test(line)) buckets.push([]);
  }

  let recs: RawRecord[] = [];
  let curDistrict = 'CE';

  for (let b = 0; b < buckets.length; b++) {
    const pageLines = buckets[b];
    const pdfPage = FIRST_PAGE + b;
    const headerLine = pageLines.find((l) => /Appointment\s+Name/.test(l));
    if (!headerLine) continue;
    const nameC = headerLine.indexOf('Name');
    const addrC = headerLine.indexOf('Address');
    const phoneC = headerLine.indexOf('Phone');

    let cur: RawRecord | null = null;
    for (const line of pageLines) {
      if (!line.trim()) continue;
      const trimmed = line.trim();
      if (DISTRICT_BY_LABEL[trimmed]) {
        if (cur) { recs.push(cur); cur = null; }
        curDistrict = DISTRICT_BY_LABEL[trimmed];
        continue;
      }
      if (isHeaderLine(line)) continue;
      const c1 = line.slice(0, nameC).trim();
      const c2 = line.slice(nameC, addrC).trim();
      const c3 = line.slice(addrC, phoneC).trim();
      const c4 = line.slice(phoneC).trim();
      // NEW record: c1 (church) has content AND one of:
      //   - c4 has a phone (most common signal)
      //   - c2 contains a "(N)" years-at-appointment marker (a fresh pastor entry)
      //   - c2 starts with a vacancy marker ("To Be Supplied" / "TBA")
      // All other lines with c1 content are multi-line church name continuations.
      const c2HasYears = /\(\d+\)/.test(c2);
      const c2IsAssoc = /^Assoc[.:]\s*Pastor/i.test(c2);
      const c2IsVacant = /^(To Be Supplied|TBA)\b/i.test(c2);
      const isNew =
        c1.length > 0 &&
        (c4.length > 0 || (c2HasYears && !c2IsAssoc) || c2IsVacant);
      if (isNew) {
        if (cur) recs.push(cur);
        cur = { district: curDistrict, pdfPage, appointment: c1, pastor: c2, address: c3, phone: c4 };
      } else if (cur) {
        if (c1) cur.appointment = (cur.appointment + ' ' + c1).trim();
        if (c2) cur.pastor      = (cur.pastor      + ' ' + c2).trim();
        if (c3) cur.address     = (cur.address     + ' ' + c3).trim();
        if (c4) cur.phone       = (cur.phone       + ' ' + c4).trim();
      }
    }
    if (cur) recs.push(cur);
  }

  // Salvage step: if a record's appointment+next-record's-appointment together
  // look like a single multi-line church name (e.g. "Floresville: El" + "Mesias"
  // → "Floresville: El Mesias"), merge them. Heuristic: prior appt is short
  // and ends with no terminal ", UMC, or punctuation; next appt is short and
  // looks like a fragment (lowercase, single word, or contains "UMC").
  const salvageMerged: RawRecord[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const next = recs[i + 1];
    const couldBeFragment =
      next &&
      next.district === r.district &&
      r.appointment.length < 30 &&
      !/UMC$/i.test(r.appointment) &&
      !/[.,)]\s*$/.test(r.appointment) &&
      next.appointment.length < 30 &&
      // Next appt either lowercase first word, or the conventional "Mesias / UMC / Hills UMC" wrap pattern.
      (/^[a-z]/.test(next.appointment) || /UMC/i.test(next.appointment) || /^[A-Z][a-zé]+$/.test(next.appointment)) &&
      // And prior pastor must lack a complete pattern (no status code) — confirms it's a wrap.
      !PASTOR_RE.test(r.pastor) && !PASTOR_LOOSE_RE.test(r.pastor);
    if (couldBeFragment) {
      const mergedRec: RawRecord = {
        district: r.district,
        pdfPage: r.pdfPage,
        appointment: (r.appointment + ' ' + next.appointment).trim(),
        pastor: (r.pastor + ' ' + next.pastor).trim(),
        address: (r.address + ' ' + next.address).trim(),
        phone: (r.phone + ' ' + next.phone).trim(),
      };
      salvageMerged.push(mergedRec);
      i++; // consumed the next record
    } else {
      salvageMerged.push(r);
    }
  }
  recs = salvageMerged;

  // Merge stranded continuation rows. A continuation has:
  //   - no phone (real records on continuation pages may also lack phone, but
  //     combined with the other signals this is reliable enough), AND
  //   - short or empty pastor (length < 30 — excludes a fresh "Name (N) STATUS"), AND
  //   - address that doesn't look like a NEW address (no leading digit or
  //     "PO Box" — those indicate a fresh address).
  const merged: RawRecord[] = [];
  for (const r of recs) {
    const last = merged[merged.length - 1];
    const looksLikeFreshAddress = /^(\d|PO Box|P\.O\. Box)/i.test(r.address);
    const isCont =
      last &&
      last.district === r.district &&
      !r.phone &&
      r.pastor.length < 30 &&
      !looksLikeFreshAddress;
    if (isCont) {
      last.appointment = (last.appointment + ' ' + r.appointment).trim();
      last.pastor      = (last.pastor      + ' ' + r.pastor).trim();
      last.address     = (last.address     + ' ' + r.address).trim();
      last.phone       = (last.phone       + ' ' + r.phone).trim();
    } else {
      merged.push(r);
    }
  }
  return merged;
}

function parsePastorSegment(seg: string, role: string): PastorEntry | null {
  let m = seg.match(PASTOR_RE);
  if (!m) m = seg.match(PASTOR_LOOSE_RE);
  if (!m) return null;
  return {
    name: m[1].trim(),
    years: Number(m[2]),
    statusCode: m[3],
    fraction: m[4] || null,
    role,
  };
}

function parsePastorField(pastor: string): PastorEntry[] {
  const parts = pastor.split(ASSOC_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  const out: PastorEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const role = i === 0 ? 'Senior Pastor' : 'Associate Pastor';
    // Some "Assoc. Pastors" sub-segments contain MULTIPLE pastor entries
    // separated by line breaks (collapsed to spaces). Split on each
    // "(N) STATUS [frac]" boundary and try parsing each piece.
    const pieces = splitMultiPastor(parts[i]);
    for (const p of pieces) {
      const entry = parsePastorSegment(p, role);
      if (entry) out.push(entry);
    }
  }
  return out;
}

/**
 * "Linda Baumheckel (2) RE [3/4] Chris Estus (4) PL [1/4]" → split on each
 * "(N) STATUS [frac]?" suffix to get individual pastor entries.
 */
function splitMultiPastor(s: string): string[] {
  const re = /[^()]*?\(\d+\)\s*[A-Z]{2,4}(?:\s*\[\d+\/\d+\])?/g;
  const matches = s.match(re);
  if (!matches || matches.length === 0) return [s.trim()];
  return matches.map((m) => m.trim());
}

function isVacant(pastor: string): boolean {
  const t = pastor.trim();
  return /^(To Be Supplied|TBA)$/i.test(t);
}

function isSuperintendent(appointment: string): boolean {
  return /\b(?:Central|North|South)\s+District\s+Superintendent\b/i.test(appointment);
}

function isConferenceLevel(appointment: string): boolean {
  return /^(Rio Texas|RTC)\b/i.test(appointment.trim());
}

/** Try to map a Section F appointment name to an existing church. */
async function resolveChurch(
  db: ReturnType<typeof adminClient>,
  rawName: string,
  allChurches: { id: string; canonical_name: string }[],
): Promise<string | null> {
  const candidates = nameCandidates(rawName);

  // Exact matches against canonical_name first.
  const byName = new Map(allChurches.map((c) => [c.canonical_name.toLowerCase(), c.id]));
  for (const c of candidates) {
    const id = byName.get(c.toLowerCase());
    if (id) return id;
  }

  // Alias table.
  for (const c of candidates) {
    const { data } = await db.from('church_alias').select('church_id').eq('alias', c).maybeSingle();
    if (data) return data.church_id;
  }

  // Suffix match in BOTH directions.
  // (a) F drops city prefix ("Bethania" → J "Dilley: Bethania"): J endsWith F.
  // (b) F adds city prefix ("Canyon Lake: North Shore" → J "North Shore"): F endsWith J.
  for (const c of candidates) {
    if (c.length < 5) continue;
    const lower = c.toLowerCase();
    const fEndsWithJ = allChurches.filter((ch) => {
      const j = ch.canonical_name.toLowerCase();
      return j.length >= 5 && (lower.endsWith(': ' + j) || lower.endsWith(' ' + j));
    });
    if (fEndsWithJ.length === 1) return fEndsWithJ[0].id;
    const jEndsWithF = allChurches.filter((ch) => {
      const j = ch.canonical_name.toLowerCase();
      return j.endsWith(': ' + lower) || j.endsWith(' ' + lower);
    });
    if (jEndsWithF.length === 1) return jEndsWithF[0].id;
  }

  return null;
}

function nameCandidates(rawName: string): string[] {
  const base = canonicalize(rawName).trim();
  const cands = new Set<string>([base]);

  // Apply each variant through a series of normalizations.
  const transforms: ((s: string) => string)[] = [
    (s) => s,
    (s) => s.replace(/\s+UMC$/i, '').trim(),
    // Append ": First" — F often drops it (e.g. "Yoakum" → "Yoakum: First").
    (s) => /:/.test(s) ? s : (s.replace(/\s+UMC$/i, '').trim() + ': First'),
    // Strip ": First" — F has "Boerne: First UMC", J has "Boerne".
    (s) => s.replace(/\s+UMC$/i, '').replace(/:\s*First$/i, '').trim(),
    // Apostrophe variants: curly ' (’) ↔ straight '.
    (s) => s.replace(/’/g, "'"),
    (s) => s.replace(/'/g, '’'),
    // Lockhart: St. Mark → Lockhart: St. Mark's
    (s) => /:\s*St\.\s+\w+$/.test(s) ? s + "'s" : s,
    // City-prefix abbreviation typos / variants.
    (s) => s.replace(/^Sang:/i, 'SAng:'),
    (s) => s.replace(/^Sant:/i, 'SAnt:'),
    (s) => s.replace(/^MC:/, 'McAllen:'),
    // SAng → San Angelo, SAnt → San Antonio, CC → Corpus Christi, NB → New Braunfels
    (s) => s.replace(/^SAng:/i, 'San Angelo:'),
    (s) => s.replace(/^SAnt:/i, 'San Antonio:'),
    (s) => s.replace(/^CC:/i, 'Corpus Christi:'),
    (s) => s.replace(/^NB:/i, 'New Braunfels:'),
    // Spaced city forms used in J data.
    (s) => s.replace(/^LaGrange:/i, 'La Grange:'),
    // Hyphen → colon (Comfort-Gaddis → Comfort: Gaddis).
    (s) => s.replace(/^([A-Z][a-z]+)-([A-Z])/, '$1: $2'),
    // Drop "El "/"Los "/"La " articles inside the name part.
    (s) => s.replace(/:\s*El\s+/i, ': '),
    // Saint variants
    (s) => s.replace(/\bSaint\b/g, 'St.'),
    // "es" → "Es" capitalization fix in Spanish names.
    (s) => s.replace(/\bes\s+Amor\b/i, 'Es Amor'),
    // Trailing "* Federated Church" annotation.
    (s) => s.replace(/\*\s*Federated Church$/i, '').trim(),
  ];

  for (const t1 of transforms) {
    for (const t2 of transforms) {
      const v = t2(t1(base)).trim();
      if (v) cands.add(v);
    }
  }

  return Array.from(cands).filter((c) => c.length > 0);
}

async function upsertClergy(
  db: ReturnType<typeof adminClient>,
  rawName: string,
): Promise<string> {
  const canonical = rawName.trim().replace(/\s+/g, ' ');
  const { data: existing } = await db.from('clergy').select('id').eq('canonical_name', canonical).maybeSingle();
  if (existing) return existing.id;
  const { data: ins, error } = await db.from('clergy').insert({ canonical_name: canonical }).select('id').single();
  if (error) throw error;
  return ins.id;
}

async function recordChurchAlias(
  db: ReturnType<typeof adminClient>,
  churchId: string,
  alias: string,
): Promise<void> {
  const { error } = await db.from('church_alias').upsert(
    { church_id: churchId, alias, source_section: SOURCE_SECTION, journal_year: JOURNAL_YEAR },
    { onConflict: 'alias,journal_year,source_section', ignoreDuplicates: true },
  );
  if (error) throw error;
}

async function main() {
  const db = adminClient();
  const recs = extractRecords();
  console.log(`Extracted ${recs.length} raw records`);

  // Probe whether the church.mailing_address column exists (migration 0012).
  // If not, skip church contact updates so we can still write appointments.
  const probe = await db.from('church').select('mailing_address').limit(1);
  const canUpdateContact = !probe.error;
  if (!canUpdateContact) {
    console.log(
      '⚠ church.mailing_address missing — skipping contact updates. ' +
        'Apply migration 0012 and re-run to backfill address/phone.',
    );
  }

  const { data: run, error: runErr } = await db
    .from('ingest_run')
    .insert({
      journal_year: JOURNAL_YEAR,
      section: 'F:Appointments',
      parser_version: PARSER_VERSION,
      notes: `pages=${FIRST_PAGE}-${LAST_PAGE}`,
    })
    .select('id')
    .single();
  if (runErr) throw runErr;

  // Load all churches once for fast in-memory matching.
  const { data: allChurches, error: chErr } = await db.from('church').select('id, canonical_name');
  if (chErr) throw chErr;

  let appointmentsWritten = 0;
  let churchUpdates = 0;
  let unmatchedChurches = 0;
  let parseFailures = 0;
  let skipped = 0;
  const unmatchedNames: string[] = [];

  try {
    for (const r of recs) {
      // Skip family-leave / extension / out-of-conference / litigation rows up-front.
      if (isSuperintendent(r.appointment)) {
        skipped++;
        continue;
      }
      if (isConferenceLevel(r.appointment)) {
        // Not church-bound; defer until we have a non-church appointment model.
        skipped++;
        continue;
      }

      // Multi-charge: "Yancey UMC / Devine UMC" — one pastor across 2 churches.
      const churchNames = r.appointment.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);

      // Resolve every church
      const churchIds: { name: string; id: string | null }[] = [];
      for (const name of churchNames) {
        const id = await resolveChurch(db, name, allChurches!);
        churchIds.push({ name, id });
        if (!id) {
          unmatchedChurches++;
          unmatchedNames.push(`${r.district}: "${name}"`);
        }
      }

      // Update church contact fields (mailing_address, phone) and record alias.
      for (let idx = 0; idx < churchIds.length; idx++) {
        const { id } = churchIds[idx];
        if (!id) continue;
        if (canUpdateContact) {
          const updates: Record<string, string | null> = {};
          if (r.address) updates.mailing_address = r.address;
          if (r.phone) updates.phone = r.phone;
          if (Object.keys(updates).length > 0) {
            const { error } = await db.from('church').update(updates).eq('id', id);
            if (error) throw error;
            churchUpdates++;
          }
        }
        const fName = canonicalize(churchNames[idx]);
        await recordChurchAlias(db, id, fName);
      }

      // Vacant — no clergy/appointment to write.
      if (isVacant(r.pastor)) continue;

      // Parse pastor entries
      const entries = parsePastorField(r.pastor);
      if (entries.length === 0) {
        parseFailures++;
        console.error(`  ✗ parse fail: ${r.district} p${r.pdfPage} appt="${r.appointment}" pastor="${r.pastor}"`);
        continue;
      }

      // Write appointment per (church, pastor) pair
      for (const entry of entries) {
        const clergyId = await upsertClergy(db, entry.name);
        for (const { id: churchId } of churchIds) {
          if (!churchId) continue;
          const { error } = await db.from('appointment').insert({
            church_id: churchId,
            clergy_id: clergyId,
            journal_year: JOURNAL_YEAR,
            role: entry.role,
            status_code: entry.statusCode,
            years_at_appt: entry.years,
            fraction: entry.fraction,
            source_pdf_page: r.pdfPage,
          });
          if (error) throw error;
          appointmentsWritten++;
        }
      }
    }
  } finally {
    await db
      .from('ingest_run')
      .update({
        finished_at: new Date().toISOString(),
        rows_written: appointmentsWritten,
        error_count: parseFailures + unmatchedChurches,
        notes:
          `pages=${FIRST_PAGE}-${LAST_PAGE} ` +
          `appts=${appointmentsWritten} churchUpdates=${churchUpdates} ` +
          `unmatched=${unmatchedChurches} parseFails=${parseFailures} skipped=${skipped}`,
      })
      .eq('id', run.id);
  }

  console.log(
    `Done. appointments=${appointmentsWritten} churchUpdates=${churchUpdates} ` +
      `unmatched=${unmatchedChurches} parseFails=${parseFailures} skipped=${skipped}`,
  );
  if (unmatchedNames.length) {
    console.log('\nUnmatched church names:');
    for (const n of unmatchedNames) console.log('  ', n);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
