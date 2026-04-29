import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ClergyList from './ClergyList';

export const dynamic = 'force-dynamic';

type EducationEntry = { institution: string; degree: string; raw: string };
type StatusEntry = { code: string; year: number };

type ServerRow = {
  id: string;
  canonical_name: string;
  status: string;
  credential_class: string | null;
  education_history: EducationEntry[] | null;
  status_history: StatusEntry[] | null;
  appointments: { status_code: string | null; journal_year: number }[];
};

function latestStatusCode(row: ServerRow): string | null {
  const hist = row.status_history ?? [];
  if (hist.length > 0) {
    const latest = [...hist].sort((a, b) => b.year - a.year)[0];
    if (latest?.code) return latest.code;
  }
  const appts = row.appointments ?? [];
  const withCode = appts.filter((a) => a.status_code);
  if (withCode.length === 0) return null;
  withCode.sort((a, b) => b.journal_year - a.journal_year);
  return withCode[0].status_code;
}

function lastNameKey(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words[words.length - 1] || name).toLowerCase();
}

export default async function ClergyPage({ searchParams }: PageProps<'/clergy'>) {
  const sp = await searchParams;
  const institutionFilter = typeof sp.institution === 'string' ? sp.institution : (typeof sp.seminary === 'string' ? sp.seminary : null);

  const supabase = await createClient();
  const all: ServerRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('clergy')
      .select('id, canonical_name, status, credential_class, education_history, status_history, appointments:appointment(status_code, journal_year)')
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
  if (institutionFilter) {
    filtered = filtered.filter((c) =>
      (c.education_history ?? []).some((e) => e.institution === institutionFilter),
    );
  }

  const sorted = [...filtered].sort((a, b) =>
    lastNameKey(a.canonical_name).localeCompare(lastNameKey(b.canonical_name)),
  );

  const rows = sorted.map((c) => ({
    id: c.id,
    canonical_name: c.canonical_name,
    status: c.status,
    apptStatus: latestStatusCode(c),
    credentialClass: c.credential_class,
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Clergy</h1>
      {institutionFilter ? (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {rows.length} clergy with at least one degree from <span className="font-medium text-zinc-900 dark:text-zinc-100">{institutionFilter}</span>.{' '}
          <Link href="/clergy" className="underline underline-offset-4">Clear institution filter →</Link>
        </p>
      ) : (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {rows.length} clergy on file across all years parsed. The 2025 journal is the source of truth for active clergy; everyone else is grouped by lifecycle status. <Link href="/education" className="underline underline-offset-4">Browse by education →</Link>
        </p>
      )}
      <ClergyList rows={rows} />
    </main>
  );
}
