import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ChurchMap, { type Point } from './Map';
import conversion from '@/lib/district-conversion-2025.json';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  canonical_name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  district_history: { district_code: string; data_year: number }[];
};

type ConversionRow = {
  new_district: string;
  county: string;
  city: string;
  church: string;
  old_district: string;
};

function normalize(s: string): string {
  return s.replace(/\s+UMC$/i, '').replace(/[.'’"]/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
}

export default async function MapPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('church')
    .select('id, canonical_name, city, lat, lng, district_history(district_code, data_year)')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .returns<Row[]>();

  if (error) {
    return <main className="mx-auto max-w-3xl px-6 py-16 text-red-600">DB error: {error.message}</main>;
  }

  // Build a lookup from the conversion chart: church name → old_district.
  // Keys: stripped " UMC", lowercased, plus city-prefix variants.
  const chart = conversion as ConversionRow[];
  const oldByName = new Map<string, string>();
  for (const r of chart) {
    const fullName = `${r.city}: ${r.church}`.replace(/\s+UMC$/i, '').trim();
    oldByName.set(normalize(fullName), r.old_district);
    oldByName.set(normalize(r.church), r.old_district);
    oldByName.set(normalize(`${r.city}: ${r.church}`), r.old_district);
  }

  const points: Point[] = (data ?? []).map((r) => {
    const dh2024 = r.district_history.find((d) => d.data_year === 2024);
    const dh2023 = r.district_history.find((d) => d.data_year === 2023);
    // Era A (2024 view) — use the district_history.data_year=2023 entry
    // (parsed from the 2024 journal). Fall back to the conversion chart by
    // name if the church wasn't in J that year.
    let district2024 = dh2023?.district_code ?? '';
    if (district2024) district2024 = ERA_A_NAME[district2024] ?? '';
    if (!district2024) district2024 = oldByName.get(normalize(r.canonical_name)) ?? '';
    return {
      id: r.id,
      name: r.canonical_name,
      lat: r.lat as number,
      lng: r.lng as number,
      district2025: dh2024?.district_code ?? '',
      district2024,
      city: r.city,
    };
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Home
      </Link>
      <div className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight">Map</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {points.length} churches plotted. Toggle between the 2024 (Era A, 7 districts) and 2025 (Era B, 3 districts) layouts to see how the conference reorganized.
        </p>
      </div>
      <div className="mt-6">
        <ChurchMap points={points} />
      </div>
    </main>
  );
}

const ERA_A_NAME: Record<string, string> = {
  CA: 'Capital',
  CB: 'Coastal Bend',
  CR: 'Crossroads',
  EV: 'El Valle',
  HC: 'Hill Country',
  LM: 'Las Misiones',
  WS: 'West',
};
