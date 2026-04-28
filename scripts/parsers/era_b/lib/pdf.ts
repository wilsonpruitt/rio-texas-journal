import { execFileSync } from 'node:child_process';

const JOURNALS_DIR =
  process.env.RTXJ_PDF_DIR || '/Users/wilsonpruitt/rio-texas-journal/journals';

function pdfPath(year: number): string {
  // Allow overriding a single year via RTXJ_PDF_YYYY for compatibility.
  const override = process.env[`RTXJ_PDF_${year}`];
  if (override) return override;
  return `${JOURNALS_DIR}/${year}.pdf`;
}

/** Extract a page range from the journal PDF as layout-preserved text. */
export function extractPages(firstPage: number, lastPage: number, year: number): string {
  return execFileSync(
    'pdftotext',
    [
      '-layout',
      '-nopgbrk',
      '-f', String(firstPage),
      '-l', String(lastPage),
      pdfPath(year),
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

/**
 * Split a page range into per-page text by detecting the journal's page
 * footer. The footer wording differs between years — 2025 prints
 * "Rio Texas Conference Journal 2025" while 2024 prints
 * "2024 RIO TEXAS CONFERENCE JOURNAL". Either form is recognized.
 */
export function splitPages(text: string, year: number): string[] {
  const yr = String(year);
  const reA = new RegExp(`Rio Texas Conference Journal\\s+${yr}`, 'i');
  const reB = new RegExp(`${yr}\\s+Rio Texas Conference Journal`, 'i');
  const lines = text.split('\n');
  const pages: string[][] = [[]];
  for (const line of lines) {
    pages[pages.length - 1].push(line);
    if (reA.test(line) || reB.test(line)) pages.push([]);
  }
  return pages.map((p) => p.join('\n'));
}
