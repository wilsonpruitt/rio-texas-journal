/**
 * Scan a year's PDF for the page range of each Era A district in Section J.
 *
 * Usage:
 *   node --experimental-strip-types scripts/parsers/era_a/find-pages.ts 2023
 */

import { execFileSync } from 'node:child_process';

const PDFTOTEXT = '/usr/local/bin/pdftotext';

const DISTRICTS = [
  { code: 'CA', label: 'CAPITAL DISTRICT' },
  { code: 'CB', label: 'COASTAL BEND DISTRICT' },
  { code: 'CR', label: 'CROSSROADS DISTRICT' },
  { code: 'EV', label: 'EL VALLE DISTRICT' },
  { code: 'HC', label: 'HILL COUNTRY DISTRICT' },
  { code: 'LM', label: 'LAS MISIONES DISTRICT' },
  { code: 'WS', label: 'WEST DISTRICT' },
] as const;

function pageHeader(year: number, page: number): string {
  return execFileSync(
    PDFTOTEXT,
    ['-layout', '-nopgbrk', '-f', String(page), '-l', String(page),
     `/Users/wilsonpruitt/rio-texas-journal/journals/${year}.pdf`, '-'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
}

function pageCount(year: number): number {
  const out = execFileSync('/usr/local/bin/pdfinfo',
    [`/Users/wilsonpruitt/rio-texas-journal/journals/${year}.pdf`],
    { encoding: 'utf8' });
  const m = out.match(/Pages:\s+(\d+)/);
  return Number(m![1]);
}

function hasJCodeLine(text: string): boolean {
  // A J-section field-code line has many code tokens (1, 2a, 2b, ...) on
  // one line. Require >= 5 in a row to weed out incidental clergy-bio
  // pages that happen to print short numeric tokens.
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5) continue;
    const codeCount = tokens.filter((t) => /^[1-9]\d?\.?[a-z]?\.?$/.test(t)).length;
    if (codeCount >= 5 && codeCount === tokens.length) return true;
  }
  return false;
}

function detectDistrict(text: string): string | null {
  if (!hasJCodeLine(text)) return null;
  const upper = text.toUpperCase();
  for (const d of DISTRICTS) {
    if (upper.includes(d.label)) return d.code;
  }
  return null;
}

async function main() {
  const year = Number(process.argv[2] ?? new Date().getFullYear());
  if (!Number.isFinite(year)) {
    console.error('Usage: find-pages.ts <year>');
    process.exit(1);
  }
  const total = pageCount(year);
  console.log(`Scanning ${year}.pdf (${total} pages) for district boundaries…`);

  const ranges: Record<string, { first: number; last: number }> = {};
  // Heuristic: scan pages 200-end (J section is always in second half).
  const start = Math.max(1, Math.floor(total * 0.4));
  for (let p = start; p <= total; p++) {
    const text = pageHeader(year, p);
    const code = detectDistrict(text);
    if (!code) continue;
    if (!ranges[code]) ranges[code] = { first: p, last: p };
    else ranges[code].last = p;
  }

  console.log(`\n  Year  District  Pages    Span`);
  for (const d of DISTRICTS) {
    const r = ranges[d.code];
    if (!r) console.log(`  ${year}  ${d.code}        — (not found)`);
    else console.log(`  ${year}  ${d.code}        ${r.first}-${r.last}    ${r.last - r.first + 1}`);
  }

  // Print a copy-paste runnable command set.
  console.log(`\n# Paste to run all 7 districts for ${year}:`);
  console.log(`for args in \\`);
  for (const d of DISTRICTS) {
    const r = ranges[d.code];
    if (!r) continue;
    console.log(`  "${d.code} ${r.first} ${r.last}" \\`);
  }
  console.log(`; do`);
  console.log(`  eval "RTXJ_YEAR=${year} node --env-file=.env.local --experimental-strip-types scripts/parsers/era_a/parse-district.ts $args" 2>&1 | grep -E "^Done|^Era A:"`);
  console.log(`done`);
}

main();
