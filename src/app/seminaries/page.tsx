import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type EducationEntry = { institution: string; degree: string; raw: string };

type ClergyRow = {
  id: string;
  canonical_name: string;
  status: string;
  education_history: EducationEntry[] | null;
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500',
  retired: 'bg-sky-500',
  withdrawn: 'bg-rose-500',
  deceased: 'bg-zinc-400',
  transferred: 'bg-violet-500',
  unknown: 'bg-amber-500',
};

export default async function SeminariesPage() {
  const supabase = await createClient();
  const all: ClergyRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('clergy')
      .select('id, canonical_name, status, education_history')
      .range(from, from + 999)
      .returns<ClergyRow[]>();
    if (error) {
      return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
    }
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const data = all;

  type Bucket = {
    total: number;
    active: number;
    retired: number;
    other: number;
    sample: { id: string; name: string; status: string }[];
    degrees: Map<string, number>;
  };
  const byInstitution = new Map<string, Bucket>();

  for (const c of data ?? []) {
    const seen = new Set<string>();
    for (const e of c.education_history ?? []) {
      if (!e.institution) continue;
      if (seen.has(e.institution)) continue;
      seen.add(e.institution);
      const bucket: Bucket = byInstitution.get(e.institution) ?? {
        total: 0, active: 0, retired: 0, other: 0,
        sample: [],
        degrees: new Map<string, number>(),
      };
      bucket.total++;
      if (c.status === 'active') bucket.active++;
      else if (c.status === 'retired') bucket.retired++;
      else bucket.other++;
      if (bucket.sample.length < 6) {
        bucket.sample.push({ id: c.id, name: c.canonical_name, status: c.status });
      }
      if (e.degree) bucket.degrees.set(e.degree, (bucket.degrees.get(e.degree) ?? 0) + 1);
      byInstitution.set(e.institution, bucket);
    }
  }

  const ranked = Array.from(byInstitution.entries())
    .map(([institution, b]) => ({ institution, ...b }))
    .sort((a, b) => b.total - a.total);

  const totalEd = (data ?? []).filter((c) => (c.education_history?.length ?? 0) > 0).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Seminaries</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {ranked.length} institutions across {totalEd} clergy records with education on file. Counts represent unique clergy who hold at least one degree from the institution; status mix is shown as a stacked bar.
      </p>

      <div className="mt-10 space-y-6">
        {ranked.map((r) => {
          const pctActive = (r.active / r.total) * 100;
          const pctRetired = (r.retired / r.total) * 100;
          const pctOther = (r.other / r.total) * 100;
          return (
            <section key={r.institution} className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <Link href={`/clergy?seminary=${encodeURIComponent(r.institution)}`} className="font-medium hover:underline underline-offset-4">
                  {r.institution}
                </Link>
                <div className="text-sm text-zinc-500 tabular-nums">
                  {r.total} clergy · <span className="text-emerald-700 dark:text-emerald-400">{r.active} active</span> · <span className="text-sky-700 dark:text-sky-400">{r.retired} retired</span>
                  {r.other > 0 && <> · <span>{r.other} other</span></>}
                </div>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                {pctActive > 0 && <div className={STATUS_COLORS.active} style={{ width: `${pctActive}%` }} />}
                {pctRetired > 0 && <div className={STATUS_COLORS.retired} style={{ width: `${pctRetired}%` }} />}
                {pctOther > 0 && <div className={STATUS_COLORS.unknown} style={{ width: `${pctOther}%` }} />}
              </div>
              {r.degrees.size > 0 && (
                <p className="mt-2 text-xs text-zinc-500">
                  Degrees: {Array.from(r.degrees.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, n]) => `${d} (${n})`).join(' · ')}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
