/**
 * Parse Section J Apportionments tables (Era B / 2025) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-apportionments.ts CE 541 543
 *   node --env-file=.env.local scripts/parsers/era_b/parse-apportionments.ts NO 582 584
 *   node --env-file=.env.local scripts/parsers/era_b/parse-apportionments.ts SO 623 625
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set(['28a', '28b', '29a', '29b']);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Apportionments',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
