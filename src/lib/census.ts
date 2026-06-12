/**
 * Census ACS 5-year fetch, by ZIP Code Tabulation Area (ZCTA).
 *
 * Ported from church-plant-analysis (Python) — same ACS variable codes and
 * sentinel handling, narrowed to the fields the Community Mirror (Module 3)
 * displays. ZCTA geography is queryable nationally, so a church's mailing ZIP
 * drives the whole neighborhood profile.
 *
 * Reference: https://api.census.gov/data/{year}/acs/acs5/variables.html
 */

/** Default ACS 5-year vintage. 2023 is the latest 5-yr release as of build. */
export const ACS_YEAR = 2023;

// Raw ACS detailed-table variables we pull. Percentages are derived below.
const VARS = {
  totalPop: "B01003_001E",
  medianAge: "B01002_001E",
  medianHouseholdIncome: "B19013_001E",
  // Hispanic-or-Latino by race (B03002): universe + mutually exclusive groups.
  raceUniverse: "B03002_001E",
  hispanic: "B03002_012E",
  whiteNH: "B03002_003E",
  blackNH: "B03002_004E",
  asianNH: "B03002_006E",
  // Age.
  under18: "B09001_001E",
  // 65+ is summed from the age/sex table (male + female brackets).
  m65_66: "B01001_020E",
  m67_69: "B01001_021E",
  m70_74: "B01001_022E",
  m75_79: "B01001_023E",
  m80_84: "B01001_024E",
  m85: "B01001_025E",
  f65_66: "B01001_044E",
  f67_69: "B01001_045E",
  f70_74: "B01001_046E",
  f75_79: "B01001_047E",
  f80_84: "B01001_048E",
  f85: "B01001_049E",
  // Households: family vs all.
  households: "B11001_001E",
  familyHouseholds: "B11001_002E",
  // Poverty.
  povertyUniverse: "B17001_001E",
  belowPoverty: "B17001_002E",
  // Employment.
  laborForce: "B23025_003E",
  unemployed: "B23025_005E",
} as const;

type VarKey = keyof typeof VARS;

/** Shape matching the CensusZipData model's derived fields. */
export type CensusProfile = {
  totalPop: number | null;
  medianAge: number | null;
  medianHouseholdIncome: number | null;
  pctHispanic: number | null;
  pctBlack: number | null;
  pctWhite: number | null;
  pctAsian: number | null;
  pctUnder18: number | null;
  pctOver65: number | null;
  pctFamilyHouseholds: number | null;
  povertyRate: number | null;
  unemploymentRate: number | null;
};

// ACS suppresses/annotates with large negative sentinels (e.g. -666666666).
function clean(n: number): number | null {
  if (!Number.isFinite(n) || n <= -100_000_000) return null;
  return n;
}

function pct(part: number | null, whole: number | null): number | null {
  if (part == null || whole == null || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10; // one decimal place
}

/**
 * Fetch and derive the neighborhood profile for one ZCTA. Returns null only if
 * the ZCTA has no ACS row (the API returns just a header).
 */
export async function fetchCensusForZcta(
  zip: string,
  year: number = ACS_YEAR,
  apiKey = process.env.CENSUS_API_KEY,
): Promise<CensusProfile | null> {
  const fields = Array.from(new Set(Object.values(VARS)));
  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set("get", fields.join(","));
  url.searchParams.set("for", `zip code tabulation area:${zip}`);
  if (apiKey) url.searchParams.set("key", apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Census API ${res.status} for ZCTA ${zip}: ${await res.text()}`);
  }
  const rows = (await res.json()) as string[][];
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const header = rows[0];
  const row = rows[1];
  const idx = new Map(header.map((h, i) => [h, i]));
  const get = (k: VarKey): number | null => {
    const i = idx.get(VARS[k]);
    if (i == null) return null;
    return clean(Number(row[i]));
  };

  const raceUniverse = get("raceUniverse");
  const over65 = sum(
    get("m65_66"), get("m67_69"), get("m70_74"), get("m75_79"), get("m80_84"), get("m85"),
    get("f65_66"), get("f67_69"), get("f70_74"), get("f75_79"), get("f80_84"), get("f85"),
  );
  const totalPop = get("totalPop");

  return {
    totalPop,
    medianAge: get("medianAge"),
    medianHouseholdIncome: get("medianHouseholdIncome"),
    pctHispanic: pct(get("hispanic"), raceUniverse),
    pctBlack: pct(get("blackNH"), raceUniverse),
    pctWhite: pct(get("whiteNH"), raceUniverse),
    pctAsian: pct(get("asianNH"), raceUniverse),
    pctUnder18: pct(get("under18"), totalPop),
    pctOver65: pct(over65, totalPop),
    pctFamilyHouseholds: pct(get("familyHouseholds"), get("households")),
    povertyRate: pct(get("belowPoverty"), get("povertyUniverse")),
    unemploymentRate: pct(get("unemployed"), get("laborForce")),
  };
}

// Sum that stays null only if EVERY input is null (a partial bracket still counts).
function sum(...vals: (number | null)[]): number | null {
  const present = vals.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

/**
 * Geocode a one-line address via the Census geocoder (no key needed). Returns
 * { lat, lng } or null. Used to place the church pin on the Mapbox map.
 */
export async function geocodeAddress(oneLine: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", oneLine);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] };
  };
  const match = data.result?.addressMatches?.[0]?.coordinates;
  if (!match) return null;
  return { lat: match.y, lng: match.x };
}
