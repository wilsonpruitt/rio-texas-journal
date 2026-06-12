import Link from "next/link";
import { TrendChart } from "@/app/_components/TrendChart";
import insights from "@/data/insights.json";
import { fmtInt, fmtUsd, fmtPct } from "@/lib/atlas";

export const dynamic = "force-static";
export const metadata = { title: "Signals" };

type Row = {
  id: string; name: string; city: string | null; district: string | null;
  members: number; worship: number | null; engagement: number | null;
  disciplesPer100: number | null; propValue: number | null; propPerMember: number | null;
};

const rows = insights.churches as Row[];
const trend = insights.engagementTrend as { year: number; ratio: number }[];

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const top = (key: keyof Row, gate = 40, n = 12) =>
  rows.filter((r) => r[key] != null && r.members >= gate).sort((a, b) => (b[key] as number) - (a[key] as number)).slice(0, n);

export default function SignalsPage() {
  const latest = insights.generatedFor;
  const engNow = trend[trend.length - 1].ratio, engThen = trend[0].ratio;
  const medEng = median(rows.filter((r) => r.engagement != null).map((r) => r.engagement!));
  const medDisc = median(rows.filter((r) => r.disciplesPer100 != null).map((r) => r.disciplesPer100!));
  const totalProp = rows.reduce((s, r) => s + (r.propValue ?? 0), 0);
  const medProp = median(rows.filter((r) => r.propPerMember != null).map((r) => r.propPerMember!));

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
