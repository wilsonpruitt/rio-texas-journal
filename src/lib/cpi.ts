/**
 * CPI-U, U.S. city average, all items, annual average (1982-84 = 100).
 * Source: U.S. Bureau of Labor Statistics. Values verified 2026-06-13.
 * Used to express apportionment giving in constant dollars / against an
 * inflation-pegged baseline on the conference finance page.
 */
export const CPI_U: Record<number, number> = {
  2016: 240.007,
  2017: 245.12,
  2018: 251.107,
  2019: 255.657,
  2020: 258.811,
  2021: 270.97,
  2022: 292.655,
  2023: 304.702,
  2024: 313.689,
};

/** Grow a base-year nominal amount to `toYear` using CPI (what it must be to keep pace with inflation). */
export function inflateTo(amount: number, fromYear: number, toYear: number): number | null {
  const a = CPI_U[fromYear];
  const b = CPI_U[toYear];
  if (a == null || b == null) return null;
  return amount * (b / a);
}

/** Express a nominal amount from `ofYear` in constant `baseYear` dollars. */
export function realDollars(amount: number, ofYear: number, baseYear: number): number | null {
  return inflateTo(amount, ofYear, baseYear);
}
