"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type Point = {
  id: string;
  name: string;
  city: string | null;
  lat: number;
  lng: number;
  status: string;
  riskTier: string | null;
  riskScore: number | null;
  members: number | null;
  trend: number | null;
  district: "Central" | "North" | "South" | null;
};

type Mode = "status" | "risk" | "trend" | "district";

const C = {
  teal: "#1f6e62", ember: "#b1431c", amber: "#a9772b", elev: "#c2722e", faint: "#938974",
  ox: "#6e2417", sky: "#2c5d70",
};

function colorFor(p: Point, mode: Mode): string {
  if (mode === "status") {
    return p.status === "active" ? C.teal : p.status === "disaffiliated" ? C.amber : p.status === "closed" ? C.ember : C.faint;
  }
  if (mode === "risk") {
    if (p.status !== "active" || !p.riskTier) return C.faint;
    return p.riskTier === "low" ? C.teal : p.riskTier === "moderate" ? C.amber : p.riskTier === "elevated" ? C.elev : C.ember;
  }
  if (mode === "district") {
    return p.district === "North" ? C.teal : p.district === "Central" ? C.amber : p.district === "South" ? C.sky : C.faint;
  }
  if (p.trend == null) return C.faint;
  return p.trend > 5 ? C.teal : p.trend < -5 ? C.ember : C.amber;
}

const LEGEND: Record<Mode, { label: string; color: string }[]> = {
  status: [{ label: "Active", color: C.teal }, { label: "Disaffiliated", color: C.amber }, { label: "Closed", color: C.ember }],
  risk: [{ label: "Low", color: C.teal }, { label: "Moderate", color: C.amber }, { label: "Elevated", color: C.elev }, { label: "High", color: C.ember }],
  trend: [{ label: "Growing", color: C.teal }, { label: "Stable", color: C.amber }, { label: "Declining", color: C.ember }],
  district: [{ label: "North", color: C.teal }, { label: "Central", color: C.amber }, { label: "South", color: C.sky }],
};

export default function Map({ points }: { points: Point[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  const [mode, setMode] = useState<Mode>("risk");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { scrollWheelZoom: false }).setView([29.6, -98.8], 7);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
          attribution: "© OpenStreetMap © CARTO", subdomains: "abcd", maxZoom: 19,
        }).addTo(mapRef.current);
      }
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      const bounds = L.latLngBounds([]);
      const ordered = [...points].sort((a, b) => (a.status === "active" ? 1 : 0) - (b.status === "active" ? 1 : 0));
      for (const p of ordered) {
        const color = colorFor(p, mode);
        const r = p.members ? Math.max(3.5, Math.min(13, 3 + Math.sqrt(p.members) / 3.2)) : 3.5;
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: r, color, weight: 1, fillColor: color,
          fillOpacity: p.status === "active" ? 0.72 : 0.4,
        }).addTo(mapRef.current);
        marker.bindPopup(
          `<div style="font-family:var(--font-franklin);font-size:13px;line-height:1.4">
             <strong>${escapeHtml(p.name)}</strong><br/>
             <span style="color:#6b6354">${escapeHtml(p.city ?? "")}</span><br/>
             <span style="color:#6b6354">${p.members != null ? p.members + " members" : ""}${p.riskScore != null && p.status === "active" ? ` · risk ${p.riskScore}` : ""}</span><br/>
             <a href="/churches/${p.id}" style="color:#1f6e62">Open profile →</a>
           </div>`,
        );
        bounds.extend([p.lat, p.lng]);
        markersRef.current.push(marker);
      }
      if (points.length) mapRef.current.fitBounds(bounds, { padding: [30, 30] });
    })();
    return () => { cancelled = true; };
  }, [points, mode]);

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex rounded-md border border-rule overflow-hidden text-sm bg-vellum">
          {(["risk", "trend", "district", "status"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 transition-colors ${mode === m ? "bg-ink text-vellum" : "text-ink-mute hover:bg-bone"}`}>
              {m === "risk" ? "Closure risk" : m === "trend" ? "Trajectory" : m === "district" ? "District" : "Status"}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LEGEND[mode].map((e) => (
            <li key={e.label} className="flex items-center gap-1.5 text-ink-mute">
              <span className="inline-block size-2.5 rounded-full" style={{ background: e.color }} />{e.label}
            </li>
          ))}
        </ul>
      </div>
      <div ref={containerRef} className="h-[calc(100vh-15rem)] min-h-[460px] w-full rounded-lg border border-rule overflow-hidden" />
      <p className="text-xs text-faint">{points.length} churches with mapped coordinates · marker size reflects membership · scroll-zoom disabled (drag &amp; use +/−).</p>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
}
