/**
 * Parse Section J Membership tables (Era B / 2025 journal) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-membership.ts CE 519 524
 */

import { extractPages, splitPages } from './lib/pdf.ts';
import { findSubTables, sliceRow, parseNumeric, type SubTable } from './lib/columns.ts';
import { adminClient, upsertChurch } from './lib/db.ts';
import { canonicalize, extractCity } from './lib/names.ts';

const PARSER_VERSION = 'era_b_v1';
const JOURNAL_YEAR = 2025;
const DATA_YEAR = 2024;
const SOURCE_SECTION = 'J';

function isSkipLine(line: string, name: string): boolean {
  if (!name) return true;
  if (/Rio Texas Conference Journal/.test(line)) return true;
  if (/Central District|North District|South District/.test(line)) return true;
  if (/^\s*MEMBERSHIP\s*$/.test(line)) return true;
  if (/^[A-Z][A-Z\s]+TOTAL/i.test(name) || /^TOTALS?$/i.test(name)) return true;
  return false;
}

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
  pdfPages: Set<number>;
  stats: Map<string, Stat>;
};

function recordStats(
  acc: ChurchAccum,
  values: Record<string, string>,
  pdfPage: number,
) {
  acc.pdfPages.add(pdfPage);
  for (const [code, raw] of Object.entries(values)) {
    const num = parseNumeric(raw);
    const hasValue = raw.trim() !== '';
    acc.stats.set(code, {
      field_code: code,
      value_numeric: num,
      value_text: hasValue && num === null ? raw.trim() : null,
      source_pdf_page: pdfPage,
      parser_version: PARSER_VERSION,
      confidence: hasValue ? 'ok' : 'non_reported',
    });
  }
}

async function main() {
  const [districtCode, firstPdfPageStr, lastPdfPageStr] = process.argv.slice(2);
  if (!districtCode || !firstPdfPageStr || !lastPdfPageStr) {
    console.error('Usage: parse-membership.ts <CE|NO|SO> <firstPdfPage> <lastPdfPage>');
    process.exit(1);
  }
  const firstPdfPage = Number(firstPdfPageStr);
  const lastPdfPage = Number(lastPdfPageStr);

  const db = adminClient();

  const { data: run, error: runErr } = await db
    .from('ingest_run')
    .insert({
      journal_year: JOURNAL_YEAR,
      section: 'J:Membership',
      parser_version: PARSER_VERSION,
      notes: `district=${districtCode} pages=${firstPdfPage}-${lastPdfPage}`,
    })
    .select('id')
    .single();
  if (runErr) throw runErr;

  let rowsWritten = 0;
  let errorCount = 0;

  try {
    const text = extractPages(firstPdfPage, lastPdfPage);
    const pages = splitPages(text);

    const churches = new Map<string, ChurchAccum>();

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const pageText = pages[pIdx];
      if (!pageText.trim()) continue;
      const pdfPage = firstPdfPage + pIdx;
      const subTables = findSubTables(pageText);
      if (subTables.length === 0) continue;
      const lines = pageText.split('\n');

      for (const sub of subTables) {
        for (let li = sub.rowsStart; li < sub.rowsEnd; li++) {
          const line = lines[li];
          if (!line.trim()) continue;
          const sliced = sliceRow(line, sub);
          if (isSkipLine(line, sliced.name)) continue;

          let acc = churches.get(sliced.name);
          if (!acc) {
            acc = { rawName: sliced.name, pdfPages: new Set(), stats: new Map() };
            churches.set(sliced.name, acc);
          }
          recordStats(acc, sliced.values, pdfPage);
        }
      }
    }

    console.log(
      `Parsed ${churches.size} unique churches across pages ${firstPdfPage}-${lastPdfPage}`,
    );

    for (const acc of churches.values()) {
      try {
        const canonical = canonicalize(acc.rawName);
        const city = extractCity(canonical);
        const churchId = await upsertChurch(
          db,
          acc.rawName,
          canonical,
          city,
          JOURNAL_YEAR,
          SOURCE_SECTION,
        );

        const { error: dhErr } = await db
          .from('district_history')
          .upsert(
            { church_id: churchId, data_year: DATA_YEAR, district_code: districtCode },
            { onConflict: 'church_id,data_year' },
          );
        if (dhErr) throw dhErr;

        const statRows = Array.from(acc.stats.values()).map((s) => ({
          church_id: churchId,
          data_year: DATA_YEAR,
          journal_year: JOURNAL_YEAR,
          field_code: s.field_code,
          value_numeric: s.value_numeric,
          value_text: s.value_text,
          source_pdf_page: s.source_pdf_page,
          parser_version: s.parser_version,
          confidence: s.confidence,
        }));

        if (statRows.length > 0) {
          const { error: statErr } = await db
            .from('church_stat')
            .upsert(statRows, { onConflict: 'church_id,data_year,field_code' });
          if (statErr) throw statErr;
          rowsWritten += statRows.length;
        }
      } catch (err) {
        errorCount++;
        console.error(`  ✗ ${acc.rawName}:`, (err as Error).message);
      }
    }
  } finally {
    await db
      .from('ingest_run')
      .update({
        finished_at: new Date().toISOString(),
        rows_written: rowsWritten,
        error_count: errorCount,
      })
      .eq('id', run.id);
  }

  console.log(`Done. rows_written=${rowsWritten} errors=${errorCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
