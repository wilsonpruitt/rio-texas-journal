import { execFileSync } from 'node:child_process';

const PDF_PATH =
  process.env.RTXJ_PDF_2025 ||
  '/Users/wilsonpruitt/Downloads/2025+Rio+TX+Journal+Web+Updated.pdf';

/** Extract a page range from the journal PDF as layout-preserved text. */
export function extractPages(firstPage: number, lastPage: number): string {
  return execFileSync(
    'pdftotext',
    [
      '-layout',
      '-nopgbrk',
      '-f', String(firstPage),
      '-l', String(lastPage),
      PDF_PATH,
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

/** Convert a J-page (1-indexed within Section J) to a PDF page number. */
export function jPageToPdfPage(jPage: number): number {
  // Section J starts at PDF page 512 (J-1 == 512).
  return 511 + jPage;
}

/** Split a page range into per-page text using "Rio Texas Conference Journal 2025" as the marker. */
export function splitPages(text: string): string[] {
  // pdftotext with -nopgbrk doesn't insert form feeds, so split on the page footer.
  const lines = text.split('\n');
  const pages: string[][] = [[]];
  for (const line of lines) {
    pages[pages.length - 1].push(line);
    if (/Rio Texas Conference Journal 2025/.test(line)) {
      pages.push([]);
    }
  }
  // Last bucket is the trailing slice after the final footer (often just whitespace).
  return pages.map((p) => p.join('\n'));
}
