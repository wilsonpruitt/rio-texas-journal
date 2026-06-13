"use client";

import { useState } from "react";
import { TrendChart, type Pt } from "./TrendChart";

type Triple = { members: Pt[]; attendance: Pt[]; giving: Pt[] };

/**
 * Conference-wide trend panels with an "all churches" vs "continuing churches
 * only" toggle. The active-only cut traces just the churches still active today
 * back through every year, so its decline reflects loss within surviving
 * congregations rather than churches closing or disaffiliating.
 */
export function ConferenceTrends({ all, active, activeCount }: { all: Triple; active: Triple; activeCount: number }) {
  const [activeOnly, setActiveOnly] = useState(false);
  const data = activeOnly ? active : all;

  return (
    <>
      <div className="mt-6 inline-flex rounded-md ring-1 ring-rule overflow-hidden text-sm" role="group" aria-label="Which churches to count">
        <Toggle on={!activeOnly} onClick={() => setActiveOnly(false)}>All churches</Toggle>
        <Toggle on={activeOnly} onClick={() => setActiveOnly(true)}>Continuing churches only</Toggle>
      </div>
      <p className="mt-3 text-xs text-faint max-w-2xl leading-relaxed">
        {activeOnly
          ? `Only the ${activeCount} churches still active today, traced back through every year. Decline here is loss within surviving congregations — it excludes the churches that have since closed or disaffiliated.`
          : "Every church on record, including those that have since closed or disaffiliated. Departures and closures read as part of the decline."}
      </p>
      <div className="mt-6 grid lg:grid-cols-3 gap-5">
        <TrendPanel title="Professing members" series={data.members} accent="ember" />
        <TrendPanel title="Average worship attendance" series={data.attendance} accent="ember" />
        <TrendPanel title="Total funds paid" series={data.giving} accent="teal" format="usd" />
      </div>
    </>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`px-3.5 py-1.5 transition-colors ${on ? "bg-ink text-vellum" : "text-ink-mute hover:bg-vellum"}`}
    >
      {children}
    </button>
  );
}

function TrendPanel({ title, series, accent, format }: { title: string; series: Pt[]; accent: "teal" | "ember"; format?: "count" | "usd" }) {
  const first = series[0]?.value ?? 0;
  const last = series.at(-1)?.value ?? 0;
  const pct = first ? Math.round(((last - first) / first) * 100) : 0;
  return (
    <div className="panel rounded-lg p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <span className={`tnum text-xs ${pct < 0 ? "text-ember" : "text-teal"}`}>{pct > 0 ? "+" : ""}{pct}%</span>
      </div>
      <div className="mt-3">
        <TrendChart points={series} accent={accent} format={format ?? "count"} height={120} />
      </div>
    </div>
  );
}
