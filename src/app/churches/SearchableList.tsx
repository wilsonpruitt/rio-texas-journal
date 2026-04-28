'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

const DISTRICT_NAME: Record<string, string> = {
  CE: 'Central',
  NO: 'North',
  SO: 'South',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  closed: 'Closed',
  disaffiliated: 'Disaffiliated',
  merged: 'Merged',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900',
  closed: 'bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
  disaffiliated: 'bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
  merged: 'bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
};

const FILTER_ORDER = ['active', 'closed', 'disaffiliated', 'merged'];

type Row = {
  id: string;
  canonical_name: string;
  city: string | null;
  status: string;
  district_code: string;
};

export default function SearchableList({ rows }: { rows: Row[] }) {
  const [filter, setFilter] = useState<string>('active');
  const [q, setQ] = useState('');

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (r) => r.canonical_name.toLowerCase().includes(needle) || (r.city ?? '').toLowerCase().includes(needle),
      );
    }
    return list;
  }, [rows, filter, q]);

  // Active churches group by district; everyone else just lists alphabetically.
  const grouped = filter === 'active';
  const byDistrict: Record<string, Row[]> = { CE: [], NO: [], SO: [] };
  if (grouped) {
    for (const r of filtered) if (byDistrict[r.district_code]) byDistrict[r.district_code].push(r);
  }

  return (
    <>
      <div className="mt-8 flex flex-wrap gap-2">
        <FilterChip active={filter === 'all'} count={rows.length} label="All" onClick={() => setFilter('all')} />
        {FILTER_ORDER.filter((s) => counts[s]).map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            count={counts[s]}
            label={STATUS_LABEL[s] ?? s}
            onClick={() => setFilter(s)}
            colorClass={STATUS_COLOR[s]}
          />
        ))}
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${filtered.length} churches…`}
        className="mt-4 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
      />

      {grouped ? (
        <div className="mt-6 space-y-10">
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
      ) : (
        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
          {filtered.map((c) => (
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
      )}
    </>
  );
}

function FilterChip({
  active,
  count,
  label,
  onClick,
  colorClass,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
  colorClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ' +
        (active
          ? (colorClass ?? 'bg-zinc-900 text-zinc-50 ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100')
          : 'bg-transparent text-zinc-500 ring-zinc-300 hover:text-zinc-900 hover:ring-zinc-500 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:text-zinc-100')
      }
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
