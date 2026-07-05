/**
 * PAR shared model core — expected-professions machinery used by both
 * build-par-baseline.ts (charge-level, rolling) and build-par.ts (pastor PAR,
 * frozen-at-arrival). See build-par-baseline.ts header for the model.
 */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { SupabaseClient } from "@supabase/supabase-js";

export const GATE_MEMBERS = 25;
export const TRAIN_MIN = 2005;
export const TRAIN_MAX = 2023;
export const TRAIL = 3;
export const STRENGTH_CHURCH = 5;
export const STRENGTH_COHORT = 50;

const DIR = new URL("../data/gcfa/", import.meta.url).pathname;

// gcfa -> field -> year -> value
export type StatSeries = Map<string, Map<string, Map<number, number>>>;

export async function loadStats(fields: Set<string>): Promise<StatSeries> {
  const s: StatSeries = new Map();
  const rl = createInterface({ input: createReadStream(DIR + "church_stats.jsonl"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!fields.has(r.field_code) || r.value_numeric == null) continue;
    if (r.field_code === "MEMBTOT" && r.value_numeric === 0) continue; // exit artifact
    const f = s.get(r.gcfa_number) ?? new Map();
    const y = f.get(r.field_code) ?? new Map();
    y.set(r.data_year, r.value_numeric);
    f.set(r.field_code, y);
    s.set(r.gcfa_number, f);
  }
  return s;
}

export type ParContext = {
  idMap: Record<string, string>;
  identByGcfa: Map<string, any>;
  statusByGcfa: Map<string, string>;
  favByGcfa: Map<string, number>;
  favTercile: (gcfa: string) => string;
  eth3: (gcfa: string) => string;
  growthByGcfa: Map<string, number>;
  growthTercile: (gcfa: string) => string;
};

export async function buildContext(db: SupabaseClient, gcfaList: Iterable<string>): Promise<ParContext> {
  const idMap: Record<string, string> = JSON.parse(readFileSync(DIR + "church_id_map.json", "utf8"));
  const churchesJson: any[] = JSON.parse(readFileSync(DIR + "churches.json", "utf8"));
  const identByGcfa = new Map(churchesJson.map((c) => [String(c.gcfa_number), c]));

  const statusByChurchId = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("church").select("id, status").not("gcfa_number", "is", null).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as any[]) statusByChurchId.set(r.id, r.status);
    if (data.length < 1000) break;
  }
  const statusByGcfa = new Map<string, string>();
  for (const [gcfa, id] of Object.entries(idMap)) statusByGcfa.set(gcfa, statusByChurchId.get(id) ?? "unknown");

  type Acs = { zip: string; median_household_income: number | null; poverty_rate: number | null };
  const acsByZip = new Map<string, Acs>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("community_acs").select("zip, median_household_income, poverty_rate").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as Acs[]) acsByZip.set(r.zip, r);
    if (data.length < 1000) break;
  }

  // Community favorability percentile (2023 ACS snapshot; applied to all years — documented limitation).
  const zfn = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1; return (v: number) => (v - m) / sd; };
  const favByGcfa = new Map<string, number>();
  {
    const entries: { gcfa: string; inc: number; pov: number; s: number }[] = [];
    for (const gcfa of gcfaList) {
      const c = identByGcfa.get(gcfa);
      const zip = c?.zip ? String(c.zip).slice(0, 5).padStart(5, "0") : null;
      const acs = zip ? acsByZip.get(zip) : null;
      if (acs?.median_household_income != null && acs.poverty_rate != null) {
        entries.push({ gcfa, inc: acs.median_household_income, pov: acs.poverty_rate, s: 0 });
      }
    }
    const zi = zfn(entries.map((e) => e.inc)), zp = zfn(entries.map((e) => e.pov));
    for (const e of entries) e.s = zi(e.inc) - zp(e.pov);
    entries.sort((a, b) => a.s - b.s);
    entries.forEach((e, i) => favByGcfa.set(e.gcfa, Math.round((i / Math.max(1, entries.length - 1)) * 100)));
  }

  const favTercile = (gcfa: string) => {
    const f = favByGcfa.get(gcfa);
    return f == null ? "fav?" : f < 33 ? "favLo" : f < 67 ? "favMid" : "favHi";
  };
  const eth3 = (gcfa: string) => {
    const e = String(identByGcfa.get(gcfa)?.church_ethnicity ?? "");
    return /Hispanic/i.test(e) ? "Hispanic" : e === "White" ? "White" : "Other";
  };

  // ZIP population growth 2018→2023 (fetch-zip-growth.ts). Fast-growing ZIPs run above
  // a growth-blind expectation (residual r=0.115, monotonic) — so growth is a cohort dim.
  const growthByGcfa = new Map<string, number>();
  {
    const path = new URL("../data/par/zip-growth.json", import.meta.url).pathname;
    if (existsSync(path)) {
      const { growth } = JSON.parse(readFileSync(path, "utf8")) as { growth: Record<string, number> };
      for (const gcfa of growthByGcfaKeys()) {
        const c = identByGcfa.get(gcfa);
        const zip = c?.zip ? String(c.zip).slice(0, 5).padStart(5, "0") : null;
        if (zip && growth[zip] != null) growthByGcfa.set(gcfa, growth[zip]);
      }
    }
    function growthByGcfaKeys() { return identByGcfa.keys(); }
  }
  // tercile cutoffs across churches that have growth data
  const gsorted = [...growthByGcfa.values()].sort((a, b) => a - b);
  const gcut = (q: number) => gsorted[Math.floor(q * (gsorted.length - 1))] ?? 0;
  const g33 = gcut(1 / 3), g67 = gcut(2 / 3);
  const growthTercile = (gcfa: string) => {
    const g = growthByGcfa.get(gcfa);
    return g == null || !gsorted.length ? "gro?" : g < g33 ? "groLo" : g < g67 ? "groMid" : "groHi";
  };

  return { idMap, identByGcfa, statusByGcfa, favByGcfa, favTercile, eth3, growthByGcfa, growthTercile };
}

