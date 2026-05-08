import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers, Columns2, SplitSquareHorizontal, Maximize } from 'lucide-react';
import api from '../../api/client';
import TimelineSlider from '../../components/TimelineSlider';
import SplitMapView from '../../components/SplitMapView';
import SplitCompareView from '../../components/SplitCompareView';
import LayerController from '../../components/LayerController';

/**
 * GroupMapView — timeline-aware map.
 *
 * Modes:
 *   'timeline' : single panel, slider swaps the orthophoto & trees to the
 *                currently-selected member project. Full LayerController.
 *   'split'    : 2-4 synced panels, one per selected timeline.
 *   'compare'  : 2 panels with draggable divider (first vs last by default).
 *
 * Props:
 *   group        — group object with members array
 *   locateTarget — { lat, lng, timelineIdx } – when set, fly to that coordinate
 */
export default function GroupMapView({ group, locateTarget }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const mapReady = useRef(false);
  const pendingFly = useRef(null);
  const selectedIdxRef = useRef(0);
  const membersRef = useRef([]);
  // lookup: timeline_index → { tree_uuid → unified_index }
  const unifiedLookupRef = useRef({});
  const [mode, setMode] = useState('timeline');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [layers, setLayers] = useState({
    base: 'ortho',
    overlays: { boundary: true, trees: true, health: false, height: false },
  });
  const [heightRange, setHeightRange] = useState({ min: 0, max: 15 });
  const members = useMemo(
    () => (group?.members || []).slice().sort((a, b) => a.timeline_index - b.timeline_index),
    [group],
  );

  // Keep refs in sync for stable callbacks
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);
  useEffect(() => { membersRef.current = members; }, [members]);

  // ── Build unified tree lookup (tree UUID → unified_index per timeline) ──
  useEffect(() => {
    if (!group?.id || group.status !== 'READY') return;
    api.get(`/groups/${group.id}/unified-trees/list`)
      .then(r => {
        const trees = Array.isArray(r.data) ? r.data : (r.data?.trees || []);
        const lookup = {};
        trees.forEach(ut => {
          (ut.observations || []).forEach(obs => {
            if (!obs.tree_id || obs.observation_type === 'MISSING') return;
            if (!lookup[obs.timeline_index]) lookup[obs.timeline_index] = {};
            lookup[obs.timeline_index][obs.tree_id] = ut.unified_index;
          });
        });
        unifiedLookupRef.current = lookup;
      })
      .catch(() => {});
  }, [group?.id, group?.status]);

  const baseUrl = window.location.origin;

  // ── Handle locateTarget prop ─────────────────────────────────
  useEffect(() => {
    if (!locateTarget) return;
    setMode('timeline');
    const idx = members.findIndex(m => m.timeline_index === (locateTarget.timelineIdx ?? 0));
    setSelectedIdx(idx >= 0 ? idx : 0);
    pendingFly.current = { lat: locateTarget.lat, lng: locateTarget.lng };
  }, [locateTarget, members]);

  // ── Init single-panel timeline map ───────────────────────────
  useEffect(() => {
    if (mode !== 'timeline' || !mapContainer.current || members.length === 0) return;
    setLoading(true);
    mapReady.current = false;
    let isMounted = true;

    const m = members[selectedIdx] || members[0];
    const init = async () => {
      try {
        const projRes = await api.get(`/projects/${m.project_id}`);
        if (!isMounted) return;
        const proj = projRes.data;
        const boundary = proj.boundary_geojson ? JSON.parse(proj.boundary_geojson) : null;
        let center = [0, 0], zoom = 14;
        if (boundary?.features?.[0]?.geometry?.coordinates) {
          const coords = boundary.features[0].geometry.coordinates[0];
          const lngs = coords.map(c => c[0]);
          const lats = coords.map(c => c[1]);
          center = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
          zoom = 16;
        }
        map.current = new maplibregl.Map({
          container: mapContainer.current,
          style: {
            version: 8,
            sources: { osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap' } },
            layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
          },
          center, zoom, antialias: true,
        });
        map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
        map.current.on('load', () => {
          if (!isMounted) return;
          mapReady.current = true;
          setLoading(false);
        });
      } catch (e) {
        console.error(e);
        if (isMounted) setLoading(false);
      }
    };
    init();

    return () => {
      isMounted = false;
      mapReady.current = false;
      if (map.current) { map.current.remove(); map.current = null; }
    };
  }, [mode, members.length]); // eslint-disable-line

  // ── Tree click popup (stable ref — reads from refs) ──────────
  const handleTreeClick = useCallback((e) => {
    if (!map.current) return;
    const features = map.current.queryRenderedFeatures(e.point, {
      layers: ['trees-point', 'trees-health', 'trees-height'],
    });
    if (!features.length) return;
    const tree = features[0].properties;
    const member = membersRef.current[selectedIdxRef.current];
    const timelineIdx = member?.timeline_index ?? 0;
    const unifiedIdx = unifiedLookupRef.current[timelineIdx]?.[tree.id];
    const idLabel = unifiedIdx != null
      ? `Unified Tree #${unifiedIdx}`
      : `Tree #${tree.tree_index}`;
    new maplibregl.Popup({ maxWidth: '280px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="tree-popup">
          <div class="tree-popup__header">
            <span class="tree-popup__id">${idLabel}</span>
            ${member ? `<span style="font-size:10px;color:#64748b;margin-left:6px">T${member.timeline_index}</span>` : ''}
          </div>
          <div class="tree-popup__row">
            <span class="tree-popup__label">Height</span>
            <span class="tree-popup__value">${tree.height_m != null ? Number(tree.height_m).toFixed(1) + ' m' : 'N/A'}</span>
          </div>
          <div class="tree-popup__row">
            <span class="tree-popup__label">Health</span>
            <span class="tree-popup__value">${tree.health_status || 'N/A'}</span>
          </div>
          <div class="tree-popup__row">
            <span class="tree-popup__label">Coords</span>
            <span class="tree-popup__value" style="font-size:10px">
              ${tree.latitude != null ? Number(tree.latitude).toFixed(6) : '—'}, ${tree.longitude != null ? Number(tree.longitude).toFixed(6) : '—'}
            </span>
          </div>
        </div>
      `)
      .addTo(map.current);
  }, []);

  // ── Swap layers on selectedIdx change ────────────────────────
  useEffect(() => {
    if (mode !== 'timeline' || !map.current || members.length === 0) return;
    const member = members[selectedIdx];
    if (!member) return;

    const apply = async () => {
      const mp = map.current;
      if (!mp) return;

      // Remove all previous data layers/sources
      ['trees-height', 'trees-health', 'trees-point', 'boundary-line', 'dsm-layer', 'dtm-layer', 'ortho-layer']
        .forEach(id => { try { if (mp.getLayer(id)) mp.removeLayer(id); } catch {} });
      ['trees', 'boundary', 'dsm', 'dtm', 'ortho']
        .forEach(id => { try { if (mp.getSource(id)) mp.removeSource(id); } catch {} });

      // Add raster base layers
      ['ortho', 'dtm', 'dsm'].forEach(type => {
        mp.addSource(type, {
          type: 'raster',
          tiles: [`${baseUrl}/tiles/${member.project_id}/${type}/{z}/{x}/{y}.png`],
          tileSize: 256, scheme: 'xyz', minzoom: 2, maxzoom: 22,
        });
        mp.addLayer({
          id: `${type}-layer`, type: 'raster', source: type,
          layout: { visibility: layers.base === type ? 'visible' : 'none' },
        });
      });

      // Add boundary
      try {
        const projRes = await api.get(`/projects/${member.project_id}`);
        const boundary = projRes.data?.boundary_geojson ? JSON.parse(projRes.data.boundary_geojson) : null;
        if (boundary) {
          mp.addSource('boundary', { type: 'geojson', data: boundary });
          mp.addLayer({
            id: 'boundary-line', type: 'line', source: 'boundary',
            paint: { 'line-color': '#00ffff', 'line-width': 3, 'line-opacity': 0.85 },
            layout: { visibility: layers.overlays.boundary ? 'visible' : 'none' },
          });
        }
      } catch {}

      // Add trees with health/height layers
      try {
        const tr = await api.get(`/projects/${member.project_id}/trees`);
        const treesGeoJson = tr.data;
        if (treesGeoJson?.features?.length > 0) {
          const heights = treesGeoJson.features.map(f => f.properties.height_m).filter(h => h != null);
          const min = heights.length ? Math.min(...heights) : 0;
          const max = heights.length ? Math.max(...heights) : 15;
          setHeightRange({ min, max });
          mp.addSource('trees', { type: 'geojson', data: treesGeoJson });
          const delta = max - min || 1;
          // White dot layer
          mp.addLayer({
            id: 'trees-point', type: 'circle', source: 'trees',
            paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000000' },
            layout: { visibility: layers.overlays.trees && !layers.overlays.health && !layers.overlays.height ? 'visible' : 'none' },
          });
          // Health layer
          mp.addLayer({
            id: 'trees-health', type: 'circle', source: 'trees',
            paint: {
              'circle-radius': 6,
              'circle-color': ['match', ['get', 'health_status'], 'Healthy', '#22c55e', 'Moderate', '#eab308', 'Poor', '#ef4444', '#64748b'],
              'circle-stroke-width': 1.5, 'circle-stroke-color': '#000000',
            },
            layout: { visibility: layers.overlays.health ? 'visible' : 'none' },
          });
          // Height layer
          mp.addLayer({
            id: 'trees-height', type: 'circle', source: 'trees',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['get', 'height_m'], min, 8, min + delta * 0.5, 12, max, 18],
              'circle-color': ['interpolate', ['linear'], ['get', 'height_m'],
                min, '#ffff00', min + delta * 0.30, '#ff8c00', min + delta * 0.60, '#e91e63', max, '#1a237e'],
              'circle-opacity': 0.85, 'circle-stroke-width': 1, 'circle-stroke-color': '#000000',
            },
            layout: { visibility: layers.overlays.height ? 'visible' : 'none' },
          });
          // Click + cursor
          ['trees-point', 'trees-health', 'trees-height'].forEach(lid => {
            mp.on('click', lid, handleTreeClick);
          });
          mp.on('mouseenter', ['trees-point', 'trees-health', 'trees-height'],
            () => { mp.getCanvas().style.cursor = 'pointer'; });
          mp.on('mouseleave', ['trees-point', 'trees-health', 'trees-height'],
            () => { mp.getCanvas().style.cursor = ''; });
        }
      } catch {}

      // Execute pending fly-to (from "Locate on map")
      if (pendingFly.current) {
        const { lat, lng } = pendingFly.current;
        pendingFly.current = null;
        setTimeout(() => {
          if (mp) mp.flyTo({ center: [lng, lat], zoom: 20, duration: 1200 });
        }, 400);
      }
    };

    if (map.current?.isStyleLoaded()) apply();
    else map.current?.once('load', apply);
  }, [selectedIdx, mode, members]); // eslint-disable-line

  // ── Base layer switching ──────────────────────────────────
  useEffect(() => {
    if (!map.current || !mapReady.current || mode !== 'timeline') return;
    ['ortho', 'dtm', 'dsm'].forEach(type => {
      if (map.current.getLayer(`${type}-layer`)) {
        map.current.setLayoutProperty(`${type}-layer`, 'visibility', layers.base === type ? 'visible' : 'none');
      }
    });
  }, [layers.base, mode]);

  // ── Overlay switching ────────────────────────────────────
  useEffect(() => {
    if (!map.current || !mapReady.current || mode !== 'timeline') return;
    if (map.current.getLayer('boundary-line')) {
      map.current.setLayoutProperty('boundary-line', 'visibility', layers.overlays.boundary ? 'visible' : 'none');
    }
    const showBasic = layers.overlays.trees && !layers.overlays.health && !layers.overlays.height;
    ['trees-point', 'trees-health', 'trees-height'].forEach(lid => {
      if (!map.current.getLayer(lid)) return;
      const vis = lid === 'trees-point' ? showBasic :
        lid === 'trees-health' ? layers.overlays.health :
        layers.overlays.height;
      map.current.setLayoutProperty(lid, 'visibility', vis ? 'visible' : 'none');
    });
  }, [layers.overlays, mode]);

  // ── Recenter ─────────────────────────────────────────────
  const handleRecenter = async () => {
    if (!map.current || members.length === 0) return;
    try {
      const projRes = await api.get(`/projects/${members[selectedIdx].project_id}`);
      const boundary = projRes.data?.boundary_geojson ? JSON.parse(projRes.data.boundary_geojson) : null;
      if (boundary?.features?.[0]?.geometry?.coordinates) {
        const coords = boundary.features[0].geometry.coordinates[0];
        const bounds = coords.reduce(
          (acc, c) => acc.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        );
        map.current.fitBounds(bounds, { padding: 50, duration: 1000 });
      }
    } catch {}
  };

  // ── Center for split/compare ─────────────────────────────
  const firstCenter = useMemoCenter(members[0]);

  if (!group) return null;
  if (members.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-slate-500">No members in this group.</div>;
  }

  // Panel setup for split/compare (health-colored trees, no layer controller)
  const panelSetup = (projectId) => (m) => {
    m.addSource('ortho', {
      type: 'raster',
      tiles: [`${baseUrl}/tiles/${projectId}/ortho/{z}/{x}/{y}.png`],
      tileSize: 256, scheme: 'xyz',
    });
    m.addLayer({ id: 'ortho-layer', type: 'raster', source: 'ortho' });
    api.get(`/projects/${projectId}/trees`).then(tr => {
      if (!m.getSource('trees')) m.addSource('trees', { type: 'geojson', data: tr.data });
      m.addLayer({
        id: 'trees-health-panel', type: 'circle', source: 'trees',
        paint: {
          'circle-radius': 5,
          'circle-color': ['match', ['get', 'health_status'],
            'Healthy', '#22c55e', 'Moderate', '#eab308', 'Poor', '#ef4444', '#ffffff'],
          'circle-stroke-width': 1, 'circle-stroke-color': '#000',
        },
      });
    }).catch(() => {});
  };

  return (
    <div className="flex-1 flex flex-col relative">
      {/* Mode toggle */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 p-1 bg-white/85 backdrop-blur-md rounded-xl shadow-glass">
        {[
          { k: 'timeline', icon: Layers, label: 'Timeline' },
          { k: 'split', icon: Columns2, label: 'Split' },
          { k: 'compare', icon: SplitSquareHorizontal, label: 'Compare' },
        ].map(({ k, icon: Icon, label }) => (
          <button key={k} onClick={() => setMode(k)}
            className={`px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold transition
              ${mode === k ? 'bg-primary-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── Timeline mode ── */}
      {mode === 'timeline' && (
        <>
          <div ref={mapContainer} className="flex-1" />

          {/* Layer Controller sidebar */}
          {!loading && (
            <LayerController
              layers={layers}
              setLayers={setLayers}
              viIndices={[]}
              viPalettes={[]}
              selectedIndex=""
              selectedPalette="rdylgn"
              onIndexChange={() => {}}
              onPaletteChange={() => {}}
              isCollapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(s => !s)}
            />
          )}

          {/* Timeline slider */}
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[min(640px,92%)] z-20">
            <TimelineSlider
              members={members}
              value={members[selectedIdx]?.timeline_index ?? 0}
              onChange={(idx) => {
                const i = members.findIndex(m => m.timeline_index === idx);
                if (i >= 0) setSelectedIdx(i);
              }}
            />
          </div>

          {/* Recenter */}
          <button onClick={handleRecenter}
            className="absolute bottom-6 right-6 z-10 w-10 h-10 bg-white/90 backdrop-blur border border-slate-200 rounded-xl shadow-glass flex items-center justify-center text-slate-600 hover:text-primary-600 transition-colors"
            title="Recenter Map">
            <Maximize size={18} />
          </button>

          {/* Height Legend */}
          {layers.overlays.height && (
            <div className="map-legend animate-fade-in" style={{ bottom: '24px', right: '60px' }}>
              <div className="map-legend__title">Tree Height (m)</div>
              <div className="map-legend__gradient">
                <div className="map-legend__bar" />
                <div className="map-legend__labels">
                  <span>{heightRange.max.toFixed(1)}+</span>
                  <span>{(heightRange.min + (heightRange.max - heightRange.min) * 0.5).toFixed(1)}</span>
                  <span>{heightRange.min.toFixed(1)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Health Legend */}
          {layers.overlays.health && (
            <div className="map-legend vi-legend animate-fade-in"
              style={{ bottom: '24px', right: layers.overlays.height ? '200px' : '60px' }}>
              <div className="map-legend__title">Health Status</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                  <span className="w-3 h-3 rounded-full bg-green-500" /> Healthy
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                  <span className="w-3 h-3 rounded-full bg-amber-500" /> Moderate
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                  <span className="w-3 h-3 rounded-full bg-red-500" /> Poor
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 z-10">
              <div className="spinner" />
            </div>
          )}
        </>
      )}

      {/* ── Split mode ── */}
      {mode === 'split' && (
        <SplitMapView
          panels={members.slice(0, 4).map(m => ({
            key: String(m.timeline_index),
            title: `T${m.timeline_index} · ${m.project_name || ''}`,
            center: firstCenter.center,
            zoom: firstCenter.zoom,
            setup: panelSetup(m.project_id),
          }))}
        />
      )}

      {/* ── Compare mode ── */}
      {mode === 'compare' && members.length >= 2 && (
        <SplitCompareView
          left={{
            key: 'l-' + members[0].timeline_index,
            title: `T${members[0].timeline_index} — ${members[0].project_name || ''}`,
            center: firstCenter.center,
            zoom: firstCenter.zoom,
            setup: panelSetup(members[0].project_id),
          }}
          right={{
            key: 'r-' + members[members.length - 1].timeline_index,
            title: `T${members[members.length - 1].timeline_index} — ${members[members.length - 1].project_name || ''}`,
            setup: panelSetup(members[members.length - 1].project_id),
          }}
        />
      )}
    </div>
  );
}

// ── Helper: fetch center from first member's project ─────────
function useMemoCenter(firstMember) {
  const [c, setC] = useState({ center: [0, 0], zoom: 14 });
  useEffect(() => {
    if (!firstMember?.project_id) return;
    api.get(`/projects/${firstMember.project_id}`).then(r => {
      const proj = r.data;
      const boundary = proj.boundary_geojson ? JSON.parse(proj.boundary_geojson) : null;
      if (boundary?.features?.[0]?.geometry?.coordinates) {
        const coords = boundary.features[0].geometry.coordinates[0];
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        setC({
          center: [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
          zoom: 16,
        });
      }
    }).catch(() => {});
  }, [firstMember?.project_id]);
  return c;
}
