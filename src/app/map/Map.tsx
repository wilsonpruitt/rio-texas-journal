'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export type Point = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  district: string; // 'CE' | 'NO' | 'SO' | ''
  city: string | null;
};

const DISTRICT_COLOR: Record<string, string> = {
  CE: '#2563eb', // blue
  NO: '#16a34a', // green
  SO: '#dc2626', // red
  '': '#737373', // gray for unassigned
};

const DISTRICT_NAME: Record<string, string> = {
  CE: 'Central',
  NO: 'North',
  SO: 'South',
};

export default function Map({ points }: { points: Point[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      // Center on the Rio Texas Conference (roughly San Antonio).
      const map = L.map(containerRef.current).setView([29.5, -98.5], 7);
      mapRef.current = map;

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      const bounds = L.latLngBounds([]);
      for (const p of points) {
        const color = DISTRICT_COLOR[p.district] ?? DISTRICT_COLOR[''];
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: 5,
          color,
          weight: 1.5,
          fillColor: color,
          fillOpacity: 0.7,
        }).addTo(map);
        const districtLabel = DISTRICT_NAME[p.district] ?? '';
        marker.bindPopup(
          `<div style="font-size:13px;line-height:1.35">
             <strong>${escapeHtml(p.name)}</strong><br/>
             <span style="color:#666">${escapeHtml(p.city ?? '')}${districtLabel ? ` · ${districtLabel}` : ''}</span><br/>
             <a href="/churches/${p.id}" style="color:#2563eb;text-decoration:underline">Open profile →</a>
           </div>`,
        );
        bounds.extend([p.lat, p.lng]);
      }
      if (points.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [points]);

  return <div ref={containerRef} className="h-[calc(100vh-12rem)] w-full rounded-md border border-zinc-200 dark:border-zinc-800" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
