import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchAll, churchMembership, districtSummary, districtSeries } from "@/lib/atlas-server";
import { district2025, DISTRICTS_2025 } from "@/lib/districts";
import { fmtInt, fmtUsd, fmtPct, RISK, type RiskTier } from "@/lib/atlas";
import SearchableList, { type Row } from "../../churches/SearchableList";
import { ConferenceTrends } from "../../_components/ConferenceTrends";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  return { title: `${id} District` };
}

const payColor = (p: number | null) =>
  p == null ? "var(--color-faint)" : p >= 85 ? "var(--color-teal)" : p >= 70 ? "var(--color-amber)" : "var(--color-ember)";

export default async function DistrictPage({ params }: Params) {
  const { id } = await params;
  const name = DISTRICTS_2025.find((d) => d.toLowerCase() === id.toLowerCase());
  if (!name) notFound();

  const summary = await districtSummary();
  const d = summary[name];
  if (!d) notFound();
  const payout = d.apportioned > 0 ? (d.paid / d.apportioned) * 100 : null;

  const ds = await districtSeries(name);
  const trends = ds && {
    all: { members: ds.all.MEMBTOT ?? [], attendance: ds.all.AVATTWOR ?? [], giving: ds.all.GRANDTOT ?? [] },
    active: { members: ds.active.MEMBTOT ?? [], attendance: ds.active.AVATTWOR ?? [], giving: ds.active.GRANDTOT ?? [] },
  };

  // roster — active churches in this district
  const churches = await fetchAll<{ id: string; canonical_name: string; status: Row["status"]; city: string | null; county_name: string | null; gcfa_number: string }>((s, from, to) =>
    s.from("church").select("id, canonical_name, status, city, county_name, gcfa_number").not("gcfa_number", "is", null).range(from, to));
  const vits = await fetchAll<{ church_id: string; risk_tier: Row["riskTier"]; risk_score: number }>((s, from, to) =>
    s.from("church_vitality").select("church_id, risk_tier, risk_score").range(from, to));
  const mem = await churchMembership();
  const vitMap = new Map(vits.map((v) => [v.church_id, v]));

  const rows: Row[] = churches
    .filter((c) => c.status === "active" && district2025(c.county_name, c.gcfa_number) === name)
    .map((c) => {
      const m = mem[c.id];
      const v = vitMap.get(c.id);
      return {
        id: c.id, name: c.canonical_name, status: c.status, city: c.city, district: name,
        worship: m?.worship ?? null, worshipTrend: m?.worshipTrend ?? null,
        riskTier: v?.risk_tier ?? null, riskScore: v?.risk_score ?? null,
      };
    });

  return (
    <main className="mx-auto max-w-5xl px-5 sm:px-8 py-10">
      <Link href="/districts" className="text-sm text-teal hover:underline">← All districts</Link>
      <p className="mt-4 eyebrow">2025 district</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink">{name}</h1>
      <p className="mt-3 text-ink-mute">{fmtInt(d.churches)} active churches</p>

      {/* headline stats */}
      <section className="mt-7 panel rounded-lg p-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <Stat label="Worship attendance" value={fmtInt(d.worship)} />
          <Stat label="Membership" value={fmtInt(d.members)} />
          <Stat label="Apportionment paid" value={fmtUsd(d.paid)} sub={`of ${fmtUsd(d.apportioned)} asked`} />
          <Stat label="Payout rate" value={fmtPct(payout)} color={payColor(payout)} />
        </div>
        <div className="mt-4 flex h-2.5 rounded-full overflow-hidden bg-bone ring-1 ring-rule">
          <div style={{ width: `${d.apportioned > 0 ? Math.min(100, (d.paid / d.apportioned) * 100) : 0}%`, background: "var(--color-teal)" }} />
        </div>

        {/* risk mix */}
        <div className="mt-6">
          <div className="eyebrow mb-1.5">Closure risk · {fmtInt(d.churches)} churches</div>
          <div className="flex h-2.5 rounded-full overflow-hidden ring-1 ring-rule">
            {(["low", "moderate", "elevated", "high"] as RiskTier[]).map((t) =>
              d.risk[t] ? <div key={t} style={{ width: `${(d.risk[t] / d.churches) * 100}%`, background: RISK[t].color }} /> : null,
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-ink-mute tnum">
            {(["low", "moderate", "elevated", "high"] as RiskTier[]).map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: RISK[t].color }} />
                {d.risk[t]} {RISK[t].label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* trends */}
      {trends && (
        <section className="mt-12">
          <h2 className="font-display text-2xl text-ink">A quarter-century in {name}</h2>
          <p className="mt-2 text-sm text-ink-mute max-w-2xl">
            District totals follow the 2025 boundaries back through every year. Toggle to see only the churches still
            active in this district today.
          </p>
          <ConferenceTrends all={trends.all} active={trends.active} activeCount={d.churches} />
        </section>
      )}

      {/* roster */}
      <section className="mt-12">
        <h2 className="font-display text-2xl text-ink">Churches</h2>
        <div className="mt-4">
          <SearchableList rows={rows} districts={[]} />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div className="tnum text-2xl sm:text-3xl font-semibold" style={{ color: color ?? "var(--color-ink)" }}>{value}</div>
      <div className="text-xs text-ink-mute mt-0.5">{label}</div>
      {sub && <div className="text-xs text-faint tnum">{sub}</div>}
    </div>
  );
}
