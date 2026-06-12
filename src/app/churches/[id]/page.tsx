import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TrendChart, type Pt } from "@/app/_components/TrendChart";
import { RiskMeter } from "@/app/_components/RiskMeter";
import { fmtInt, fmtUsd, fmtPct, STATUS, type RiskTier } from "@/lib/atlas";
import { district2025 } from "@/lib/district-2025";

export const dynamic = "force-dynamic";

const FIELDS = ["MEMBTOT", "AVATTWOR", "GRANDTOT", "NUMBAPT", "RECPROF", "PREPMEMB", "ONLNWOR", "CFTOTAL"];

type StatRow = { data_year: number; field_code: string; value_numeric: number | null };
type ProjRow = { field_code: string; horizon_year: number; projected: number; lo: number; hi: number; base_year: number; base_value: number };

// Scale metrics report 0 in a church's exit/non-report year — treat 0 as missing.
const ZERO_AS_MISSING = new Set(["MEMBTOT", "AVATTWOR", "GRANDTOT"]);
function series(rows: StatRow[], code: string): Pt[] {
  return rows.filter((r) => r.field_code === code && r.value_numeric != null && !(ZERO_AS_MISSING.has(code) && r.value_numeric === 0))
    .map((r) => ({ year: r.data_year, value: r.value_numeric as number }))
    .sort((a, b) => a.year - b.year);
}

