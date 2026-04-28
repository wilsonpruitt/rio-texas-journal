'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

export type Point = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  district2025: string; // CE / NO / SO / ''
  district2024: string; // Capital / North / Coastal Bend / etc. / ''
  city: string | null;
};

const ERA_B_COLOR: Record<string, string> = {
  CE: '#2563eb',
  NO: '#16a34a',
  SO: '#dc2626',
  '': '#737373',
};

const ERA_B_NAME: Record<string, string> = {
  CE: 'Central',
  NO: 'North',
  SO: 'South',
};

const ERA_A_COLOR: Record<string, string> = {
  Capital: '#2563eb',
  'Coastal Bend': '#06b6d4',
  Crossroads: '#f59e0b',
  'El Valle': '#dc2626',
  'Hill Country': '#16a34a',
  'Las Misiones': '#a855f7',
  West: '#78350f',
  '': '#737373',
};

export type EraView = '2025' | '2024';

export default function Map({ points }: { points: Point[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  const [era, setEra] = useState<EraView>('2025');

  // Recompute counts for whichever era is active.
  const counts: Record<string, number> = {};
  for (const p of points) {
    const k = era === '2025' ? p.district2025 : p.district2024;
    counts[k] = (counts[k] || 0) + 1;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current).setView([29.5, -98.5], 7);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(mapRef.current);
      }
      // Clear existing markers, then redraw.
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      const bounds = L.latLngBounds([]);
      for (const p of points) {
        const districtKey = era === '2025' ? p.district2025 : p.district2024;
        const palette = era === '2025' ? ERA_B_COLOR : ERA_A_COLOR;
        const color = palette[districtKey] ?? palette[''];
        const districtLabel = era === '2025'
          ? (ERA_B_NAME[districtKey] ?? '')
          : (districtKey || '');
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: 5,
          color,
          weight: 1.5,
          fillColor: color,
          fillOpacity: 0.75,
        }).addTo(mapRef.current);
        marker.bindPopup(
          `<div style="font-size:13px;line-height:1.35">
             <strong>${escapeHtml(p.name)}</strong><br/>
             <span style="color:#666">${escapeHtml(p.city ?? '')}${districtLabel ? ` · ${districtLabel} District` : ''}</span><br/>
             <a href="/churches/${p.id}" style="color:#2563eb;text-decoration:underline">Open profile →</a>
           </div>`,
        );
        bounds.extend([p.lat, p.lng]);
        markersRef.current.push(marker);
      }
      if (points.length > 0 && era === '2025') {
        mapRef.current.fitBounds(bounds, { padding: [30, 30] });
      }
    })();

    return () => { cancelled = true; };
  }, [points, era]);

  // Cleanup map on unmount.
  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  const eraEntries = era === '2025'
    ? (['CE', 'NO', 'SO'] as const).map((k) => ({ key: k, label: ERA_B_NAME[k], color: ERA_B_COLOR[k] }))
    : (['Capital', 'Coastal Bend', 'Crossroads', 'El Valle', 'Hill Country', 'Las Misiones', 'West'] as const).map((k) => ({ key: k, label: k, color: ERA_A_COLOR[k] }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setEra('2024')}
            className={
              'px-3 py-1.5 ' +
              (era === '2024'
                ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800')
            }
          >
            2024 · Era A (7 districts)
          </button>
          <button
            type="button"
            onClick={() => setEra('2025')}
            className={
              'px-3 py-1.5 ' +
              (era === '2025'
                ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800')
            }
          >
            2025 · Era B (3 districts)
          </button>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {eraEntries.map((e) => (
            <li key={e.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: e.color }} />
              {e.label} · {counts[e.key] ?? 0}
            </li>
          ))}
        </ul>
      </div>
      <div ref={containerRef} className="h-[calc(100vh-14rem)] w-full rounded-md border border-zinc-200 dark:border-zinc-800" />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
