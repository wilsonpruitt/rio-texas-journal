import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  canonical_name: string;
  appointments: { status_code: string | null }[];
};

function lastNameKey(name: string): string {
  // Sort by last word in the name (handles "Daisy San Jorge Borrego" → Borrego).
  const words = name.trim().split(/\s+/);
  return (words[words.length - 1] || name).toLowerCase();
}

export default async function ClergyPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clergy')
    .select('id, canonical_name, appointments:appointment(status_code)')
    .returns<Row[]>();

  if (error) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
  }

  const sorted = [...(data ?? [])].sort((a, b) => lastNameKey(a.canonical_name).localeCompare(lastNameKey(b.canonical_name)));

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Clergy</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {sorted.length} clergy serving Rio Texas in 2025.
      </p>

      <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
        {sorted.map((c) => {
          const status = c.appointments?.[0]?.status_code;
          return (
            <li key={c.id} className="flex items-baseline justify-between gap-2">
              <Link
                href={`/clergy/${c.id}`}
                className="text-zinc-900 dark:text-zinc-100 hover:underline underline-offset-4 truncate"
              >
                {c.canonical_name}
              </Link>
              {status && <span className="text-xs text-zinc-400 font-mono shrink-0">{status}</span>}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
