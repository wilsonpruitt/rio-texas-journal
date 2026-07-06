import { fetchAll, churchMembership } from "@/lib/atlas-server";
import { district2025 } from "@/lib/districts";
import ChurchMap, { type Point } from "./Map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Map" };

export default async function MapPage() {
  const churches = await fetchAll<{ id: string; canonical_name: string; city: string | null; county_name: string | null; status: string; lat: number | null; lng: number | null; gcfa_number: string }>((s, from, to) =>
    s.from("church").select("id, canonical_name, city, county_name, status, lat, lng, gcfa_number").not("gcfa_number", "is", null).neq("status", "unverified").not("lat", "is", null).range(from, to));
  const vits = await fetchAll<{ church_id: string; risk_tier: string; risk_score: number }>((s, from, to) =>
    s.from("church_vitality").select("church_id, risk_tier, risk_score").range(from, to));
  const mem = await churchMembership();

  const vitMap = new Map(vits.map((v) => [v.church_id, v]));

  const points: Point[] = churches.map((c) => {
    const m = mem[c.id];
    const v = vitMap.get(c.id);
    return {
      id: c.id, name: c.canonical_name, city: c.city, lat: c.lat as number, lng: c.lng as number,
      status: c.status, riskTier: v?.risk_tier ?? null, riskScore: v?.risk_score ?? null,
      members: m?.members ?? null, trend: m?.trend ?? null,
      // Map.tsx's coloring is still keyed to RT's three district names specifically;
      // districts.ts itself is generic now (returns string | null).
      district: district2025(c.county_name, c.gcfa_number) as Point["district"],
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
