import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const CURRENT = 2024; // most recent data_year ingested
const COMPARE_BASE = 2017; // when many Era A series stabilize

const FIELDS = ['1', '2a', '2b', '4', '7', '7a', '8', '8a', '8b', '11a', '11b', '14', '21', '23', '28a', '29a', '51', '52', '55'] as const;

type StatRow = { church_id: string; data_year: number; field_code: string; value_numeric: number | null };
type Church = { id: string; canonical_name: string; status: string };

const FIELD_LABEL: Record<string, string> = {
  '4': 'Year-end membership',
  '7': 'Average worship',
  '7a': 'Online worship',
  '8': 'Total baptisms',
  '11a': 'Children in CF groups',
  '11b': 'Youth in CF groups',
  '14': 'VBS attendance',
  '21': 'Community ministries',
  '23': 'Persons served',
  '28a': 'Conference apportioned',
  '29a': 'Conference paid',
  '51': 'Giving households',
  '52': 'Funds received',
  '55': 'Total received',
};

function fmtCount(n: number) {
  return new Intl.NumberFormat('en-US').format(n);
}
function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: n >= 1_000_000 ? 'compact' : 'standard' }).format(n);
}
function fmtPct(n: number) {
  return `${n.toFixed(0)}%`;
}

async function fetchAllStats(supabase: ReturnType<typeof createClient> extends Promise<infer S> ? S : never): Promise<StatRow[]> {
  const out: StatRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('church_stat')
      .select('church_id, data_year, field_code, value_numeric')
      .in('field_code', FIELDS as unknown as string[])
      .in('data_year', [CURRENT, COMPARE_BASE])
      .range(from, from + 999);
    if (error) break;
    out.push(...((data ?? []) as StatRow[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

export default async function LeaderboardsPage() {
  const supabase = await createClient();

  const stats = await fetchAllStats(supabase);
  const { data: churches } = await supabase
    .from('church')
    .select('id, canonical_name, status')
    .returns<Church[]>();
  const churchById = new Map((churches ?? []).map((c) => [c.id, c]));

  // Build (church_id, year) → field_code → value lookup.
  const byKey = new Map<string, Map<string, number>>();
  for (const s of stats) {
    if (s.value_numeric == null) continue;
    const k = `${s.church_id}|${s.data_year}`;
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k)!.set(s.field_code, s.value_numeric);
  }

  type Entry = { church: Church; value: number; sub?: string };
  function topN(year: number, code: string, n = 10, statusFilter?: string): Entry[] {
    const out: Entry[] = [];
    for (const ch of churches ?? []) {
      if (statusFilter && ch.status !== statusFilter) continue;
      const v = byKey.get(`${ch.id}|${year}`)?.get(code);
      if (v == null) continue;
      out.push({ church: ch, value: v });
    }
    out.sort((a, b) => b.value - a.value);
    return out.slice(0, n);
  }

  function ratioRanked(year: number, num: string, denom: string, n = 10, opts: { minDenom?: number; ascending?: boolean } = {}): Entry[] {
    const out: Entry[] = [];
    const minDenom = opts.minDenom ?? 0;
    for (const ch of (churches ?? []).filter((c) => c.status === 'active')) {
      const m = byKey.get(`${ch.id}|${year}`);
      if (!m) continue;
      const a = m.get(num);
      const b = m.get(denom);
      if (a == null || b == null || b <= minDenom) continue;
      out.push({ church: ch, value: (a / b) * 100, sub: `${fmtCount(a)} / ${fmtCount(b)}` });
    }
    out.sort((a, b) => (opts.ascending ? a.value - b.value : b.value - a.value));
    return out.slice(0, n);
  }

  // Growth: compare 2024 vs 2017 (or earliest available among the pulled years).
  function growthRanked(code: string, n = 10, ascending = false): Entry[] {
    const out: Entry[] = [];
    for (const ch of (churches ?? []).filter((c) => c.status === 'active')) {
      const cur = byKey.get(`${ch.id}|${CURRENT}`)?.get(code);
      const base = byKey.get(`${ch.id}|${COMPARE_BASE}`)?.get(code);
      if (cur == null || base == null || base <= 5) continue;
      const pct = ((cur - base) / base) * 100;
      out.push({ church: ch, value: pct, sub: `${fmtCount(base)} → ${fmtCount(cur)}` });
    }
    out.sort((a, b) => (ascending ? a.value - b.value : b.value - a.value));
    return out.slice(0, n);
  }

  // Composite metrics: professions of faith (2a + 2b), faith additions
  // (2a + 2b + 8). Build a derived per-church value for these.
  function topNComposite(year: number, codes: string[], n = 10): Entry[] {
    const out: Entry[] = [];
    for (const ch of (churches ?? []).filter((c) => c.status === 'active')) {
      const m = byKey.get(`${ch.id}|${year}`);
      if (!m) continue;
      let sum = 0;
      let any = false;
      for (const c of codes) {
        const v = m.get(c);
        if (v != null) { sum += v; any = true; }
      }
      if (!any || sum === 0) continue;
      out.push({ church: ch, value: sum });
    }
    out.sort((a, b) => b.value - a.value);
    return out.slice(0, n);
  }

  // HEADLINE: worship + professions of faith + baptisms
  const largestWorship = topN(CURRENT, '7', 10, 'active');
  const largestProfessions = topNComposite(CURRENT, ['2a', '2b'], 10);
  const largestBaptisms = topN(CURRENT, '8', 10, 'active');

  // SECONDARY: growth versions
  const growthWorship = growthRanked('7', 10, false);
  const declineWorship = growthRanked('7', 10, true);

  // Other rankings
  const largestMembership = topN(CURRENT, '4', 10, 'active');
  const topReceipts = topN(CURRENT, '55', 10, 'active');
  const topGiverHouseholds = topN(CURRENT, '51', 10, 'active');
  const apportionmentPct = ratioRanked(CURRENT, '29a', '28a', 10, { minDenom: 1000 });
  const apportionmentMissed = ratioRanked(CURRENT, '29a', '28a', 10, { minDenom: 1000, ascending: true });
  const growthMembership = growthRanked('4', 10, false);
  const declineMembership = growthRanked('4', 10, true);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Leaderboards</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Worship attendance and professions of faith / baptisms come first — these are the discipleship signals the conference watches most closely. Rankings drawn from {CURRENT} statistics, restricted to active churches. Growth rankings compare {COMPARE_BASE}→{CURRENT}; ratios require a meaningful denominator so a tiny church doesn't dominate by accident.
      </p>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-zinc-500">Discipleship</h2>
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Board title="Highest worship attendance" subtitle={`${FIELD_LABEL['7']}, ${CURRENT}`} entries={largestWorship} fmt={fmtCount} />
        <Board title="Most professions of faith" subtitle={`Confirmation + other professions (codes 2a + 2b), ${CURRENT}`} entries={largestProfessions} fmt={fmtCount} />
        <Board title="Most baptisms" subtitle={`Total baptized — children + youth/adults (code 8), ${CURRENT}`} entries={largestBaptisms} fmt={fmtCount} />
        <Board title="Largest worship growth" subtitle={`${COMPARE_BASE}→${CURRENT} change`} entries={growthWorship} fmt={(n) => `${n > 0 ? '+' : ''}${fmtPct(n)}`} />
        <Board title="Largest worship decline" subtitle={`${COMPARE_BASE}→${CURRENT} change`} entries={declineWorship} fmt={(n) => `${n > 0 ? '+' : ''}${fmtPct(n)}`} />
      </div>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-zinc-500">Membership</h2>
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Board title="Largest membership" subtitle={`${FIELD_LABEL['4']}, ${CURRENT}`} entries={largestMembership} fmt={fmtCount} />
        <Board title="Largest membership growth" subtitle={`${COMPARE_BASE}→${CURRENT} change`} entries={growthMembership} fmt={(n) => `${n > 0 ? '+' : ''}${fmtPct(n)}`} />
        <Board title="Largest membership decline" subtitle={`${COMPARE_BASE}→${CURRENT} change`} entries={declineMembership} fmt={(n) => `${n > 0 ? '+' : ''}${fmtPct(n)}`} />
      </div>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-zinc-500">Finances</h2>
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Board title="Highest total receipts" subtitle={`${FIELD_LABEL['55']}, ${CURRENT}`} entries={topReceipts} fmt={fmtUsd} />
        <Board title="Most giving households" subtitle={`${FIELD_LABEL['51']}, ${CURRENT}`} entries={topGiverHouseholds} fmt={fmtCount} />
        <Board title="Highest apportionment payment %" subtitle={`Paid ÷ apportioned, ${CURRENT}`} entries={apportionmentPct} fmt={fmtPct} />
        <Board title="Lowest apportionment payment %" subtitle={`Paid ÷ apportioned, ${CURRENT}`} entries={apportionmentMissed} fmt={fmtPct} />
      </div>
    </main>
  );
}

function Board({ title, subtitle, entries, fmt }: { title: string; subtitle: string; entries: { church: Church; value: number; sub?: string }[]; fmt: (n: number) => string }) {
  return (
    <section className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-zinc-500">{subtitle}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">Not enough data.</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {entries.map((e, i) => (
            <li key={e.church.id} className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-zinc-400 tabular-nums">{i + 1}</span>
              <Link href={`/churches/${e.church.id}`} className="flex-1 truncate hover:underline underline-offset-4">
                {e.church.canonical_name}
              </Link>
              <span className="text-xs tabular-nums text-zinc-500 truncate">{e.sub}</span>
              <span className="text-sm tabular-nums font-medium">{fmt(e.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