export default async function ChurchPage({ params }: PageProps<"/churches/[id]">) {
  const { id } = await params;
  const sb = await createClient();

  const { data: church } = await sb.from("church")
    .select("id, canonical_name, gcfa_number, city, address, state, zip, county_name, status, church_ethnicity, congregation_type, legacy_conferences, first_data_year, last_data_year, lat, lng")
    .eq("id", id).maybeSingle();
  if (!church || !church.gcfa_number || church.status === "unverified") notFound();

  const [statsRes, projRes, vitRes, cohRes] = await Promise.all([
    sb.from("church_stat").select("data_year, field_code, value_numeric").eq("church_id", id).eq("source", "gcfa").in("field_code", FIELDS),
    sb.from("church_projection").select("field_code, horizon_year, projected, lo, hi, base_year, base_value").eq("church_id", id),
    sb.from("church_vitality").select("risk_score, risk_tier, prob_decline, factors, observed_status").eq("church_id", id).maybeSingle(),
    sb.from("church_cohort").select("size_band, ethnicity, district, cohort_key").eq("church_id", id).maybeSingle(),
  ]);
  const stats = (statsRes.data ?? []) as StatRow[];
  const projections = (projRes.data ?? []) as ProjRow[];
  const vit = vitRes.data as { risk_score: number; risk_tier: RiskTier; prob_decline: number; factors: Record<string, number>; observed_status: string } | null;
  const cohort = cohRes.data as { size_band: string; ethnicity: string | null; district: string | null; cohort_key: string } | null;

  const zip = church.zip ? String(church.zip).slice(0, 5).padStart(5, "0") : null;
  const { data: acs } = zip ? await sb.from("community_acs").select("*").eq("zip", zip).maybeSingle() : { data: null };

  // peer benchmarking — latest membership of cohort-mates
  let peerStat: { n: number; pct: number | null } = { n: 0, pct: null };
  if (cohort) {
    const { data: peers } = await sb.from("church_cohort").select("church_id").eq("cohort_key", cohort.cohort_key);
    const ids = (peers ?? []).map((p: { church_id: string }) => p.church_id);
    if (ids.length > 1) {
      const { data: peerMem } = await sb.from("church_stat").select("value_numeric").eq("source", "gcfa").eq("field_code", "MEMBTOT").eq("data_year", church.last_data_year).in("church_id", ids);
      const vals = (peerMem ?? []).map((r: { value_numeric: number | null }) => r.value_numeric).filter((v): v is number => v != null && v > 0);
      const mine = series(stats, "MEMBTOT").at(-1)?.value ?? null;
      if (mine != null && vals.length > 1) {
        const below = vals.filter((v) => v < mine).length;
        peerStat = { n: vals.length, pct: Math.round((below / vals.length) * 100) };
      } else peerStat = { n: vals.length, pct: null };
    }
  }

  const mem = series(stats, "MEMBTOT");
  const att = series(stats, "AVATTWOR");
  const giving = series(stats, "GRANDTOT");
  const memNow = mem.at(-1)?.value ?? null;
  const attNow = att.at(-1)?.value ?? null;
  const memPeak = mem.length ? Math.max(...mem.map((p) => p.value)) : null;
  const memStart = mem[0]?.value ?? null;

  const projFor = (code: string) => {
    if (church.status !== "active") return {}; // projections only meaningful for active churches
    const ps = projections.filter((p) => p.field_code === code).sort((a, b) => a.horizon_year - b.horizon_year);
    if (!ps.length) return {};
    return {
      projection: ps.map((p) => ({ year: p.horizon_year, value: p.projected })),
      band: ps.map((p) => ({ year: p.horizon_year, lo: p.lo, hi: p.hi })),
    };
  };

  const st = STATUS[(church.status as keyof typeof STATUS)] ?? STATUS.active;
  const lineage = (church.legacy_conferences ?? []).join(" → ");
  const district = district2025(church.county_name);
  const eraADistrict = cohort?.district && cohort.district !== district ? cohort.district : null;

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
      <Link href="/churches" className="eyebrow hover:text-ink">← All churches</Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4 pb-6 border-b border-rule">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: st.dot }} />
            <span className={`text-sm ${st.text}`}>{st.label}</span>
            {church.congregation_type && <span className="text-sm text-faint">· {church.congregation_type}</span>}
          </div>
          <h1 className="mt-1 font-display text-4xl sm:text-5xl text-ink">{church.canonical_name}</h1>
          <p className="mt-2 text-ink-mute">
            {[church.city, church.county_name && `${church.county_name.trim()} County`, church.state].filter(Boolean).join(", ")}
            {district && <> · {district} District</>}
          </p>
        </div>
        <div className="text-right text-sm text-faint tnum">
          <div>GCFA #{church.gcfa_number}</div>
          <div>Reported {church.first_data_year}–{church.last_data_year}</div>
          {eraADistrict && <div className="text-ink-mute">Formerly {eraADistrict} District</div>}
          {lineage && <div className="text-ink-mute">{lineage}</div>}
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Members" value={fmtInt(memNow)} sub={memPeak && memNow != null && memPeak !== memNow ? `peak ${fmtInt(memPeak)}` : undefined} />
        <Metric label="Worship attendance" value={fmtInt(attNow)} />
        <Metric label="Attendance / member" value={memNow && attNow ? `${Math.round((attNow / memNow) * 100)}%` : "—"} />
        <Metric
          label={`Since ${mem[0]?.year ?? ""}`}
          value={memStart && memNow != null ? `${memNow >= memStart ? "+" : ""}${Math.round(((memNow - memStart) / memStart) * 100)}%` : "—"}
          sub="membership"
        />
      </section>

      <div className="mt-8 grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <ChartCard title="Professing membership" subtitle="with five-year projection" series={mem} accent="ember" {...projFor("MEMBTOT")} />
          <div className="grid sm:grid-cols-2 gap-5">
            <ChartCard title="Worship attendance" series={att} accent="ember" {...projFor("AVATTWOR")} small />
            <ChartCard title="Total funds paid" series={giving} accent="teal" format="usd" {...projFor("GRANDTOT")} small />
          </div>
        </div>

        <div className="space-y-5">
          {vit && church.status === "active" && (
            <div className="panel rounded-lg p-5">
              <div className="eyebrow">Vitality</div>
              <div className="mt-3"><RiskMeter score={vit.risk_score} tier={vit.risk_tier} /></div>
              <div className="mt-4 pt-4 border-t border-rule space-y-1.5">
                {Object.entries(vit.factors ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <FactorRow key={k} name={k} contrib={v} />
                ))}
              </div>
              <p className="mt-3 text-xs text-faint">Ember pushes toward closure; teal protects against it.</p>
            </div>
          )}
          {vit && church.status !== "active" && (
            <div className="panel rounded-lg p-5">
              <div className="eyebrow">Outcome</div>
              <p className="mt-2 text-ink">Recorded as <span className={st.text}>{st.label.toLowerCase()}</span>.</p>
            </div>
          )}

          {cohort && (
            <div className="panel rounded-lg p-5">
              <div className="eyebrow">Peers · churches like this</div>
              <p className="mt-2 text-sm text-ink-mute">{cohort.size_band} members{cohort.ethnicity ? `, ${cohort.ethnicity}` : ""}</p>
              {peerStat.pct != null ? (
                <>
                  <div className="mt-3 h-2 rounded-full bg-parchment ring-1 ring-rule overflow-hidden">
                    <div className="h-full bg-teal" style={{ width: `${peerStat.pct}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-ink">Larger than <span className="tnum font-medium">{peerStat.pct}%</span> of its {peerStat.n} peers.</p>
                </>
              ) : <p className="mt-2 text-sm text-faint">{peerStat.n} peer churches.</p>}
            </div>
          )}

          {acs && (
            <div className="panel rounded-lg p-5">
              <div className="eyebrow">Neighborhood · ZIP {zip}</div>
              <dl className="mt-3 grid grid-cols-2 gap-y-2.5 gap-x-3 text-sm">
                <Demo label="Population" value={fmtInt(acs.total_pop)} />
                <Demo label="Median income" value={fmtUsd(acs.median_household_income)} />
                <Demo label="Hispanic" value={fmtPct(acs.pct_hispanic)} />
                <Demo label="Over 65" value={fmtPct(acs.pct_over65)} />
                <Demo label="Under 18" value={fmtPct(acs.pct_under18)} />
                <Demo label="Poverty" value={fmtPct(acs.poverty_rate)} />
              </dl>
              <p className="mt-3 text-xs text-faint">U.S. Census ACS 5-year, by ZIP tabulation area.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel rounded-lg px-4 py-3">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className="tnum text-2xl font-semibold text-ink mt-0.5">{value}</div>
      {sub && <div className="text-xs text-faint tnum">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, subtitle, series, accent, format, projection, band, small }: {
  title: string; subtitle?: string; series: Pt[]; accent: "teal" | "ember"; format?: "count" | "usd";
  projection?: Pt[]; band?: { year: number; lo: number; hi: number }[]; small?: boolean;
}) {
  return (
    <div className="panel rounded-lg p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {subtitle && <span className="text-xs text-faint">{subtitle}</span>}
      </div>
      <div className="mt-3">
        <TrendChart points={series} projection={projection} band={band} accent={accent} format={format ?? "count"} height={small ? 120 : 168} />
      </div>
    </div>
  );
}

const FACTOR_LABEL: Record<string, string> = {
  log_size: "Size",
  membership_cagr: "Membership trend",
  attendance_per_member: "Engagement",
  baptism_rate: "Baptisms",
  net_change_rate: "Net change",
};
function FactorRow({ name, contrib }: { name: string; contrib: number }) {
  const w = Math.min(100, Math.abs(contrib) * 60);
  const risky = contrib > 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 text-xs text-ink-mute">{FACTOR_LABEL[name] ?? name}</div>
      <div className="w-24 h-1.5 rounded-full bg-parchment ring-1 ring-rule overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: risky ? "var(--color-ember)" : "var(--color-teal)" }} />
      </div>
    </div>
  );
}

function Demo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-mute">{label}</dt>
      <dd className="tnum text-ink font-medium">{value}</dd>
    </div>
  );
}
