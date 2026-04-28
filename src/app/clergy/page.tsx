import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ClergyList from './ClergyList';

export const dynamic = 'force-dynamic';

type ServerRow = {
  id: string;
  canonical_name: string;
  status: string;
  appointments: { status_code: string | null }[];
};

function lastNameKey(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words[words.length - 1] || name).toLowerCase();
}

export default async function ClergyPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clergy')
    .select('id, canonical_name, status, appointments:appointment(status_code)')
    .returns<ServerRow[]>();

  if (error) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
  }

  const sorted = [...(data ?? [])].sort((a, b) =>
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
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {rows.length} clergy on file across all years parsed. The 2025 journal is the source of truth for active clergy; everyone else is grouped by lifecycle status.
      </p>
      <ClergyList rows={rows} />
    </main>
  );
}
