import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import Map, { type Point } from './Map';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  canonical_name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  district_history: { district_code: string }[];
};

export default async function MapPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('church')
    .select('id, canonical_name, city, lat, lng, district_history(district_code)')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .returns<Row[]>();

  if (error) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
  }

  const points: Point[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.canonical_name,
    lat: r.lat as number,
    lng: r.lng as number,
    district: r.district_history.find((d) => d.district_code)?.district_code ?? '',
    city: r.city,
  }));

  const counts = { CE: 0, NO: 0, SO: 0, '': 0 };
  for (const p of points) counts[p.district as keyof typeof counts] = (counts[p.district as keyof typeof counts] ?? 0) + 1;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <div className="mt-4 flex items-baseline justify-between gap-6 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight">Map</h1>
        <ul className="flex gap-4 text-sm">
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: '#2563eb' }} />
            Central · {counts.CE}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: '#16a34a' }} />
            North · {counts.NO}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: '#dc2626' }} />
            South · {counts.SO}
          </li>
          {counts[''] > 0 && (
            <li className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: '#737373' }} />
              Unassigned · {counts['']}
            </li>
          )}
        </ul>
      </div>
      <p className="mt-1 text-sm text-zinc-500">{points.length} churches plotted.</p>

      <div className="mt-6">
        <Map points={points} />
      </div>
    </main>
  );
}
