import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, churchMembership } from "@/lib/atlas-server";
import { district2025 } from "@/lib/district-2025";
import { fmtInt, RISK, type RiskTier } from "@/lib/atlas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vitality & Risk" };

export default async function VitalityPage() {
  const sb = await createClient();

  const vits = await fetchAll<{ church_id: string; risk_score: number; risk_tier: RiskTier; observed_status: string }>((s, from, to) =>
    s.from("church_vitality").select("church_id, risk_score, risk_tier, observed_status").eq("observed_status", "active").range(from, to));
  const churches = await fetchAll<{ id: string; canonical_name: string; city: string | null; county_name: string | null }>((s, from, to) =>
    s.from("church").select("id, canonical_name, city, county_name").not("gcfa_number", "is", null).range(from, to));
  const mem = await churchMembership();
  const { data: autopsyData } = await sb.from("model_meta").select("payload").eq("key", "disaffiliation_autopsy").maybeSingle();
  const autopsy = autopsyData?.payload as any;

  const nameMap = new Map(churches.map((c) => [c.id, c]));

  const tiers: Record<RiskTier, number> = { low: 0, moderate: 0, elevated: 0, high: 0 };
  for (const v of vits) tiers[v.risk_tier]++;
  const totalActive = vits.length;

  const atRisk = vits
    .filter((v) => v.risk_tier === "high" || v.risk_tier === "elevated")
    .map((v) => ({ ...v, name: nameMap.get(v.church_id)?.canonical_name ?? "?", city: nameMap.get(v.church_id)?.city ?? null, district: district2025(nameMap.get(v.church_id)?.county_name), members: mem[v.church_id]?.members ?? null }))
    .sort((a, b) => b.risk_score - a.risk_score);

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
      <p className="eyebrow">Vitality & risk</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink max-w-3xl">Which churches are most likely to close — and why.</h1>
      <p className="mt-4 text-ink-mute max-w-2xl">
        A closure-risk score for every active congregation, from a model trained on the {autopsy ? fmtInt(autopsy.closed?.n) : ""} churches
        that have closed since 2000. Size and a sustained membership slide are the strongest signals. Disaffiliation is
        treated separately — it is a different event, examined below.
      </p>

      {/* distribution */}
      <section className="mt-8 panel rounded-lg p-6">
        <div className="eyebrow">Risk distribution · {totalActive} active churches</div>
        <div className="mt-4 flex h-3 rounded-full overflow-hidden ring-1 ring-rule">
          {(["low", "moderate", "elevated", "high"] as RiskTier[]).map((t) => (
            <div key={t} style={{ width: `${(tiers[t] / totalActive) * 100}%`, background: RISK[t].color }} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["low", "moderate", "elevated", "high"] as RiskTier[]).map((t) => (
            <div key={t}>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: RISK[t].color }} />
                <span className="tnum text-2xl font-semibold text-ink">{tiers[t]}</span>
              </div>
              <div className="text-sm text-ink-mute">{RISK[t].label} risk</div>
            </div>
          ))}
        </div>
      </section>

      {/* at-risk ranked list */}
      <section className="mt-12">
        <h2 className="font-display text-2xl text-ink">Watch list — {atRisk.length} churches at elevated or high risk</h2>
        <div className="mt-4 panel rounded-lg overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto] sm:grid-cols-[auto_1fr_1fr_auto_auto] gap-x-4 px-4 py-2.5 border-b border-rule text-xs text-ink-mute">
            <span className="w-10">Score</span><span>Church</span><span className="hidden sm:block">District</span><span className="text-right">Members</span><span className="text-right w-16">Tier</span>
          </div>
          <div className="divide-y divide-rule">
            {atRisk.map((c) => (
              <Link key={c.church_id} href={`/churches/${c.church_id}`} className="grid grid-cols-[auto_1fr_auto_auto] sm:grid-cols-[auto_1fr_1fr_auto_auto] gap-x-4 px-4 py-2.5 items-center hover:bg-vellum transition-colors">
                <span className="tnum text-lg font-semibold w-10" style={{ color: RISK[c.risk_tier].color }}>{c.risk_score}</span>
                <div className="min-w-0"><div className="text-ink truncate">{c.name}</div>{c.city && <div className="text-xs text-faint">{c.city}</div>}</div>
                <span className="hidden sm:block text-sm text-ink-mute truncate">{c.district ?? "—"}</span>
                <span className="text-right tnum text-ink">{fmtInt(c.members)}</span>
                <span className="text-right w-16"><span className={`text-xs px-1.5 py-0.5 rounded ${RISK[c.risk_tier].bg} ${RISK[c.risk_tier].text}`}>{RISK[c.risk_tier].label}</span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* disaffiliation analysis — sober, not splash */}
      {autopsy && (
        <section className="mt-16 border-t border-rule pt-10">
          <p className="eyebrow">A separate question</p>
          <h2 className="mt-2 font-display text-2xl sm:text-3xl text-ink max-w-3xl">Disaffiliation and closure are not the same loss.</h2>
          <p className="mt-3 text-ink-mute max-w-2xl">
            It would be easy to read every departure as decline. The record does not support that. The churches that
            disaffiliated during 2019–2023 and the churches that quietly closed look almost nothing alike.
          </p>
          <div className="mt-7 grid sm:grid-cols-3 gap-4">
            <AnalysisCol label="Still active" n={autopsy.active?.n} size={autopsy.active?.median_size} trend={autopsy.active?.median_membership_cagr} tone="teal" />
            <AnalysisCol label="Disaffiliated" n={autopsy.disaffiliated?.n} size={autopsy.disaffiliated?.median_size} trend={autopsy.disaffiliated?.median_membership_cagr} tone="amber" />
            <AnalysisCol label="Closed" n={autopsy.closed?.n} size={autopsy.closed?.median_size} trend={autopsy.closed?.median_membership_cagr} tone="ember" />
          </div>
          <p className="mt-5 text-sm text-ink-mute max-w-3xl leading-relaxed">
            Churches that closed were small — a median of {fmtInt(autopsy.closed?.median_size)} members — and had been shrinking for years.
            Churches that disaffiliated were larger and roughly stable at a median of {fmtInt(autopsy.disaffiliated?.median_size)} members; their departure was a
            choice, not a collapse. The closure-risk model above deliberately excludes them so that risk reflects vitality, not alignment.
          </p>
        </section>
      )}
    </main>
  );
}

function AnalysisCol({ label, n, size, trend, tone }: { label: string; n: number; size: number; trend: number; tone: "teal" | "amber" | "ember" }) {
  const text = { teal: "text-teal", amber: "text-amber", ember: "text-ember" }[tone];
  return (
    <div className="panel rounded-lg p-5">
      <div className={`text-sm ${text}`}>{label}</div>
      <div className="mt-3 tnum text-3xl font-semibold text-ink">{fmtInt(size)}</div>
      <div className="text-xs text-ink-mute">median members</div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="tnum text-lg text-ink">{trend != null ? `${(trend * 100).toFixed(1)}%` : "—"}</span>
        <span className="text-xs text-faint">annual trend</span>
      </div>
      <div className="mt-2 tnum text-xs text-faint">{fmtInt(n)} churches</div>
    </div>
  );
}
