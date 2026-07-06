/**
 * PAR Phase 0 — reconcile appointment-stub churches to GCFA numbers.
 *
 * The clergy-record importer auto-created gcfa-less church rows under
 * "City: Name" canonical names ("San Antonio: Alamo Heights") while the GCFA
 * import named churches "Name City" ("Alamo Heights" + city, "Grace Corpus
 * Christi"). This script token-set-matches every gcfa-less church that carries
 * appointment rows against the GCFA extract and writes an ANALYSIS-TIME map —
 * no DB rows are touched; Phase 2 resolves through the map.
 *
 * Output: scripts/data/par/church-match-map.json
 *   { byChurchId: { <stub church_id>: "<gcfa_number>" }, unmatched: [...] }
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/reconcile-appointment-churches.ts
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import config from "../src/lib/conference.ts";

const DIR = new URL("./data/gcfa/", import.meta.url).pathname;
const OUT = new URL("./data/par/church-match-map.json", import.meta.url).pathname;

// Hand-verified overrides for names token matching can't settle.
// Keyed by the stub church's exact canonical_name -> gcfa_number (or null = confirmed unscoreable).
// Lives at conferences/<slug>/hand-maps/appointment-churches.json; grows during reconciliation.
const HAND_MAP_RAW: Record<string, { value: string | null; _note?: string }> = JSON.parse(
  readFileSync(join(process.cwd(), "conferences", config.slug, "hand-maps", "appointment-churches.json"), "utf8"),
);
const HAND_MAP: Record<string, string | null> = Object.fromEntries(
  Object.entries(HAND_MAP_RAW).map(([k, v]) => [k, v.value]),
);

// Clearly not local churches: extension ministries, conference/district posts, institutions.
const NON_CHURCH_RE =
  /\b(District|Conference|Foundation|Wesley Found|Seminary|Chaplain|Healthcare|Hospital|Ministries|Ministry|Church Start|Executive Director|Dir\.?|Director|Campus Min|Mission Service|Methodist Mission Home|Providence Place|Board of|Cabinet|Student|Divinity School|Bishop|No record|Eligible But Unappointed|Institute|Home$|Communities)\b/i;
// Truncated/garbage parser fragments — not resolvable, not local churches.
const GARBAGE_RE = /^(Assoc\.?|Reti|Supply Pastor,?)$|^o record|Appt,|APPTS/i;

const db = adminClient();

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order("id").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return rows;
}

// --- token normalization -----------------------------------------------------
// Light stemming applied identically to both sides so set-equality survives
// "St. Luke" vs "Saint Lukes", "Memorial" vs "Memorial UMC", accents, etc.
const DROP = new Set(["UMC", "UNITED", "METHODIST", "CHURCH", "IGLESIA", "METODISTA", "UNIDA", "INC"]);
const ALIAS: Record<string, string> = { MEML: "MEMORIAL", WM: "WILLIAM", MTN: "MOUNTAIN" };
// Journal city-prefix abbreviations ("Sant: Pollard Memorial" = San Antonio).
const CITY_PREFIX: Record<string, string> = {
  SANT: "San Antonio", SANG: "San Angelo", CC: "Corpus Christi", V: "Victoria",
  MC: "McAllen", B: "Brownsville", P: "Pharr", L: "Laredo", E: "Edinburg",
};
function expandCityPrefix(name: string): string {
  const m = name.match(/^([A-Za-z]{1,4})\s*:\s*(.+)$/);
  if (m && CITY_PREFIX[m[1].toUpperCase()]) return `${CITY_PREFIX[m[1].toUpperCase()]}: ${m[2]}`;
  return name;
}
function tokens(...parts: (string | null | undefined)[]): Set<string> {
  const s = parts.filter(Boolean).join(" ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")           // strip accents
    .toUpperCase()
    .replace(/\bST\.?\b/g, "SAINT")
    .replace(/\bMT\.?\b/g, "MOUNT")
    .replace(/[^A-Z0-9 ]+/g, " ");
  const out = new Set<string>();
  for (let t of s.split(/\s+/)) {
    if (!t || DROP.has(t)) continue;
    t = ALIAS[t] ?? t;
    if (t.length > 3 && t.endsWith("S")) t = t.slice(0, -1);     // Lukes -> Luke, Heights -> Height (both sides)
    out.add(t);
  }
  return out;
}
const minus = (a: Set<string>, t: string) => { const c = new Set(a); c.delete(t); return c; };
const eq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((t) => b.has(t));
const subset = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((t) => b.has(t));

// --- load both sides ---------------------------------------------------------
type Church = { id: string; canonical_name: string; gcfa_number: string | null; status: string };
type Appt = { id: string; church_id: string };

const churches = await fetchAll<Church>("church", "id, canonical_name, gcfa_number, status");
const appts = await fetchAll<Appt>("appointment", "id, church_id");
const apptCount = new Map<string, number>();
for (const a of appts) apptCount.set(a.church_id, (apptCount.get(a.church_id) ?? 0) + 1);

const gcfaChurches: any[] = JSON.parse(readFileSync(DIR + "churches.json", "utf8"));
type Cand = { gcfa: string; full: Set<string>; name: Set<string>; label: string };
const cands: Cand[] = gcfaChurches
  .filter((c) => c.gcfa_number)
  .map((c) => ({
    gcfa: String(c.gcfa_number),
    full: tokens(c.church_name, c.city),
    name: tokens(c.church_name),
    label: `${c.church_name} (${c.city ?? c.county_name ?? "?"})`,
  }));

// Stubs: gcfa-less churches that actually carry appointment rows.
const stubs = churches
  .filter((c) => !c.gcfa_number && (apptCount.get(c.id) ?? 0) > 0)
  .sort((a, b) => (apptCount.get(b.id) ?? 0) - (apptCount.get(a.id) ?? 0));

// --- match tiers ---------------------------------------------------------------
const byChurchId: Record<string, string> = {};
const nonChurchIds: string[] = [];
const tally = { hand: 0, exact: 0, nameSubset: 0, candSubset: 0, nonChurch: 0, ambiguous: 0, unmatched: 0 };
const unmatchedOut: { name: string; status: string; appts: number; note?: string }[] = [];

for (const stub of stubs) {
  const n = apptCount.get(stub.id) ?? 0;
  if (stub.canonical_name in HAND_MAP) {
    const g = HAND_MAP[stub.canonical_name];
    if (g) { byChurchId[stub.id] = g; tally.hand++; }
    else { nonChurchIds.push(stub.id); tally.nonChurch++; }
    continue;
  }
  if (NON_CHURCH_RE.test(stub.canonical_name) || GARBAGE_RE.test(stub.canonical_name)) {
    nonChurchIds.push(stub.id);
    tally.nonChurch++;
    continue;
  }

  const expanded = expandCityPrefix(stub.canonical_name);
  const full = tokens(expanded);
  // name-part = after "City: " prefix if present
  const namePart = tokens(expanded.includes(":") ? expanded.split(":").slice(1).join(":") : expanded);

  // Tier 1: full token-set equality, unique
  let hits = cands.filter((c) => eq(full, c.full));
  if (hits.length === 1) { byChurchId[stub.id] = hits[0].gcfa; tally.exact++; continue; }
  if (hits.length > 1) { tally.ambiguous++; unmatchedOut.push({ name: stub.canonical_name, status: stub.status, appts: n, note: `ambiguous: ${hits.map((h) => h.label).join(" | ")}` }); continue; }

  // Tier 2: stub full tokens == candidate NAME tokens (gcfa name already embeds city)
  hits = cands.filter((c) => eq(full, c.name));
  if (hits.length === 1) { byChurchId[stub.id] = hits[0].gcfa; tally.exact++; continue; }

  // Tier 2b: "First"-insensitive equality — journal says "Portland: First" where GCFA
  // says "Portland", and journal says "Boerne" where GCFA says "Boerne First".
  const fullNoFirst = minus(full, "FIRST");
  if (fullNoFirst.size >= 1) {
    hits = cands.filter((c) => eq(fullNoFirst, minus(c.full, "FIRST")) || eq(fullNoFirst, minus(c.name, "FIRST")));
    if (hits.length === 1) { byChurchId[stub.id] = hits[0].gcfa; tally.exact++; continue; }
  }

  // Tier 3: stub name-part ⊆ candidate full tokens, unique (city prefix noisy/abbrev)
  if (namePart.size >= 1) {
    hits = cands.filter((c) => subset(namePart, c.full));
    if (hits.length === 1) { byChurchId[stub.id] = hits[0].gcfa; tally.nameSubset++; continue; }
    if (hits.length > 1 && namePart.size >= 2) { tally.ambiguous++; unmatchedOut.push({ name: stub.canonical_name, status: stub.status, appts: n, note: `ambiguous: ${hits.slice(0, 4).map((h) => h.label).join(" | ")}` }); continue; }
  }

  // Tier 4: candidate full tokens ⊆ stub full tokens, unique (stub carries extra words)
  hits = cands.filter((c) => c.full.size >= 2 && subset(c.full, full));
  if (hits.length === 1) { byChurchId[stub.id] = hits[0].gcfa; tally.candSubset++; continue; }

  tally.unmatched++;
  unmatchedOut.push({ name: stub.canonical_name, status: stub.status, appts: n });
}

// Sanity: no two stubs of DIFFERENT canonical names should collide onto huge counts silently — report top collisions
const gcfaHit = new Map<string, string[]>();
for (const [id, g] of Object.entries(byChurchId)) {
  const nm = churches.find((c) => c.id === id)?.canonical_name ?? id;
  (gcfaHit.get(g) ?? gcfaHit.set(g, []).get(g)!).push(nm);
}

const matchedAppts = Object.keys(byChurchId).reduce((s, id) => s + (apptCount.get(id) ?? 0), 0);
const totalStubAppts = stubs.reduce((s, c) => s + (apptCount.get(c.id) ?? 0), 0);

writeFileSync(OUT, JSON.stringify({
  generated: "PAR Phase 0 reconcile",
  byChurchId,
  nonChurchIds,
  unmatched: unmatchedOut.sort((a, b) => b.appts - a.appts),
}, null, 2));

console.log(`stub churches with appointments: ${stubs.length} (${totalStubAppts} appointment rows)`);
console.log(`matched -> gcfa: ${Object.keys(byChurchId).length} stubs / ${matchedAppts} appointment rows`);
console.log(`tiers: hand=${tally.hand} exact=${tally.exact} nameSubset=${tally.nameSubset} candSubset=${tally.candSubset}`);
console.log(`non-church (excluded): ${tally.nonChurch} | ambiguous: ${tally.ambiguous} | unmatched: ${tally.unmatched}`);
console.log(`\nmulti-stub collisions (several stub names -> same gcfa — usually fine, name variants):`);
for (const [g, names] of [...gcfaHit.entries()].filter(([, v]) => v.length > 1).slice(0, 15)) {
  console.log(`  ${g}: ${names.join(" | ")}`);
}
console.log(`\ntop 30 still-unmatched by appointment count:`);
for (const u of unmatchedOut.sort((a, b) => b.appts - a.appts).slice(0, 30)) {
  console.log(`  ${String(u.appts).padStart(3)}  ${u.name}  [${u.status}]${u.note ? "  <<" + u.note : ""}`);
}
console.log(`\nwrote ${OUT}`);
