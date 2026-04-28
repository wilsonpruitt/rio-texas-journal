import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Clergy = { id: string; canonical_name: string };
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
    .select('id, canonical_name')
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
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{clergy.canonical_name}</h1>

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
