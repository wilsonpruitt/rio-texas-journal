/**
 * Mark clergy as status='extension_ministry' when their current
 * appointment text clearly indicates extension ministry (chaplain,
 * agency, seminary, university, foundation, etc.) rather than a
 * local-church appointment.
 *
 * Heuristic source: the most recent appointment row's role/raw text,
 * or — if no appointment row exists — the latest APPTS entry from the
 * clergy record (status_history is the wrong source; APPTS is right).
 *
 * We only reclassify clergy currently in 'active' or 'unknown' status.
 * Retired/withdrawn/etc. are left alone — extension ministry is an
 * active classification.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-extension-ministry.ts [--dry]
 */
import { adminClient } from './parsers/era_b/lib/db.ts';

const DRY = process.argv.includes('--dry');
const db = adminClient();

// Keywords that strongly indicate extension ministry. Tested against the
// most recent appointment text (role + church canonical_name) and against
// the latest APPTS raw entry.
const EXTENSION_PATTERNS: RegExp[] = [
  /\bchaplain\b/i,
  /\bhealthcare\s+system\b/i,
  /\bmethodist\s+healthcare\b/i,
  /\bmethodist\s+hospital\b/i,
  /\bmethodist\s+home\b/i,
  /\bmethodist\s+children'?s?\s+home\b/i,
  /\bschool\s+of\s+theology\b/i,
  /\bdivinity\s+school\b/i,
  /\b(perkins|candler|asbury|duke|drew|garrett|iliff|wesley\s+theological|saint\s+paul|princeton|yale|boston\s+university|austin\s+presbyterian)\b/i,
  /\bgeneral\s+board\b/i,
  /\bglobal\s+ministries\b/i,
  /\bdiscipleship\s+ministries\b/i,
  /\bumcor\b/i,
  /\bfoundation\b/i,
  /\bwesley\s+community\b/i,
  /\bwesley\s+nurse\b/i,
  /\bwesley\s+(community\s+)?center\b/i,
  /\bcampus\s+ministry\b/i,
  /\b(university|college)\b/i,
  /\bextension\s+ministr/i,
  /\battend\s+school\b/i,           // student appointments
  /\b(pastoral\s+counsel|private\s+practice\s+counsel)/i,
  /\bnon-?conference\s+appointment\b/i,
  /\bbishop\b/i,
  /\bmsnry\b|\bmissionary\b/i,
  /\bbeyond\s+the\s+local\s+church\b/i,
];

function looksExtension(text: string | null | undefined): boolean {
  if (!text) return false;
  // Don't fire on local-church names that happen to contain "Foundation"
  // when the canonical pattern is "City: Foundation UMC". Heuristic:
  // skip if the text starts with "Last-name City: " pattern AND contains
  // ": " followed by something that looks like a church name. We're
  // intentionally simple here — false positives for review.
  return EXTENSION_PATTERNS.some((re) => re.test(text));
}

type ClergyRow = {
  id: string;
  canonical_name: string;
  status: string;
  status_history: { code: string; year: number }[] | null;
};

const all: ClergyRow[] = [];
let from = 0;
while (true) {
  const { data, error } = await db
    .from('clergy')
    .select('id, canonical_name, status, status_history')
    .in('status', ['active', 'unknown'])
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all.push(...((data ?? []) as ClergyRow[]));
  if (!data || data.length < 1000) break;
  from += 1000;
}
console.log(`Active+unknown clergy: ${all.length}`);

// Pull most-recent appointment row per clergy (role + church name).
const apptByClergy = new Map<string, { role: string | null; church_name: string | null; status_code: string | null; year: number; raw: string | null }>();
{
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('appointment')
      .select('clergy_id, role, status_code, journal_year, church:church_id(canonical_name)')
      .order('journal_year', { ascending: false })
      .range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    for (const row of (data ?? []) as any[]) {
      if (!apptByClergy.has(row.clergy_id)) {
        apptByClergy.set(row.clergy_id, {
          role: row.role ?? null,
          church_name: row.church?.canonical_name ?? null,
          status_code: row.status_code ?? null,
          year: row.journal_year,
          raw: row.raw_text ?? null,
        });
      }
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

// Also fetch latest APPTS-history entry per clergy from clergy_apptment_history.
// We don't have a dedicated table — APPTS were written into the appointment
// table when church matched, otherwise dropped. The clergy.education_history
// jsonb column is unrelated; we only have the parsed-but-unmatched APPTS as
// log output. So the best fallback signal is the parsed name itself: if the
// clergy was created during 2015 import and has no appointment row, their
// status was probably set from their *currentAppt* line — which we don't
// store either. Skip the fallback for now; report unmatched separately.

let candidates = 0;
let updated = 0;
let noAppt = 0;
for (const c of all) {
  const appt = apptByClergy.get(c.id);
  if (!appt) { noAppt++; continue; }
  // A "City: Name" church name marks a real local church (e.g. "Austin:
  // University", "Bishop: El Redentor") — don't probe it for extension
  // keywords. Only the auto-created closed-row names like "Methodist
  // Healthcare System" lack a colon and indicate extension placement.
  const churchProbe = appt.church_name && !/^[^:]+:\s/.test(appt.church_name) ? appt.church_name : null;
  const probe = [appt.role, churchProbe].filter(Boolean).join(' | ');
  if (!probe) continue;
  if (!looksExtension(probe)) continue;
  candidates++;
  console.log(`  ${c.canonical_name}: ${c.status} → extension_ministry  [${probe}]`);
  if (DRY) continue;
  const { error } = await db.from('clergy').update({ status: 'extension_ministry' }).eq('id', c.id);
  if (error) { console.error(`    ERROR: ${error.message}`); continue; }
  updated++;
}
console.log(`\nExtension-ministry candidates: ${candidates}, updated: ${updated}${DRY ? ' (dry)' : ''}`);
console.log(`Active+unknown clergy with NO appointment row: ${noAppt} (skipped — no signal)`);
