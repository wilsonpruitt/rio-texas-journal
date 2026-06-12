/**
 * Verify church.status against the conference's FINAL 3-district roster
 * (new+districts+RTC+3-Districts+FINAL+07.14.2025-3.pdf). The roster lists every
 * church that exists in the new Central/North/South districts as of July 2025 —
 * so it is authoritative for who is ACTIVE.
 *
 * Reports three discrepancy classes (dry-run; no writes):
 *   1. roster church matched to a DB church whose status != active
 *   2. roster church with NO DB match at all
 *   3. DB-active church never claimed by any roster row (candidate closed/left)
 * Plus: district mismatches vs our county-based district-2025 mapping.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/reconcile-district-roster.ts
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

// Wilson's classifications 2026-06-12, keyed by GCFA number.
// Roster-but-not-active churches default to -> active; these override or extend that.
const DECISIONS: Record<string, "active" | "closed" | "disaffiliated"> = {
  // group A overrides
  "758983": "disaffiliated", // Prairie Lea — DID disaffiliate; roster listing is stale (Wilson)
  // group B: former vote-pending, absent from final roster -> they left
  "758471": "disaffiliated", // Resurrection (SA)
  "758584": "disaffiliated", // Garwood: Lehrer Memorial
  "758642": "disaffiliated", // Hallettsville: First
  "758697": "disaffiliated", // Mossy Grove
  "759987": "disaffiliated", // Mathis
  "761150": "disaffiliated", // Granite Shoals: Grace
  "761172": "disaffiliated", // Walnut (Buchanan Dam)
  "763125": "disaffiliated", // Veribest
  "758265": "closed",        // St Luke Austin (Wilson)
  // undecided, left active: Nuevo Pacto 750670, Hope Arise 760873, Saint Johns SA 764186
};

const PDF = "/Users/wilsonpruitt/Downloads/new+districts+RTC+3-Districts+FINAL+07.14.2025-3.pdf";
const OLD_DISTRICTS = new Set(["West", "Capital", "Hill Country", "Crossroads", "Las Misiones", "Coastal Bend", "El Valle"]);

// Hand-map for rows the fuzzy matcher misses (roster "name|city" -> GCFA number). Verified against DB 2026-06-12.
const HAND_MAP: Record<string, string> = {
  "The Journey UMC|Kyle": "758458",        // The Journey (Buda) — roster lists under Kyle
  "Spring Creek UMC|San Antonio": "764392",// Spring Creek (Fair Oaks Ranch, Bexar-adjacent)
  "Lakehills UMC|Pipe Creek": "760532",    // Lakehills (Bandera Co.)
  "Gruene UMC|Gruene": "758595",           // Gruene (New Braunfels)
  "First UMC / MBH|Eagle Pass": "762440",  // mangled canonical "Eagle [ Pass"
  "St. Paul’s UMC|Austin": "758460",       // Saint Paul Austin — PAULS/PAUL token tie vs St Johns
  "St. Mark UMC|Lockhart": "985140",       // Lockhart: St. Mark's — tie vs St Mark Austin
};

const STOP = new Set(["UMC", "THE", "OF", "CHURCH", "UNITED", "METHODIST"]);

function tokens(name: string): Set<string> {
  let s = name.replace(/ﬂ/g, "fl").replace(/ﬁ/g, "fi").toUpperCase();
  s = s.replace(/\bST\b\.?/g, "SAINT").replace(/\bMT\b\.?/g, "MOUNT");
  s = s.replace(/['’]S\b/g, "S"); // possessive: PETER'S -> PETERS (matches DB "Peters")
  s = s.replace(/\bLAGRANGE\b/g, "LA GRANGE");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  return new Set(s.split(/\s+/).filter((t) => t && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

type RosterRow = { district: string; county: string; city: string; church: string; oldDistrict: string };

function parseRoster(): RosterRow[] {
  const txt = execFileSync("pdftotext", ["-layout", PDF, "-"], { encoding: "utf8" });
  const rows: RosterRow[] = [];
  let district = "";
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, "").trimEnd();
    const hdr = line.match(/^\s*(North|Central|South) District\s*$/);
    if (hdr) { district = hdr[1]; continue; }
    if (!/^\s*\d+\s{2,}/.test(line)) continue; // not a data row
    const f = line.trim().split(/\s{2,}/);
    if (f.length === 2 && /^\d+$/.test(f[1])) continue; // footer "countyCount churchCount"
    if (f.length !== 5) { console.warn(`⚠ malformed row (${f.length} cols): ${line.trim()}`); continue; }
    const [, county, city, church, oldDistrict] = f;
    if (!OLD_DISTRICTS.has(oldDistrict)) { console.warn(`⚠ unknown old district "${oldDistrict}": ${line.trim()}`); continue; }
    rows.push({ district, county, city, church: church.replace(/ﬂ/g, "fl"), oldDistrict });
  }
  return rows;
}

async function main() {
  const db = adminClient();
  const roster = parseRoster();
  const perDist: Record<string, number> = {};
  roster.forEach((r) => (perDist[r.district] = (perDist[r.district] ?? 0) + 1));
  console.log(`Roster parsed: ${roster.length} churches`, JSON.stringify(perDist));

  // all DB churches (any status) that carry a gcfa identity
  const all: { id: string; canonical_name: string; status: string; city: string | null; gcfa_number: string }[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from("church")
      .select("id, canonical_name, status, city, gcfa_number")
      .not("gcfa_number", "is", null).range(f, f + 999);
    if (error) throw error;
    if (!data?.length) break; all.push(...(data as typeof all)); if (data.length < 1000) break;
  }
  console.log(`DB churches with gcfa_number: ${all.length} (active ${all.filter((c) => c.status === "active").length})`);
  const ours = all.map((c) => ({ ...c, tok: tokens(`${c.canonical_name} ${c.city ?? ""}`) }));
  const byGcfa = new Map(ours.map((o) => [o.gcfa_number, o]));

  const claimed = new Map<string, RosterRow>(); // db id -> roster row
  const out: { r: RosterRow; match: typeof ours[0] | null; score: number; hand?: boolean }[] = [];
  for (const r of roster) {
    const hand = HAND_MAP[`${r.church}|${r.city}`] ?? HAND_MAP[r.church];
    if (hand) {
      const o = byGcfa.get(hand) ?? null;
      out.push({ r, match: o, score: 1, hand: true });
      if (o) claimed.set(o.id, r);
      continue;
    }
    const rt = tokens(`${r.church} ${r.city}`);
    let best: typeof ours[0] | null = null, bestScore = 0;
    for (const o of ours) {
      const sc = jaccard(rt, o.tok);
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    const ok = bestScore >= 0.5 ? best : null;
    out.push({ r, match: ok, score: bestScore });
    if (ok) claimed.set(ok.id, r);
  }

  // class 1: roster church matched but our status != active
  const wrongStatus = out.filter((o) => o.match && o.match.status !== "active");
  console.log(`\n=== ROSTER CHURCH BUT OUR STATUS != active (${wrongStatus.length}) — should likely be active`);
  wrongStatus.forEach((o) =>
    console.log(`  [${o.r.district}] ${o.r.church} (${o.r.city}) -> ${o.match!.canonical_name} [${o.match!.gcfa_number}] status=${o.match!.status} score=${o.score.toFixed(2)}`));

  // class 2: roster church with no DB match
  const noMatch = out.filter((o) => !o.match);
  console.log(`\n=== ROSTER CHURCH WITH NO DB MATCH (${noMatch.length})`);
  noMatch.forEach((o) => console.log(`  [${o.r.district}] ${o.r.church} (${o.r.city}, ${o.r.county}) best=${o.score.toFixed(2)}`));

  // class 3: DB-active churches never claimed by a roster row
  const unclaimed = ours.filter((o) => o.status === "active" && !claimed.has(o.id));
  console.log(`\n=== DB-ACTIVE BUT NOT ON ROSTER (${unclaimed.length}) — candidates for closed/left`);
  unclaimed.forEach((o) => console.log(`  ${o.canonical_name} [${o.gcfa_number}] city=${o.city ?? "?"}`));

  // duplicate claims (two roster rows -> same DB church) indicate matcher trouble
  const claimCount = new Map<string, number>();
  out.forEach((o) => { if (o.match) claimCount.set(o.match.id, (claimCount.get(o.match.id) ?? 0) + 1); });
  const dups = out.filter((o) => o.match && claimCount.get(o.match.id)! > 1);
  if (dups.length) {
    console.log(`\n=== DUPLICATE CLAIMS (${dups.length} rows share a DB church) — matcher needs hand-map`);
    dups.forEach((o) => console.log(`  [${o.r.district}] ${o.r.church} (${o.r.city}) -> ${o.match!.canonical_name} [${o.match!.gcfa_number}] score=${o.score.toFixed(2)}`));
  }

  // review TSV with every roster row
  const tsv = out.map((o) => [o.r.district, o.r.county, o.r.city, o.r.church, o.r.oldDistrict,
    o.match?.canonical_name ?? "*** NO MATCH ***", o.match?.gcfa_number ?? "", o.match?.status ?? "",
    o.hand ? "hand" : o.score.toFixed(2)].join("\t"));
  writeFileSync(new URL("./data/district-roster-reconcile.tsv", import.meta.url).pathname,
    "new_district\tcounty\tcity\tchurch\told_district\tour_match\tgcfa\tour_status\tscore\n" + tsv.join("\n"));
  console.log("\nReview file: scripts/data/district-roster-reconcile.tsv");

  // authoritative per-church district map (gcfa -> Central/North/South), consumed by district2025()
  const byGcfa2: Record<string, string> = {};
  for (const o of out) if (o.match) byGcfa2[o.match.gcfa_number] = o.r.district;
  writeFileSync(new URL("../src/lib/district-roster-2025.ts", import.meta.url).pathname,
    `// GENERATED by scripts/reconcile-district-roster.ts from the FINAL 07.14.2025 roster PDF.\n` +
    `// Authoritative church->district assignment; overrides the county inference in district-2025.ts.\n` +
    `export const ROSTER_DISTRICT_2025: Record<string, "Central" | "North" | "South"> =\n` +
    `${JSON.stringify(byGcfa2, null, 1)} as const;\n`);
  console.log(`District override map: src/lib/district-roster-2025.ts (${Object.keys(byGcfa2).length} churches)`);

  // resolve target status: DECISIONS override; otherwise roster presence -> active
  const changes: { id: string; gcfa: string; name: string; from: string; to: string }[] = [];
  for (const o of out) {
    if (!o.match) continue;
    const to = DECISIONS[o.match.gcfa_number] ?? "active";
    if (o.match.status !== to) changes.push({ id: o.match.id, gcfa: o.match.gcfa_number, name: o.match.canonical_name, from: o.match.status, to });
  }
  for (const o of unclaimed) {
    const to = DECISIONS[o.gcfa_number];
    if (to && o.status !== to) changes.push({ id: o.id, gcfa: o.gcfa_number, name: o.canonical_name, from: o.status, to });
  }
  console.log(`\nPlanned status changes: ${changes.length}`);
  changes.forEach((c) => console.log(`  ${c.name} [${c.gcfa}] ${c.from} -> ${c.to}`));

  if (APPLY) {
    for (const c of changes) {
      const { error } = await db.from("church").update({ status: c.to }).eq("id", c.id);
      if (error) throw error;
    }
    console.log(`\nApplied ${changes.length} status updates.`);
  } else {
    console.log("\n(dry run — pass --apply to write)");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
