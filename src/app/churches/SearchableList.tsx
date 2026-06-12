"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUS, RISK, type RiskTier } from "@/lib/atlas";

export type Row = {
  id: string;
  name: string;
  status: keyof typeof STATUS;
  city: string | null;
  district: string | null;
  worship: number | null;
  worshipTrend: number | null; // % change over window
  riskTier: RiskTier | null;
  riskScore: number | null;
};

type SortKey = "name" | "worship" | "trend" | "risk";

export default function SearchableList({ rows, districts }: { rows: Row[]; districts: string[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [district, setDistrict] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("worship");
  const [asc, setAsc] = useState(false);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let r = rows.filter((x) => {
      if (status !== "all" && x.status !== status) return false;
      if (district !== "all" && x.district !== district) return false;
      if (ql && !x.name.toLowerCase().includes(ql) && !(x.city ?? "").toLowerCase().includes(ql)) return false;
      return true;
    });
    const dir = asc ? 1 : -1;
    r = [...r].sort((a, b) => {
      const get = (x: Row) => sort === "name" ? x.name : sort === "worship" ? (x.worship ?? -1) : sort === "trend" ? (x.worshipTrend ?? -999) : (x.riskScore ?? -1);
      const av = get(a), bv = get(b);
      if (typeof av === "string") return (av as string).localeCompare(bv as string) * (asc ? 1 : -1);
      return ((av as number) - (bv as number)) * dir;
    });
    return r;
  }, [rows, q, status, district, sort, asc]);

  const toggle = (k: SortKey) => { if (sort === k) setAsc(!asc); else { setSort(k); setAsc(k === "name"); } };
  const arrow = (k: SortKey) => sort === k ? (asc ? "▲" : "▼") : "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search church or city…"
          className="flex-1 min-w-[200px] px-3.5 py-2 bg-vellum border border-rule rounded-md text-ink placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-teal/40"
        />
        <Select value={status} onChange={setStatus} options={[["active", "Active"], ["closed", "Closed"], ["disaffiliated", "Disaffiliated"], ["all", "All statuses"]]} />
        <Select value={district} onChange={setDistrict} options={[["all", "All districts"], ...districts.map((d) => [d, d] as [string, string])]} />
      </div>

      <p className="mt-3 text-sm text-ink-mute tnum">{filtered.length} churches</p>

      <div className="mt-3 panel rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1.6fr_1fr_auto_auto_auto] gap-x-4 px-4 py-2.5 border-b border-rule text-xs text-ink-mute">
          <button onClick={() => toggle("name")} className="text-left hover:text-ink">Church {arrow("name")}</button>
          <span className="hidden sm:block">District</span>
          <button onClick={() => toggle("worship")} className="text-right hover:text-ink tnum">Worship {arrow("worship")}</button>
          <button onClick={() => toggle("trend")} className="text-right hover:text-ink tnum w-20">Trend {arrow("trend")}</button>
          <button onClick={() => toggle("risk")} className="text-right hover:text-ink tnum w-20">Risk {arrow("risk")}</button>
        </div>
        <div className="divide-y divide-rule max-h-[70vh] overflow-y-auto">
          {filtered.map((x) => (
            <Link key={x.id} href={`/churches/${x.id}`} className="grid grid-cols-[1fr_auto_auto_auto] sm:grid-cols-[1.6fr_1fr_auto_auto_auto] gap-x-4 px-4 py-2.5 items-center hover:bg-vellum transition-colors">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS[x.status].dot }} />
                  <span className="text-ink truncate">{x.name}</span>
                </div>
                {x.city && <span className="text-xs text-faint pl-3.5">{x.city}</span>}
              </div>
              <span className="hidden sm:block text-sm text-ink-mute truncate">{x.district ?? "—"}</span>
              <span className="text-right tnum text-ink">{x.worship != null ? new Intl.NumberFormat("en-US").format(x.worship) : "—"}</span>
              <span className={`text-right tnum text-sm w-20 ${x.worshipTrend == null ? "text-faint" : x.worshipTrend < 0 ? "text-ember" : "text-teal"}`}>
                {x.worshipTrend == null ? "—" : `${x.worshipTrend > 0 ? "+" : ""}${x.worshipTrend}%`}
              </span>
              <span className="text-right w-20">
                {x.riskTier && x.status === "active" ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${RISK[x.riskTier].bg} ${RISK[x.riskTier].text}`}>{x.riskScore}</span>
                ) : <span className="text-faint text-sm">—</span>}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 bg-vellum border border-rule rounded-md text-ink text-sm focus:outline-none focus:ring-1 focus:ring-teal/40">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
