import Link from "next/link";
import { notFound } from "next/navigation";
import { TrendChart } from "@/app/_components/TrendChart";
import { LockedTeaser } from "@/app/_components/LockedTeaser";
import insights from "@data/public/insights.json";
import par from "@data/public/par.json";
import { fmtInt, fmtUsd, fmtPct } from "@/lib/atlas";
import { isUnlocked } from "@/lib/unlock";
import config from "@/lib/conference";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signals" };

type Row = {
  id: string; name: string; city: string | null; district: string | null;
  members: number; worship: number | null; engagement: number | null;
  disciplesPer100: number | null; propValue: number | null; propPerMember: number | null;
  worshipTrend: number | null; income: number | null; povertyRate: number | null; favorability: number | null;
};

const rows = insights.churches as Row[];
const trend = insights.engagementTrend as { year: number; ratio: number }[];

type ParRow = {
  gcfa: string; id: string | null; name: string; city: string | null; district: string | null;
  members: number | null; propensityPct: number | null;
  history: { year: number; actual: number | null; expected: number | null }[];
  forecast: { year: number; expected: number; lo: number; hi: number }[];
};
const parRows = par.churches as ParRow[];
// over/under-performance vs expectation, summed over the last 3 reported years
const parDelta = (r: ParRow) => {
  const recent = r.history.filter((h) => h.year >= 2022 && h.actual != null && h.expected != null);
  if (recent.length < 2) return null;
  return recent.reduce((s, h) => s + (h.actual! - h.expected!), 0);
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const top = (key: keyof Row, gate = 40, n = 12) =>
  rows.filter((r) => r[key] != null && r.members >= gate).sort((a, b) => (b[key] as number) - (a[key] as number)).slice(0, n);

export default async function SignalsPage() {
  if (!config.modules.signals) notFound();
  const unlocked = await isUnlocked();
  const latest = insights.generatedFor;
  const engNow = trend[trend.length - 1].ratio, engThen = trend[0].ratio;
  const medEng = median(rows.filter((r) => r.engagement != null).map((r) => r.engagement!));
  const medDisc = median(rows.filter((r) => r.disciplesPer100 != null).map((r) => r.disciplesPer100!));
  const totalProp = rows.reduce((s, r) => s + (r.propValue ?? 0), 0);
  const medProp = median(rows.filter((r) => r.propPerMember != null).map((r) => r.propPerMember!));

  // bright-spots quadrant: community favorability (x) vs worship trajectory (y)
  const quad = rows.filter((r) => r.favorability != null && r.worshipTrend != null);
  const bright = quad.filter((r) => r.favorability! <= 40 && r.worshipTrend! > 0).sort((a, b) => b.worshipTrend! - a.worshipTrend!);
  const untapped = quad.filter((r) => r.favorability! >= 60 && r.worshipTrend! < 0).sort((a, b) => a.worshipTrend! - b.worshipTrend!);

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
      <p className="eyebrow">Beneath the membership count</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink max-w-3xl">Signals of vitality.</h1>
      <p className="mt-4 text-ink-mute max-w-2xl">
        Membership is the headline, but it hides more than it shows. Three quieter measures — who actually worships,
        who is making new disciples, and how much property a church carries per member — say more about a
        congregation&rsquo;s life than its roll. Drawn from {insights.count} active churches with {insights.gateMembers}+
        members, through {latest}.
      </p>

      {/* 0. Bright spots — gated (inferential model) */}
      <Section
        eyebrow="Against the odds"
        title={unlocked ? "Demographics don't decide a church's future." : "Growing against the odds."}
        lede={unlocked
          ? `Each church plotted by the affluence of its community (left = harder, right = easier) against its worship trajectory (up = growing). If neighborhood made the church, the dots would climb left to right. They don't. ${bright.length} congregations are growing in the hardest contexts, while ${untapped.length} decline in the most favorable ones — the clearest sign that ministry, not zip code, is doing the work.`
          : "Some congregations thrive where the demographics are hardest, while others decline in the most favorable settings. This analysis maps every church's community context against its worship trajectory to find them."}
      >
        {unlocked ? (
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6">
            <div className="panel rounded-lg p-6">
              <div className="eyebrow">Community favorability vs worship trajectory</div>
              <Scatter rows={quad} />
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-mute">
                <Dot color="var(--color-teal)" label="Growing in a hard context" />
                <Dot color="var(--color-amber)" label="Declining in a good context" />
                <Dot color="var(--color-faint)" label="Other" />
              </div>
            </div>
            <div className="space-y-5">
              <CalloutList heading="Bright spots" sub="growing against a hard context" tone="teal"
                rows={bright.slice(0, 6)} metric={(r) => `+${r.worshipTrend!.toFixed(0)}%`} />
              <CalloutList heading="Untapped potential" sub="declining in a favorable context" tone="amber"
                rows={untapped.slice(0, 6)} metric={(r) => `${r.worshipTrend!.toFixed(0)}%`} />
            </div>
          </div>
        ) : (
          <LockedTeaser title="Bright-spots analysis"
            blurb="Plots every church's community context against its trajectory to surface the congregations growing where the odds are hardest. Enter the access code to view."
            next="/signals" />
        )}
      </Section>

      {/* 1. Engagement */}
      <Section
        eyebrow="The engagement gap"
        title="A quarter of the membership is in the room."
        lede={`Across the conference, average worship attendance has fallen from ${fmtPct(engThen * 100, 0)} of membership in ${trend[0].year} to ${fmtPct(engNow * 100, 0)} in ${trend[trend.length - 1].year}. The roll shrinks slowly; the room empties faster.`}
      >
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6">
          <div className="panel rounded-lg p-6">
            <div className="eyebrow">Worship as a share of membership · conference</div>
            <div className="mt-3">
              <TrendChart points={trend.map((t) => ({ year: t.year, value: +(t.ratio * 100).toFixed(1) }))} accent="amber" format="count" markMergerYear={null} />
            </div>
            <div className="mt-2 text-xs text-faint">Percent of members attending worship in a typical week.</div>
          </div>
          <Leaderboard
            heading="Most engaged"
            note={`Median church: ${fmtPct(medEng * 100, 0)} of members in worship`}
            rows={top("engagement")}
            metric={(r) => fmtPct((r.engagement ?? 0) * 100, 0)}
          />
        </div>
      </Section>

      {/* 2. Discipleship */}
      <Section
        eyebrow="Making disciples"
        title="New faith, not just retained members."
        lede={`Professions of faith and baptisms per 100 members — the rate a church is adding new disciples, smoothed over three years. The median church adds ${medDisc.toFixed(1)} per 100 members a year. Fruitfulness is not the same as size.`}
      >
        <Leaderboard
          heading="Most fruitful"
          note="Professions of faith + baptisms per 100 members per year"
          rows={top("disciplesPer100")}
          metric={(r) => (r.disciplesPer100 ?? 0).toFixed(1)}
          metricLabel="per 100"
          wide
        />
      </Section>

      {/* 2b. Expected professions — gated (predictive model) */}
      <Section
        eyebrow="Regardless of the pastor"
        title={unlocked ? "What each charge should be expected to produce." : "Expected professions of faith."}
        lede={unlocked
          ? `A model of expected professions of faith per charge — built from the charge's size, its own trailing record, its community, and the conference-wide climate of each year (so COVID years are scored against COVID expectations). The gap between actual and expected is the interesting part: it is what the charge did beyond what any charge like it would do. Forecast band is ±1 SD.`
          : "How many professions of faith should a charge of this size, in this community, with this history, be expected to record — regardless of who is appointed there? A context model answers that, and shows who is running ahead of it."}
      >
        {unlocked ? (
          <div className="grid lg:grid-cols-2 gap-6">
            <ParCalloutList heading="Running ahead of expectation" sub="actual − expected professions, last 3 reported years" tone="teal"
              rows={parRows.map((r) => ({ r, d: parDelta(r) })).filter((x): x is { r: ParRow; d: number } => x.d != null && x.d > 0).sort((a, b) => b.d - a.d).slice(0, 8)} />
            <ParCalloutList heading="Running behind expectation" sub="actual − expected professions, last 3 reported years" tone="amber"
              rows={parRows.map((r) => ({ r, d: parDelta(r) })).filter((x): x is { r: ParRow; d: number } => x.d != null && x.d < 0).sort((a, b) => a.d - b.d).slice(0, 8)} />
          </div>
        ) : (
          <LockedTeaser title="Expected-professions model"
            blurb="Models each charge's expected professions of faith from size, history, community context, and conference climate — then shows who is running ahead of or behind it. Enter the access code to view."
            next="/signals" />
        )}
      </Section>

      {/* 3. Assets */}
      <Section
        eyebrow="Property and people"
        title="Carrying buildings the membership can't fill."
        lede={`The conference's active churches hold ${fmtUsd(totalProp)} in property. Measured per member, the load varies enormously — the median is ${fmtUsd(medProp)} per member. The churches below carry the most real estate for the fewest people: the stewardship question the conference will keep facing.`}
      >
        <Leaderboard
          heading="Most property per member"
          note="Market value of church land, buildings & equipment ÷ members"
          rows={top("propPerMember")}
          metric={(r) => fmtUsd(r.propPerMember)}
          sub={(r) => `${fmtUsd(r.propValue)} total`}
          wide
        />
      </Section>

      <p className="mt-14 text-xs text-faint max-w-2xl">
        Source: GCFA local-church statistical tables. Rates use each church&rsquo;s most recent reported figures
        (discipleship smoothed over the last three reported years). Churches under {insights.gateMembers} members are
        excluded so small denominators don&rsquo;t distort the ratios.
      </p>
    </main>
  );
}

