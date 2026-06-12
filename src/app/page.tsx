import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtInt, fmtUsd } from "@/lib/atlas";
import { conferenceSeries } from "@/lib/atlas-server";
import { TrendChart } from "./_components/TrendChart";

export const dynamic = "force-dynamic";

async function counts() {
  const sb = await createClient();
  const one = async (status: string) =>
    (await sb.from("church").select("*", { count: "exact", head: true }).not("gcfa_number", "is", null).eq("status", status)).count ?? 0;
  const total = (await sb.from("church").select("*", { count: "exact", head: true }).not("gcfa_number", "is", null)).count ?? 0;
  const highRisk = (await sb.from("church_vitality").select("*", { count: "exact", head: true }).eq("observed_status", "active").in("risk_tier", ["elevated", "high"])).count ?? 0;
  return { active: await one("active"), closed: await one("closed"), disaff: await one("disaffiliated"), total, highRisk };
}

async function meta(key: string) {
  const sb = await createClient();
  const { data } = await sb.from("model_meta").select("payload").eq("key", key).maybeSingle();
  return data?.payload as any;
}

export default async function Overview() {
  const [c, members, attendance, giving, drivers] = await Promise.all([
    counts(),
    conferenceSeries("MEMBTOT"),
    conferenceSeries("AVATTWOR"),
    conferenceSeries("GRANDTOT"),
    meta("growth_drivers"),
  ]);

  const memPeak = members.length ? Math.max(...members.map((p) => p.value)) : 0;
  const memNow = members.at(-1)?.value ?? 0;
  const memDropPct = memPeak ? Math.round(((memPeak - memNow) / memPeak) * 100) : 0;

  return (
    <main>
      {/* ── Masthead ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 pt-12 sm:pt-16">
        <p className="eyebrow">A statistical atlas · 2000—2024 · {c.total} churches</p>
        <h1 className="mt-3 font-display text-[2.6rem] sm:text-6xl leading-[1.02] text-ink max-w-4xl">
          Five hundred miles of border,
          <br className="hidden sm:block" /> five hundred miles of <span className="italic text-oxblood">coast</span>.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-ink/80 max-w-2xl" style={{ fontFamily: "var(--font-display)" }}>
          The Rio Texas Annual Conference of The United Methodist Church, formed in 2015 from the
          merger of the Southwest Texas and Rio Grande conferences. This atlas follows every
          congregation through a quarter-century of its own statistical record — where the conference
          has grown, where it has thinned, and what tends to come before each.
        </p>
      </section>

      {/* ── Stat band ────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 mt-10">
        <div className="panel rounded-lg grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-rule">
          <Stat n={c.active} label="Active churches" accent="teal" />
          <Stat n={c.disaff} label="Disaffiliated" accent="amber" />
          <Stat n={c.closed} label="Closed since 2000" accent="ember" />
          <Stat n={c.highRisk} label="Active & at-risk" accent="ember" sub="elevated or high" />
        </div>
      </section>

      {/* ── Conference-wide trends ───────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 mt-20">
        <p className="eyebrow">A quarter-century</p>
        <h2 className="mt-2 font-display text-3xl sm:text-4xl text-ink">
          The conference, by the numbers, {members[0]?.year ?? 2000}–{members.at(-1)?.year ?? 2024}.
        </h2>
        <p className="mt-3 text-ink-mute max-w-2xl">
          Professing membership has fallen roughly {memDropPct}% from its peak. Figures before 2015 sum the two
          predecessor conferences.
        </p>
        <div className="mt-8 grid lg:grid-cols-3 gap-5">
          <TrendPanel title="Professing members" series={members} accent="ember" />
          <TrendPanel title="Average worship attendance" series={attendance} accent="ember" />
          <TrendPanel title="Total funds paid" series={giving} accent="teal" format="usd" />
        </div>
      </section>

      {/* ── Growth drivers ───────────────────────────────────── */}
      {drivers?.drivers && (
        <section className="mx-auto max-w-6xl px-5 sm:px-8 mt-20">
          <p className="eyebrow">What precedes growth</p>
          <h2 className="mt-2 font-display text-3xl sm:text-4xl text-ink max-w-3xl">
            Engagement, not size, foretells the next three years.
          </h2>
          <p className="mt-3 text-ink-mute max-w-2xl">
            Correlation between a church&apos;s per-member activity in one year and its membership change three
            years later, across every congregation and year on record.
          </p>
          <div className="mt-8 panel rounded-lg divide-y divide-rule">
            {drivers.drivers.map((d: { factor: string; r: number; n: number }) => (
              <DriverRow key={d.factor} factor={d.factor} r={d.r} n={d.n} />
            ))}
          </div>
        </section>
      )}

      {/* ── Entry points ─────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 mt-20">
        <div className="grid sm:grid-cols-3 gap-4">
          <EntryCard href="/churches" kicker="Browse" title="Every church" desc="481 congregations, 25 years of records, searchable and sortable." />
          <EntryCard href="/map" kicker="Locate" title="The map" desc="Plotted across south and central Texas, colored by trajectory." />
          <EntryCard href="/vitality" kicker="Assess" title="Vitality & risk" desc="Closure-risk scores and peer benchmarks for active churches." />
        </div>
      </section>

      <div className="h-8" />
    </main>
  );
}

function Stat({ n, label, accent, sub }: { n: number; label: string; accent: "teal" | "ember" | "amber"; sub?: string }) {
  const text = { teal: "text-teal", ember: "text-ember", amber: "text-amber" }[accent];
  return (
    <div className="px-5 py-5">
      <div className={`tnum text-3xl sm:text-4xl font-semibold ${text}`}>{fmtInt(n)}</div>
      <div className="mt-1 text-sm text-ink-mute">{label}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

function TrendPanel({ title, series, accent, format }: { title: string; series: { year: number; value: number }[]; accent: "teal" | "ember"; format?: "count" | "usd" }) {
  const first = series[0]?.value ?? 0;
  const last = series.at(-1)?.value ?? 0;
  const pct = first ? Math.round(((last - first) / first) * 100) : 0;
  return (
    <div className="panel rounded-lg p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <span className={`tnum text-xs ${pct < 0 ? "text-ember" : "text-teal"}`}>{pct > 0 ? "+" : ""}{pct}%</span>
      </div>
      <div className="mt-3">
        <TrendChart points={series} accent={accent} format={format ?? "count"} height={120} />
      </div>
    </div>
  );
}

const DRIVER_LABEL: Record<string, string> = {
  attendance_ratio: "Worship attendance per member",
  profession_rate: "Professions of faith per member",
  formation_rate: "Formation participation per member",
  baptism_rate: "Baptisms per member",
  online_worship: "Reports online worship",
};
function DriverRow({ factor, r, n }: { factor: string; r: number; n: number }) {
  const w = Math.min(100, Math.abs(r) * 320);
  const pos = r >= 0;
  return (
    <div className="px-5 py-3.5 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink">{DRIVER_LABEL[factor] ?? factor}</div>
        <div className="text-xs text-faint tnum">n = {fmtInt(n)}</div>
      </div>
      <div className="w-40 h-2 rounded-full bg-parchment overflow-hidden ring-1 ring-rule">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: pos ? "var(--color-teal)" : "var(--color-ember)" }} />
      </div>
      <div className={`tnum text-sm w-14 text-right ${pos ? "text-teal" : "text-ember"}`}>{r > 0 ? "+" : ""}{r.toFixed(2)}</div>
    </div>
  );
}

function EntryCard({ href, kicker, title, desc }: { href: string; kicker: string; title: string; desc: string }) {
  return (
    <Link href={href} className="group panel rounded-lg p-6 hover:bg-vellum transition-colors hover:ring-1 hover:ring-teal/30">
      <div className="eyebrow">{kicker}</div>
      <div className="mt-2 font-display text-2xl text-ink group-hover:text-teal transition-colors">{title}</div>
      <p className="mt-2 text-sm text-ink-mute leading-relaxed">{desc}</p>
      <div className="mt-4 text-teal text-sm opacity-0 group-hover:opacity-100 transition-opacity">Open →</div>
    </Link>
  );
}
