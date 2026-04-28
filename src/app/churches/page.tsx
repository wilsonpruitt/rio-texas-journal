import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const DISTRICT_NAME: Record<string, string> = {
  CE: 'Central',
  NO: 'North',
  SO: 'South',
};

type Row = {
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
    .returns<Row[]>();

  if (error) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
  }

  const byDistrict: Record<string, Row[]> = { CE: [], NO: [], SO: [] };
  for (const r of data ?? []) {
    const code = r.district_history[0]?.district_code ?? '';
    if (byDistrict[code]) byDistrict[code].push(r);
  }

  const total = (data ?? []).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Churches</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {total} churches across the Rio Texas Conference (2024 data year, 2025 journal).
      </p>

      <div className="mt-10 space-y-12">
        {(['CE', 'NO', 'SO'] as const).map((code) => {
          const churches = byDistrict[code];
          if (churches.length === 0) return null;
          return (
            <section key={code}>
              <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
                {DISTRICT_NAME[code]} District · {churches.length}
              </h2>
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
                {churches.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/churches/${c.id}`}
                      className="text-zinc-900 dark:text-zinc-100 hover:underline underline-offset-4"
                    >
                      {c.canonical_name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
