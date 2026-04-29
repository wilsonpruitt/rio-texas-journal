/**
 * Detect and merge parser-mangled clergy duplicates.
 *
 * Earlier parser bugs occasionally captured a clergyperson's appointment
 * text into their canonical_name field, producing rows like:
 *   - "Aaron A. Methodist Healthcare Ministries Gonzalez"
 *   - "John Abner, III Lee"           (Roman-numeral suffix mid-name)
 *   - "Daniel F Director, lumberg Memorial Library Flores"
 *   - "Jeana LeAnn Pastoral Counseling, Pilgrims Martin"
 *   - "Ray Jose h Altman"             (lowercase fragment from PDF kerning)
 *
 * For each mangled row, a "clean" sibling (same surname + same first
 * name) usually exists. We detect collisions by (surname-token, first-
 * name-token), score each candidate's "cleanness," and propose merging
 * the dirty rows into the clean one.
 *
 * Merge action:
 *   - move appointment rows from dirty.id → clean.id
 *   - union dirty.status_history into clean.status_history
 *   - union dirty.education_history into clean.education_history
 *   - if clean has no status set but dirty does, copy the dirty status
 *   - delete the dirty clergy row
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/dedup-mangled-clergy.ts [--dry]
 */
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const db = adminClient();

type Clergy = {
  id: string;
  canonical_name: string;
  status: string;
  status_history: { code: string; year: number }[] | null;
  education_history: any[] | null;
};

function normTok(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, '').trim();
}

// Higher score = "dirtier" / more likely a parser artifact.
//
// Mid-name Jr/Sr/II/III suffixes ALONE are NOT a merge signal — they may
// indicate distinct generations (father/son sharing every other name).
// We only flag a row as mangled if it has unambiguous parser-noise:
// lowercase word fragments, or appointment-text vocabulary words.
function manglednessScore(name: string): number {
  let score = 0;
  // Lowercase mid-word fragments like " h ", " lumberg", " ay " — PDF
  // glyph corruption that the OCR couldn't reassemble.
  const lowerFrag = /(?:^|\s)([a-z]{1,3})(?=\s|$)/.test(name);
  if (lowerFrag) score += 4;
  // Appointment-text vocabulary that crept into a name field.
  const apptVocab = /\b(Pastoral|Counseling|Library|Director|Ministries|Healthcare|Hospital|Foundation|Memorial|System|Conference|Chaplain|Cha\s*lain|Methodist|Center|Hospice|Service|Assoc\.?\s*Pastor|Senior\s*Pastor|Sant|UMC|Umc|Congregational|Tension|Spring\s*Creek)\b/i.test(name);
  if (apptVocab) score += 5;
  // Status-code timeline embedded in name (e.g. "PM: 1969; FE: 1971;")
  if (/\b[A-Z]{2,4}:\s*\d{4}/.test(name)) score += 6;
  // Bare CONF REL code mid-name (e.g. "Valerie FE Great Plains Nagel")
  // — a 2-letter all-caps token sandwiched between two capitalized words
  // is almost always a parser smear. Excludes initials like "Aaron A.
  // Gonzalez" (one cap letter + period).
  if (/(?:^|\s)(FE|FD|PE|PD|FL|PL|RE|RD|RL|RA|RP|OE|OD|OF|OR|AM|AF|SY|PM|TO|TI|HN|HR|HL)\s+[A-Z][a-z]/.test(name)) score += 4;
  return score;
}

// Heuristic: does this look like a real person name? A merge keeper that
// fails this gets skipped — we don't want to consolidate dirty rows into
// another dirty row.
function looksLikePersonName(name: string): boolean {
  if (/[:()]/.test(name)) return false;                          // church-name format
  if (/\b[A-Z]{2,4}:\s*\d{4}/.test(name)) return false;          // status timeline
  if (/\b(Pastor|Conference|Ministry|Healthcare|UMC|Umc|Methodist|Foundation|Hospice|System|Assoc\.?)\b/.test(name)) return false;
  if (/(?:^|\s)(FE|FD|PE|PD|FL|PL|RE|RD|RL|RA|RP|OE|OD|OF|OR|AM|SY|PM)\s+[A-Z][a-z]/.test(name)) return false;
  return true;
}

