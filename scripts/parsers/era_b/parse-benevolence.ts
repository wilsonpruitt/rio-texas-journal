/**
 * Parse Section J Benevolence and Connectional Support tables (Era B / 2025) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-benevolence.ts CE 544 546
 *   node --env-file=.env.local scripts/parsers/era_b/parse-benevolence.ts NO 585 587
 *   node --env-file=.env.local scripts/parsers/era_b/parse-benevolence.ts SO 626 628
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set([
  '30', '31', '32', '33', '34', '35',
  '36a', '36b', '36c', '36d', '36e', '36f',
  '37', '38',
]);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Benevolence',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
