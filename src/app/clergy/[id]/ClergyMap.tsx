'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export type Stop = {
  year: number;
  churchId: string;
  churchName: string;
  city: string | null;
  lat: number;
  lng: number;
  role: string | null;
};

export default function ClergyMap({ stops }: { stops: Stop[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current);
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      // Sort stops by year ascending; collapse multi-charge same-year stops
      // and consecutive duplicate-church entries (re-appointments at the
      // same church should still draw a single point for that span).
      const sorted = [...stops].sort((a, b) => a.year - b.year);
      const bounds = L.latLngBounds([]);

      // Draw arcs between consecutive distinct churches.
      const path: [number, number][] = [];
      let prevChurchId: string | null = null;
      for (const s of sorted) {
        if (s.churchId !== prevChurchId) {
          path.push([s.lat, s.lng]);
          prevChurchId = s.churchId;
        }
      }
      if (path.length >= 2) {
        L.polyline(path, {
          color: '#2563eb',
          weight: 2,
          opacity: 0.5,
          dashArray: '4,6',
        }).addTo(map);
      }

      // Group stops by churchId so a long tenure shows as one marker
      // labeled with the year-range.
      const byChurch = new Map<string, Stop[]>();
      for (const s of sorted) {
        const list = byChurch.get(s.churchId) ?? [];
        list.push(s);
        byChurch.set(s.churchId, list);
      }
      const ordered = Array.from(byChurch.values())
        .map((arr) => ({ first: arr[0].year, list: arr }))
        .sort((a, b) => a.first - b.first);

      ordered.forEach((entry, idx) => {
        const arr = entry.list;
        const a = arr[0];
        const years = arr.map((s) => s.year);
        const yearLabel = years.length === 1 ? `${years[0]}` : `${Math.min(...years)}–${Math.max(...years)}`;
        const stopNumber = idx + 1;
        const marker = L.circleMarker([a.lat, a.lng], {
          radius: 9,
          color: '#1e3a8a',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 0.85,
        }).addTo(map);
        // Numbered tooltip permanent.
        marker.bindTooltip(String(stopNumber), {
          permanent: true,
          direction: 'center',
          className: 'rtxj-stop-label',
        });
        marker.bindPopup(
          `<div style="font-size:13px;line-height:1.35">
             <strong>${escapeHtml(a.churchName)}</strong><br/>
             <span style="color:#666">${escapeHtml(a.city ?? '')}${a.role ? ` · ${escapeHtml(a.role)}` : ''}</span><br/>
             <span style="color:#666">${yearLabel}</span><br/>
             <a href="/churches/${a.churchId}" style="color:#2563eb;text-decoration:underline">Open church profile →</a>
           </div>`,
        );
        bounds.extend([a.lat, a.lng]);
      });

      if (ordered.length > 0) {
        if (ordered.length === 1) {
          map.setView([ordered[0].list[0].lat, ordered[0].list[0].lng], 11);
        } else {
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      } else {
        map.setView([29.5, -98.5], 7);
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [stops]);

  return (
    <>
      <style>{`
        .rtxj-stop-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          color: white !important;
          font-weight: 600;
          font-size: 11px;
        }
      `}</style>
      <div ref={containerRef} className="h-[300px] w-full rounded-md border border-zinc-200 dark:border-zinc-800" />
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
