import { ROSTER_DISTRICT_2025 } from "./district-roster-2025.ts";

// Rio Texas 2025 district realignment (Central / North / South), assigned by COUNTY.
// Derived from the conference's 2025 district-conversion table (district-conversion-2025.json);
// counties map 1:1 to districts (Guadalupe split 3 Central / 1 North → Central). Using county
// avoids church-name matching entirely — every church has a clean GCFA county. The pre-2025
// 7-district structure (Capital, Crossroads, …) remains available as historical context on
// church_cohort.district.

export const DISTRICT_2025_BY_COUNTY: Record<string, "Central" | "North" | "South"> = {
  // North
  MCCULLOCH: "North", MASON: "North", "SAN SABA": "North", LAMPASAS: "North", BURNET: "North",
  TRAVIS: "North", WILLIAMSON: "North", LLANO: "North", HAYS: "North", GILLESPIE: "North",
  BASTROP: "North", CALDWELL: "North", FAYETTE: "North", COLORADO: "North", AUSTIN: "North",
  // Central
  GUADALUPE: "Central", BEXAR: "Central", WILSON: "Central", FRIO: "Central", COMAL: "Central",
  KENDALL: "Central", KERR: "Central", BANDERA: "Central", MEDINA: "Central", UVALDE: "Central",
  ZAVALA: "Central", DIMMIT: "Central", MAVERICK: "Central", SUTTON: "Central", UPTON: "Central",
  "TOM GREEN": "Central", PECOS: "Central", KINNEY: "Central", "VAL VERDE": "Central",
  // South
  WEBB: "South", GONZALES: "South", DEWITT: "South", KARNES: "South", VICTORIA: "South",
  JACKSON: "South", LAVACA: "South", MATAGORDA: "South", CALHOUN: "South", ARANSAS: "South",
  REFUGIO: "South", BEE: "South", GOLIAD: "South", "SAN PATRICIO": "South", NUECES: "South",
  KLEBERG: "South", DUVAL: "South", ZAPATA: "South", HIDALGO: "South", CAMERON: "South",

  // Counties with no church in the source conversion sample — assigned by geography.
  // Flagged for review: adjust if the official 2025 alignment differs.
  BLANCO: "North", WHARTON: "South",
  COKE: "Central", STERLING: "Central", SCHLEICHER: "Central", KIMBLE: "Central", MENARD: "Central",
  ATASCOSA: "Central",
  STARR: "South", "JIM WELLS": "South", WILLACY: "South", BROOKS: "South", "LA SALLE": "South",
};

/**
 * Current (2025) district for a church. The FINAL 07.14.2025 roster (per-church,
 * via gcfaNumber) is authoritative; county inference is the fallback for churches
 * not on that roster (e.g. closed/disaffiliated churches shown with historical context).
 */
export function district2025(countyName: string | null | undefined, gcfaNumber?: string | null): "Central" | "North" | "South" | null {
  if (gcfaNumber) {
    const d = ROSTER_DISTRICT_2025[gcfaNumber];
    if (d) return d;
  }
  if (!countyName) return null;
  return DISTRICT_2025_BY_COUNTY[countyName.trim().toUpperCase()] ?? null;
}

export const DISTRICTS_2025 = ["Central", "North", "South"] as const;
