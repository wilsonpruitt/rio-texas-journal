import { extractPages, splitPages } from './pdf.ts';
import { findSubTables, sliceRow, parseNumeric, type SubTable } from './columns.ts';
import { adminClient, upsertChurch } from './db.ts';
import { canonicalize, extractCity } from './names.ts';

export type RunOpts = {
  journalYear: number;
  dataYear: number;
  sourceSection: string;
  parserVersion: string;
  /** Label used in ingest_run.section, e.g. 'J:Membership'. */
  tableLabel: string;
  /**
   * Allowlist of GCFA field codes for this sub-table. Sub-tables whose codes
   * don't intersect this set are skipped — used to ignore the previous
   * sub-table's tail rows that bleed onto the first page of a new section.
   */
  expectedCodes: ReadonlySet<string>;
};

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

function isSkipLine(line: string, name: string, tableLabel: string): boolean {
  if (!name) return true;
  if (/Rio Texas Conference Journal/.test(line)) return true;
  if (/Central District|North District|South District/.test(line)) return true;
  // Section banner lines: "MEMBERSHIP", "MEMBERS BY ETHNICITY AND GENDER", etc.
  if (/^[A-Z][A-Z\s/&]+$/.test(name) && name.length < 60) return true;
  // TOTALS rows have larger numbers that may bleed left of the name boundary
  // (e.g. "TOTALS                       2,876,533") — match TOTALS as a prefix.
  if (/^TOTALS?\b/i.test(name) || /^[A-Z][A-Z\s]+TOTAL/i.test(name)) return true;
  // Stray header-fragment lines (e.g. "Ethnicity", "Gender") with no numeric data.
  void tableLabel;
  return false;
}

function subTableMatches(sub: SubTable, expected: ReadonlySet<string>): boolean {
  return sub.columns.some((c) => expected.has(c.code));
}

export async function runSubTable(
  opts: RunOpts,
  districtCode: string,
  firstPdfPage: number,
  lastPdfPage: number,
): Promise<void> {
  const db = adminClient();

  const { data: run, error: runErr } = await db
    .from('ingest_run')
    .insert({
      journal_year: opts.journalYear,
      section: opts.tableLabel,
      parser_version: opts.parserVersion,
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
      const subTables = findSubTables(pageText).filter((s) =>
        subTableMatches(s, opts.expectedCodes),
      );
      if (subTables.length === 0) continue;
      const lines = pageText.split('\n');

      for (const sub of subTables) {
        // Restrict the sub-table's columns to expected codes only — ignore any
        // unexpected codes that happen to share the header line.
        const filteredColumns = sub.columns.filter((c) => opts.expectedCodes.has(c.code));
        const filteredSub: SubTable = { ...sub, columns: filteredColumns };

        for (let li = sub.rowsStart; li < sub.rowsEnd; li++) {
          const line = lines[li];
          if (!line.trim()) continue;
          const sliced = sliceRow(line, filteredSub);
          if (isSkipLine(line, sliced.name, opts.tableLabel)) continue;

          let acc = churches.get(sliced.name);
          if (!acc) {
            acc = { rawName: sliced.name, pdfPages: new Set(), stats: new Map() };
            churches.set(sliced.name, acc);
          }
          acc.pdfPages.add(pdfPage);
          for (const [code, raw] of Object.entries(sliced.values)) {
            const num = parseNumeric(raw);
            const hasValue = raw.trim() !== '';
            acc.stats.set(code, {
              field_code: code,
              value_numeric: num,
              value_text: hasValue && num === null ? raw.trim() : null,
              source_pdf_page: pdfPage,
              parser_version: opts.parserVersion,
              confidence: hasValue ? 'ok' : 'non_reported',
            });
          }
        }
      }
    }

    // Drop accumulators with no actual data — these are usually multi-line
    // column-header fragments (e.g. "Number of", "Ongoing") that landed in a
    // sub-table's row range. A genuinely non-reporting church (e.g. Iraan UMC)
    // is already recorded with confidence='non_reported' in the Membership
    // table, so dropping it here just avoids 26 rows of noise.
    const reportingChurches = Array.from(churches.values()).filter((acc) =>
      Array.from(acc.stats.values()).some((s) => s.confidence !== 'non_reported'),
    );
    const skipped = churches.size - reportingChurches.length;
    console.log(
      `Parsed ${reportingChurches.length} reporting churches across pages ${firstPdfPage}-${lastPdfPage}` +
        (skipped > 0 ? ` (skipped ${skipped} all-empty rows)` : ''),
    );

    for (const acc of reportingChurches) {
      try {
        const canonical = canonicalize(acc.rawName);
        const city = extractCity(canonical);
        const churchId = await upsertChurch(
          db,
          acc.rawName,
          canonical,
          city,
          opts.journalYear,
          opts.sourceSection,
        );

        const { error: dhErr } = await db
          .from('district_history')
          .upsert(
            { church_id: churchId, data_year: opts.dataYear, district_code: districtCode },
            { onConflict: 'church_id,data_year' },
          );
        if (dhErr) throw dhErr;

        const statRows = Array.from(acc.stats.values()).map((s) => ({
          church_id: churchId,
          data_year: opts.dataYear,
          journal_year: opts.journalYear,
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

export function cliEntry(opts: RunOpts, validDistricts: readonly string[]): void {
  const [districtCode, firstPdfPageStr, lastPdfPageStr] = process.argv.slice(2);
  if (!districtCode || !firstPdfPageStr || !lastPdfPageStr) {
    console.error(
      `Usage: <script> <${validDistricts.join('|')}> <firstPdfPage> <lastPdfPage>`,
    );
    process.exit(1);
  }
  if (!validDistricts.includes(districtCode)) {
    console.error(`Unknown district ${districtCode}; expected one of ${validDistricts.join(', ')}`);
    process.exit(1);
  }
  runSubTable(opts, districtCode, Number(firstPdfPageStr), Number(lastPdfPageStr)).catch(
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
