/**
 * Era A district parser. Walks every sub-table on every page of one
 * district's range and writes church_stat + district_history rows for
 * a given journal year. Pastor names from the Membership table are
 * recorded as clergy aliases (the F-section is authoritative for
 * appointment data, so we don't synthesize appointments here).
 *
 * Usage:
 *   RTXJ_YEAR=2024 node --env-file=.env.local --experimental-strip-types \
 *     scripts/parsers/era_a/parse-district.ts CA 480 487
 */

import { findSubTables, sliceRow, parseNumeric, type SlicedRow, type SubTable } from './lib/columns.ts';
import { extractPages, splitPages } from '../era_b/lib/pdf.ts';
import { adminClient } from '../era_b/lib/db.ts';
import { canonicalize } from '../era_b/lib/names.ts';

const VALID_DISTRICTS = ['CA', 'CB', 'CR', 'EV', 'HC', 'LM', 'WS'] as const;
type DistrictCode = (typeof VALID_DISTRICTS)[number];

const PARSER_VERSION = 'era_a_v1';
const SOURCE_SECTION = 'J';

type Stat = {
  field_code: string;
  value_numeric: number | null;
  value_text: string | null;
  source_pdf_page: number;
  parser_version: string;
  confidence: 'ok' | 'needs_review' | 'non_reported';
};

type ChurchAccum = {
  rawName: string;
  pastorName: string;
  pdfPages: Set<number>;
  stats: Map<string, Stat>;
};

function isSkipRow(line: string, name: string): boolean {
  if (!name) return true;
  if (/^TOTALS?\b/i.test(name) || /^[A-Z][A-Z\s]+TOTAL/i.test(name)) return true;
  // Section banner / district label rows.
  if (/^[A-Z]{2,3}$/.test(name.trim())) return true;
  if (/^STATISTICS\s*$/i.test(name.trim())) return true;
  if (/^(Capital|Coastal Bend|Crossroads|El Valle|Hill Country|Las Misiones|West)\s+District\s*$/i.test(name.trim())) return true;
  if (/Rio Texas Conference Journal/i.test(line)) return true;
  // Numeric-only "names" (page numbers leaked through).
  if (/^\d+$/.test(name.trim())) return true;
  return false;
}

async function resolveChurch(
  db: ReturnType<typeof adminClient>,
  rawName: string,
  allChurches: { id: string; canonical_name: string }[],
): Promise<string | null> {
  const cands = nameCandidates(rawName);
  const byName = new Map(allChurches.map((c) => [c.canonical_name.toLowerCase(), c.id]));
  for (const c of cands) {
    const id = byName.get(c.toLowerCase());
    if (id) return id;
  }
  // Alias table.
  for (const c of cands) {
    const { data } = await db.from('church_alias').select('church_id').eq('alias', c).maybeSingle();
    if (data) return data.church_id;
  }
  // Suffix match (both directions).
  for (const c of cands) {
    if (c.length < 5) continue;
    const lower = c.toLowerCase();
    const fEndsJ = allChurches.filter((ch) => {
      const j = ch.canonical_name.toLowerCase();
      return j.length >= 5 && (lower.endsWith(': ' + j) || lower.endsWith(' ' + j));
    });
    if (fEndsJ.length === 1) return fEndsJ[0].id;
    const jEndsF = allChurches.filter((ch) => ch.canonical_name.toLowerCase().endsWith(': ' + lower));
    if (jEndsF.length === 1) return jEndsF[0].id;
  }
  return null;
}

