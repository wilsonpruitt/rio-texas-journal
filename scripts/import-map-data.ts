/**
 * Import lat/long + address from Rio_Texas_Map_Data_Audit.xlsx (dumped to JSON).
 *
 * Pre-step (one-time):
 *   python3 -c "import openpyxl, json; \
 *     wb = openpyxl.load_workbook('/Users/wilsonpruitt/Downloads/Rio_Texas_Map_Data_Audit.xlsx', data_only=True); \
 *     ws = wb['All Churches']; \
 *     rows = list(ws.iter_rows(values_only=True)); \
 *     hdr = rows[0]; \
 *     out = [dict(zip(hdr, r)) for r in rows[1:] if r[1]]; \
 *     json.dump(out, open('/tmp/rtx-map.json','w'), default=str)"
 *
 * Then:
 *   node --env-file=.env.local --experimental-strip-types scripts/import-map-data.ts
 *
 * Updates church.lat, church.lng, church.city for matched rows. Updates
 * church.mailing_address only if migration 0012 has been applied.
 */

import { readFileSync } from 'node:fs';
import { adminClient } from './parsers/era_b/lib/db.ts';
import { canonicalize } from './parsers/era_b/lib/names.ts';

const JSON_PATH = '/tmp/rtx-map.json';
const SOURCE_LABEL = 'map-audit';

type MapRow = {
  '#': number;
  'Church Name': string;
  'City/Town': string;
  'County': string;
  'Address': string;
  'District': string;
  'Latitude': number;
  'Longitude': number;
};

const DISTRICT_CODE: Record<string, string> = {
  'Central District': 'CE',
  'North District': 'NO',
  'South District': 'SO',
};

function nameCandidates(row: MapRow): string[] {
  const name = (row['Church Name'] || '').trim();
  const city = (row['City/Town'] || '').trim();
  const cands = new Set<string>();

  // Strip trailing " UMC" (and trailing-city suffix like "First UMC Laredo").
  const cityRe = new RegExp(`\\s+UMC\\s+${city}$`, 'i');
  let core = name.replace(cityRe, '').replace(/\s+UMC$/i, '').trim();
  // Also strip trailing 2-letter "city abbr" (e.g. "Bethany UMC SA" → "Bethany").
  core = core.replace(/\s+UMC\s+[A-Z]{2,3}$/i, '').trim();

  // Bare core
  cands.add(core);
  cands.add(name);
  // City: Core
  if (city && core) cands.add(`${city}: ${core}`);
  // City alone (matches J one-word names like "Boerne")
  if (city) {
    cands.add(city);
    // J often has "Sinton: First", "Bishop: First". Only add this candidate
    // when the bare core actually fits — name is "First" alone, or core==city
    // (e.g. "Bishop UMC" / "Bishop" → "Bishop: First"). Otherwise, this would
    // wrongly swallow rows like "William Taylor UMC" / "Luling".
    if (/^First$/i.test(core) || core.toLowerCase() === city.toLowerCase()) {
      cands.add(`${city}: First`);
    }
  }
  // Apostrophe variants ("Evans Chapel" → "Evan's Chapel")
  if (core) {
    cands.add(core.replace(/(\w)s\s+(Chapel|Memorial)/i, "$1's $2"));
    cands.add(core.replace(/St Mark/i, "St. Mark's"));
    cands.add(core.replace(/St Marks/i, "St. Mark's"));
    cands.add(core.replace(/^William Taylor$/i, 'Wm Taylor'));
    cands.add(core.replace(/^Richardson Chapel$/i, 'Richardson-Brown Chapel'));
  }
  // Apply canonicalize transforms (Saint, prefix expansions).
  for (const c of Array.from(cands)) cands.add(canonicalize(c));

  return Array.from(cands).filter((c) => c.length > 0);
}

