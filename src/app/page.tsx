import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Journal = {
  year: number;
  pdf_path: string;
  data_year: number;
  parser_era: 'a' | 'b';
};

export default async function Home() {
  const supabase = await createClient();
  const { data: journals, error } = await supabase
    .from('journal')
    .select('year, pdf_path, data_year, parser_era')
    .order('year', { ascending: false })
    .returns<Journal[]>();

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pdfUrl = (path: string) =>
    `${baseUrl}/storage/v1/object/public/journals/${path}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Rio Texas Journal</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Interactive archive of Rio Texas Annual Conference journals.
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Smoke test — journals in DB
        </h2>
        {error ? (
          <p className="mt-3 text-red-600">DB error: {error.message}</p>
        ) : journals && journals.length > 0 ? (
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {journals.map((j) => (
              <li key={j.year} className="flex items-center justify-between py-3">
                <div>
                  <span className="font-medium">{j.year}</span>{' '}
                  <span className="text-zinc-500">
                    (data {j.data_year}, era {j.parser_era})
                  </span>
                </div>
                <a
                  href={pdfUrl(j.pdf_path)}
                  className="text-sm underline underline-offset-4 hover:no-underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  PDF →
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-zinc-500">No journals yet.</p>
        )}
      </section>
    </main>
  );
}
