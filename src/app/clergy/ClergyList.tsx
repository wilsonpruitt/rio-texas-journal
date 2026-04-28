'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type Row = {
  id: string;
  canonical_name: string;
  status: string;
  apptStatus: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  unknown: 'Needs review',
  withdrawn: 'Withdrawn',
  retired: 'Retired',
  transferred: 'Transferred',
  deceased: 'Deceased',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900',
  unknown: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900',
  withdrawn: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900',
  retired: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900',
  transferred: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900',
  deceased: 'bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
};

const FILTER_ORDER = ['active', 'unknown', 'retired', 'withdrawn', 'transferred', 'deceased'];

export default function ClergyList({ rows }: { rows: Row[] }) {
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
      list = list.filter((r) => r.canonical_name.toLowerCase().includes(needle));
    }
    return list;
  }, [rows, filter, q]);

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
        placeholder={`Search ${filtered.length} clergy…`}
        className="mt-4 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
      />

      <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
        {filtered.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-2">
            <Link
              href={`/clergy/${c.id}`}
              className="text-zinc-900 dark:text-zinc-100 hover:underline underline-offset-4 truncate"
            >
              {c.canonical_name}
            </Link>
            {c.apptStatus && <span className="text-xs text-zinc-400 font-mono shrink-0">{c.apptStatus}</span>}
          </li>
        ))}
      </ul>
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
