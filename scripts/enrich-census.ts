/**
 * Phase 3 — enrich GCFA churches with Census ACS neighborhood data + coordinates.
 *
 * For each church (with a ZIP): geocode its address to lat/lng if missing (free
 * Census geocoder), then fetch the ACS 5-yr profile for its ZCTA and cache it in
 * community_acs (keyed by zip+year, so churches in the same ZCTA share one fetch).
 *
 * Run (after migration 0020):
 *   node --env-file=.env.local --experimental-strip-types scripts/enrich-census.ts [--dry] [gcfaNumber]
 */
import { adminClient } from './parsers/era_b/lib/db.ts';
import { fetchCensusForZcta, geocodeAddress, ACS_YEAR } from '../src/lib/census.ts';

const DRY = process.argv.includes('--dry');
const ONLY = process.argv.find((a) => /^\d{5,7}$/.test(a));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = adminClient();
  let q = db.from('church')
    .select('id, canonical_name, address, city, state, zip, lat, lng')
    .not('gcfa_number', 'is', null);
  if (ONLY) q = db.from('church').select('id, canonical_name, address, city, state, zip, lat, lng').eq('gcfa_number', ONLY);
  const { data: churches, error } = await q;
  if (error) throw error;
  console.log(`${churches!.length} GCFA churches`);

  const zipCache = new Map<string, boolean>(); // zip already upserted this run
  let geocoded = 0, enriched = 0, noZip = 0, failed = 0;

  for (const c of churches!) {
    // 1. geocode -> lat/lng if missing
    if ((c.lat == null || c.lng == null) && (c.address || c.city)) {
      const oneLine = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
      try {
        const geo = await geocodeAddress(oneLine);
        if (geo && !DRY) {
          await db.from('church').update({ lat: geo.lat, lng: geo.lng }).eq('id', c.id);
          geocoded++;
        } else if (geo) { geocoded++; }
        await sleep(120);
      } catch { /* keep going */ }
    }
    // 2. ACS by ZCTA (cache per zip)
    const zip = c.zip ? String(c.zip).slice(0, 5).padStart(5, '0') : null;
    if (!zip) { noZip++; continue; }
    if (zipCache.has(zip)) { enriched++; continue; }
    try {
      const prof = await fetchCensusForZcta(zip, ACS_YEAR);
      if (prof) {
        if (!DRY) {
          const { error: upErr } = await db.from('community_acs').upsert({
            zip, acs_year: ACS_YEAR,
            total_pop: prof.totalPop, median_age: prof.medianAge,
            median_household_income: prof.medianHouseholdIncome,
            pct_hispanic: prof.pctHispanic, pct_black: prof.pctBlack,
            pct_white: prof.pctWhite, pct_asian: prof.pctAsian,
            pct_under18: prof.pctUnder18, pct_over65: prof.pctOver65,
            pct_family_households: prof.pctFamilyHouseholds,
            poverty_rate: prof.povertyRate, unemployment_rate: prof.unemploymentRate,
          }, { onConflict: 'zip,acs_year' });
          if (upErr) throw upErr;
        }
        zipCache.set(zip, true);
        enriched++;
      } else { failed++; }
      await sleep(120);
    } catch (e) { failed++; console.warn(`! ${c.canonical_name} (${zip}): ${(e as Error).message}`); }
  }
  console.log(`geocoded: ${geocoded}, ACS-enriched churches: ${enriched}, unique ZCTAs: ${zipCache.size}, no-zip: ${noZip}, failed: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
