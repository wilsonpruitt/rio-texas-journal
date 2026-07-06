import { notFound } from "next/navigation";
import careers from "@data/public/clergy-careers.json";
import config from "@/lib/conference";

export const metadata = {
  title: "Clergy Careers",
  description:
    "What a ministry career looks like in the Rio Texas Annual Conference — by order. Elders, deacons, and licensed local pastors serve very differently, drawn from the 2025 Journal clergy records.",
};

type Block = { n: number; churches_mean: number; churches_median: number; career_mean: number; career_median: number } | null;
type Tenure = { n: number; mean: number; median: number; mode: number; short_appt_share: number; histogram: Record<string, number>; "13_plus": number } | null;
type Order = {
  n_total: number; active: Block; retired: Block; extension_n: number; leave_n: number;
  tenure_per_appointment: Tenure;
  entry_decade: Record<string, { n: number; churches_mean: number; career_mean: number; churches_per_decade: number }>;
};
const C = careers as unknown as {
  conference: string; journal_year: number; n_records: number;
  orders: Record<string, Order>;
  districts: Record<string, NonNullable<Block>>;
  district_match_rate: number;
};

const TEAL = "#2f7d77";
const OX = "#8a3a32";
const SHOWN = ["Elder", "Deacon", "Local pastor"] as const; // "Other" noted in footnote

function hist(t: Tenure) {
  if (!t) return [];
  const h = Object.entries(t.histogram).map(([k, v]) => ({ label: k, value: v }));
  h.push({ label: "13+", value: t["13_plus"] });
  return h;
}

