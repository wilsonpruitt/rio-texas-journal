/**
 * Build per-church + conference "signals" from the GCFA stat panel and bundle them
 * into the app (src/data/insights.json) — no DB write, no migration. Read-only over
 * church_stat, so it deploys cleanly and can be verified locally.
 *
 * Three signals (all from data already loaded):
 *   1. Engagement gap     — worship attendance / membership (who actually shows up)
 *   2. Making disciples   — (professions of faith + baptisms) per 100 members, 3-yr avg
 *   3. Asset vs people     — market value of church property per member
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/build-insights.ts
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { district2025 } from "../src/lib/district-2025.ts";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const FIELDS = new Set(["MEMBTOT", "AVATTWOR", "RECPROF", "NUMBAPT", "VALPROP"]);
const GATE_MEMBERS = 25; // exclude very small churches so ratios aren't dominated by noise
const DIR = new URL("./data/gcfa/", import.meta.url).pathname;
const OUT = new URL("../src/data/insights.json", import.meta.url).pathname;

const db = adminClient();

// authoritative status (disaffiliation reconcile + closures) from the DB — small, fast query
const statusByChurchId = new Map<string, string>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("church").select("id, status").not("gcfa_number", "is", null).range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const r of data as any[]) statusByChurchId.set(r.id, r.status);
  if (data.length < 1000) break;
}

// gcfa -> church_id, and gcfa -> identity (name/city/county) from the local extract
const idMap: Record<string, string> = JSON.parse(readFileSync(DIR + "church_id_map.json", "utf8"));
const churchesJson: any[] = JSON.parse(readFileSync(DIR + "churches.json", "utf8"));
const identByGcfa = new Map(churchesJson.map((c) => [String(c.gcfa_number), c]));

type Church = { id: string; canonical_name: string; city: string | null; county_name: string | null };
const churches: Church[] = [];
for (const [gcfa, id] of Object.entries(idMap)) {
  if (statusByChurchId.get(id) !== "active") continue;
  const c = identByGcfa.get(gcfa);
  churches.push({ id, canonical_name: c?.church_name ?? "(unknown)", city: c?.city ?? null, county_name: c?.county_name ?? null });
}
const gcfaById = new Map(Object.entries(idMap).map(([g, id]) => [id, g]));

// gcfa -> field -> year -> value, read from the local stats extract (avoids DB scan timeouts)
const seriesByGcfa = new Map<string, Map<string, Map<number, number>>>();
const rl = createInterface({ input: createReadStream(DIR + "church_stats.jsonl"), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (!FIELDS.has(r.field_code) || r.value_numeric == null) continue;
  if (r.field_code === "MEMBTOT" && r.value_numeric === 0) continue; // exit artifact
  const f = (seriesByGcfa.get(r.gcfa_number) ?? seriesByGcfa.set(r.gcfa_number, new Map()).get(r.gcfa_number))!;
  const y = (f.get(r.field_code) ?? f.set(r.field_code, new Map()).get(r.field_code))!;
  y.set(r.data_year, r.value_numeric);
}
// re-key series by church_id for the per-church pass
const series = new Map<string, Map<string, Map<number, number>>>();
for (const [gcfa, m] of seriesByGcfa) { const id = idMap[gcfa]; if (id) series.set(id, m); }

const latest = (m: Map<number, number> | undefined): number | null => {
  if (!m || !m.size) return null;
  const y = Math.max(...m.keys());
  return m.get(y) ?? null;
};
// average annual value over the most recent `n` reported years
const recentAvg = (m: Map<number, number> | undefined, n = 3): number | null => {
  if (!m || !m.size) return null;
  const yrs = [...m.keys()].sort((a, b) => b - a).slice(0, n);
  return yrs.reduce((s, y) => s + (m.get(y) ?? 0), 0) / yrs.length;
};

// per-church signals
const out = [];
for (const c of churches) {
  const f = series.get(c.id);
  const members = latest(f?.get("MEMBTOT"));
  if (members == null || members < GATE_MEMBERS) continue;
  const worship = latest(f?.get("AVATTWOR"));
  const prof = recentAvg(f?.get("RECPROF"));
  const bapt = recentAvg(f?.get("NUMBAPT"));
  const propValue = latest(f?.get("VALPROP"));
  out.push({
    id: c.id, name: c.canonical_name, city: c.city, district: district2025(c.county_name),
    members,
    worship,
    engagement: worship != null ? worship / members : null,                       // worship per member
    disciplesPer100: prof != null || bapt != null ? ((prof ?? 0) + (bapt ?? 0)) / members * 100 : null,
    propValue,
    propPerMember: propValue != null ? propValue / members : null,
  });
}

// conference engagement trend (sum worship / sum members per year, all reporting churches)
const trend = new Map<number, { mem: number; wor: number }>();
for (const f of series.values()) {
  const mem = f.get("MEMBTOT"), wor = f.get("AVATTWOR");
  if (!mem) continue;
  for (const [yr, mv] of mem) {
    if (mv === 0) continue;
    const t = trend.get(yr) ?? { mem: 0, wor: 0 };
    t.mem += mv;
    t.wor += wor?.get(yr) ?? 0;
    trend.set(yr, t);
  }
}
const engagementTrend = [...trend.entries()]
  .filter(([yr]) => yr >= 2010)
  .sort((a, b) => a[0] - b[0])
  .map(([year, t]) => ({ year, members: t.mem, worship: t.wor, ratio: t.wor / t.mem }));

const latestYear = Math.max(...engagementTrend.map((t) => t.year));
const payload = { generatedFor: latestYear, gateMembers: GATE_MEMBERS, count: out.length, engagementTrend, churches: out };
writeFileSync(OUT, JSON.stringify(payload, null, 2));

// summary
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log(`${out.length} active churches (>= ${GATE_MEMBERS} members) profiled`);
console.log(`engagement: conference ratio ${engagementTrend[0]?.year} ${(engagementTrend[0]?.ratio * 100).toFixed(0)}% -> ${latestYear} ${(engagementTrend[engagementTrend.length - 1]?.ratio * 100).toFixed(0)}%`);
console.log(`median engagement ${(med(out.filter((c) => c.engagement != null).map((c) => c.engagement!)) * 100).toFixed(0)}% | median disciples/100 ${med(out.filter((c) => c.disciplesPer100 != null).map((c) => c.disciplesPer100!)).toFixed(1)} | median $/member ${Math.round(med(out.filter((c) => c.propPerMember != null).map((c) => c.propPerMember!))).toLocaleString()}`);
console.log(`wrote ${OUT}`);
