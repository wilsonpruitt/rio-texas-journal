import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Page through a Supabase query 1000 rows at a time.
 * IMPORTANT: the build callback MUST include a stable `.order(...)` (e.g. .order("id")),
 * otherwise PostgREST row order is unstable across pages and aggregations over the
 * paged result will double-count / drop rows.
 */
export async function fetchAll<T>(
  build: (sb: Awaited<ReturnType<typeof createClient>>, from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const sb = await createClient();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await build(sb, from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Conference-wide yearly totals for a GCFA field — read from the precomputed
 * model_meta['conference_series'] row (built by scripts/build-models.ts). Summing
 * over the raw church_stat table here would require paginating ~12k rows per field,
 * which is slow and order-unstable under RLS.
 */
export async function conferenceSeries(fieldCode: string, activeOnly = false) {
  const sb = await createClient();
  const key = activeOnly ? "conference_series_active" : "conference_series";
  const { data } = await sb.from("model_meta").select("payload").eq("key", key).maybeSingle();
  const payload = (data?.payload ?? {}) as Record<string, { year: number; value: number }[]>;
  return payload[fieldCode] ?? [];
}

type Series = Record<string, { year: number; value: number }[]>;

/** Per-2025-district yearly series, both "all" and "active-only" cuts (precomputed). */
export async function districtSeries(name: string): Promise<{ all: Series; active: Series } | null> {
  const sb = await createClient();
  const { data } = await sb.from("model_meta").select("payload").eq("key", "district_series").maybeSingle();
  const payload = (data?.payload ?? {}) as Record<string, { all: Series; active: Series }>;
  return payload[name] ?? null;
}

export type DistrictSummary = {
  churches: number; members: number; worship: number;
  apportioned: number; paid: number;
  risk: Record<"low" | "moderate" | "elevated" | "high", number>;
};

/** Per-2025-district active-church rollup (precomputed by build-models). */
export async function districtSummary(): Promise<Record<string, DistrictSummary>> {
  const sb = await createClient();
  const { data } = await sb.from("model_meta").select("payload").eq("key", "district_summary").maybeSingle();
  return (data?.payload ?? {}) as Record<string, DistrictSummary>;
}

/** Per-church latest membership + worship attendance + 10-yr trend %, keyed by church_id (precomputed). */
export async function churchMembership(): Promise<Record<string, { members: number | null; trend: number | null; worship: number | null; worshipTrend: number | null }>> {
  const sb = await createClient();
  const { data } = await sb.from("model_meta").select("payload").eq("key", "church_membership").maybeSingle();
  return (data?.payload ?? {}) as Record<string, { members: number | null; trend: number | null; worship: number | null; worshipTrend: number | null }>;
}
