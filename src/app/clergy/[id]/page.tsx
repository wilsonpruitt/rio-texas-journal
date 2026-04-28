import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Clergy = { id: string; canonical_name: string; status: string };

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  unknown: 'Needs review',
  withdrawn: 'Withdrawn',
  retired: 'Retired',
  transferred: 'Transferred',
  deceased: 'Deceased',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900',
  unknown: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900',
  withdrawn: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900',
  retired: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900',
  transferred: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900',
  deceased: 'bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
};
type ApptRow = {
  journal_year: number;
  role: string | null;
  status_code: string | null;
  years_at_appt: number | null;
  fraction: string | null;
  source_pdf_page: number | null;
  church: { id: string; canonical_name: string; city: string | null } | null;
};

export default async function ClergyDetailPage({ params }: PageProps<'/clergy/[id]'>) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: clergy } = await supabase
    .from('clergy')
    .select('id, canonical_name, status')
    .eq('id', id)
    .maybeSingle<Clergy>();
  if (!clergy) notFound();

  const { data: appts } = await supabase
    .from('appointment')
    .select('journal_year, role, status_code, years_at_appt, fraction, source_pdf_page, church:church_id(id, canonical_name, city)')
    .eq('clergy_id', id)
    .order('journal_year', { ascending: false })
    .returns<ApptRow[]>();

  // Group by journal_year so multi-charge appointments collapse together.
  const byYear: Map<number, ApptRow[]> = new Map();
  for (const a of appts ?? []) {
    const list = byYear.get(a.journal_year) ?? [];
    list.push(a);
    byYear.set(a.journal_year, list);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/clergy" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Clergy
      </Link>
      <div className="mt-4 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight">{clergy.canonical_name}</h1>
        {clergy.status !== 'active' && (
          <span className={'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ' + (STATUS_COLOR[clergy.status] ?? '')}>
            {STATUS_LABEL[clergy.status] ?? clergy.status}
          </span>
        )}
      </div>

      {byYear.size === 0 ? (
        <p className="mt-8 text-zinc-500">No appointments on file.</p>
      ) : (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Appointments</h2>
          <ol className="mt-4 space-y-6">
            {Array.from(byYear.entries()).map(([year, items]) => (
              <li key={year} className="flex gap-6">
                <div className="w-16 shrink-0 text-right">
                  <span className="font-medium tabular-nums">{year}</span>
                </div>
                <div className="flex-1 space-y-2">
                  {items.map((a, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-4">
                      <div>
                        {a.church ? (
                          <Link
                            href={`/churches/${a.church.id}`}
                            className="font-medium hover:underline underline-offset-4"
                          >
                            {a.church.canonical_name}
                          </Link>
                        ) : (
                          <span className="font-medium text-zinc-500">[no church]</span>
                        )}
                        <span className="ml-2 text-sm text-zinc-500">
                          {a.role}
                          {a.years_at_appt != null
                            ? ` · ${a.years_at_appt} yr${a.years_at_appt === 1 ? '' : 's'}`
                            : ''}
                        </span>
                      </div>
                      <div className="text-sm text-zinc-500 font-mono shrink-0">
                        {a.status_code}
                        {a.fraction ? ` [${a.fraction}]` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
