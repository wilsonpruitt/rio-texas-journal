import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ClergyList from './ClergyList';

export const dynamic = 'force-dynamic';

type EducationEntry = { institution: string; degree: string; raw: string };

type ServerRow = {
  id: string;
  canonical_name: string;
  status: string;
  education_history: EducationEntry[] | null;
  appointments: { status_code: string | null }[];
};

function lastNameKey(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words[words.length - 1] || name).toLowerCase();
}

export default async function ClergyPage({ searchParams }: PageProps<'/clergy'>) {
  const sp = await searchParams;
  const seminaryFilter = typeof sp.seminary === 'string' ? sp.seminary : null;

  const supabase = await createClient();
  const all: ServerRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('clergy')
      .select('id, canonical_name, status, education_history, appointments:appointment(status_code)')
      .range(from, from + 999)
      .returns<ServerRow[]>();
    if (error) {
      return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
    }
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  let filtered = all;
  if (seminaryFilter) {
    filtered = filtered.filter((c) =>
      (c.education_history ?? []).some((e) => e.institution === seminaryFilter),
    );
  }

  const sorted = [...filtered].sort((a, b) =>
    lastNameKey(a.canonical_name).localeCompare(lastNameKey(b.canonical_name)),
  );

  const rows = sorted.map((c) => ({
    id: c.id,
    canonical_name: c.canonical_name,
    status: c.status,
    apptStatus: c.appointments?.[0]?.status_code ?? null,
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Clergy</h1>
      {seminaryFilter ? (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {rows.length} clergy with at least one degree from <span className="font-medium text-zinc-900 dark:text-zinc-100">{seminaryFilter}</span>.{' '}
          <Link href="/clergy" className="underline underline-offset-4">Clear seminary filter →</Link>
        </p>
      ) : (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {rows.length} clergy on file across all years parsed. The 2025 journal is the source of truth for active clergy; everyone else is grouped by lifecycle status. <Link href="/seminaries" className="underline underline-offset-4">Browse by seminary →</Link>
        </p>
      )}
      <ClergyList rows={rows} />
    </main>
  );
}
