import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Page through a Supabase query 1000 rows at a time. */
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

/** Conference-wide yearly SUM of a GCFA field (source='gcfa'). */
export async function conferenceSeries(fieldCode: string, fromYear = 2000, toYear = 2024) {
  const rows = await fetchAll<{ data_year: number; value_numeric: number | null }>((sb, from, to) =>
    sb.from("church_stat").select("data_year, value_numeric").eq("source", "gcfa").eq("field_code", fieldCode).gte("data_year", fromYear).lte("data_year", toYear).range(from, to),
  );
  const byYear = new Map<number, number>();
  for (const r of rows) {
    if (r.value_numeric == null) continue;
    byYear.set(r.data_year, (byYear.get(r.data_year) ?? 0) + r.value_numeric);
  }
  return [...byYear.entries()].map(([year, value]) => ({ year, value })).sort((a, b) => a.year - b.year);
}
