import Link from "next/link";
import { districtSummary, type DistrictSummary } from "@/lib/atlas-server";
import { DISTRICTS_2025 } from "@/lib/districts";
import { fmtInt, fmtUsd, fmtPct, RISK, type RiskTier } from "@/lib/atlas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Districts" };

const payout = (d: DistrictSummary) => (d.apportioned > 0 ? (d.paid / d.apportioned) * 100 : null);
// payout health color
const payColor = (p: number | null) =>
  p == null ? "var(--color-faint)" : p >= 85 ? "var(--color-teal)" : p >= 70 ? "var(--color-amber)" : "var(--color-ember)";

export default async function DistrictsPage() {
  const summary = await districtSummary();
  const districts = DISTRICTS_2025.filter((d) => summary[d]);

  // conference rollup across the 3 districts
  const total = districts.reduce(
    (a, d) => {
      const s = summary[d];
      a.churches += s.churches; a.members += s.members; a.worship += s.worship;
      a.apportioned += s.apportioned; a.paid += s.paid;
      return a;
    },
    { churches: 0, members: 0, worship: 0, apportioned: 0, paid: 0 },
  );
  const totalPayout = total.apportioned > 0 ? (total.paid / total.apportioned) * 100 : null;

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
      <p className="eyebrow">The 2025 realignment</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink max-w-3xl">Three districts, one ledger.</h1>
      <p className="mt-4 text-ink-mute max-w-2xl">
        In 2025 the conference consolidated seven districts into three — Central, North, and South. Here is how the
        active churches in each compare on size and, most tellingly, on what they were apportioned versus what they paid.
        Apportionment figures are each church&rsquo;s most recently reported year.
      </p>

      {/* conference strip */}
      <section className="mt-8 panel rounded-lg p-6">
        <div className="eyebrow">Conference total · {fmtInt(total.churches)} active churches</div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-5">
          <Stat label="Worship attendance" value={fmtInt(total.worship)} />
          <Stat label="Membership" value={fmtInt(total.members)} />
          <Stat label="Apportionment paid" value={fmtUsd(total.paid)} sub={`of ${fmtUsd(total.apportioned)} asked`} />
          <Stat label="Payout rate" value={fmtPct(totalPayout)} color={payColor(totalPayout)} />
        </div>
        <PayBar paid={total.paid} asked={total.apportioned} />
      </section>

      {/* district cards */}
      <section className="mt-10 grid gap-5 lg:grid-cols-3">
        {[...districts]
          .sort((a, b) => (payout(summary[b]) ?? -1) - (payout(summary[a]) ?? -1))
          .map((name) => {
            const d = summary[name];
            const p = payout(d);
            return (
              <Link
                key={name}
                href={`/districts/${name}`}
                className="panel rounded-lg p-6 hover:ring-1 hover:ring-teal/30 transition-shadow block"
              >
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-2xl text-ink">{name}</h2>
                  <span className="tnum text-sm text-ink-mute">{fmtInt(d.churches)} churches</span>
                </div>

                <div className="mt-5 flex items-end gap-2">
                  <span className="tnum text-4xl font-semibold leading-none" style={{ color: payColor(p) }}>{fmtPct(p, 0)}</span>
                  <span className="text-sm text-ink-mute pb-1">apportionments paid</span>
                </div>
                <PayBar paid={d.paid} asked={d.apportioned} />
                <div className="mt-1 text-xs text-faint tnum">{fmtUsd(d.paid)} of {fmtUsd(d.apportioned)}</div>

                <div className="mt-5 grid grid-cols-2 gap-4">
                  <Stat label="Worship" value={fmtInt(d.worship)} small />
                  <Stat label="Members" value={fmtInt(d.members)} small />
                </div>

                {/* risk mix */}
                <div className="mt-5">
                  <div className="eyebrow mb-1.5">Closure risk</div>
                  <div className="flex h-2 rounded-full overflow-hidden ring-1 ring-rule">
                    {(["low", "moderate", "elevated", "high"] as RiskTier[]).map((t) =>
                      d.risk[t] ? <div key={t} style={{ width: `${(d.risk[t] / d.churches) * 100}%`, background: RISK[t].color }} /> : null,
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-3 text-xs text-ink-mute tnum">
                    {(["elevated", "high"] as RiskTier[]).map((t) => (
                      <span key={t} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: RISK[t].color }} />
                        {d.risk[t]} {RISK[t].label.toLowerCase()}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-5 text-sm text-teal">View district →</div>
              </Link>
            );
          })}
      </section>
    </main>
  );
}

function Stat({ label, value, sub, color, small }: { label: string; value: string; sub?: string; color?: string; small?: boolean }) {
  return (
    <div>
      <div className={`tnum ${small ? "text-2xl" : "text-3xl"} font-semibold`} style={{ color: color ?? "var(--color-ink)" }}>{value}</div>
      <div className="text-xs text-ink-mute mt-0.5">{label}</div>
      {sub && <div className="text-xs text-faint tnum">{sub}</div>}
    </div>
  );
}

function PayBar({ paid, asked }: { paid: number; asked: number }) {
  const pct = asked > 0 ? Math.min(100, (paid / asked) * 100) : 0;
  return (
    <div className="mt-3 flex h-2.5 rounded-full overflow-hidden bg-bone ring-1 ring-rule">
      <div style={{ width: `${pct}%`, background: "var(--color-teal)" }} />
    </div>
  );
}
