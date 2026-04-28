'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

const DISTRICT_NAME: Record<string, string> = {
  CE: 'Central',
  NO: 'North',
  SO: 'South',
};

type Row = {
  id: string;
  canonical_name: string;
  city: string | null;
  district_code: string;
};

export default function SearchableList({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.canonical_name.toLowerCase().includes(needle) ||
        (r.city ?? '').toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const byDistrict: Record<string, Row[]> = { CE: [], NO: [], SO: [] };
  for (const r of filtered) {
    if (byDistrict[r.district_code]) byDistrict[r.district_code].push(r);
  }

  return (
    <>
      <div className="mt-8">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${rows.length} churches…`}
          className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          autoFocus
        />
        {q.trim() && (
          <p className="mt-2 text-xs text-zinc-500">
            {filtered.length} match{filtered.length === 1 ? '' : 'es'}
          </p>
        )}
      </div>

      <div className="mt-8 space-y-12">
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
    </>
  );
}