// compact server-rendered SVG vertical bars
function VBars({ data, color = TEAL, unit = "", h = 150 }: { data: { label: string; value: number; note?: string }[]; color?: string; unit?: string; h?: number }) {
  const W = 360, padL = 6, padB = 34, padT = 14;
  const max = Math.max(...data.map((d) => d.value)) || 1;
  const bw = (W - padL) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full" role="img">
      {data.map((d, i) => {
        const bh = (d.value / max) * (h - padT - padB);
        const x = padL + i * bw + bw * 0.16;
        const y = padT + (h - padT - padB) - bh;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={bw * 0.68} height={bh} fill={color} fillOpacity={0.85} rx={1.5} />
            <text x={x + bw * 0.34} y={y - 4} textAnchor="middle" fontSize="10" fill="#3a3a3a" fontWeight="600">{d.value}{unit}</text>
            <text x={x + bw * 0.34} y={h - padB + 16} textAnchor="middle" fontSize="10" fill="#6a6256">{d.label}</text>
            {d.note ? <text x={x + bw * 0.34} y={h - padB + 28} textAnchor="middle" fontSize="8.5" fill="#9a9182">{d.note}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

const ORDER_BLURB: Record<string, string> = {
  Elder: "Ordained, itinerant. The classic moving career — sent where the bishop appoints.",
  Deacon: "Ordained to a specialized ministry. Tend to stay put in one setting.",
  "Local pastor": "Licensed, often part-time and bivocational; many enter as a second career.",
};

export default function CareersPage() {
  if (!config.modules.careers) notFound();
  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      <p className="eyebrow text-oxblood">{config.shortName} · {C.journal_year} Journal</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink leading-tight">
        What a ministry career looks like
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-mute">
        Drawn from the appointment histories of all{" "}
        {C.n_records.toLocaleString()}{" "}
        clergy in the conference&apos;s records. The shape of a career depends almost entirely on{" "}
        <span className="text-ink">order</span> — so the numbers are split three ways, never blended.
      </p>

      {/* Three orders, side by side */}
      <section className="mt-10 grid gap-5 md:grid-cols-3">
        {SHOWN.map((o) => {
          const od = C.orders[o];
          const a = od.active, r = od.retired, t = od.tenure_per_appointment;
          return (
            <div key={o} className="rounded-lg border border-rule bg-bone/40 p-6">
              <h2 className="font-display text-2xl text-oxblood">{o}s</h2>
              <p className="mt-1 text-sm text-ink-mute">{ORDER_BLURB[o]}</p>
              <dl className="mt-4 space-y-3 text-sm">
                {a && (
                  <div>
                    <dt className="text-ink-mute">Active today ({a.n})</dt>
                    <dd className="text-ink">
                      <span className="font-display text-2xl text-ink">{a.churches_median}</span> {a.churches_median === 1 ? "church" : "churches"}
                      <span className="text-ink-mute"> median · {a.churches_mean} mean</span>
                      <div className="text-[13px] text-ink-mute">{a.career_median} {a.career_median === 1 ? "yr" : "yrs"} in so far · {a.career_mean} mean</div>
                    </dd>
                  </div>
                )}
                {r && (
                  <div>
                    <dt className="text-ink-mute">Full career, now retired ({r.n})</dt>
                    <dd className="text-ink">
                      <span className="font-display text-2xl text-ink">{r.churches_median}</span> {r.churches_median === 1 ? "church" : "churches"}
                      <span className="text-ink-mute"> median · {r.churches_mean} mean</span>
                      <div className="text-[13px] text-ink-mute">over {r.career_median} {r.career_median === 1 ? "yr" : "yrs"} · {r.career_mean} mean</div>
                    </dd>
                  </div>
                )}
                {t && (
                  <div>
                    <dt className="text-ink-mute">Typical appointment</dt>
                    <dd className="text-ink">
                      <span className="font-display text-2xl text-ink">{t.median}</span> {t.median === 1 ? "yr" : "yrs"}
                      <span className="text-ink-mute"> median · {t.mean} mean</span>
                      <div className="text-[13px] text-ink-mute">{Math.round(t.short_appt_share * 100)}% last 1–2 yrs</div>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </section>
      <p className="mt-3 text-sm text-ink-mute max-w-2xl">
        An elder&apos;s full career runs to {C.orders.Elder.retired?.churches_median}{" "}
        churches; a deacon&apos;s, often {C.orders.Deacon.retired?.churches_median}. Blending the
        orders would hide exactly this difference.
      </p>

      {/* Tenure distributions, small multiples */}
      <section className="mt-14">
        <p className="eyebrow text-teal">How long does one appointment last?</p>
        <h2 className="mt-1 font-display text-2xl text-ink">Local pastors move fastest; deacons stay longest.</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {SHOWN.map((o) => {
            const t = C.orders[o].tenure_per_appointment;
            return (
              <div key={o} className="rounded-lg border border-rule bg-parchment p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-lg text-ink">{o}s</h3>
                  <span className="text-xs text-ink-mute">median {t?.median}y · mean {t?.mean}y · n={t?.n}</span>
                </div>
                <VBars data={hist(t)} color={o === "Local pastor" ? OX : TEAL} />
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-mute">Years in a single appointment → number of completed appointments. (Deacon counts are small — read as indicative.)</p>
      </section>

      {/* Mobility rising — elders */}
      <section className="mt-14">
        <p className="eyebrow text-teal">Has it changed?</p>
        <h2 className="mt-1 font-display text-2xl text-ink">Newer elders move more often.</h2>
        <p className="mt-2 max-w-2xl text-ink-mute">
          Counting churches served per decade of service, elders who entered ministry recently are
          changing appointments more frequently than earlier generations did at the same stage.
        </p>
        <div className="mt-5 rounded-lg border border-rule bg-parchment p-4 md:max-w-2xl">
          <VBars
            h={170}
            data={Object.entries(C.orders.Elder.entry_decade).map(([d, v]) => ({ label: d, value: v.churches_per_decade, note: `n=${v.n}` }))}
          />
          <p className="mt-1 text-center text-xs text-ink-mute">Active elders — churches per decade of service, by the decade they entered ministry</p>
        </div>
      </section>

      {/* District */}
      <section className="mt-14">
        <p className="eyebrow text-teal">By district</p>
        <h2 className="mt-1 font-display text-2xl text-ink">Mobility is broadly similar across districts.</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {Object.entries(C.districts).map(([d, v]) => (
            <div key={d} className="rounded-md border border-rule bg-bone/40 p-5">
              <div className="font-display text-xl text-ink">{d}</div>
              <div className="mt-2 text-sm text-ink-mute">
                <span className="text-oxblood font-semibold">{v.churches_mean}</span> churches on average ·{" "}
                {v.career_mean}-yr mean career · n={v.n}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-mute">
          District is matched by clergy name to the {C.journal_year} appointment roster
          ({Math.round(C.district_match_rate * 100)}% of active clergy matched, all orders); indicative.
        </p>
      </section>

      <footer className="mt-16 border-t border-rule pt-5 text-xs text-ink-mute">
        Source: Rio Texas Annual Conference Journal {C.journal_year}, Section I (Clergy Records) and the
        2025 Appointments roster. Order is taken from each clergyperson&apos;s current status code
        (elder, deacon, or licensed local pastor; associate members, provisional-generic, and
        other-denomination clergy are grouped as &ldquo;other&rdquo; and not shown here). A church
        appointment excludes extension ministry, leave, school, and retirement. Gender and race are not
        shown — the journal does not record them.
      </footer>
    </main>
  );
}
