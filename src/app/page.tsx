import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import Trendline, { type Point } from './Trendline';
import HomeMap from './HomeMap';
import { SearchForm } from './search/page';

export const dynamic = 'force-dynamic';

const HEADLINE_FIELDS = ['4', '7', '7a', '29a', '55'] as const;
const MOST_RECENT_JOURNAL = 2025;
const MOST_RECENT_DATA_YEAR = 2024;

export default async function Home() {
  const supabase = await createClient();

  // ---- Conference-wide trend data ----
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
  type Sum = { sum: number };
  const totals = new Map<string, Map<number, Sum>>();
  for (const r of trendRows) {
    if (r.value_numeric == null) continue;
    if (!totals.has(r.field_code)) totals.set(r.field_code, new Map());
    const m = totals.get(r.field_code)!;
    const cur = m.get(r.data_year) ?? { sum: 0 };
    cur.sum += r.value_numeric;
    m.set(r.data_year, cur);
  }
  function pointsFor(code: string): Point[] {
    const m = totals.get(code);
    if (!m) return [];
    return Array.from(m.entries())
      .filter(([y]) => y >= 2015 && y <= 2024)
      .map(([year, { sum }]) => ({ year, value: sum }))
      .sort((a, b) => a.year - b.year);
  }

  // ---- Counts ----
  const { count: activeChurches } = await supabase.from('church').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: closedChurches } = await supabase.from('church').select('*', { count: 'exact', head: true }).eq('status', 'closed');
  const { count: disaffChurches } = await supabase.from('church').select('*', { count: 'exact', head: true }).eq('status', 'disaffiliated');
  const { count: activeClergy } = await supabase.from('clergy').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: retiredClergy } = await supabase.from('clergy').select('*', { count: 'exact', head: true }).eq('status', 'retired');
  const { count: totalClergy } = await supabase.from('clergy').select('*', { count: 'exact', head: true });

  // ---- Map points (active churches with lat/lng) ----
  const { data: mapRows } = await supabase
    .from('church')
    .select('id, canonical_name, lat, lng, district_history(district_code, data_year)')
    .eq('status', 'active')
    .not('lat', 'is', null);
  type MapRow = { id: string; canonical_name: string; lat: number; lng: number; district_history: { district_code: string; data_year: number }[] };
  const mapPoints = ((mapRows ?? []) as MapRow[]).map((r) => ({
    id: r.id,
    name: r.canonical_name,
    lat: r.lat,
    lng: r.lng,
    district: r.district_history.find((d) => d.data_year === 2024)?.district_code ?? '',
  }));

  // ---- Featured highlights from leaderboard data ----
  // Pull just the headline metric per highlight so we don't re-load all stats.
  const featured = await loadFeatured(supabase);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Rio Texas Journal</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400 max-w-3xl">
          The Rio Texas Annual Conference of the United Methodist Church spans 500 miles of border and 500 miles of coastline across south and central Texas — from Brownsville and Laredo up through Austin, San Antonio, San Angelo, and Corpus Christi. Formed January 1, 2015 from the merger of the Southwest Texas and Río Grande conferences, it now organizes {activeChurches?.toLocaleString() ?? '–'} active congregations into three districts and is led by {activeClergy?.toLocaleString() ?? '–'} appointed clergy.
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          Most recent journal ingested: <span className="font-medium text-zinc-700 dark:text-zinc-300">{MOST_RECENT_JOURNAL}</span> · data year <span className="font-medium text-zinc-700 dark:text-zinc-300">{MOST_RECENT_DATA_YEAR}</span> · 11 conference journals (2015–2025) parsed.
        </p>
      </header>

      <div className="mt-6"><SearchForm q="" /></div>

      <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/churches" className="underline underline-offset-4 hover:no-underline">Churches</Link>
        <Link href="/clergy" className="underline underline-offset-4 hover:no-underline">Clergy</Link>
        <Link href="/map" className="underline underline-offset-4 hover:no-underline">Map</Link>
        <Link href="/seminaries" className="underline underline-offset-4 hover:no-underline">Seminaries</Link>
        <Link href="/leaderboards" className="underline underline-offset-4 hover:no-underline">Leaderboards</Link>
      </nav>

      <section className="mt-8">
        <Link href="/map" className="block">
          <HomeMap points={mapPoints} />
        </Link>
        <p className="mt-2 text-xs text-zinc-500">{mapPoints.length} active churches plotted. <Link href="/map" className="underline underline-offset-4">Open the full map →</Link></p>
      </section>

      <section className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Active churches" value={activeChurches ?? 0} accent="emerald" />
        <StatCard label="Historical churches" value={(closedChurches ?? 0) + (disaffChurches ?? 0)} accent="zinc" />
        <StatCard label="Active clergy" value={activeClergy ?? 0} accent="emerald" />
        <StatCard label="Retired clergy" value={retiredClergy ?? 0} accent="sky" />
        <StatCard label="Clergy on file" value={totalClergy ?? 0} accent="zinc" />
      </section>

      {featured.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Notable in {MOST_RECENT_DATA_YEAR}</h2>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {featured.map((f, i) => (
              <li key={i} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-zinc-500">{f.label}</div>
                <Link href={`/churches/${f.churchId}`} className="mt-1 block text-base font-medium hover:underline underline-offset-4">
                  {f.churchName}
                </Link>
                <div className="mt-0.5 text-sm text-zinc-500 tabular-nums">{f.value}</div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500"><Link href="/leaderboards" className="underline underline-offset-4">Full leaderboards →</Link></p>
        </section>
      )}

      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Conference-wide trends · 2015–2024</h2>
        <Trendline label="Members reported year end" points={pointsFor('4')} format="count" />
        <Trendline label="Average worship attendance" points={pointsFor('7')} format="count" />
        <Trendline label="Conference apportionments paid" points={pointsFor('29a')} format="usd" />
        <Trendline label="Grand total received" points={pointsFor('55')} format="usd" />
      </section>

      <section className="mt-12 text-sm text-zinc-500">
        <p>
          Source data: 11 official Rio Texas Annual Conference journals (2015–2025) including statistical (Section J), appointment (Section F), and clergy-records (Section I) data. Era A (2015–2024) used a 7-district structure (Capital, Coastal Bend, Crossroads, El Valle, Hill Country, Las Misiones, West); Era B (2025–) consolidated into 3 districts (Central, North, South).
        </p>
      </section>
    </main>
  );
}

