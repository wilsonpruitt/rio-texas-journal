/**
 * Parse Section J Salary and Benefits tables (Era B / 2025) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-salary.ts CE 547 549
 *   node --env-file=.env.local scripts/parsers/era_b/parse-salary.ts NO 588 591
 *   node --env-file=.env.local scripts/parsers/era_b/parse-salary.ts SO 629 631
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set([
  '39', '40', '41a', '41b', '41c',
  '42a', '42b', '42c',
  '43', '44', '45', '46', '47', '47t',
]);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Salary',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
