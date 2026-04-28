/**
 * Parse Section J Expenses tables (Era B / 2025) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-expenses.ts CE 550 552
 *   node --env-file=.env.local scripts/parsers/era_b/parse-expenses.ts NO 592 594
 *   node --env-file=.env.local scripts/parsers/era_b/parse-expenses.ts SO 632 634
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set(['48', '49', '50']);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Expenses',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
