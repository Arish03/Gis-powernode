import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * SplitMapView — renders up to 4 synchronized MapLibre panels.
 *
 * Each panel receives its own `setup(map)` callback invoked on 'load' to add
 * sources and layers. Camera events (move, zoom, rotate, pitch) from any panel
 * are replayed on all siblings via jumpTo(), guarded by a `syncing` ref flag.
 *
 * Props:
 *   panels: Array<{
 *     key: string,
 *     title?: string,
 *     center: [lng, lat],
 *     zoom: number,
 *     setup: (map) => void,         // add sources/layers here
 *   }>
 */
export default function SplitMapView({ panels = [] }) {
  const refs = useRef({});
  const maps = useRef({});
  const syncing = useRef(false);

  useEffect(() => {
    // Cleanup prior maps
    Object.values(maps.current).forEach(m => m.remove && m.remove());
    maps.current = {};

    panels.forEach(p => {
      const container = refs.current[p.key];
      if (!container) return;
      const m = new maplibregl.Map({
        container,
        style: {
          version: 8,
          sources: {
            osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        center: p.center || [0, 0],
        zoom: p.zoom ?? 2,
      });
      m.addControl(new maplibregl.NavigationControl(), 'top-right');
      m.on('load', () => {
        try { p.setup && p.setup(m); } catch (e) { console.error('panel setup error', e); }
      });

      const sync = () => {
        if (syncing.current) return;
        syncing.current = true;
        const center = m.getCenter();
        const zoom = m.getZoom();
        const bearing = m.getBearing();
        const pitch = m.getPitch();
        Object.entries(maps.current).forEach(([k, other]) => {
          if (k === p.key) return;
          try { other.jumpTo({ center, zoom, bearing, pitch }); } catch {}
        });
        syncing.current = false;
      };
      m.on('move', sync);

      maps.current[p.key] = m;
    });

    return () => {
      Object.values(maps.current).forEach(m => m.remove && m.remove());
      maps.current = {};
    };
  }, [panels]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = panels.length;
  const cols = n <= 1 ? 1 : n === 2 ? 2 : 2;
  const rows = n <= 2 ? 1 : 2;

  return (
    <div
      className="grid flex-1 w-full min-h-0 gap-1 bg-slate-200"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
    >
      {panels.map(p => (
        <div key={p.key} className="relative bg-slate-100 overflow-hidden">
          {p.title && (
            <div className="absolute top-2 left-2 z-10 px-3 py-1 rounded-lg bg-white/85 backdrop-blur-md
                           text-xs font-semibold text-slate-700 shadow-sm">
              {p.title}
            </div>
          )}
          <div ref={el => (refs.current[p.key] = el)} className="w-full h-full" />
        </div>
      ))}
    </div>
  );
}
