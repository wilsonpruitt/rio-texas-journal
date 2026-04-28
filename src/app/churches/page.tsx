import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import SearchableList from './SearchableList';

export const dynamic = 'force-dynamic';

type ServerRow = {
  id: string;
  canonical_name: string;
  city: string | null;
  district_history: { district_code: string }[];
};

export default async function ChurchesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('church')
    .select('id, canonical_name, city, district_history!inner(district_code)')
    .eq('district_history.data_year', 2024)
    .order('canonical_name')
    .returns<ServerRow[]>();

  if (error) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
  }

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    canonical_name: r.canonical_name,
    city: r.city,
    district_code: r.district_history[0]?.district_code ?? '',
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Churches</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {rows.length} churches across the Rio Texas Conference (2024 data year, 2025 journal).
      </p>
      <SearchableList rows={rows} />
    </main>
  );
}