function Section({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section className="mt-14 border-t border-rule pt-10 first-of-type:border-t-0 first-of-type:pt-8">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-2 font-display text-2xl sm:text-3xl text-ink max-w-2xl">{title}</h2>
      <p className="mt-3 text-ink-mute max-w-3xl leading-relaxed">{lede}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />{label}</span>;
}

// Community favorability (x, 0–100 percentile) vs worship trajectory (y, % change).
function Scatter({ rows }: { rows: Row[] }) {
  const W = 560, H = 340, P = { l: 44, r: 14, t: 16, b: 34 };
  const yClamp = (v: number) => Math.max(-100, Math.min(120, v));
  const x = (fav: number) => P.l + (fav / 100) * (W - P.l - P.r);
  const yMin = -100, yMax = 120;
  const y = (v: number) => P.t + (1 - (yClamp(v) - yMin) / (yMax - yMin)) * (H - P.t - P.b);
  const color = (r: Row) =>
    r.favorability! <= 40 && r.worshipTrend! > 0 ? "var(--color-teal)"
    : r.favorability! >= 60 && r.worshipTrend! < 0 ? "var(--color-amber)"
    : "var(--color-faint)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label="Bright-spots quadrant">
      {/* quadrant guides */}
      <line x1={x(50)} x2={x(50)} y1={P.t} y2={H - P.b} stroke="var(--color-rule)" strokeWidth="1" />
      <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--color-rule)" strokeWidth="1" />
      {/* y ticks */}
      {[-100, -50, 0, 50, 100].map((v) => (
        <text key={v} x={P.l - 6} y={y(v) + 3} textAnchor="end" className="fill-faint" style={{ fontSize: 9 }}>{v > 0 ? `+${v}` : v}%</text>
      ))}
      {/* x axis labels */}
      <text x={P.l} y={H - 8} textAnchor="start" className="fill-faint" style={{ fontSize: 10 }}>Harder context</text>
      <text x={W - P.r} y={H - 8} textAnchor="end" className="fill-faint" style={{ fontSize: 10 }}>Easier context</text>
      {/* quadrant captions */}
      <text x={x(4)} y={P.t + 10} className="fill-teal" style={{ fontSize: 10, fontWeight: 600 }}>Bright spots</text>
      <text x={W - P.r - 2} y={H - P.b - 6} textAnchor="end" className="fill-amber" style={{ fontSize: 10, fontWeight: 600 }}>Untapped</text>
      {/* points */}
      {rows.map((r) => (
        <circle key={r.id} cx={x(r.favorability!)} cy={y(r.worshipTrend!)} r={color(r) === "var(--color-faint)" ? 2.5 : 3.5}
          fill={color(r)} opacity={color(r) === "var(--color-faint)" ? 0.45 : 0.9} />
      ))}
    </svg>
  );
}

