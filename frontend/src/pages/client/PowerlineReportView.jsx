import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Download, FileText, Loader2, X, AlertTriangle, Image as ImageIcon, MapPin } from 'lucide-react';
import api from '../../api/client';

const SEVERITY_OPTIONS = [
  { value: 'S5', label: 'Category A — Critical', color: '#b91c1c', bg: '#fee2e2' },
  { value: 'S4', label: 'Category B — Major', color: '#ea580c', bg: '#ffedd5' },
  { value: 'S3', label: 'Category C — Minor', color: '#d97706', bg: '#fef3c7' },
  { value: 'S2', label: 'Kuo — Observation', color: '#65a30d', bg: '#ecfccb' },
  { value: 'S1', label: 'N/A', color: '#16a34a', bg: '#dcfce7' },
  { value: 'POI', label: 'POI', color: '#2563eb', bg: '#dbeafe' },
];
const SEV = Object.fromEntries(SEVERITY_OPTIONS.map(o => [o.value, o]));

export default function PowerlineReportView({ projectId, projectInfo, adminPreview = false }) {
  const [images, setImages] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [thumbUrls, setThumbUrls] = useState({}); // { imageId: objectUrl }
  const [annotationsByImage, setAnnotationsByImage] = useState({}); // { imageId: [ann] }
  const [openImage, setOpenImage] = useState(null); // image obj
  const [openImageUrl, setOpenImageUrl] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const urls = [];
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [imagesRes, summaryRes] = await Promise.all([
          api.get(`/projects/${projectId}/powerline/images`),
          api.get(`/projects/${projectId}/powerline/summary`),
        ]);
        if (cancelled) return;
        const imgs = imagesRes.data.images || [];
        setImages(imgs);
        setSummary(summaryRes.data);

        // Pre-fetch thumbnails + annotations for each image (cap to keep memory bounded)
        const preview = imgs.slice(0, 60);
        const newThumbs = {};
        const newAnnMap = {};
        await Promise.all(preview.map(async (im) => {
          try {
            const [b, ar] = await Promise.all([
              api.get(`/projects/${projectId}/powerline/images/${im.id}/file`, { responseType: 'blob' }),
              api.get(`/projects/${projectId}/powerline/images/${im.id}/annotations`),
            ]);
            const url = URL.createObjectURL(b.data);
            urls.push(url);
            newThumbs[im.id] = url;
            newAnnMap[im.id] = ar.data || [];
          } catch { /* tolerate per-image errors */ }
        }));
        if (cancelled) return;
        setThumbUrls(newThumbs);
        setAnnotationsByImage(newAnnMap);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.detail || 'Failed to load inspection report.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [projectId]);

  const downloadReport = async () => {
    if (!projectId) return;
    setDownloading(true);
    try {
      const res = await api.get(`/projects/${projectId}/report/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      const name = (projectInfo?.name || 'inspection-report').replace(/[^a-z0-9_-]+/gi, '_');
      a.download = `${name}-inspection-report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to download report.');
    } finally {
      setDownloading(false);
    }
  };

  const severityRows = useMemo(() => {
    const map = Object.fromEntries(SEVERITY_OPTIONS.map(o => [o.value, 0]));
    (summary?.severity_counts || []).forEach(s => { map[s.severity] = s.count; });
    return SEVERITY_OPTIONS.map(o => ({ ...o, count: map[o.value] || 0 }));
  }, [summary]);

  const totalAnn = summary?.total_annotations ?? 0;

  const openImageFull = async (im) => {
    setOpenImage(im);
    if (thumbUrls[im.id]) {
      setOpenImageUrl(thumbUrls[im.id]);
    } else {
      try {
        const b = await api.get(`/projects/${projectId}/powerline/images/${im.id}/file`, { responseType: 'blob' });
        setOpenImageUrl(URL.createObjectURL(b.data));
      } catch { /* ignore */ }
    }
  };

  const closeModal = () => {
    setOpenImage(null);
    setOpenImageUrl(null);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary-500" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-screen-2xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex-1 min-w-0">
          <h1 className="font-heading font-extrabold text-slate-800 text-2xl truncate">
            {projectInfo?.name || 'Inspection Report'}
          </h1>
          <p className="text-sm text-slate-500 truncate">
            Power Transmission Line Inspection
            {projectInfo?.location ? ` · ${projectInfo.location}` : ''}
            {adminPreview ? ' · Admin preview' : ''}
          </p>
        </div>
        <button
          onClick={downloadReport}
          disabled={downloading || !images.length}
          className="btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {downloading ? 'Generating PDF…' : 'Download Inspection Report (PDF)'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
          <p className="text-red-700 text-xs flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Total Images" value={summary?.total_images ?? 0} />
        <KpiTile label="Total Annotations" value={totalAnn} />
        <KpiTile
          label="Critical Findings"
          value={(severityRows.find(r => r.value === 'S5')?.count || 0) + (severityRows.find(r => r.value === 'S4')?.count || 0)}
          tone="red"
        />
        <KpiTile
          label="Issue Categories"
          value={Object.keys(summary?.issue_type_counts || {}).length}
        />
      </div>

      {/* Inspector / Summary bar */}
      {(projectInfo?.primary_inspector_name || projectInfo?.report_summary) && (
        <div className="bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl shadow-glass px-5 py-4 space-y-1">
          {projectInfo?.primary_inspector_name && (
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Primary Inspector:</span>{' '}
              {projectInfo.primary_inspector_name}
            </p>
          )}
          {projectInfo?.report_summary && (
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{projectInfo.report_summary}</p>
          )}
        </div>
      )}

      {/* Map of image capture points */}
      <PowerlineLocationsMap
        images={images}
        annotationsByImage={annotationsByImage}
        onSelectImage={(im) => openImageFull(im)}
      />

      {/* Severity Overview — distribution strip + per-annotation findings table */}
      <div className="bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl shadow-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <FileText size={15} className="text-slate-400" />
          <h2 className="font-heading font-bold text-slate-800 text-sm">Severity Overview</h2>
          <span className="ml-auto text-[11px] text-slate-400">{totalAnn} finding{totalAnn !== 1 ? 's' : ''}</span>
        </div>

        {/* Compact distribution bar */}
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-3 items-center">
          {severityRows.filter(r => r.count > 0).map(r => (
            <span
              key={r.value}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
              style={{ background: r.bg, color: r.color }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
              {r.label} <span className="font-semibold opacity-80">· {r.count}</span>
            </span>
          ))}
          {totalAnn === 0 && <span className="text-slate-400 text-xs">No findings recorded.</span>}
        </div>

        {/* Per-annotation flat list */}
        {totalAnn > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold w-8">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold w-16">Sev.</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Image</th>
                  <th className="px-4 py-2.5 text-left font-semibold w-32">Component</th>
                  <th className="px-4 py-2.5 text-left font-semibold w-40">Issue Type</th>
                  <th className="px-4 py-2.5 text-left font-semibold w-56">Remedy Action</th>
                  <th className="px-4 py-2.5 text-left font-semibold w-56">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  const rows = [];
                  let n = 1;
                  images.forEach((im, iIdx) => {
                    (annotationsByImage[im.id] || []).forEach(a => {
                      rows.push(
                        <tr key={a.id} className={n % 2 === 0 ? 'bg-slate-50/60' : ''}>
                          <td className="px-4 py-2.5 text-slate-400 font-mono">{n++}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-md font-bold"
                              style={{ background: SEV[a.severity]?.bg, color: SEV[a.severity]?.color }}
                            >
                              {SEV[a.severity]?.label || a.severity}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                            <button
                              onClick={() => openImageFull(im)}
                              className="underline underline-offset-2 decoration-dotted hover:text-primary-600 text-left"
                            >
                              #{iIdx + 1} {im.filename}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 text-[11px]">{a.component_tag || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-700">{a.issue_type || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-600">{a.remedy_action || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-500">{a.comment || <span className="text-slate-300">—</span>}</td>
                        </tr>
                      );
                    });
                  });
                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Image gallery */}
      <div>
        <h2 className="font-heading font-bold text-slate-800 text-sm mb-3">Inspected Images</h2>
        {images.length === 0 ? (
          <div className="bg-white/80 border border-slate-200 rounded-2xl p-10 text-center text-slate-500 text-sm">
            No images in this inspection.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {images.map((im, idx) => (
              <button
                key={im.id}
                onClick={() => openImageFull(im)}
                className="group bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl shadow-glass overflow-hidden text-left hover:shadow-md transition"
              >
                <ImageWithBoxes
                  src={thumbUrls[im.id]}
                  width={im.width_px}
                  height={im.height_px}
                  annotations={annotationsByImage[im.id] || []}
                />
                <div className="p-3">
                  <p className="text-xs font-semibold text-slate-700 truncate">#{idx + 1} {im.filename}</p>
                  {im.image_tag && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-200">
                      {im.image_tag}
                    </span>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(annotationsByImage[im.id] || []).length === 0 ? (
                      <span className="text-[10px] text-slate-400">No findings</span>
                    ) : (
                      severitySummary(annotationsByImage[im.id] || []).map(([sev, c]) => (
                        <span
                          key={sev}
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                          style={{ background: SEV[sev]?.bg || '#f1f5f9', color: SEV[sev]?.color || '#475569' }}
                        >
                          {SEV[sev]?.label?.split(' —')[0] || sev} · {c}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {openImage && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="font-bold text-slate-800 text-sm truncate">{openImage.filename}</h3>
                <p className="text-[11px] text-slate-500 truncate">
                  {openImage.date_taken ? new Date(openImage.date_taken).toLocaleString() : '—'}
                  {openImage.altitude != null ? ` · Alt ${openImage.altitude.toFixed(1)} m` : ''}
                  {openImage.heading != null ? ` · Heading ${openImage.heading.toFixed(1)}°` : ''}
                  {openImage.latitude != null && openImage.longitude != null
                    ? ` · ${openImage.latitude.toFixed(6)}°, ${openImage.longitude.toFixed(6)}°`
                    : ''}
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-[1fr_320px]">
              <div className="bg-slate-50 flex items-center justify-center p-4 overflow-auto min-h-[300px]">
                <ImageWithBoxes
                  src={openImageUrl}
                  width={openImage.width_px}
                  height={openImage.height_px}
                  annotations={annotationsByImage[openImage.id] || []}
                  full
                />
              </div>
              <div className="border-l border-slate-200 overflow-y-auto">
                <div className="px-5 py-3 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-600">
                    {(annotationsByImage[openImage.id] || []).length} annotation{(annotationsByImage[openImage.id] || []).length === 1 ? '' : 's'}
                  </p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {(annotationsByImage[openImage.id] || []).map((a, i) => (
                    <li key={a.id} className="px-5 py-3 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                          style={{ background: SEV[a.severity]?.bg, color: SEV[a.severity]?.color }}
                        >
                          {SEV[a.severity]?.label || a.severity}
                        </span>
                        <span className="font-semibold text-slate-700">#{i + 1} {a.issue_type || 'Finding'}</span>
                      </div>
                      {a.remedy_action && (
                        <p className="text-slate-600 mb-1"><span className="font-semibold">Remedy:</span> {a.remedy_action}</p>
                      )}
                      {a.comment && (
                        <p className="text-slate-500 mb-1"><span className="font-semibold">Comment:</span> {a.comment}</p>
                      )}
                      {a.inspector_name && (
                        <p className="text-slate-400 text-[10px] mt-1">Inspector: {a.inspector_name}</p>
                      )}
                    </li>
                  ))}
                  {(annotationsByImage[openImage.id] || []).length === 0 && (
                    <li className="px-5 py-6 text-center text-slate-400 text-xs">
                      <ImageIcon size={20} className="mx-auto mb-2 text-slate-300" />
                      No findings on this image.
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function severitySummary(anns) {
  const map = {};
  anns.forEach(a => { map[a.severity] = (map[a.severity] || 0) + 1; });
  // keep deterministic order S5..S1, POI
  const order = ['S5', 'S4', 'S3', 'S2', 'S1', 'POI'];
  return order.filter(s => map[s]).map(s => [s, map[s]]);
}

function KpiTile({ label, value, tone = 'default' }) {
  const tones = {
    default: 'text-slate-800',
    red: 'text-red-600',
  };
  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl shadow-glass px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`font-heading font-extrabold text-2xl mt-0.5 ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
}

function ImageWithBoxes({ src, width, height, annotations, full = false }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const aspect = width && height ? width / height : 16 / 9;
  const containerStyle = full
    ? { width: '100%', maxHeight: '70vh', aspectRatio: aspect }
    : { width: '100%', aspectRatio: aspect };

  return (
    <div ref={containerRef} className="relative bg-slate-100" style={containerStyle}>
      {src ? (
        <img src={src} alt="" className="absolute inset-0 w-full h-full object-contain" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}
      {annotations.map((a) => {
        const color = SEV[a.severity]?.color || '#dc2626';
        return (
          <div
            key={a.id}
            className="absolute pointer-events-none"
            style={{
              left: `${a.bbox_x * 100}%`,
              top: `${a.bbox_y * 100}%`,
              width: `${a.bbox_width * 100}%`,
              height: `${a.bbox_height * 100}%`,
              border: `2px solid ${color}`,
              background: `${color}1a`,
              boxShadow: full ? `0 0 0 1px ${color}` : 'none',
            }}
          >
            <span
              className="absolute -top-0 left-0 px-1.5 py-0.5 text-[9px] font-bold text-white whitespace-nowrap"
              style={{ background: color, transform: 'translateY(-100%)' }}
            >
              {SEV[a.severity]?.label || a.severity}{a.issue_type ? ` · ${a.issue_type}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PowerlineLocationsMap({ images, annotationsByImage, onSelectImage }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  const geotagged = useMemo(
    () => images.filter(i => i.latitude != null && i.longitude != null),
    [images],
  );

  // Initialize the map exactly once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap Contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
      },
      center: [0, 0],
      zoom: 1,
      antialias: true,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Render markers when geotagged set or annotations change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const place = () => {
      // Clear previous markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      if (!geotagged.length) return;

      geotagged.forEach((im, idx) => {
        const anns = annotationsByImage[im.id] || [];
        // Highest severity present (S5 > S4 > … > POI)
        const order = ['S5', 'S4', 'S3', 'S2', 'S1', 'POI'];
        let topSev = null;
        for (const s of order) {
          if (anns.some(a => a.severity === s)) { topSev = s; break; }
        }
        const color = SEV[topSev]?.color || '#475569';
        const heading = im.heading;
        const hasHeading = heading != null && Number.isFinite(heading);

        // Build a single SVG marker so its geometric centre always matches
        // the lng/lat anchor across zoom levels. Box is 36x36, centre = (18,18).
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '36');
        svg.setAttribute('height', '36');
        svg.setAttribute('viewBox', '0 0 36 36');
        svg.style.cssText = 'display:block; cursor:pointer; overflow:visible;';

        // Heading wedge (rotates around the centre 18,18)
        if (hasHeading) {
          const wedge = document.createElementNS(svgNS, 'polygon');
          // Triangle pointing "up" (north = 0°) with its base anchored at centre.
          // Tip at (18,2), base from (12,18) to (24,18).
          wedge.setAttribute('points', '18,2 12,18 24,18');
          wedge.setAttribute('fill', color);
          wedge.setAttribute('fill-opacity', '0.9');
          wedge.setAttribute('stroke', '#ffffff');
          wedge.setAttribute('stroke-width', '1');
          wedge.setAttribute('transform', `rotate(${heading} 18 18)`);
          svg.appendChild(wedge);
        }

        // Pin disk centred at (18,18)
        const disk = document.createElementNS(svgNS, 'circle');
        disk.setAttribute('cx', '18');
        disk.setAttribute('cy', '18');
        disk.setAttribute('r', '9');
        disk.setAttribute('fill', color);
        disk.setAttribute('stroke', '#ffffff');
        disk.setAttribute('stroke-width', '2');
        disk.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))';
        svg.appendChild(disk);

        // Number label centred at (18,18)
        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', '18');
        text.setAttribute('y', '18');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('fill', '#ffffff');
        text.setAttribute('font-size', '10');
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', 'ui-sans-serif, system-ui, sans-serif');
        text.style.pointerEvents = 'none';
        text.textContent = String(idx + 1);
        svg.appendChild(text);

        svg.setAttribute('aria-label', `${im.filename} · ${anns.length} annotation${anns.length === 1 ? '' : 's'}`);

        const popupHtml = `
          <div style="font-family: ui-sans-serif, system-ui, sans-serif; font-size:12px; max-width:220px;">
            <div style="font-weight:700; color:#0f172a; margin-bottom:4px;">#${idx + 1} ${escapeHtml(im.filename)}</div>
            <div style="color:#475569; line-height:1.5;">
              ${im.date_taken ? `<div>${escapeHtml(new Date(im.date_taken).toLocaleString())}</div>` : ''}
              <div>${im.latitude.toFixed(6)}°, ${im.longitude.toFixed(6)}°</div>
              ${im.altitude != null ? `<div>Altitude: ${im.altitude.toFixed(1)} m</div>` : ''}
              ${im.heading != null ? `<div>Heading: ${im.heading.toFixed(1)}°</div>` : ''}
              <div style="margin-top:4px;">
                <span style="background:${color}22; color:${color}; padding:1px 6px; border-radius:4px; font-weight:700; font-size:10px;">
                  ${anns.length} annotation${anns.length === 1 ? '' : 's'}${topSev ? ` · top ${topSev}` : ''}
                </span>
              </div>
            </div>
          </div>
        `;

        const marker = new maplibregl.Marker({
          element: svg,
          anchor: 'center',
          rotationAlignment: 'map',
          pitchAlignment: 'map',
        })
          .setLngLat([im.longitude, im.latitude])
          .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(popupHtml))
          .addTo(map);

        svg.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectImage?.(im);
        });

        markersRef.current.push(marker);
      });

      // Fit bounds
      if (geotagged.length === 1) {
        map.flyTo({ center: [geotagged[0].longitude, geotagged[0].latitude], zoom: 17, duration: 600 });
      } else {
        const bounds = new maplibregl.LngLatBounds(
          [geotagged[0].longitude, geotagged[0].latitude],
          [geotagged[0].longitude, geotagged[0].latitude],
        );
        geotagged.forEach(i => bounds.extend([i.longitude, i.latitude]));
        map.fitBounds(bounds, { padding: 60, duration: 600, maxZoom: 18 });
      }
    };

    if (map.loaded()) {
      place();
    } else {
      map.once('load', place);
    }
  }, [geotagged, annotationsByImage, onSelectImage]);

  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl shadow-glass overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <MapPin size={15} className="text-slate-400" />
        <h2 className="font-heading font-bold text-slate-800 text-sm">Capture Locations</h2>
        <span className="ml-auto text-[11px] text-slate-500">
          {geotagged.length} of {images.length} images geotagged
        </span>
      </div>
      {geotagged.length === 0 ? (
        <div className="p-10 text-center text-slate-500 text-sm">
          No GPS coordinates were extracted from these images.
        </div>
      ) : (
        <div className="relative">
          <div ref={containerRef} style={{ height: 360 }} />
          <div className="absolute left-3 bottom-3 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-md px-2.5 py-1.5 text-[10px] text-slate-600 shadow-sm pointer-events-none">
            <div className="flex items-center gap-1.5">
              <span className="inline-block" style={{
                width: 0, height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderBottom: '12px solid #475569',
              }} />
              <span>Arrow indicates capture heading</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
