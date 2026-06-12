/**
 * Phase 2 cleanup backfill (run after import-gcfa + build-models):
 *  1. Fix church.status — churches created fresh by the importer defaulted to
 *     'active'. Any GCFA church last reporting before 2023 is really closed.
 *  2. Normalize church_cohort.district casing to canonical names.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-gcfa-cleanup.ts [--dry]
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";

const DRY = process.argv.includes("--dry");

const DISTRICT_CANON: Record<string, string> = {
  CAPITAL: "Capital", "COASTAL BEND": "Coastal Bend", CROSSROADS: "Crossroads",
  "EL VALLE": "El Valle", "HILL COUNTRY": "Hill Country", "LAS MISIONES": "Las Misiones",
  WEST: "West", "SAN ANTONIO": "San Antonio", AUSTIN: "Austin", VICTORIA: "Victoria",
  MCALLEN: "McAllen", "CORPUS CHRISTI": "Corpus Christi", "SAN ANGELO": "San Angelo",
  KERRVILLE: "Kerrville", NORTHWEST: "Northwest", CENTRAL: "Central", SOUTHERN: "Southern",
  WESTERN: "Western", NORTHERN: "Northern",
};

async function main() {
  const db = adminClient();

  // 1. status fix
  const { data: bad } = await db.from("church").select("id")
    .not("gcfa_number", "is", null).eq("status", "active").lt("last_data_year", 2023);
  const ids = (bad ?? []).map((r: { id: string }) => r.id);
  console.log(`status: ${ids.length} active-but-pre-2023 churches -> closed`);
  if (!DRY && ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db.from("church").update({ status: "closed" }).in("id", ids.slice(i, i + 200));
      if (error) throw error;
    }
  }

  // 2. district casing
  const { data: coh } = await db.from("church_cohort").select("church_id, district");
  let fixed = 0;
  for (const r of (coh ?? []) as { church_id: string; district: string | null }[]) {
    if (!r.district) continue;
    const canon = DISTRICT_CANON[r.district.toUpperCase()] ?? r.district;
    if (canon !== r.district) {
      fixed++;
      if (!DRY) {
        const { error } = await db.from("church_cohort").update({ district: canon }).eq("church_id", r.church_id);
        if (error) throw error;
      }
    }
  }
  console.log(`district: normalized casing on ${fixed} rows`);
  console.log(DRY ? "** DRY — no writes **" : "Done.");
}
main().catch((e) => { console.error(e); process.exit(1); });