function nameCandidates(rawName: string): string[] {
  const base = canonicalize(rawName).trim();
  const cands = new Set<string>([base]);
  const transforms: ((s: string) => string)[] = [
    (s) => s,
    (s) => s.replace(/\s+UMC$/i, '').trim(),
    (s) => /:/.test(s) ? s : (s + ': First'),
    (s) => s.replace(/\s+UMC$/i, '').replace(/:\s*First$/i, '').trim(),
    (s) => s.replace(/^Sang:/i, 'San Angelo:'),
    (s) => s.replace(/^SAng:/i, 'San Angelo:'),
    (s) => s.replace(/^Sant:/i, 'San Antonio:'),
    (s) => s.replace(/^SAnt:/i, 'San Antonio:'),
    (s) => s.replace(/^CC:/i, 'Corpus Christi:'),
    (s) => s.replace(/^NB:/i, 'New Braunfels:'),
    (s) => s.replace(/’/g, "'"),
    (s) => s.replace(/'/g, '’'),
  ];
  for (const t1 of transforms) for (const t2 of transforms) {
    const v = t2(t1(base)).trim();
    if (v) cands.add(v);
  }
  return Array.from(cands).filter((c) => c.length > 0);
}

/** A pastor-name string is "junk" if it looks like an APPTS list fragment
 *  or a status timeline rather than a real person's name. These came from
 *  pastor-column misalignments in older Era A J-section parses. */
function isJunkClergyName(n: string): boolean {
  if (!n) return true;
  if (/\[(RG|SWTX|RG-Hispanic)\]/i.test(n)) return true;
  if (/;\s*\d{4}\b/.test(n)) return true;
  if (/^[A-Z]{2,4}:\s*\d{4}/.test(n)) return true;
  if (/^(McAllen|SAng|SAnt|CC|NB|MC):\s/.test(n)) return true;
  if (n.includes(' Appt')) return true;
  if (n.length > 80) return true;
  return false;
}

async function upsertClergy(
  db: ReturnType<typeof adminClient>,
  rawName: string,
): Promise<string | null> {
  const canonical = rawName.replace(/^Rev\.?\s+/i, '').replace(/\s+/g, ' ').trim();
  if (!canonical) return null;
  if (isJunkClergyName(canonical)) return null;
  const { data: existing } = await db.from('clergy').select('id').eq('canonical_name', canonical).maybeSingle();
  if (existing) return existing.id;
  // Default new clergy from J-section to 'unknown' — only the F-section
  // appointments authoritatively establish current 'active' status.
  const { data: ins, error } = await db.from('clergy').insert({ canonical_name: canonical, status: 'unknown' }).select('id').single();
  if (error) throw error;
  return ins.id;
}

async function main() {
  const [districtCode, firstStr, lastStr] = process.argv.slice(2);
  if (!VALID_DISTRICTS.includes(districtCode as DistrictCode)) {
    console.error(`Usage: <script> <${VALID_DISTRICTS.join('|')}> <firstPage> <lastPage>`);
    console.error(`       RTXJ_YEAR=2024 (defaults to 2024)`);
    process.exit(1);
  }
  const firstPage = Number(firstStr);
  const lastPage = Number(lastStr);
  const journalYear = Number(process.env.RTXJ_YEAR ?? '2024');
  const dataYear = journalYear - 1;

  console.log(`Era A: district=${districtCode} pages=${firstPage}-${lastPage} journal=${journalYear} data=${dataYear}`);

  const db = adminClient();
  const { data: allChurches, error: chErr } = await db.from('church').select('id, canonical_name');
  if (chErr) throw chErr;

  // Pre-load known stat_field codes so we can auto-create any new ones we
  // encounter (older Era A years use codes like 9a/9b/10a/etc. that the
  // 2025 seed didn't include).
  const { data: knownFields } = await db.from('stat_field').select('code');
  const knownCodes = new Set((knownFields ?? []).map((r: { code: string }) => r.code));

  const { data: run, error: runErr } = await db
    .from('ingest_run')
    .insert({
      journal_year: journalYear,
      section: `J:Era-A`,
      parser_version: PARSER_VERSION,
      notes: `district=${districtCode} pages=${firstPage}-${lastPage}`,
    })
    .select('id')
    .single();
  if (runErr) throw runErr;

  // Some years (notably 2021) embed C0 control chars in numeric tokens —
  // strip them so column detection and row slicing work consistently.
  const text = extractPages(firstPage, lastPage, journalYear)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  const pages = splitPages(text, journalYear);

  // Accumulate per-church stats across all pages of the district.
  const churches = new Map<string, ChurchAccum>();

  let totalRows = 0;
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageText = pages[pIdx];
    if (!pageText.trim()) continue;
    const pdfPage = firstPage + pIdx;
    const subTables = findSubTables(pageText);
    if (subTables.length === 0) continue;
    const lines = pageText.split('\n');

    for (const sub of subTables) {
      for (let li = sub.rowsStart; li < sub.rowsEnd; li++) {
        const line = lines[li];
        if (!line.trim()) continue;
        const sliced = sliceRow(line, sub);
        if (!sliced) continue;
        if (isSkipRow(line, sliced.church)) continue;

        let acc = churches.get(sliced.church);
        if (!acc) {
          acc = { rawName: sliced.church, pastorName: sliced.pastor, pdfPages: new Set(), stats: new Map() };
          churches.set(sliced.church, acc);
        }
        // Prefer a non-empty pastor name when one shows up in any sub-table row.
        if (!acc.pastorName && sliced.pastor) acc.pastorName = sliced.pastor;
        acc.pdfPages.add(pdfPage);
        for (const [code, raw] of Object.entries(sliced.values)) {
          const num = parseNumeric(raw);
          const hasValue = raw !== '' && raw !== '-';
          acc.stats.set(code, {
            field_code: code,
            value_numeric: num,
            value_text: hasValue && num === null ? raw : null,
            source_pdf_page: pdfPage,
            parser_version: PARSER_VERSION,
            confidence: hasValue ? 'ok' : 'non_reported',
          });
        }
        totalRows++;
      }
    }
  }

  console.log(`Found ${churches.size} unique churches, ${totalRows} row reads`);

  let appliedChurches = 0;
  let unmatched: string[] = [];
  let statsWritten = 0;
  let dhWritten = 0;
  let clergyAliases = 0;

  let createdChurches = 0;
  for (const acc of churches.values()) {
    let churchId = await resolveChurch(db, acc.rawName, allChurches!);
    if (!churchId) {
      // Likely a church that closed or disaffiliated before 2025. Create
      // with the conservative 'closed' status; disaffiliations can be
      // promoted manually once the source is verified.
      const canonical = canonicalize(acc.rawName).trim();
      const city = canonical.includes(':') ? canonical.split(':')[0].trim() : canonical;
      const { data: ins, error: insErr } = await db.from('church')
        .insert({ canonical_name: canonical, city, status: 'closed' })
        .select('id, canonical_name')
        .single();
      if (insErr) {
        // Likely a uniqueness collision from a near-duplicate name.
        unmatched.push(`${acc.rawName} (insert failed: ${insErr.message})`);
        continue;
      }
      churchId = ins.id;
      allChurches!.push({ id: ins.id, canonical_name: ins.canonical_name });
      createdChurches++;
      unmatched.push(`${acc.rawName} → created`);
    }
    appliedChurches++;

    // Add the Era A name as an alias
    await db.from('church_alias').upsert(
      { church_id: churchId, alias: acc.rawName, source_section: SOURCE_SECTION, journal_year: journalYear },
      { onConflict: 'alias,journal_year,source_section', ignoreDuplicates: true },
    );

    // district_history
    const { error: dhErr } = await db.from('district_history').upsert(
      { church_id: churchId, data_year: dataYear, district_code: districtCode },
      { onConflict: 'church_id,data_year' },
    );
    if (dhErr) throw dhErr;
    dhWritten++;

    // Pastor name → clergy alias (no appointment row — F section handles those)
    if (acc.pastorName) {
      const clergyId = await upsertClergy(db, acc.pastorName);
      if (clergyId) {
        await db.from('clergy_alias').upsert(
          { clergy_id: clergyId, alias: acc.pastorName, journal_year: journalYear },
          { onConflict: 'alias,journal_year', ignoreDuplicates: true },
        );
        clergyAliases++;
      }
    }

    // Auto-create any unknown stat_field codes encountered.
    for (const s of acc.stats.values()) {
      if (knownCodes.has(s.field_code)) continue;
      const { error: fErr } = await db.from('stat_field').upsert({
        code: s.field_code,
        label_en: `Field ${s.field_code} (auto)`,
        category: 'other',
        unit: /^\d+[a-z]?$/.test(s.field_code) && Number(s.field_code.replace(/[a-z]$/, '')) >= 24 ? 'usd' : 'count',
        first_seen_year: dataYear,
      }, { onConflict: 'code', ignoreDuplicates: true });
      if (fErr) throw fErr;
      knownCodes.add(s.field_code);
    }

    // Stat rows
    const statRows = Array.from(acc.stats.values()).map((s) => ({
      church_id: churchId,
      data_year: dataYear,
      journal_year: journalYear,
      field_code: s.field_code,
      value_numeric: s.value_numeric,
      value_text: s.value_text,
      source_pdf_page: s.source_pdf_page,
      parser_version: s.parser_version,
      confidence: s.confidence,
    }));
    if (statRows.length > 0) {
      const { error: statErr } = await db.from('church_stat').upsert(statRows, {
        onConflict: 'church_id,data_year,field_code',
      });
      if (statErr) throw statErr;
      statsWritten += statRows.length;
    }
  }

  await db.from('ingest_run').update({
    finished_at: new Date().toISOString(),
    rows_written: statsWritten,
    error_count: unmatched.length,
    notes: `district=${districtCode} appliedChurches=${appliedChurches} unmatched=${unmatched.length} stats=${statsWritten} dh=${dhWritten} clergyAliases=${clergyAliases}`,
  }).eq('id', run.id);

  console.log(`Done. churches=${appliedChurches} (created ${createdChurches}) stats=${statsWritten} dh=${dhWritten} clergyAliases=${clergyAliases} unmatched=${unmatched.length}`);
  if (unmatched.length) {
    console.log('Unmatched:');
    for (const u of unmatched) console.log(`  "${u}"`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
