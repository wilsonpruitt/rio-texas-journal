import { TrendChart } from "@/app/_components/TrendChart";
import ConferenceScenario from "./ConferenceScenario";
import financeJson from "@/data/conference-finance.json";
import { type FinanceRow, defaultAssumptions, cagr } from "@/lib/finance-model";
import { fmtUsd, fmtPct } from "@/lib/atlas";

export const dynamic = "force-static";
export const metadata = { title: "Conference Finance" };

const rows = financeJson as FinanceRow[];

export default function ConferencePage() {
  const first = rows[0], last = rows[rows.length - 1];
  const baseline = defaultAssumptions(rows);

  const apportPts = rows.filter((r) => r.apportionment_rev != null).map((r) => ({ year: r.data_year, value: r.apportionment_rev as number }));
  const netPts = rows.filter((r) => r.net_assets_eoy != null).map((r) => ({ year: r.data_year, value: r.net_assets_eoy as number }));
  const apportCagr = cagr(rows, "apportionment_rev");
  const apportDropPct = first.apportionment_rev && last.apportionment_rev
    ? ((last.apportionment_rev - first.apportionment_rev) / first.apportionment_rev) * 100 : null;
  const lastProgram = last.program_exp ?? null;
  const lastAdmin = last.gen_admin_exp ?? null;
  const adminShare = lastProgram != null && lastAdmin != null ? (lastAdmin / (lastProgram + lastAdmin)) * 100 : null;

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
      <p className="eyebrow">The conference ledger</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink max-w-3xl">The money, and where it is going.</h1>
      <p className="mt-4 text-ink-mute max-w-2xl">
        Drawn from the conference&rsquo;s audited financial statements, {first.data_year}–{last.data_year}. Apportionment
        revenue — the giving that funds nearly everything connectional — has fallen with the membership it is assessed on.
        Below, you can bend the assumptions and watch how the reserves respond over the next five years.
      </p>

      {/* headline stats */}
      <section className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-5">
        <Stat label={`Apportionment revenue (${last.data_year})`} value={fmtUsd(last.apportionment_rev)} sub={apportDropPct != null ? `${apportDropPct.toFixed(0)}% since ${first.data_year}` : undefined} tone="ember" />
        <Stat label="Annual decline rate" value={apportCagr != null ? fmtPct(apportCagr * 100) : "—"} sub="compounded" tone="ember" />
        <Stat label={`Reserves (${last.data_year})`} value={fmtUsd(last.net_assets_eoy)} sub="net assets, end of year" />
        <Stat label="Spent on administration" value={adminShare != null ? fmtPct(adminShare) : "—"} sub={`${fmtUsd(lastAdmin)} of operating`} />
      </section>

      {/* historical trends */}
      <section className="mt-10 grid md:grid-cols-2 gap-6">
        <div className="panel rounded-lg p-6">
          <div className="eyebrow">Apportionment revenue</div>
          <div className="mt-1 text-sm text-ink-mute">{first.data_year}–{last.data_year}, audited</div>
          <div className="mt-3"><TrendChart points={apportPts} accent="ember" format="usd" markMergerYear={null} /></div>
        </div>
        <div className="panel rounded-lg p-6">
          <div className="eyebrow">Reserves (net assets)</div>
          <div className="mt-1 text-sm text-ink-mute">{first.data_year}–{last.data_year}, end of year</div>
          <div className="mt-3"><TrendChart points={netPts} accent="teal" format="usd" markMergerYear={null} /></div>
        </div>
      </section>

      {/* scenario tool */}
      <section className="mt-14">
        <p className="eyebrow">What if?</p>
        <h2 className="mt-2 font-display text-2xl sm:text-3xl text-ink max-w-2xl">Test a different future.</h2>
        <p className="mt-3 text-ink-mute max-w-2xl">
          The sliders start on each line&rsquo;s recent trend. Push apportionment giving up, hold the line on expenses, or
          change what the reserves earn — and see where the conference&rsquo;s finances land by {last.data_year + 5}.
        </p>
        <div className="mt-6">
          <ConferenceScenario rows={rows} baseline={baseline} />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ember" }) {
  return (
    <div className="panel rounded-lg p-5">
      <div className={`tnum text-2xl sm:text-3xl font-semibold ${tone === "ember" ? "text-ember" : "text-ink"}`}>{value}</div>
      <div className="text-xs text-ink-mute mt-1">{label}</div>
      {sub && <div className="text-xs text-faint tnum mt-0.5">{sub}</div>}
    </div>
  );
}
