/**
 * Parse Section J Worship Attendance tables (Era B / 2025) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-worship.ts CE 529 531
 *   node --env-file=.env.local scripts/parsers/era_b/parse-worship.ts NO 569 571
 *   node --env-file=.env.local scripts/parsers/era_b/parse-worship.ts SO 611 613
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set(['7', '7a', '8a', '8b', '8', '9', '10']);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Worship',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
