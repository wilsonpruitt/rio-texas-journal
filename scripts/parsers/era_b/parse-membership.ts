/**
 * Parse Section J Membership tables (Era B / 2025 journal) for one district.
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-membership.ts CE 519 524
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set([
  '1',
  '2a', '2b', '2c', '2d', '2e', '2f', '2g',
  '3a', '3b', '3c', '3d', '3e', '3f',
  '4',
]);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Membership',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
