'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

type Pt = { id: string; lat: number; lng: number; name: string; district: string };

const COLORS: Record<string, string> = {
  CE: '#2563eb',
  NO: '#16a34a',
  SO: '#dc2626',
  '': '#737373',
};

export default function HomeMap({ points }: { points: Pt[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: false, scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 18,
      }).addTo(map);
      const bounds = L.latLngBounds([]);
      for (const p of points) {
        const color = COLORS[p.district] ?? COLORS[''];
        L.circleMarker([p.lat, p.lng], {
          radius: 3,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.7,
          interactive: false,
        }).addTo(map);
        bounds.extend([p.lat, p.lng]);
      }
      if (points.length > 0) map.fitBounds(bounds, { padding: [20, 20] });
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [points]);

  return <div ref={containerRef} className="h-[260px] w-full rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden" />;
}
