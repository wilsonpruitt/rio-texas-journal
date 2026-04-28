/**
 * Parse Section J "Members by Ethnicity and Gender" tables (Era B / 2025) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-ethnicity.ts CE 525 528
 *   node --env-file=.env.local scripts/parsers/era_b/parse-ethnicity.ts NO 566 568
 *   node --env-file=.env.local scripts/parsers/era_b/parse-ethnicity.ts SO 608 610
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set([
  '5a', '5b', '5c', '5d', '5e', '5f', '5g', '5',
  '6a', '6b', '6c', '6',
]);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Ethnicity',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