async function main() {
  const rows: MapRow[] = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  console.log(`Loaded ${rows.length} map rows`);

  const db = adminClient();

  const probe = await db.from('church').select('mailing_address').limit(1);
  const canUpdateAddress = !probe.error;
  console.log(canUpdateAddress
    ? '✓ migration 0012 applied — will update mailing_address'
    : '⚠ migration 0012 not applied — will skip mailing_address');

  const { data: allChurches, error } = await db.from('church').select('id, canonical_name, city');
  if (error) throw error;
  const byName = new Map(allChurches!.map((c) => [c.canonical_name.toLowerCase(), c]));

  let matched = 0, updated = 0, unmatched: { row: MapRow; tried: string[] }[] = [];

  for (const row of rows) {
    const cands = nameCandidates(row);
    let hit: { id: string; canonical_name: string } | null = null;

    // Exact canonical match.
    for (const c of cands) {
      const m = byName.get(c.toLowerCase());
      if (m) { hit = m; break; }
    }
    // Alias table.
    if (!hit) {
      for (const c of cands) {
        const { data } = await db.from('church_alias').select('church_id, church!inner(id, canonical_name)').eq('alias', c).maybeSingle();
        if (data) { hit = data.church as any; break; }
      }
    }
    // Suffix match in both directions, with city as tiebreaker.
    if (!hit) {
      const cityLower = (row['City/Town'] || '').toLowerCase();
      for (const c of cands) {
        if (c.length < 5) continue;
        const lower = c.toLowerCase();
        const fEndsJ = allChurches!.filter((ch) => {
          const j = ch.canonical_name.toLowerCase();
          return j.length >= 5 && (lower.endsWith(': ' + j) || lower.endsWith(' ' + j));
        });
        if (fEndsJ.length === 1) { hit = fEndsJ[0]; break; }
        const jEndsF = allChurches!.filter((ch) => ch.canonical_name.toLowerCase().endsWith(': ' + lower));
        if (jEndsF.length === 1) { hit = jEndsF[0]; break; }
        // Multi-match: tiebreaker by city prefix on canonical_name.
        if (jEndsF.length > 1) {
          const cityHit = jEndsF.filter((ch) => ch.canonical_name.toLowerCase().startsWith(cityLower + ':'));
          if (cityHit.length === 1) { hit = cityHit[0]; break; }
        }
      }
    }

    if (!hit) {
      // Not in J — create a new church record. These are typically recent
      // plants, multi-cultural ministries, or pre-J churches.
      const canonical = row['City/Town']
        ? `${row['City/Town']}: ${(row['Church Name'] || '').replace(/\s+UMC$/i, '').trim()}`
        : (row['Church Name'] || '').trim();
      const { data: ins, error: insErr } = await db.from('church')
        .insert({ canonical_name: canonical, city: row['City/Town'] || null })
        .select('id, canonical_name')
        .single();
      if (insErr) throw insErr;
      hit = { id: ins.id, canonical_name: ins.canonical_name };
      unmatched.push({ row, tried: cands });
      console.log(`  + created: "${canonical}"`);
    }
    matched++;

    const updates: Record<string, unknown> = {
      lat: row.Latitude,
      lng: row.Longitude,
    };
    if (row['City/Town']) updates.city = row['City/Town'];
    if (canUpdateAddress && row.Address) updates.mailing_address = row.Address;

    const { error: upErr } = await db.from('church').update(updates).eq('id', hit.id);
    if (upErr) throw upErr;
    updated++;

    // Record the xlsx church-name as an alias if it differs.
    if (row['Church Name'] && row['Church Name'] !== hit.canonical_name) {
      await db.from('church_alias').upsert(
        { church_id: hit.id, alias: row['Church Name'], source_section: SOURCE_LABEL, journal_year: 2025 },
        { onConflict: 'alias,journal_year,source_section', ignoreDuplicates: true },
      );
    }
  }

  console.log(`\nMatched: ${matched}/${rows.length}, updated: ${updated}, unmatched: ${unmatched.length}`);
  if (unmatched.length) {
    console.log('\n--- Unmatched ---');
    for (const u of unmatched) {
      console.log(`  ${u.row['District']}: "${u.row['Church Name']}" / "${u.row['City/Town']}"`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
