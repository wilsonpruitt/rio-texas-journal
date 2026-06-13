"use client";

import { useState } from "react";
import { TrendChart, type Pt } from "./TrendChart";
import { fmtUsd } from "@/lib/atlas";

/**
 * Apportionments paid (per-church GCFA basis), toggled between every church on
 * record and only the churches still active today. The gap between the two is
 * the apportionment giving lost to churches closing or disaffiliating, as
 * opposed to remaining churches paying less.
 */
export function ApportionmentSplit({ all, remained, remainedCount }: { all: Pt[]; remained: Pt[]; remainedCount: number }) {
  const [remainedOnly, setRemainedOnly] = useState(false);
  const data = remainedOnly ? remained : all;
  const first = data[0]?.value ?? 0;
  const last = data.at(-1)?.value ?? 0;
  const pct = first ? Math.round(((last - first) / first) * 100) : 0;

  return (
    <div className="panel rounded-lg p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Apportionments paid</div>
          <div className="mt-1 text-sm text-ink-mute">{data[0]?.year}–{data.at(-1)?.year}, per-church basis</div>
        </div>
        <div className="inline-flex rounded-md ring-1 ring-rule overflow-hidden text-sm" role="group" aria-label="Which churches to count">
          <Toggle on={!remainedOnly} onClick={() => setRemainedOnly(false)}>All churches</Toggle>
          <Toggle on={remainedOnly} onClick={() => setRemainedOnly(true)}>Churches who remained</Toggle>
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="tnum text-2xl font-semibold text-ink">{fmtUsd(last)}</span>
        <span className={`tnum text-xs ${pct < 0 ? "text-ember" : "text-teal"}`}>{pct > 0 ? "+" : ""}{pct}% since {data[0]?.year}</span>
      </div>
      <div className="mt-3">
        <TrendChart points={data} accent="ember" format="usd" markMergerYear={null} />
      </div>
      <p className="mt-3 text-xs text-faint leading-relaxed">
        {remainedOnly
          ? `Apportionments paid by the ${remainedCount} churches still active today, traced back through every year — the decline here is remaining churches paying less, not congregations leaving.`
          : "Apportionments paid by every church on record, including those that have since closed or disaffiliated and stopped paying."}{" "}
        Per-church reported figures (GCFA Table J); they run lower than the audited conference total above, and the most recent year reflects partial reporting.
      </p>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`px-3.5 py-1.5 transition-colors ${on ? "bg-ink text-vellum" : "text-ink-mute hover:bg-vellum"}`}>
      {children}
    </button>
  );
}