const all: Clergy[] = [];
{
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('clergy')
      .select('id, canonical_name, status, status_history, education_history')
      .range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    all.push(...((data ?? []) as Clergy[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}
console.log(`Loaded ${all.length} clergy`);

// Group by (surname-token, first-name-token).
type Group = Clergy[];
const groups = new Map<string, Group>();
for (const c of all) {
  const tokens = c.canonical_name.trim().split(/\s+/).map(normTok).filter(Boolean);
  if (tokens.length < 2) continue;
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  const key = `${last}|${first}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(c);
}

const proposals: { clean: Clergy; dirty: Clergy[] }[] = [];
for (const [key, members] of groups) {
  if (members.length < 2) continue;
  // Score each. The lowest-scored member is the "clean" one.
  const scored = members.map((m) => ({ m, score: manglednessScore(m.canonical_name) })).sort((a, b) => a.score - b.score);
  const clean = scored[0].m;
  const dirty = scored.slice(1).filter((s) => s.score >= 4).map((s) => s.m);
  if (dirty.length === 0) continue;
  // Sanity: only merge when the clean candidate is meaningfully cleaner
  // AND looks like a real person name (not a partial-parse stub).
  if (scored[0].score >= 4) continue;
  if (!looksLikePersonName(clean.canonical_name)) continue;
  proposals.push({ clean, dirty });
}

console.log(`\nFound ${proposals.length} merge candidates:\n`);
for (const p of proposals) {
  console.log(`  KEEP  ${p.clean.canonical_name.padEnd(50)} [${p.clean.status}]  id=${p.clean.id.slice(0, 8)}`);
  for (const d of p.dirty) {
    console.log(`  MERGE ${d.canonical_name.padEnd(50)} [${d.status}]  id=${d.id.slice(0, 8)}`);
  }
  console.log();
}

if (DRY) {
  console.log(`Total dirty rows that would be merged & deleted: ${proposals.reduce((s, p) => s + p.dirty.length, 0)}`);
  process.exit(0);
}

let merged = 0;
let apptsMoved = 0;
for (const p of proposals) {
  for (const d of p.dirty) {
    // Move appointments. Some rows will conflict with the unique
    // (clergy_id, church_id, journal_year) index because the SAME
    // appointment is already attributed to both clergy rows — in that
    // case the dirty row's appointment is redundant, so just delete it.
    const { data: dirtyAppts } = await db
      .from('appointment')
      .select('id, church_id, journal_year')
      .eq('clergy_id', d.id);
    for (const a of (dirtyAppts ?? []) as any[]) {
      const { error: eMove } = await db
        .from('appointment')
        .update({ clergy_id: p.clean.id })
        .eq('id', a.id);
      if (eMove) {
        // Conflict → drop the duplicate.
        const { error: eDel } = await db.from('appointment').delete().eq('id', a.id);
        if (eDel) { console.error(`  appt delete ERROR for ${d.canonical_name}: ${eDel.message}`); }
      } else {
        apptsMoved++;
      }
    }

    // Union status_history
    const cleanHist = p.clean.status_history ?? [];
    const dirtyHist = d.status_history ?? [];
    const seen = new Set(cleanHist.map((h) => `${h.code}:${h.year}`));
    const mergedHist = [...cleanHist];
    for (const h of dirtyHist) {
      const k = `${h.code}:${h.year}`;
      if (!seen.has(k)) { mergedHist.push(h); seen.add(k); }
    }
    mergedHist.sort((a, b) => a.year - b.year);

    // Union education_history
    const cleanEdu = p.clean.education_history ?? [];
    const dirtyEdu = d.education_history ?? [];
    const eduSeen = new Set(cleanEdu.map((e: any) => e.raw ?? JSON.stringify(e)));
    const mergedEdu = [...cleanEdu];
    for (const e of dirtyEdu) {
      const k = (e as any).raw ?? JSON.stringify(e);
      if (!eduSeen.has(k)) { mergedEdu.push(e); eduSeen.add(k); }
    }

    // Pick best status: prefer non-unknown
    const cleanStatusIsKnown = p.clean.status !== 'unknown';
    const dirtyStatusIsKnown = d.status !== 'unknown';
    const finalStatus = cleanStatusIsKnown ? p.clean.status : (dirtyStatusIsKnown ? d.status : 'unknown');

    const { error: e2 } = await db.from('clergy').update({
      status_history: mergedHist,
      education_history: mergedEdu,
      status: finalStatus,
    }).eq('id', p.clean.id);
    if (e2) { console.error(`  update ERROR for ${p.clean.canonical_name}: ${e2.message}`); continue; }

    // Delete dirty row
    const { error: e3 } = await db.from('clergy').delete().eq('id', d.id);
    if (e3) { console.error(`  delete ERROR for ${d.canonical_name}: ${e3.message}`); continue; }

    // Update p.clean for subsequent dirty merges in the same group
    p.clean.status_history = mergedHist;
    p.clean.education_history = mergedEdu;
    p.clean.status = finalStatus;

    merged++;
  }
}

console.log(`\nMerged & deleted: ${merged} dirty rows. Appointments re-parented: ${apptsMoved}.`);
