import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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
  disaffiliated: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900',
  merged: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900',
};

const CATEGORY_LABEL: Record<string, string> = {
  membership: 'Membership',
  ethnicity: 'Ethnicity',
  worship: 'Worship',
  groups: 'Groups & Ministries',
  finance: 'Finances',
  other: 'Gender',
};

const CATEGORY_ORDER = ['membership', 'worship', 'ethnicity', 'other', 'groups', 'finance'];

type Church = {
  id: string;
  canonical_name: string;
  city: string | null;
  status: string;
  closed_year: number | null;
  mailing_address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
};

type StatRow = {
  field_code: string;
  value_numeric: number | null;
  value_text: string | null;
  source_pdf_page: number | null;
  stat_field: { label_en: string; category: string; unit: string };
};

type Appointment = {
  role: string | null;
  status_code: string | null;
  years_at_appt: number | null;
  fraction: string | null;
  clergy: { id: string; canonical_name: string };
};

function fmtValue(row: StatRow): string {
  if (row.value_numeric === null) return row.value_text ?? '—';
  if (row.stat_field.unit === 'usd') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(row.value_numeric);
  }
  return new Intl.NumberFormat('en-US').format(row.value_numeric);
}

export default async function ChurchPage({ params }: PageProps<'/churches/[id]'>) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: church, error: chErr } = await supabase
    .from('church')
    .select('id, canonical_name, city, status, closed_year, mailing_address, phone, lat, lng')
    .eq('id', id)
    .maybeSingle<Church>();
  if (chErr || !church) notFound();

  const { data: dh } = await supabase
    .from('district_history')
    .select('district_code')
    .eq('church_id', id)
    .eq('data_year', 2024)
    .maybeSingle<{ district_code: string }>();

  const { data: stats } = await supabase
    .from('church_stat')
    .select('field_code, value_numeric, value_text, source_pdf_page, stat_field!inner(label_en, category, unit)')
    .eq('church_id', id)
    .eq('data_year', 2024)
    .order('field_code')
    .returns<StatRow[]>();

  const { data: appts } = await supabase
    .from('appointment')
    .select('role, status_code, years_at_appt, fraction, clergy:clergy_id(id, canonical_name)')
    .eq('church_id', id)
    .eq('journal_year', 2025)
    .returns<Appointment[]>();

  const { data: aliases } = await supabase
    .from('church_alias')
    .select('alias, source_section, journal_year')
    .eq('church_id', id);

  const statsByCategory: Record<string, StatRow[]> = {};
  for (const s of stats ?? []) {
    const cat = s.stat_field.category;
    (statsByCategory[cat] ??= []).push(s);
  }

  const districtName = dh?.district_code ? DISTRICT_NAME[dh.district_code] : null;
  const mapHref =
    church.lat && church.lng
      ? `https://www.openstreetmap.org/?mlat=${church.lat}&mlon=${church.lng}&zoom=15`
      : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/churches" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Churches
      </Link>

      <header className="mt-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold tracking-tight">{church.canonical_name}</h1>
          {church.status !== 'active' && (
            <span className={'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ' + (STATUS_COLOR[church.status] ?? '')}>
              {STATUS_LABEL[church.status] ?? church.status}
              {church.closed_year ? ` · ${church.closed_year}` : ''}
            </span>
          )}
        </div>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {districtName ? `${districtName} District` : 'Unassigned'}
          {church.city && church.city !== church.canonical_name ? ` · ${church.city}` : ''}
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {church.mailing_address && (
            <div>
              <div className="text-zinc-500">Address</div>
              <div>{church.mailing_address}</div>
            </div>
          )}
          {church.phone && (
            <div>
              <div className="text-zinc-500">Phone</div>
              <div>{church.phone}</div>
            </div>
          )}
          {mapHref && (
            <div>
              <div className="text-zinc-500">Map</div>
              <a href={mapHref} target="_blank" rel="noopener" className="underline underline-offset-4">
                {church.lat?.toFixed(4)}, {church.lng?.toFixed(4)}
              </a>
            </div>
          )}
        </div>
      </header>

      {appts && appts.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            2025 Appointments
          </h2>
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {appts.map((a, i) => (
              <li key={i} className="flex items-baseline justify-between py-3">
                <div>
                  <Link
                    href={`/clergy/${a.clergy.id}`}
                    className="font-medium hover:underline underline-offset-4"
                  >
                    {a.clergy.canonical_name}
                  </Link>
                  <span className="ml-2 text-sm text-zinc-500">
                    {a.role}
                    {a.years_at_appt != null ? ` · ${a.years_at_appt} yr${a.years_at_appt === 1 ? '' : 's'}` : ''}
                  </span>
                </div>
                <div className="text-sm text-zinc-500">
                  {a.status_code}
                  {a.fraction ? ` [${a.fraction}]` : ''}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats && stats.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            2024 Statistics
          </h2>
          {CATEGORY_ORDER.filter((cat) => statsByCategory[cat]?.length).map((cat) => (
            <div key={cat} className="mt-6">
              <h3 className="font-medium">{CATEGORY_LABEL[cat] ?? cat}</h3>
              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {statsByCategory[cat].map((s) => (
                  <div key={s.field_code} className="flex justify-between border-b border-zinc-100 dark:border-zinc-900 py-1">
                    <dt className="text-zinc-600 dark:text-zinc-400">
                      <span className="text-xs text-zinc-400 mr-1.5 font-mono">{s.field_code}</span>
                      {s.stat_field.label_en}
                    </dt>
                    <dd className="tabular-nums">{fmtValue(s)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      )}

      {aliases && aliases.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Also known as
          </h2>
          <ul className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {aliases.map((a, i) => (
              <li key={i}>
                {a.alias}{' '}
                <span className="text-zinc-400 text-xs">
                  ({a.source_section} {a.journal_year})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
