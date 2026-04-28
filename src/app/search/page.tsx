import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type ChurchHit = { id: string; canonical_name: string; status: string; city: string | null };
type ClergyHit = { id: string; canonical_name: string; status: string };

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim();

  if (!q) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← Home</Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Search</h1>
        <SearchForm q="" />
      </main>
    );
  }

  const supabase = await createClient();
  const needle = `%${q}%`;

  const [churchRes, clergyRes, churchAliasRes, clergyAliasRes] = await Promise.all([
    supabase.from('church').select('id, canonical_name, status, city').ilike('canonical_name', needle).limit(50).returns<ChurchHit[]>(),
    supabase.from('clergy').select('id, canonical_name, status').ilike('canonical_name', needle).limit(50).returns<ClergyHit[]>(),
    supabase.from('church_alias').select('alias, church!inner(id, canonical_name, status, city)').ilike('alias', needle).limit(20),
    supabase.from('clergy_alias').select('alias, clergy!inner(id, canonical_name, status)').ilike('alias', needle).limit(20),
  ]);

  // Merge alias hits into the main results dedup'd by id.
  const churches = new Map<string, ChurchHit>();
  for (const h of churchRes.data ?? []) churches.set(h.id, h);
  for (const a of churchAliasRes.data ?? []) {
    const arr = (a as unknown as { church: ChurchHit | ChurchHit[] }).church;
    const c = Array.isArray(arr) ? arr[0] : arr;
    if (c) churches.set(c.id, c);
  }
  const clergy = new Map<string, ClergyHit>();
  for (const h of clergyRes.data ?? []) clergy.set(h.id, h);
  for (const a of clergyAliasRes.data ?? []) {
    const arr = (a as unknown as { clergy: ClergyHit | ClergyHit[] }).clergy;
    const c = Array.isArray(arr) ? arr[0] : arr;
    if (c) clergy.set(c.id, c);
  }

  const churchList = Array.from(churches.values()).sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
  const clergyList = Array.from(clergy.values()).sort((a, b) => {
    const aLast = a.canonical_name.split(/\s+/).pop() || a.canonical_name;
    const bLast = b.canonical_name.split(/\s+/).pop() || b.canonical_name;
    return aLast.localeCompare(bLast);
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Search results</h1>
      <p className="mt-1 text-sm text-zinc-500">{churchList.length + clergyList.length} matches for &ldquo;{q}&rdquo;</p>
      <SearchForm q={q} />

      {churchList.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Churches · {churchList.length}</h2>
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {churchList.map((c) => (
              <li key={c.id} className="py-2.5 flex items-baseline justify-between gap-3">
                <Link href={`/churches/${c.id}`} className="hover:underline underline-offset-4">
                  {c.canonical_name}
                </Link>
                <span className="text-xs text-zinc-500 shrink-0">
                  {c.city && c.city !== c.canonical_name ? c.city + ' · ' : ''}{c.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {clergyList.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Clergy · {clergyList.length}</h2>
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {clergyList.map((c) => (
              <li key={c.id} className="py-2.5 flex items-baseline justify-between gap-3">
                <Link href={`/clergy/${c.id}`} className="hover:underline underline-offset-4">
                  {c.canonical_name}
                </Link>
                <span className="text-xs text-zinc-500 shrink-0">{c.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {churchList.length === 0 && clergyList.length === 0 && (
        <p className="mt-8 text-zinc-500">No matches.</p>
      )}
    </main>
  );
}

export function SearchForm({ q }: { q: string }) {
  return (
    <form action="/search" method="GET" className="mt-6 flex gap-2">
      <input
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search churches, clergy, aliases…"
        className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
        autoFocus={!q}
      />
      <button
        type="submit"
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-sm font-medium hover:opacity-90"
      >
        Search
      </button>
    </form>
  );
}