function CalloutList({ heading, sub, tone, rows, metric }: {
  heading: string; sub: string; tone: "teal" | "amber"; rows: Row[]; metric: (r: Row) => string;
}) {
  const text = tone === "teal" ? "text-teal" : "text-amber";
  return (
    <div className="panel rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-rule">
        <div className={`font-medium ${text}`}>{heading}</div>
        <div className="text-xs text-ink-mute">{sub}</div>
      </div>
      <div>
        {rows.map((r) => (
          <Link key={r.id} href={`/churches/${r.id}`} className="flex items-center gap-3 px-4 py-2 border-b border-rule hover:bg-vellum transition-colors">
            <div className="min-w-0 flex-1">
              <div className="text-ink truncate text-sm">{r.name}</div>
              <div className="text-xs text-faint truncate">{[r.city, r.district].filter(Boolean).join(" · ")} · {fmtInt(r.members)} members</div>
            </div>
            <span className={`tnum text-sm font-semibold ${text}`}>{metric(r)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ParCalloutList({ heading, sub, tone, rows }: {
  heading: string; sub: string; tone: "teal" | "amber"; rows: { r: ParRow; d: number }[];
}) {
  const text = tone === "teal" ? "text-teal" : "text-amber";
  return (
    <div className="panel rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-rule">
        <div className={`font-medium ${text}`}>{heading}</div>
        <div className="text-xs text-ink-mute">{sub}</div>
      </div>
      <div>
        {rows.map(({ r, d }) => {
          const f = r.forecast[0];
          const inner = (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-ink truncate text-sm">{r.name}</div>
                <div className="text-xs text-faint truncate">
                  {[r.city, r.district].filter(Boolean).join(" · ")} · {fmtInt(r.members)} members
                  {f ? ` · expect ${f.expected}/yr (${f.lo}–${f.hi})` : ""}
                </div>
              </div>
              <span className={`tnum text-sm font-semibold ${text}`}>{d > 0 ? "+" : ""}{d.toFixed(1)}</span>
            </>
          );
          return r.id ? (
            <Link key={r.gcfa} href={`/churches/${r.id}`} className="flex items-center gap-3 px-4 py-2 border-b border-rule hover:bg-vellum transition-colors">
              {inner}
            </Link>
          ) : (
            <div key={r.gcfa} className="flex items-center gap-3 px-4 py-2 border-b border-rule">{inner}</div>
          );
        })}
      </div>
    </div>
  );
}

function Leaderboard({ heading, note, rows, metric, metricLabel, sub, wide }: {
  heading: string; note: string; rows: Row[]; metric: (r: Row) => string; metricLabel?: string;
  sub?: (r: Row) => string; wide?: boolean;
}) {
  return (
    <div className="panel rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-rule">
        <div className="text-ink font-medium">{heading}</div>
        <div className="text-xs text-ink-mute">{note}</div>
      </div>
      <div className={wide ? "grid sm:grid-cols-2" : ""}>
        {rows.map((r, i) => (
          <Link key={r.id} href={`/churches/${r.id}`}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-rule hover:bg-vellum transition-colors">
            <span className="tnum text-xs text-faint w-5">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-ink truncate text-sm">{r.name}</div>
              <div className="text-xs text-faint truncate">{[r.city, r.district].filter(Boolean).join(" · ")} · {fmtInt(r.members)} members</div>
            </div>
            <div className="text-right">
              <div className="tnum text-ink font-semibold">{metric(r)}{metricLabel && <span className="text-xs text-faint font-normal"> {metricLabel}</span>}</div>
              {sub && <div className="tnum text-xs text-faint">{sub(r)}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
