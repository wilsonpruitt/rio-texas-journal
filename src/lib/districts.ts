import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "./conference.ts";

// Per-conference district payload (byCounty + roster), read from
// conferences/<slug>/districts.json beside that conference's config.ts. See
// ~/wroot-labs/notes/conference-atlas-architecture.md §2b.
type DistrictsData = {
  byCounty: Record<string, string>;
  roster: Record<string, string>;
};

// process.cwd()-based rather than import.meta.url-based: Turbopack statically
// rewrites `new URL(..., import.meta.url)` into an asset reference when this
// module is bundled into the app, which breaks the runtime fs read. cwd is the
// repo root both under `next build`/`next dev` and under plain `node scripts/*.ts`.
const path = join(process.cwd(), "conferences", config.slug, "districts.json");
const data: DistrictsData = JSON.parse(readFileSync(path, "utf8"));

/**
 * Current district for a church, resolved by the conference's configured
 * assignment order (roster override, then county fallback). Per-church roster
 * data is authoritative where present; county inference is the fallback for
 * churches not on the roster (e.g. closed/disaffiliated churches shown with
 * historical context).
 */
export function district2025(countyName: string | null | undefined, gcfaNumber?: string | null): string | null {
  for (const strategy of config.districts.assignment) {
    if (strategy === "roster" && gcfaNumber) {
      const d = data.roster[gcfaNumber];
      if (d) return d;
    }
    if (strategy === "county" && countyName) {
      const d = data.byCounty[countyName.trim().toUpperCase()];
      if (d) return d;
    }
  }
  return null;
}

export const DISTRICTS_2025 = config.districts.current;
