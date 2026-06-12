import { fetchAll } from "@/lib/atlas-server";
import { district2025 } from "@/lib/district-2025";
import ChurchMap, { type Point } from "./Map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Map" };

export default async function MapPage() {
  const churches = await fetchAll<{ id: string; canonical_name: string; city: string | null; county_name: string | null; status: string; lat: number | null; lng: number | null }>((s, from, to) =>
    s.from("church").select("id, canonical_name, city, county_name, status, lat, lng").not("gcfa_number", "is", null).not("lat", "is", null).range(from, to));
  const vits = await fetchAll<{ church_id: string; risk_tier: string; risk_score: number }>((s, from, to) =>
    s.from("church_vitality").select("church_id, risk_tier, risk_score").range(from, to));
  const memRows = await fetchAll<{ church_id: string; data_year: number; value_numeric: number | null }>((s, from, to) =>
    s.from("church_stat").select("church_id, data_year, value_numeric").eq("source", "gcfa").eq("field_code", "MEMBTOT").range(from, to));

  const vitMap = new Map(vits.map((v) => [v.church_id, v]));
  const byCh = new Map<string, Map<number, number>>();
  for (const r of memRows) { if (r.value_numeric == null || r.value_numeric === 0) continue; if (!byCh.has(r.church_id)) byCh.set(r.church_id, new Map()); byCh.get(r.church_id)!.set(r.data_year, r.value_numeric); }

  const points: Point[] = churches.map((c) => {
    const m = byCh.get(c.id);
    let members: number | null = null, trend: number | null = null;
    if (m && m.size) {
      const yrs = [...m.keys()].sort((a, b) => a - b);
      const last = yrs[yrs.length - 1];
      members = m.get(last)!;
      const baseY = yrs.find((y) => y >= last - 10) ?? yrs[0];
      const base = m.get(baseY)!;
      if (base > 0 && baseY !== last) trend = Math.round(((members - base) / base) * 100);
    }
    const v = vitMap.get(c.id);
    return {
      id: c.id, name: c.canonical_name, city: c.city, lat: c.lat as number, lng: c.lng as number,
      status: c.status, riskTier: v?.risk_tier ?? null, riskScore: v?.risk_score ?? null, members, trend,
      district: district2025(c.county_name),
    };
  });

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
      <p className="eyebrow">The territory</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink">The map</h1>
      <p className="mt-3 text-ink-mute max-w-2xl">
        Every located church across south and central Texas — from Brownsville and the Valle up through
        San Antonio and Austin to San Angelo and the coast. Color by closure risk, trajectory, 2025 district, or status.
      </p>
      <div className="mt-7">
        <ChurchMap points={points} />
      </div>
    </main>
  );
}