export const sizeBand = (m: number) => (m < 50 ? "<50" : m < 100 ? "50-99" : m < 250 ? "100-249" : m < 500 ? "250-499" : "500+");

export type ParModel = ReturnType<typeof buildParModel>;

export function buildParModel(stats: StatSeries, ctx: ParContext) {
  const mem = (gcfa: string) => stats.get(gcfa)?.get("MEMBTOT");
  const prof = (gcfa: string) => stats.get(gcfa)?.get("RECPROF");

  // membership entering year t = last reported MEMBTOT in [t-3, t-1]
  const exposure = (gcfa: string, t: number): number | null => {
    const m = mem(gcfa);
    if (!m) return null;
    for (let y = t - 1; y >= t - 3; y--) if (m.has(y)) return m.get(y)!;
    return null;
  };

  // Y(t) = conference-wide professions per member.
  const yearEffect = new Map<number, number>();
  for (let t = TRAIN_MIN; t <= 2024; t++) {
    let obs = 0, exp = 0;
    for (const gcfa of stats.keys()) {
      const e = exposure(gcfa, t), p = prof(gcfa)?.get(t);
      if (e == null || e < GATE_MEMBERS || p == null) continue;
      obs += p;
      exp += e;
    }
    if (exp > 0) yearEffect.set(t, obs / exp);
  }
  // Forecast years: hold flat at the mean of the last 3 full observed years
  // (linear extrapolation of the 2015–2021 collapse runs to ~zero; the rate stabilized post-COVID).
  {
    const recent = [...yearEffect.entries()].filter(([y]) => y <= TRAIN_MAX).sort((a, b) => a[0] - b[0]).slice(-3);
    const flat = recent.reduce((a, [, v]) => a + v, 0) / recent.length;
    for (const t of [2025, 2026, 2027]) yearEffect.set(t, flat);
  }

  const cohortKey = (gcfa: string, exp0: number) => `${sizeBand(exp0)}|${ctx.favTercile(gcfa)}|${ctx.eth3(gcfa)}`;

  // C_k = (sum obs + S) / (sum baseExp + S)
  function cohortTable(maxYear: number): Map<string, number> {
    const agg = new Map<string, { obs: number; exp: number }>();
    for (const gcfa of stats.keys()) {
      for (let t = TRAIN_MIN; t <= maxYear; t++) {
        const e = exposure(gcfa, t), p = prof(gcfa)?.get(t), Y = yearEffect.get(t);
        if (e == null || e < GATE_MEMBERS || p == null || Y == null) continue;
        const k = cohortKey(gcfa, e);
        const a = agg.get(k) ?? { obs: 0, exp: 0 };
        a.obs += p;
        a.exp += e * Y;
        agg.set(k, a);
      }
    }
    const table = new Map<string, number>();
    for (const [k, a] of agg) table.set(k, (a.obs + STRENGTH_COHORT) / (a.exp + STRENGTH_COHORT));
    return table;
  }

  // charge propensity M as of year t (trailing TRAIL-year record ending t-1)
  function propensity(gcfa: string, t: number, cohorts: Map<string, number>): { M: number; cohortM: number } {
    const e0 = exposure(gcfa, t);
    const cohortM = e0 != null ? cohorts.get(cohortKey(gcfa, e0)) ?? 1 : 1;
    let obs = 0, exp = 0;
    for (let y = t - TRAIL; y <= t - 1; y++) {
      const e = exposure(gcfa, y), p = prof(gcfa)?.get(y), Y = yearEffect.get(y);
      if (e == null || p == null || Y == null) continue;
      obs += p;
      exp += e * Y;
    }
    const M = (obs + STRENGTH_CHURCH * cohortM) / (exp + STRENGTH_CHURCH);
    return { M, cohortM };
  }

  // Growth corrector: fast-growing ZIPs run above the growth-blind expectation
  // (residual r=0.115, monotonic). Estimated as a second stage on the model's own
  // residuals — per growth tercile, G = (sum obs + S) / (sum modelExp + S), shrunk
  // toward 1 — then multiplied into every expectation.
  function growthAdjust(maxYear: number, cohorts: Map<string, number>): Map<string, number> {
    const S = 100; // shrink strength, in expected-professions units
    const agg = new Map<string, { obs: number; exp: number }>();
    for (const gcfa of stats.keys()) {
      for (let t = TRAIN_MIN; t <= maxYear; t++) {
        const e = exposure(gcfa, t), p = prof(gcfa)?.get(t);
        if (e == null || e < GATE_MEMBERS || p == null) continue;
        const base = baseExpected(gcfa, t, cohorts);
        if (base == null || base <= 0) continue;
        const k = ctx.growthTercile(gcfa);
        const a = agg.get(k) ?? { obs: 0, exp: 0 };
        a.obs += p;
        a.exp += base;
        agg.set(k, a);
      }
    }
    const table = new Map<string, number>();
    for (const [k, a] of agg) table.set(k, (a.obs + S) / (a.exp + S));
    return table;
  }

  // growth-blind expectation (internal): exposure × year effect × propensity
  const baseExpected = (gcfa: string, t: number, cohorts: Map<string, number>): number | null => {
    const e = exposure(gcfa, t), Y = yearEffect.get(t);
    if (e == null || Y == null) return null;
    return e * Y * propensity(gcfa, t, cohorts).M;
  };

  // rolling expectation (charge forecast): everything as of year t
  const expectedAt = (gcfa: string, t: number, cohorts: Map<string, number>, gAdj?: Map<string, number>): number | null => {
    const base = baseExpected(gcfa, t, cohorts);
    if (base == null) return null;
    return base * (gAdj?.get(ctx.growthTercile(gcfa)) ?? 1);
  };

  // frozen expectation (pastor PAR): the charge AS RECEIVED at arrival year — size and
  // trailing record frozen at arrivalT, only the conference climate Y(t) rolls forward.
  const expectedFrozen = (gcfa: string, t: number, arrivalT: number, cohorts: Map<string, number>, gAdj?: Map<string, number>): number | null => {
    const e = exposure(gcfa, arrivalT), Y = yearEffect.get(t);
    if (e == null || Y == null) return null;
    return e * Y * propensity(gcfa, arrivalT, cohorts).M * (gAdj?.get(ctx.growthTercile(gcfa)) ?? 1);
  };

  return { exposure, yearEffect, cohortTable, growthAdjust, propensity, expectedAt, expectedFrozen };
}
