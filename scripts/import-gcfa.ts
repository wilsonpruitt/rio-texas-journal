/**
 * Phase 2 importer — loads the GCFA local-church statistical dataset (2000-2024)
 * extracted by scripts/data/extract_gcfa.py into Supabase as the authoritative
 * church-level source (source='gcfa').
 *
 * Order:
 *   A. upsert stat_field   from gcfa/fields.json     (218 fields; FK coverage for stats)
 *   B. upsert church       from gcfa/churches.json   (485; keyed by gcfa_number,
 *                          attaching to existing rows by normalized name where possible)
 *   C. insert church_stat  from gcfa/church_stats.jsonl (~1.08M rows, batched, re-runnable)
 *
 * Run (after migration 0019 is applied):
 *   node --env-file=.env.local --experimental-strip-types scripts/import-gcfa.ts [--dry]
 *        [--fields-only] [--churches-only] [--stats-only]
 */
import { createReadStream } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { adminClient } from './parsers/era_b/lib/db.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry');
const ONLY = {
  fields: process.argv.includes('--fields-only'),
  churches: process.argv.includes('--churches-only'),
  stats: process.argv.includes('--stats-only'),
};
const RUN_ALL = !ONLY.fields && !ONLY.churches && !ONLY.stats;
const DIR = new URL('./data/gcfa/', import.meta.url).pathname;
const PARSER_VERSION = 'gcfa-1';
const BATCH = 1000;

const norm = (s: string | null | undefined) =>
  (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------------------------------------------------------- A. fields
async function importFields(db: SupabaseClient) {
  const fields = JSON.parse(readFileSync(DIR + 'fields.json', 'utf8')) as Array<{
    code: string; label: string; question: string | null; category: string;
    unit: string; table_no: string | null; first_seen_year: number; last_seen_year: number;
  }>;
  const rows = fields.map((f) => ({
    code: f.code,
    label_en: (f.label || f.code).slice(0, 500),
    category: f.category,
    unit: f.unit,
    question: f.question,
    table_no: f.table_no,
    first_seen_year: f.first_seen_year,
    last_seen_year: f.last_seen_year,
  }));
  console.log(`A. stat_field: upserting ${rows.length} fields`);
  if (DRY) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from('stat_field').upsert(rows.slice(i, i + BATCH), { onConflict: 'code' });
    if (error) throw error;
  }
  console.log('   done.');
}

