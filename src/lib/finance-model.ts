// Conference finance model — client-safe (no server-only). Drives the /conference
// historical view, the baseline projection, and the interactive what-if scenario.
//
// The audited aggregates (total revenue/expense) include pass-through flows (the
// conference insurance program, grants, restricted-fund releases) that swing year to
// year, so the forward model is explicitly ILLUSTRATIVE: it projects each driver from
// its own recent trend and lets the user bend the assumptions. Apportionment revenue —
// the cleanest, most policy-relevant line — is the headline lever.

export type FinanceRow = {
  data_year: number;
  source: string;
  apportionment_rev: number | null;
  other_giving?: number | null;
  insurance_income?: number | null;
  grants?: number | null;
  total_rev: number | null;
  program_exp?: number | null;
  gen_admin_exp?: number | null;
  total_exp: number | null;
  net_assets_eoy: number | null;
  // Non-recurring revenue baked into total_rev — chiefly the non-cash fair value of
  // closed-church property reverting to the conference (Note 9). It inflates a single
  // year's "surplus" without being repeatable, so the forward projection strips it.
  one_time_rev?: number | null;
  // Net assets that are closed-church property held for sale (the Trustees Property
  // Transition reserve). Real, but non-spendable and earns no investment return, so the
  // projection holds it aside rather than compounding it.
  property_held?: number | null;
};

// Recurring "other revenue" for a row = total revenue, less apportionments, less any
// one-time items. This is the line the forward model trends — not the raw audited total.
const recurringOther = (r: FinanceRow): number | null =>
  r.total_rev == null || r.apportionment_rev == null
    ? null
    : r.total_rev - r.apportionment_rev - (r.one_time_rev ?? 0);

export type Assumptions = {
  apportionmentGrowth: number; // ongoing annual fraction, e.g. -0.07
  apportionmentStep: number;   // ONE-TIME change applied in the first projected year only,
                               // on top of the ongoing rate — "what if payments jump next year?"
                               // The bumped value becomes the new base for later years.
  otherRevGrowth: number;
  expenseGrowth: number;
  investmentReturn: number;
};

export const ASSUMPTION_KEYS: (keyof Assumptions)[] = [
  "apportionmentStep", "apportionmentGrowth", "otherRevGrowth", "expenseGrowth", "investmentReturn",
];

export type ProjPoint = {
  year: number;
  apportionment: number;
  otherRev: number;
  totalRev: number;
  expense: number;
  operating: number; // totalRev - expense
  netAssets: number;
  projected: boolean;
};

// Compound annual growth rate between the first and last non-null points of a field.
export function cagr(rows: FinanceRow[], field: keyof FinanceRow): number | null {
  const pts = rows
    .map((r) => ({ y: r.data_year, v: r[field] as number | null }))
    .filter((p) => p.v != null && (p.v as number) > 0) as { y: number; v: number }[];
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const span = b.y - a.y;
  if (span <= 0) return null;
  return (b.v / a.v) ** (1 / span) - 1;
}

// Sensible default assumptions taken from the historical record, clamped so a noisy
// pass-through line can't produce an absurd default.
export function defaultAssumptions(rows: FinanceRow[]): Assumptions {
  const clamp = (x: number | null, lo: number, hi: number, fallback: number) =>
    x == null ? fallback : Math.max(lo, Math.min(hi, x));
  // "other revenue" = recurring total less apportionments (one-time items excluded);
  // compute its own CAGR from a synthetic series so a windfall year can't set the trend.
  const otherPts = rows
    .map((r) => ({ y: r.data_year, v: recurringOther(r) }))
    .filter((p): p is { y: number; v: number } => p.v != null && p.v > 0);
  const otherCagr = otherPts.length >= 2
    ? (otherPts[otherPts.length - 1].v / otherPts[0].v) ** (1 / (otherPts[otherPts.length - 1].y - otherPts[0].y)) - 1
    : null;
  const otherLast = otherPts.length ? otherPts[otherPts.length - 1].v : 0;
  return {
    apportionmentGrowth: clamp(cagr(rows, "apportionment_rev"), -0.25, 0.25, -0.07),
    apportionmentStep: 0,
    otherRevGrowth: clamp(otherLast > 0 ? otherCagr : 0, -0.25, 0.25, -0.05),
    expenseGrowth: clamp(cagr(rows, "total_exp"), -0.25, 0.25, -0.04),
    investmentReturn: 0.045,
  };
}

// Project forward `horizon` years from the last actual row under the given assumptions.
// Returns the actual rows (projected:false) followed by the projection (projected:true).
export function project(rows: FinanceRow[], a: Assumptions, horizon = 5): ProjPoint[] {
  const actual: ProjPoint[] = rows
    .filter((r) => r.total_rev != null && r.net_assets_eoy != null)
    .map((r) => {
      const apportionment = r.apportionment_rev ?? 0;
      const totalRev = r.total_rev ?? 0;
      const expense = r.total_exp ?? 0;
      return {
        year: r.data_year, apportionment, otherRev: totalRev - apportionment, totalRev,
        expense, operating: totalRev - expense, netAssets: r.net_assets_eoy ?? 0, projected: false,
      };
    });

  const out = [...actual];
  const usable = rows.filter((r) => r.total_rev != null && r.net_assets_eoy != null);
  const lastRow = usable[usable.length - 1];
  // Closed-church property held for sale: stays in net assets but earns no investment
  // return (it isn't invested) and isn't sold down in the model — held constant.
  const propertyHeld = lastRow?.property_held ?? 0;
  // Launch the forward path from the RECURRING base — strip the year's one-time revenue
  // so a property windfall doesn't seed a permanent surplus.
  let apportionment = lastRow?.apportionment_rev ?? 0;
  let otherRev = recurringOther(lastRow) ?? 0;
  let expense = lastRow?.total_exp ?? 0;
  let netAssets = lastRow?.net_assets_eoy ?? 0;
  const lastYear = lastRow?.data_year ?? 0;
  for (let i = 1; i <= horizon; i++) {
    // first projected year also absorbs the one-time step; later years compound off it
    apportionment *= 1 + a.apportionmentGrowth + (i === 1 ? a.apportionmentStep : 0);
    otherRev *= 1 + a.otherRevGrowth;
    expense *= 1 + a.expenseGrowth;
    const totalRev = apportionment + otherRev;
    const operating = totalRev - expense;
    const invIncome = Math.max(netAssets - propertyHeld, 0) * a.investmentReturn;
    netAssets = netAssets + operating + invIncome;
    out.push({ year: lastYear + i, apportionment, otherRev, totalRev, expense, operating, netAssets, projected: true });
  }
  return out;
}

// First future year in which projected net assets go negative (reserves exhausted), or null.
export function reservesExhaustedYear(proj: ProjPoint[]): number | null {
  const hit = proj.find((p) => p.projected && p.netAssets < 0);
  return hit ? hit.year : null;
}
