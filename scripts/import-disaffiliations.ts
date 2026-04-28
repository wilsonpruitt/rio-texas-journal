/**
 * Mark churches as disaffiliated based on the Rio TX UMC Disaffiliation
 * spreadsheet. Lawsuit-status churches are also treated as disaffiliated
 * per the conference's classification.
 *
 * Pre-step (one-time, paste into terminal):
 *   python3 -c "
 *   import openpyxl, json
 *   wb = openpyxl.load_workbook('/Users/wilsonpruitt/Downloads/Rio TX UMC Disaffiliation.xlsx', data_only=True)
 *   ws = wb['Disaffiliated']
 *   rows = list(ws.iter_rows(values_only=True))
 *   hdr = [h for h in rows[0] if h]
 *   data = [{hdr[i].strip(): r[i] for i in range(len(hdr))} for r in rows[1:] if r[0]]
 *   json.dump(data, open('/tmp/disaff.json','w'), default=str)
 *   "
 *
 * Then:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-disaffiliations.ts
 */

import { readFileSync } from 'node:fs';
import { adminClient } from './parsers/era_b/lib/db.ts';
import { canonicalize } from './parsers/era_b/lib/names.ts';

const JSON_PATH = '/tmp/disaff.json';

type Row = Record<string, string | null>;

const DISTRICT_HINTS: Record<string, string> = {
  HC: 'Hill Country',
  LM: 'Las Misiones',
  W: 'West',
  Ca: 'Capital',
  Cap: 'Capital',
  CB: 'Coastal Bend',
  EV: 'El Valle',
  CR: 'Crossroads',
};

function parseName(raw: string): { cores: string[]; districtHint: string | null } {
  // Strip date-annotation suffix ("--May 21" or "—May 21").
  let work = raw.replace(/\s*[—-]+\s*[A-Z][a-z]+\s+\d+\s*$/, '').trim();
  // Trailing "(XX)" district hint.
  const m = work.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const districtHint = m ? DISTRICT_HINTS[m[2].trim()] ?? m[2].trim() : null;
  if (m) work = m[1].trim();
  // Hyphen format is ambiguous — could be City-Church or Church-City.
  // Generate BOTH orderings as candidates and let the lookup figure it out.
  const cores: string[] = [work];
  const hyphen = work.match(/^([^-:]+)-([A-Za-z .'’]+)$/);
  if (hyphen) {
    const a = hyphen[1].trim();
    const b = hyphen[2].trim();
    cores.push(`${a}: ${b}`);
    cores.push(`${b}: ${a}`);
  }
  // Also handle the case where the colon got dropped: "Rio Grande City St John"
  // → "Rio Grande City: St John".
  const tokens = work.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    cores.push(tokens.slice(0, i).join(' ') + ': ' + tokens.slice(i).join(' '));
  }
  return { cores, districtHint };
}

function nameCandidates(rawName: string): string[] {
  const { cores, districtHint } = parseName(rawName);
  void districtHint;
  const cands = new Set<string>();
  const transforms = [
    (s: string) => s,
    (s: string) => s.replace(/\s+UMC$/i, '').trim(),
    (s: string) => /:/.test(s) ? s : (s + ': First'),
    (s: string) => s.replace(/^Sang:/i, 'San Angelo:'),
    (s: string) => s.replace(/^SAng:/i, 'San Angelo:'),
    (s: string) => s.replace(/^SAnt:/i, 'San Antonio:'),
    (s: string) => s.replace(/^CC:/i, 'Corpus Christi:'),
    (s: string) => s.replace(/^NB:/i, 'New Braunfels:'),
    (s: string) => s.replace(/^MC:/i, 'McAllen:'),
    (s: string) => s,
  ];
  for (const core of cores) {
    cands.add(core);
    cands.add(canonicalize(core));
    for (const t1 of transforms) for (const t2 of transforms) {
      const v = canonicalize(t2(t1(core))).trim();
      if (v) cands.add(v);
    }
  }
  return Array.from(cands).filter((c) => c.length > 0);
}

async function main() {
  const rows: Row[] = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  // Filter rows: skip STAY summary lines and empty-reason rows.
  const targets = rows.filter((r) => {
    const reason = (r['REASON ON LIST'] || '').trim();
    if (!reason) return false;
    if (reason.startsWith('STAY')) return false;
    return true;
  });
  console.log(`disaffiliation rows: ${targets.length}`);

  const db = adminClient();
  const { data: allChurches } = await db.from('church').select('id, canonical_name, status');
  const byName = new Map(allChurches!.map((c: any) => [c.canonical_name.toLowerCase(), c]));

  let matched = 0;
  let alreadyDisaff = 0;
  const unmatched: { name: string; reason: string; tried: string[] }[] = [];
  const updates: { id: string; from: string; to: string; voteDate: string | null }[] = [];

  for (const r of targets) {
    const name = (r['Name'] || '').trim();
    const reason = (r['REASON ON LIST'] || '').trim();
    const voteDateRaw = r['AC Vote Date '] || null;
    const cands = nameCandidates(name);
    let hit: any = null;
    for (const c of cands) {
      const m = byName.get(c.toLowerCase());
      if (m) { hit = m; break; }
    }
    if (!hit) {
      // Suffix match.
      for (const c of cands) {
        if (c.length < 5) continue;
        const lower = c.toLowerCase();
        const fEndsJ = allChurches!.filter((ch: any) => {
          const j = ch.canonical_name.toLowerCase();
          return j.length >= 5 && (lower.endsWith(': ' + j) || lower.endsWith(' ' + j));
        });
        if (fEndsJ.length === 1) { hit = fEndsJ[0]; break; }
        const jEndsF = allChurches!.filter((ch: any) => ch.canonical_name.toLowerCase().endsWith(': ' + lower));
        if (jEndsF.length === 1) { hit = jEndsF[0]; break; }
      }
    }
    if (!hit) {
      unmatched.push({ name, reason, tried: cands.slice(0, 6) });
      continue;
    }
    matched++;
    if (hit.status === 'disaffiliated') alreadyDisaff++;
    updates.push({
      id: hit.id,
      from: hit.canonical_name,
      to: 'disaffiliated',
      voteDate: voteDateRaw ? String(voteDateRaw).slice(0, 10) : null,
    });
  }

  console.log(`matched: ${matched} (${alreadyDisaff} already disaffiliated)`);
  console.log(`unmatched: ${unmatched.length}`);

  // Apply updates
  for (const u of updates) {
    const closed_year = u.voteDate ? Number(u.voteDate.slice(0, 4)) : null;
    const { error } = await db.from('church').update({
      status: 'disaffiliated',
      ...(closed_year ? { closed_year } : {}),
    }).eq('id', u.id);
    if (error) { console.error(`  ✗ ${u.from}: ${error.message}`); continue; }
  }
  console.log(`updated ${updates.length} churches → disaffiliated`);

  if (unmatched.length) {
    console.log('\n--- Unmatched (need manual review) ---');
    for (const u of unmatched) {
      console.log(`  "${u.name}" [${u.reason}]  tried: ${u.tried.slice(0, 3).join(' | ')}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
