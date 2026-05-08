import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * SplitCompareView — two stacked synchronized MapLibre panels with a draggable
 * vertical divider that clips the TOP (left) map so the user can "reveal" the
 * bottom map through the clip.
 *
 * Props:
 *   left:  { key, title?, center, zoom, setup(map) }
 *   right: { key, title?, setup(map) }
 */
export default function SplitCompareView({ left, right, className = '' }) {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const leftMap = useRef(null);
  const rightMap = useRef(null);
  const syncing = useRef(false);
  const [sliderX, setSliderX] = useState(50); // % from left
  const dragging = useRef(false);

  useEffect(() => {
    if (!leftRef.current || !rightRef.current) return;

    const makeMap = (container, center, zoom) => new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: center || [0, 0],
      zoom: zoom ?? 2,
    });

    leftMap.current = makeMap(leftRef.current, left?.center, left?.zoom);
    rightMap.current = makeMap(rightRef.current, left?.center, left?.zoom);
    leftMap.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    leftMap.current.on('load', () => { try { left?.setup?.(leftMap.current); } catch (e) { console.error(e); } });
    rightMap.current.on('load', () => { try { right?.setup?.(rightMap.current); } catch (e) { console.error(e); } });

    const sync = (src, dst) => () => {
      if (syncing.current) return;
      syncing.current = true;
      try { dst.jumpTo({ center: src.getCenter(), zoom: src.getZoom(), bearing: src.getBearing(), pitch: src.getPitch() }); } catch {}
      syncing.current = false;
    };
    leftMap.current.on('move', sync(leftMap.current, rightMap.current));
    rightMap.current.on('move', sync(rightMap.current, leftMap.current));

    return () => {
      leftMap.current?.remove();
      rightMap.current?.remove();
    };
  }, [left?.key, right?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = () => { dragging.current = true; };
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const parent = leftRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      setSliderX(x);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div className={`relative flex-1 w-full min-h-0 bg-slate-200 overflow-hidden ${className}`}>
      {/* Right (bottom) map fills */}
      <div ref={rightRef} className="absolute inset-0" />
      {/* Left (top) map clipped by slider */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - sliderX}% 0 0)` }}
      >
        <div ref={leftRef} className="w-full h-full" />
      </div>
      {/* Labels */}
      {left?.title && (
        <div className="absolute top-3 left-3 z-20 px-3 py-1 rounded-lg bg-white/85 backdrop-blur-md text-xs font-semibold text-slate-700 shadow-sm">
          {left.title}
        </div>
      )}
      {right?.title && (
        <div className="absolute top-3 right-3 z-20 px-3 py-1 rounded-lg bg-white/85 backdrop-blur-md text-xs font-semibold text-slate-700 shadow-sm">
          {right.title}
        </div>
      )}
      {/* Divider handle */}
      <div
        className="absolute top-0 bottom-0 z-30 cursor-ew-resize group"
        style={{ left: `calc(${sliderX}% - 8px)`, width: 16 }}
        onMouseDown={handleMouseDown}
      >
        <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
          <span className="text-slate-500 text-xs">◀▶</span>
        </div>
      </div>
    </div>
  );
}
