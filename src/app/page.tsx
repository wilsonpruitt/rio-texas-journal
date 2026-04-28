import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import Trendline, { type Point } from './Trendline';

export const dynamic = 'force-dynamic';

const HEADLINE_FIELDS = ['4', '7', '7a', '29a', '55'] as const;

export default async function Home() {
  const supabase = await createClient();

  // Conference-wide totals per data_year for the headline metrics.
  // Pull only churches that were ACTIVE that year (have a district_history
  // entry for that data_year) so we don't double-count disaffiliated
  // churches' tail data when computing trends.
  const trendRows: { data_year: number; field_code: string; value_numeric: number | null }[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('church_stat')
      .select('data_year, field_code, value_numeric')
      .in('field_code', HEADLINE_FIELDS as unknown as string[])
      .range(from, from + PAGE - 1);
    if (error) break;
    trendRows.push(...((data ?? []) as typeof trendRows));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  // Build per-year sums per field.
  type Sum = { sum: number; count: number };
  const totals = new Map<string, Map<number, Sum>>();
  for (const r of trendRows) {
    if (r.value_numeric == null) continue;
    if (!totals.has(r.field_code)) totals.set(r.field_code, new Map());
    const yMap = totals.get(r.field_code)!;
    const cur = yMap.get(r.data_year) ?? { sum: 0, count: 0 };
    cur.sum += r.value_numeric;
    cur.count += 1;
    yMap.set(r.data_year, cur);
  }
  function pointsFor(code: string): Point[] {
    const m = totals.get(code);
    if (!m) return [];
    return Array.from(m.entries())
      .filter(([y]) => y >= 2015 && y <= 2024)  // 2014 partial / pre-merger; 2025 not yet ingested
      .map(([year, { sum }]) => ({ year, value: sum }))
      .sort((a, b) => a.year - b.year);
  }

  // Church + clergy counts.
  const { count: activeChurches } = await supabase.from('church').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: closedChurches } = await supabase.from('church').select('*', { count: 'exact', head: true }).eq('status', 'closed');
  const { count: disaffChurches } = await supabase.from('church').select('*', { count: 'exact', head: true }).eq('status', 'disaffiliated');
  const { count: activeClergy } = await supabase.from('clergy').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: retiredClergy } = await supabase.from('clergy').select('*', { count: 'exact', head: true }).eq('status', 'retired');
  const { count: totalClergy } = await supabase.from('clergy').select('*', { count: 'exact', head: true });

  const membershipPts = pointsFor('4');
  const worshipPts = pointsFor('7');
  const apportPaidPts = pointsFor('29a');
  const receiptsPts = pointsFor('55');

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Rio Texas Journal</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Interactive archive of the Rio Texas Annual Conference of the United Methodist Church. Eleven years of statistics and clergy records, parsed from the official annual journals.
        </p>
        <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href="/churches" className="underline underline-offset-4 hover:no-underline">Churches</Link>
          <Link href="/clergy" className="underline underline-offset-4 hover:no-underline">Clergy</Link>
          <Link href="/map" className="underline underline-offset-4 hover:no-underline">Map</Link>
          <Link href="/seminaries" className="underline underline-offset-4 hover:no-underline">Seminaries</Link>
          <Link href="/leaderboards" className="underline underline-offset-4 hover:no-underline">Leaderboards</Link>
        </nav>
      </header>

      <section className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Active churches" value={activeChurches ?? 0} accent="emerald" />
        <StatCard label="Historical churches" value={(closedChurches ?? 0) + (disaffChurches ?? 0)} accent="zinc" />
        <StatCard label="Active clergy" value={activeClergy ?? 0} accent="emerald" />
        <StatCard label="Retired clergy" value={retiredClergy ?? 0} accent="sky" />
        <StatCard label="Clergy on file" value={totalClergy ?? 0} accent="zinc" />
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Conference-wide trends · 2015–2024</h2>
        <p className="text-xs text-zinc-500">Each panel sums every reporting church for the data year noted.</p>
        <Trendline label="Members reported year end (code 4)" points={membershipPts} format="count" />
        <Trendline label="Average worship attendance (code 7)" points={worshipPts} format="count" />
        <Trendline label="Conference apportionments paid (code 29a)" points={apportPaidPts} format="usd" />
        <Trendline label="Grand total received (code 55)" points={receiptsPts} format="usd" />
      </section>

      <section className="mt-12 text-sm text-zinc-500">
        <p>
          Source data: 11 official Rio Texas Annual Conference journals (2015–2025) including statistical (Section J), appointment (Section F), and clergy-records (Section I) data. Era A (2015–2024) used a 7-district structure (Capital, Coastal Bend, Crossroads, El Valle, Hill Country, Las Misiones, West); Era B (2025–) consolidated into 3 districts (Central, North, South).
        </p>
      </section>
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: 'emerald' | 'rose' | 'sky' | 'zinc' }) {
  const colorBg = {
    emerald: 'bg-emerald-50 dark:bg-emerald-950 ring-emerald-200 dark:ring-emerald-900',
    rose: 'bg-rose-50 dark:bg-rose-950 ring-rose-200 dark:ring-rose-900',
    sky: 'bg-sky-50 dark:bg-sky-950 ring-sky-200 dark:ring-sky-900',
    zinc: 'bg-zinc-50 dark:bg-zinc-900 ring-zinc-200 dark:ring-zinc-800',
  }[accent];
  return (
    <div className={'rounded-md ring-1 px-3 py-2 ' + colorBg}>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{new Intl.NumberFormat('en-US').format(value)}</div>
    </div>
  );
}