// ------------------------------------------------------------- B. churches
async function importChurches(db: SupabaseClient): Promise<Record<string, string>> {
  const churches = JSON.parse(readFileSync(DIR + 'churches.json', 'utf8')) as Array<Record<string, any>>;
  // load existing churches to attach by normalized name
  const existing: Array<{ id: string; canonical_name: string; gcfa_number: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('church').select('id, canonical_name, gcfa_number').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    existing.push(...data);
    if (data.length < 1000) break;
  }
  const byName = new Map<string, { id: string; gcfa_number: string | null }>();
  const byGcfa = new Map<string, string>();
  const usedNames = new Set<string>();           // exact canonical_name values in use
  for (const e of existing) {
    if (e.gcfa_number) byGcfa.set(e.gcfa_number, e.id);
    usedNames.add(e.canonical_name);
    const k = norm(e.canonical_name);
    if (k && !byName.has(k)) byName.set(k, { id: e.id, gcfa_number: e.gcfa_number });
  }

  const map: Record<string, string> = {};
  let matched = 0, created = 0, alreadyGcfa = 0;
  console.log(`B. church: ${churches.length} GCFA churches vs ${existing.length} existing rows`);

  let skippedNonChurch = 0;
  for (const c of churches) {
    const gcfa = String(c.gcfa_number);
    // drop non-church administrative rows (e.g. "DISTRICT AT LARGE", synthetic S-prefixed ids)
    if (/district at large|conference at large/i.test(c.church_name ?? '')) { skippedNonChurch++; continue; }
    const identity = {
      gcfa_number: gcfa,
      gcfa_id: c.gcfa_id ? String(c.gcfa_id) : null,
      city: c.city ?? null,
      address: c.address1 ?? null,
      state: c.state ?? null,
      zip: c.zip ? String(c.zip) : null,
      county_no: c.county_no ? String(c.county_no) : null,
      county_name: c.county_name ?? null,
      congregation_type: c.congregation_type ?? null,
      church_ethnicity: c.church_ethnicity ?? null,
      ein: c.ein ?? null,
      charge_no: c.charge_no ? String(c.charge_no) : null,
      charge_name: c.charge_name ?? null,
      legacy_conferences: c.conferences ?? null,
      first_data_year: c.first_year ?? null,
      last_data_year: c.last_year ?? null,
    };

    if (byGcfa.has(gcfa)) { map[gcfa] = byGcfa.get(gcfa)!; alreadyGcfa++; if (!DRY) await db.from('church').update(identity).eq('id', map[gcfa]); continue; }

    const nameKey = norm(c.church_name);
    const hit = byName.get(nameKey);
    if (hit && !hit.gcfa_number) {
      map[gcfa] = hit.id; matched++;
      hit.gcfa_number = gcfa; // claim it so two GCFA churches don't grab the same row
      byGcfa.set(gcfa, hit.id);
      if (!DRY) {
        const { error } = await db.from('church').update(identity).eq('id', hit.id);
        if (error) throw error;
      }
    } else {
      created++;
      // disambiguate canonical_name collisions (two distinct churches share a name)
      let cname = c.church_name as string;
      if (usedNames.has(cname)) cname = `${cname} (${gcfa})`;
      usedNames.add(cname);
      if (!DRY) {
        const { data, error } = await db.from('church')
          .insert({ canonical_name: cname, ...identity })
          .select('id').single();
        if (error) throw error;
        map[gcfa] = data.id;
        byGcfa.set(gcfa, data.id);
      } else {
        map[gcfa] = `dry-${gcfa}`;
      }
    }
  }
  console.log(`   matched-to-existing: ${matched}, created-new: ${created}, already-had-gcfa: ${alreadyGcfa}, skipped-non-church: ${skippedNonChurch}`);
  // persist map for a separate --stats-only run
  if (!DRY) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(DIR + 'church_id_map.json', JSON.stringify(map));
  }
  return map;
}

// --------------------------------------------------------------- C. stats
async function importStats(db: SupabaseClient, map: Record<string, string>) {
  console.log('C. church_stat: streaming church_stats.jsonl');
  const rl = createInterface({ input: createReadStream(DIR + 'church_stats.jsonl'), crlfDelay: Infinity });
  let batch: any[] = [];
  let total = 0, skipped = 0;
  const flush = async () => {
    if (!batch.length || DRY) { total += batch.length; batch = []; return; }
    const { error } = await db.from('church_stat').upsert(batch, {
      onConflict: 'church_id,data_year,field_code,source', ignoreDuplicates: true,
    });
    if (error) throw error;
    total += batch.length;
    batch = [];
    if (total % 50000 === 0) console.log(`   ...${total} rows`);
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const cid = map[String(r.gcfa_number)];
    if (!cid) { skipped++; continue; }
    batch.push({
      church_id: cid,
      data_year: r.data_year,
      journal_year: null,
      field_code: r.field_code,
      value_numeric: r.value_numeric,
      value_text: r.value_text,
      source: 'gcfa',
      parser_version: PARSER_VERSION,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  console.log(`   inserted/seen: ${total}, skipped (no church match): ${skipped}`);
}

async function main() {
  const db = adminClient();
  if (DRY) console.log('** DRY RUN — no writes **');
  if (RUN_ALL || ONLY.fields) await importFields(db);
  let map: Record<string, string> = {};
  if (RUN_ALL || ONLY.churches) map = await importChurches(db);
  if (ONLY.stats) map = JSON.parse(readFileSync(DIR + 'church_id_map.json', 'utf8'));
  if (RUN_ALL || ONLY.stats) await importStats(db, map);
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
