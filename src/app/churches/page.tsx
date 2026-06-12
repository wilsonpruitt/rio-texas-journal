import { fetchAll } from "@/lib/atlas-server";
import { district2025 } from "@/lib/district-2025";
import SearchableList, { type Row } from "./SearchableList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Churches" };

export default async function ChurchesPage() {
  const churches = await fetchAll<{ id: string; canonical_name: string; status: Row["status"]; city: string | null; county_name: string | null }>((s, from, to) =>
    s.from("church").select("id, canonical_name, status, city, county_name").not("gcfa_number", "is", null).range(from, to));
  const vits = await fetchAll<{ church_id: string; risk_tier: Row["riskTier"]; risk_score: number }>((s, from, to) =>
    s.from("church_vitality").select("church_id, risk_tier, risk_score").range(from, to));
  const memRows = await fetchAll<{ church_id: string; data_year: number; value_numeric: number | null }>((s, from, to) =>
    s.from("church_stat").select("church_id, data_year, value_numeric").eq("source", "gcfa").eq("field_code", "MEMBTOT").range(from, to));

  const vitMap = new Map(vits.map((v) => [v.church_id, v]));

  // latest + ~10yr-prior membership per church (ignoring 0 exit-year values)
  const memByChurch = new Map<string, Map<number, number>>();
  for (const r of memRows) {
    if (r.value_numeric == null || r.value_numeric === 0) continue;
    if (!memByChurch.has(r.church_id)) memByChurch.set(r.church_id, new Map());
    memByChurch.get(r.church_id)!.set(r.data_year, r.value_numeric);
  }

  const rows: Row[] = churches.map((c) => {
    const m = memByChurch.get(c.id);
    let members: number | null = null, trend: number | null = null;
    if (m && m.size) {
      const yrs = [...m.keys()].sort((a, b) => a - b);
      const lastY = yrs[yrs.length - 1];
      members = m.get(lastY)!;
      const baseY = yrs.find((y) => y >= lastY - 10) ?? yrs[0];
      const base = m.get(baseY)!;
      if (base > 0 && baseY !== lastY) trend = Math.round(((members - base) / base) * 100);
    }
    const v = vitMap.get(c.id);
    return {
      id: c.id, name: c.canonical_name, status: c.status, city: c.city,
      district: district2025(c.county_name), members, trend,
      riskTier: v?.risk_tier ?? null, riskScore: v?.risk_score ?? null,
    };
  });

  const districts = [...new Set(rows.filter((r) => r.status === "active" && r.district).map((r) => r.district as string))].sort();

  return (
    <main className="mx-auto max-w-5xl px-5 sm:px-8 py-10">
      <p className="eyebrow">The roll</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink">Every church</h1>
      <p className="mt-3 text-ink-mute max-w-2xl">
        All {rows.length} congregations on record in the Rio Texas conference and its predecessors, 2000–2024.
        Search, filter by district, and sort by size, trajectory, or closure risk.
      </p>
      <div className="mt-7">
        <SearchableList rows={rows} districts={districts} />
      </div>
    </main>
  );
}
