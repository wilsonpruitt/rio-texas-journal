// UMC clergy credential codes used in Rio Texas BAC reports. The latest
// entry in `clergy.status_history` is treated as the current credential
// class and copied into `clergy.credential_class`.

export const CREDENTIAL_LABEL: Record<string, string> = {
  FE: 'Full Elder',
  FD: 'Full Deacon',
  PE: 'Provisional Elder',
  PD: 'Provisional Deacon',
  FL: 'Full-time Local Pastor',
  PL: 'Part-time Local Pastor',
  AM: 'Associate Member',
  AF: 'Affiliate Member',
  SY: 'Student / Supply Pastor',
  PM: 'Probationary Member',
  OE: 'Other Methodist Elder',
  OD: 'Other Methodist Deacon',
  OF: 'Other Methodist Full-time',
  OR: 'Other Methodist Retired',
  OA: 'Other Methodist Associate',
  TI: 'Transfer In',
  TO: 'Transfer Out',
  RE: 'Retired Elder',
  RD: 'Retired Deacon',
  RL: 'Retired Local Pastor',
  RA: 'Retired Associate Member',
  RP: 'Retired Probationary Member',
  HN: 'Honorable Location',
  HR: 'Honorable Location – Retired',
  HL: 'Honorable Location',
  LC: 'Local Conference Member',
};

// Order used for UI filter chips — active credentials first, then
// retired, then "other" categories.
export const CREDENTIAL_ORDER: string[] = [
  'FE', 'FD', 'PE', 'PD', 'FL', 'PL', 'AM', 'AF', 'SY',
  'OE', 'OD', 'OF', 'OA', 'TI',
  'RE', 'RD', 'RL', 'RA', 'RP', 'OR',
  'HN', 'HR', 'HL', 'LC', 'PM', 'TO',
];

export function credentialLabel(code: string | null | undefined): string {
  if (!code) return '';
  return CREDENTIAL_LABEL[code] ?? code;
}