type Featured = { label: string; churchId: string; churchName: string; value: string };

async function loadFeatured(supabase: Awaited<ReturnType<typeof createClient>>): Promise<Featured[]> {
  const fmtCount = (n: number) => new Intl.NumberFormat('en-US').format(n);
  const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: n >= 1_000_000 ? 'compact' : 'standard' }).format(n);

  // Pull only the data we need for the highlights: 2024 values for fields
  // 4 / 7 / 8 / 55 + 2017 baseline for growth.
  const codes = ['4', '7', '8', '55', '2a', '2b'];
  const rows: { church_id: string; field_code: string; value_numeric: number | null; data_year: number }[] = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('church_stat')
      .select('church_id, field_code, value_numeric, data_year')
      .in('field_code', codes)
      .in('data_year', [2017, 2024])
      .range(from, from + 999);
    if (!data) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
    from += 1000;
  }
  const { data: churches } = await supabase
    .from('church')
    .select('id, canonical_name, status');
  const churchById = new Map((churches ?? []).map((c: { id: string; canonical_name: string; status: string }) => [c.id, c]));

  const at = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.value_numeric == null) continue;
    const k = `${r.church_id}|${r.data_year}`;
    if (!at.has(k)) at.set(k, new Map());
    at.get(k)!.set(r.field_code, r.value_numeric);
  }

  function topFor(predicate: (id: string) => number | null): { id: string; v: number } | null {
    let best: { id: string; v: number } | null = null;
    for (const c of (churches ?? []) as { id: string; status: string }[]) {
      if (c.status !== 'active') continue;
      const v = predicate(c.id);
      if (v == null) continue;
      if (!best || v > best.v) best = { id: c.id, v };
    }
    return best;
  }

  const featured: Featured[] = [];

  const topWorship = topFor((id) => at.get(`${id}|2024`)?.get('7') ?? null);
  if (topWorship) featured.push({
    label: 'Largest worship attendance',
    churchId: topWorship.id, churchName: churchById.get(topWorship.id)?.canonical_name ?? '?',
    value: `${fmtCount(topWorship.v)} per week`,
  });

  const topProf = topFor((id) => {
    const m = at.get(`${id}|2024`);
    if (!m) return null;
    const sum = (m.get('2a') ?? 0) + (m.get('2b') ?? 0);
    return sum > 0 ? sum : null;
  });
  if (topProf) featured.push({
    label: 'Most professions of faith',
    churchId: topProf.id, churchName: churchById.get(topProf.id)?.canonical_name ?? '?',
    value: `${fmtCount(topProf.v)} new professions`,
  });

  const topBap = topFor((id) => at.get(`${id}|2024`)?.get('8') ?? null);
  if (topBap) featured.push({
    label: 'Most baptisms',
    churchId: topBap.id, churchName: churchById.get(topBap.id)?.canonical_name ?? '?',
    value: `${fmtCount(topBap.v)} baptisms`,
  });

  const topReceipts = topFor((id) => at.get(`${id}|2024`)?.get('55') ?? null);
  if (topReceipts) featured.push({
    label: 'Largest receipts',
    churchId: topReceipts.id, churchName: churchById.get(topReceipts.id)?.canonical_name ?? '?',
    value: fmtUsd(topReceipts.v),
  });

  // Growth winner: largest worship % delta 2017→2024
  let bestWorshipGrowth: { id: string; pct: number; from: number; to: number } | null = null;
  for (const c of (churches ?? []) as { id: string; status: string }[]) {
    if (c.status !== 'active') continue;
    const cur = at.get(`${c.id}|2024`)?.get('7');
    const base = at.get(`${c.id}|2017`)?.get('7');
    if (cur == null || base == null || base < 30) continue;
    const pct = ((cur - base) / base) * 100;
    if (!bestWorshipGrowth || pct > bestWorshipGrowth.pct) bestWorshipGrowth = { id: c.id, pct, from: base, to: cur };
  }
  if (bestWorshipGrowth) featured.push({
    label: 'Fastest worship growth',
    churchId: bestWorshipGrowth.id, churchName: churchById.get(bestWorshipGrowth.id)?.canonical_name ?? '?',
    value: `${fmtCount(bestWorshipGrowth.from)} → ${fmtCount(bestWorshipGrowth.to)} (+${bestWorshipGrowth.pct.toFixed(0)}%)`,
  });

  // Largest membership
  const topMem = topFor((id) => at.get(`${id}|2024`)?.get('4') ?? null);
  if (topMem) featured.push({
    label: 'Largest membership',
    churchId: topMem.id, churchName: churchById.get(topMem.id)?.canonical_name ?? '?',
    value: `${fmtCount(topMem.v)} members`,
  });

  return featured;
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
