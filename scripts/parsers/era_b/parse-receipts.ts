/**
 * Parse Section J Receipts tables (Era B / 2025) for one district.
 *
 * Two sub-tables under one section header:
 *   A) Funds + Capital: 51 52a–52g 52 53a
 *   B) Designated + Connectional + Total: 53b–53e 53 54a–54c 54 55
 *
 * Usage:
 *   node --env-file=.env.local scripts/parsers/era_b/parse-receipts.ts CE 553 558
 *   node --env-file=.env.local scripts/parsers/era_b/parse-receipts.ts NO 595 601
 *   node --env-file=.env.local scripts/parsers/era_b/parse-receipts.ts SO 635 640
 */

import { cliEntry } from './lib/run-subtable.ts';

const EXPECTED_CODES = new Set([
  '51',
  '52a', '52b', '52c', '52d', '52e', '52f', '52g', '52',
  '53a', '53b', '53c', '53d', '53e', '53',
  '54a', '54b', '54c', '54',
  '55',
]);

cliEntry(
  {
    journalYear: 2025,
    dataYear: 2024,
    sourceSection: 'J',
    parserVersion: 'era_b_v1',
    tableLabel: 'J:Receipts',
    expectedCodes: EXPECTED_CODES,
  },
  ['CE', 'NO', 'SO'],
);
