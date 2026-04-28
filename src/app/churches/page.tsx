import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import SearchableList from './SearchableList';

export const dynamic = 'force-dynamic';

type ServerRow = {
  id: string;
  canonical_name: string;
  city: string | null;
  status: string;
  district_history: { district_code: string; data_year: number }[];
};

export default async function ChurchesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('church')
    .select('id, canonical_name, city, status, district_history(district_code, data_year)')
    .order('canonical_name')
    .returns<ServerRow[]>();

  if (error) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
  }

  const rows = (data ?? []).map((r) => {
    // Prefer the 2024 (Era B) district; fall back to the most-recent Era A district.
    const dh2024 = r.district_history.find((d) => d.data_year === 2024);
    const latest = [...r.district_history].sort((a, b) => b.data_year - a.data_year)[0];
    return {
      id: r.id,
      canonical_name: r.canonical_name,
      city: r.city,
      status: r.status,
      district_code: dh2024?.district_code ?? latest?.district_code ?? '',
    };
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Churches</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {rows.length} churches on file across all parsed years. Active churches are grouped by 2025 district; closed and disaffiliated are listed alphabetically.
      </p>
      <SearchableList rows={rows} />
    </main>
  );
}
