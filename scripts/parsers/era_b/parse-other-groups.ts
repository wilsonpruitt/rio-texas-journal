/**
 * Parse Section J Other Groups tables (Era B / 2025) for one district.
 *
 * Three sub-tables under one section header:
 *   A) Christian Formation: 11a 11b 11c 11d 11 12 13 14
 *   B) Classes / UMM / UWF / UMVIM: 15 16 17 18a 18b 19a 19b 20a 20b
 *   C) Community Ministries + Property/Debt: 21 21a 21b 22 23 24 25 26 27
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-other-groups.ts CE 532 540
 *   node --env-file=.env.local scripts/parsers/era_b/parse-other-groups.ts NO 572 581
 *   node --env-file=.env.local scripts/parsers/era_b/parse-other-groups.ts SO 614 622
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set([
  '11a', '11b', '11c', '11d', '11', '12', '13', '14',
  '15', '16', '17', '18a', '18b', '19a', '19b', '20a', '20b',
  '21', '21a', '21b', '22', '23', '24', '25', '26', '27',
]);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:OtherGroups',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
