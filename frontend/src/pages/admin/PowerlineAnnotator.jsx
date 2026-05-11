import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, UploadCloud, Trash2, Send, Save, Loader2, CheckCircle2, ShieldAlert, Plus, X, Image as ImageIcon } from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import GlassCard from '../../components/ui/GlassCard';
import ConfirmModal from '../../components/ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
const SEVERITY_OPTIONS = [{
  value: 'S5',
  label: 'Category A — Critical',
  color: '#b91c1c'
}, {
  value: 'S4',
  label: 'Category B — Major',
  color: '#ea580c'
}, {
  value: 'S3',
  label: 'Category C — Minor',
  color: '#d97706'
}, {
  value: 'S2',
  label: 'Kuo — Observation',
  color: '#65a30d'
}, {
  value: 'S1',
  label: 'N/A',
  color: '#16a34a'
}, {
  value: 'POI',
  label: 'POI',
  color: '#2563eb'
}];
const SEV_COLOR = Object.fromEntries(SEVERITY_OPTIONS.map(o => [o.value, o.color]));
const SEV_LABEL = Object.fromEntries(SEVERITY_OPTIONS.map(o => [o.value, o.label.split(' —')[0]]));
const ISSUE_TYPE_SUGGESTIONS = ['Conductor Damage', 'Corrosion', 'Insulator Damage', 'Vegetation Encroachment', 'Safety & Security', 'Tower Defect', 'Hardware Failure', 'Miscellaneous'];
const IMAGE_TAG_OPTIONS = ['Structure', 'Circuit Top', 'Circuit Middle', 'Circuit Bottom', 'Circuit Ground'];
const COMPONENT_TAG_DEFAULTS = ['Insulators', 'Clamps', 'Power Line', 'Fasteners'];
const HANDLE_SIZE = 8;
export default function PowerlineAnnotator() {
  const {
    projectId
  } = useParams();
  const navigate = useNavigate();
  const {
    user
  } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [project, setProject] = useState(null);
  const [images, setImages] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [annotations, setAnnotations] = useState([]); // for current image
  const [selectedAnnId, setSelectedAnnId] = useState(null);
  const [imageObjectUrl, setImageObjectUrl] = useState(null);
  const [imageNatural, setImageNatural] = useState({
    w: 0,
    h: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState(''); // '', 'saving', 'saved'
  const [confirm, setConfirm] = useState(null);
  const fileInputRef = useRef(null);

  // Component tag custom options (localStorage)
  const [componentTags, setComponentTags] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pl:componentTags') || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });
  const [customTagInput, setCustomTagInput] = useState('');
  const [showCustomTagInput, setShowCustomTagInput] = useState(false);
  const allComponentTags = [...new Set([...COMPONENT_TAG_DEFAULTS, ...componentTags])];
  const addCustomComponentTag = () => {
    const v = customTagInput.trim();
    if (!v) return;
    const updated = [...new Set([...componentTags, v])];
    setComponentTags(updated);
    localStorage.setItem('pl:componentTags', JSON.stringify(updated));
    setCustomTagInput('');
    setShowCustomTagInput(false);
    // Apply to selected annotation
    if (selectedAnn) updateSelectedField('component_tag', v);
  };

  // Canvas state
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const imgElRef = useRef(new Image());
  const [scale, setScale] = useState(1); // pixels per natural pixel
  const [drag, setDrag] = useState(null); // { mode: 'create'|'move'|'resize', start, original, handle }
  const [pendingNew, setPendingNew] = useState(null);
  const [inspectorName, setInspectorName] = useState(() => localStorage.getItem('powerline_inspector_name') || '');

  // ── Load project + images ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [p, i] = await Promise.all([api.get(`/projects/${projectId}`), api.get(`/projects/${projectId}/powerline/images`)]);
        if (cancelled) return;
        setProject(p.data);
        if (p.data.project_type !== 'POWERLINE') {
          setError('This project is not a Power Transmission Line project.');
          return;
        }
        setImages(i.data.images || []);
        if (i.data.images?.length && !selectedImageId) {
          setSelectedImageId(i.data.images[0].id);
        }
      } catch (e) {
        setError(e.response?.data?.detail || 'Failed to load project.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load image bytes + annotations when selection changes ────
  useEffect(() => {
    if (!selectedImageId) {
      setImageObjectUrl(null);
      setAnnotations([]);
      return;
    }
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const [imgRes, annRes] = await Promise.all([api.get(`/projects/${projectId}/powerline/images/${selectedImageId}/file`, {
          responseType: 'blob'
        }), api.get(`/projects/${projectId}/powerline/images/${selectedImageId}/annotations`)]);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(imgRes.data);
        setImageObjectUrl(createdUrl);
        setAnnotations(annRes.data || []);
        setSelectedAnnId(null);
        setPendingNew(null);
      } catch (e) {
        setError(e.response?.data?.detail || 'Failed to load image.');
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [selectedImageId, projectId]);

  // Load image element when objectUrl changes
  useEffect(() => {
    if (!imageObjectUrl) return;
    const img = new Image();
    img.onload = () => {
      imgElRef.current = img;
      setImageNatural({
        w: img.naturalWidth,
        h: img.naturalHeight
      });
    };
    img.src = imageObjectUrl;
  }, [imageObjectUrl]);

  // Compute scale from wrapper width
  useEffect(() => {
    if (!imageNatural.w) return;
    const measure = () => {
      const w = wrapperRef.current?.clientWidth || 800;
      const h = wrapperRef.current?.clientHeight || 600;
      const s = Math.min(w / imageNatural.w, h / imageNatural.h);
      setScale(s > 0 ? s : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [imageNatural]);

  // ── Canvas rendering ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageNatural.w) return;
    const dispW = imageNatural.w * scale;
    const dispH = imageNatural.h * scale;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dispW, dispH);
    if (imgElRef.current) ctx.drawImage(imgElRef.current, 0, 0, dispW, dispH);

    // Draw annotations
    const drawBox = (a, isSelected) => {
      const x = a.bbox_x * dispW;
      const y = a.bbox_y * dispH;
      const w = a.bbox_width * dispW;
      const h = a.bbox_height * dispH;
      const sev = a.severity || 'S3';
      const color = SEV_COLOR[sev] || '#dc2626';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '22';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      // Severity label
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      const label = `${SEV_LABEL[sev] || sev}${a.issue_type ? ' · ' + a.issue_type : ''}`;
      const padding = 4;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(x, Math.max(0, y - 16), tw + padding * 2, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + padding, Math.max(11, y - 4));
      if (isSelected) {
        // Draw resize handles
        const handles = getHandles(x, y, w, h);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = color;
        for (const hPt of handles) {
          ctx.beginPath();
          ctx.rect(hPt.cx - HANDLE_SIZE / 2, hPt.cy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          ctx.fill();
          ctx.stroke();
        }
      }
    };
    annotations.forEach(a => drawBox(a, a.id === selectedAnnId));
    if (pendingNew) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0ea5e9';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(pendingNew.bbox_x * dispW, pendingNew.bbox_y * dispH, pendingNew.bbox_width * dispW, pendingNew.bbox_height * dispH);
      ctx.setLineDash([]);
    }
  }, [annotations, selectedAnnId, scale, imageNatural, pendingNew, imageObjectUrl]);

  // ── Mouse handlers ───────────────────────────────────────────
  const getMouseNorm = e => {
    const rect = canvasRef.current.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    return {
      nx: Math.max(0, Math.min(1, xPx / rect.width)),
      ny: Math.max(0, Math.min(1, yPx / rect.height)),
      xPx,
      yPx
    };
  };
  const findHitAnnotation = (nx, ny) => {
    // top-most last (drawn last), so iterate reverse
    for (let i = annotations.length - 1; i >= 0; i--) {
      const a = annotations[i];
      if (nx >= a.bbox_x && nx <= a.bbox_x + a.bbox_width && ny >= a.bbox_y && ny <= a.bbox_y + a.bbox_height) return a;
    }
    return null;
  };
  const findHandleHit = (a, xPx, yPx) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = a.bbox_x * rect.width;
    const y = a.bbox_y * rect.height;
    const w = a.bbox_width * rect.width;
    const h = a.bbox_height * rect.height;
    const handles = getHandles(x, y, w, h);
    for (const hPt of handles) {
      if (Math.abs(hPt.cx - xPx) <= HANDLE_SIZE && Math.abs(hPt.cy - yPx) <= HANDLE_SIZE) {
        return hPt.name;
      }
    }
    return null;
  };
  const onMouseDown = e => {
    if (e.button !== 0) return;
    const {
      nx,
      ny,
      xPx,
      yPx
    } = getMouseNorm(e);
    if (selectedAnnId) {
      const sel = annotations.find(a => a.id === selectedAnnId);
      if (sel) {
        const handle = findHandleHit(sel, xPx, yPx);
        if (handle) {
          setDrag({
            mode: 'resize',
            handle,
            original: {
              ...sel
            },
            start: {
              nx,
              ny
            }
          });
          return;
        }
      }
    }
    const hit = findHitAnnotation(nx, ny);
    if (hit) {
      setSelectedAnnId(hit.id);
      setDrag({
        mode: 'move',
        original: {
          ...hit
        },
        start: {
          nx,
          ny
        }
      });
      setPendingNew(null);
      return;
    }
    // Start creating a new bbox
    setSelectedAnnId(null);
    setPendingNew({
      bbox_x: nx,
      bbox_y: ny,
      bbox_width: 0,
      bbox_height: 0
    });
    setDrag({
      mode: 'create',
      start: {
        nx,
        ny
      }
    });
  };
  const onMouseMove = e => {
    if (!drag) return;
    const {
      nx,
      ny
    } = getMouseNorm(e);
    if (drag.mode === 'create') {
      const x0 = drag.start.nx;
      const y0 = drag.start.ny;
      const x = Math.min(x0, nx);
      const y = Math.min(y0, ny);
      const w = Math.abs(nx - x0);
      const h = Math.abs(ny - y0);
      setPendingNew({
        bbox_x: x,
        bbox_y: y,
        bbox_width: w,
        bbox_height: h
      });
    } else if (drag.mode === 'move') {
      const dx = nx - drag.start.nx;
      const dy = ny - drag.start.ny;
      const o = drag.original;
      const newX = Math.max(0, Math.min(1 - o.bbox_width, o.bbox_x + dx));
      const newY = Math.max(0, Math.min(1 - o.bbox_height, o.bbox_y + dy));
      setAnnotations(arr => arr.map(a => a.id === o.id ? {
        ...a,
        bbox_x: newX,
        bbox_y: newY
      } : a));
    } else if (drag.mode === 'resize') {
      const o = drag.original;
      let x = o.bbox_x,
        y = o.bbox_y,
        w = o.bbox_width,
        h = o.bbox_height;
      const right = o.bbox_x + o.bbox_width;
      const bottom = o.bbox_y + o.bbox_height;
      if (drag.handle.includes('w')) {
        x = Math.min(nx, right - 0.005);
        w = right - x;
      }
      if (drag.handle.includes('e')) {
        w = Math.max(0.005, nx - x);
      }
      if (drag.handle.includes('n')) {
        y = Math.min(ny, bottom - 0.005);
        h = bottom - y;
      }
      if (drag.handle.includes('s')) {
        h = Math.max(0.005, ny - y);
      }
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      w = Math.min(w, 1 - x);
      h = Math.min(h, 1 - y);
      setAnnotations(arr => arr.map(a => a.id === o.id ? {
        ...a,
        bbox_x: x,
        bbox_y: y,
        bbox_width: w,
        bbox_height: h
      } : a));
    }
  };
  const onMouseUp = async () => {
    if (!drag) return;
    const mode = drag.mode;
    setDrag(null);
    if (mode === 'create' && pendingNew) {
      if (pendingNew.bbox_width < 0.005 || pendingNew.bbox_height < 0.005) {
        setPendingNew(null);
        return;
      }
      // Persist new annotation
      setSaveStatus('saving');
      try {
        const res = await api.post(`/projects/${projectId}/powerline/images/${selectedImageId}/annotations`, {
          ...pendingNew,
          severity: 'S3',
          inspector_name: inspectorName || null
        });
        setAnnotations(arr => [...arr, res.data]);
        setSelectedAnnId(res.data.id);
        setPendingNew(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(''), 1200);
        // Refresh image list count
        refreshImageCounts();
      } catch (e) {
        setError(e.response?.data?.detail || 'Failed to save annotation.');
        setPendingNew(null);
        setSaveStatus('');
      }
    } else if (mode === 'move' || mode === 'resize') {
      // Persist updated bbox
      const a = annotations.find(x => x.id === drag.original.id);
      if (!a) return;
      setSaveStatus('saving');
      try {
        await api.put(`/projects/${projectId}/powerline/annotations/${a.id}`, {
          bbox_x: a.bbox_x,
          bbox_y: a.bbox_y,
          bbox_width: a.bbox_width,
          bbox_height: a.bbox_height
        });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(''), 1200);
      } catch (e) {
        setError(e.response?.data?.detail || 'Failed to update annotation.');
        setSaveStatus('');
      }
    }
  };
  const refreshImageCounts = useCallback(async () => {
    try {
      const r = await api.get(`/projects/${projectId}/powerline/images`);
      setImages(r.data.images || []);
    } catch {/* tolerate */}
  }, [projectId]);

  // ── Image tag ──────────────────────────────────────────────
  const selectedImage = images.find(i => i.id === selectedImageId) || null;
  const updateImageTag = useCallback(async tag => {
    if (!selectedImageId) return;
    try {
      const res = await api.patch(`/projects/${projectId}/powerline/images/${selectedImageId}`, {
        image_tag: tag || null
      });
      setImages(arr => arr.map(i => i.id === selectedImageId ? {
        ...i,
        image_tag: res.data.image_tag
      } : i));
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to save image tag.');
    }
  }, [selectedImageId, projectId]);

  // ── Selected annotation form u2500─────────────────────────────────
  const selectedAnn = annotations.find(a => a.id === selectedAnnId) || null;
  const updateSelectedField = async (field, value) => {
    if (!selectedAnn) return;
    setAnnotations(arr => arr.map(a => a.id === selectedAnn.id ? {
      ...a,
      [field]: value
    } : a));
    setSaveStatus('saving');
    try {
      await api.put(`/projects/${projectId}/powerline/annotations/${selectedAnn.id}`, {
        [field]: value
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 1000);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to update annotation.');
      setSaveStatus('');
    }
  };
  const deleteSelected = async () => {
    if (!selectedAnn) return;
    setConfirm({
      show: true,
      title: 'Delete annotation?',
      message: 'This bounding box and its metadata will be removed.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.delete(`/projects/${projectId}/powerline/annotations/${selectedAnn.id}`);
          setAnnotations(arr => arr.filter(a => a.id !== selectedAnn.id));
          setSelectedAnnId(null);
          refreshImageCounts();
        } catch (e) {
          setError(e.response?.data?.detail || 'Failed to delete annotation.');
        }
      },
      onCancel: () => setConfirm(null)
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = e => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') setSelectedAnnId(null);
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnId) deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedAnnId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload ───────────────────────────────────────────────────
  const handleUploadFiles = async fileList => {
    if (!fileList || !fileList.length) return;
    const fd = new FormData();
    Array.from(fileList).forEach(f => fd.append('files', f));
    setSaveStatus('saving');
    try {
      await api.post(`/projects/${projectId}/powerline/upload`, fd, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      const r = await api.get(`/projects/${projectId}/powerline/images`);
      setImages(r.data.images || []);
      if (!selectedImageId && r.data.images?.length) {
        setSelectedImageId(r.data.images[0].id);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 1200);
    } catch (e) {
      setError(e.response?.data?.detail || 'Upload failed.');
      setSaveStatus('');
    }
  };

  // ── Publish ──────────────────────────────────────────────────
  const totalAnnotations = useMemo(() => images.reduce((s, i) => s + (i.annotation_count || 0), 0) + 0, [images]);
  const publishProject = () => {
    setConfirm({
      show: true,
      title: 'Publish inspection report?',
      message: 'The assigned client will be able to view the gallery and download the PDF report.',
      confirmLabel: 'Publish',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        setConfirm(null);
        try {
          const r = await api.post(`/projects/${projectId}/publish`);
          setProject(r.data);
        } catch (e) {
          setError(e.response?.data?.detail || 'Failed to publish.');
        }
      },
      onCancel: () => setConfirm(null)
    });
  };
  const removeImage = img => {
    setConfirm({
      show: true,
      title: `Delete "${img.filename}"?`,
      message: 'The image and all its annotations will be permanently removed.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.delete(`/projects/${projectId}/powerline/images/${img.id}`);
          const r = await api.get(`/projects/${projectId}/powerline/images`);
          setImages(r.data.images || []);
          if (selectedImageId === img.id) {
            setSelectedImageId(r.data.images?.[0]?.id || null);
          }
        } catch (e) {
          setError(e.response?.data?.detail || 'Failed to delete image.');
        }
      },
      onCancel: () => setConfirm(null)
    });
  };
  if (loading) {
    return <SidebarLayout title="Powerline Annotator">
        <div className="spinner" />
      </SidebarLayout>;
  }
  const status = project?.status || '';
  return <SidebarLayout title="Powerline Annotator">
      

      {/* Header bar */}
      <div className="relative z-10 max-w-screen-2xl mx-auto w-full px-4 sm:px-6 mt-4 mb-3 flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(project?.client_id ? `/admin/clients/${project.client_id}/projects` : '/admin')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-white">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-heading font-extrabold text-slate-800 text-xl truncate">
            {project?.name || 'Powerline Annotation'}
          </h1>
          <p className="text-xs text-slate-500 truncate">
            {project?.location || 'Power Transmission Line Inspection'} · {images.length} images · {annotations.length} annotations on this image
          </p>
        </div>
        <span className={['px-2.5 py-1 rounded-full text-[11px] font-semibold', status === 'READY' ? 'bg-emerald-100 text-emerald-700' : status === 'REVIEW_PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'].join(' ')}>
          {status === 'READY' ? 'Published' : status === 'REVIEW_PENDING' ? 'Pending Review' : status || 'Draft'}
        </span>
        {saveStatus === 'saving' && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 size={12} className="animate-spin" /> Saving…
          </span>}
        {saveStatus === 'saved' && <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 size={12} /> Saved
          </span>}
        {isAdmin && <button onClick={() => navigate(`/admin/projects/${projectId}/powerline/summary`)} disabled={!images.length || !images.some(i => (i.annotation_count || 0) > 0)} className="btn-primary gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed">
            <Send size={13} /> Continue to Summary →
          </button>}
      </div>

      {error && <div className="relative z-10 max-w-screen-2xl mx-auto w-full px-4 sm:px-6 mb-3">
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={16} />
            <p className="text-red-700 text-xs flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
              <X size={14} />
            </button>
          </div>
        </div>}

      <main className="relative z-10 max-w-screen-2xl mx-auto w-full px-4 sm:px-6 pb-8 flex-1 grid grid-cols-12 gap-4 min-h-0">
        {/* Left: image list */}
        <aside className="col-span-12 md:col-span-3 lg:col-span-2 flex flex-col min-h-0">
          <GlassCard className="p-3 flex-1 flex flex-col min-h-[300px] max-h-[calc(100vh-180px)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600">Images ({images.length})</span>
              <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700">
                <Plus size={12} /> Add
              </button>
              <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.tif,.tiff" className="hidden" onChange={e => {
              handleUploadFiles(e.target.files);
              e.target.value = '';
            }} />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {images.length === 0 ? <button onClick={() => fileInputRef.current?.click()} className="w-full p-6 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-primary-400 hover:text-primary-600 transition flex flex-col items-center gap-2">
                  <UploadCloud size={20} />
                  <span className="text-xs font-semibold">Upload images</span>
                </button> : images.map((im, idx) => {
              const active = im.id === selectedImageId;
              return <div key={im.id} className={['group flex items-center gap-2 p-2 rounded-xl cursor-pointer text-xs transition', active ? 'bg-primary-50 border border-primary-300 shadow-sm' : 'bg-white/80 hover:bg-slate-50 border border-transparent'].join(' ')} onClick={() => setSelectedImageId(im.id)}>
                      <div className="w-9 h-9 rounded-md bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                        <ImageIcon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-slate-700">#{idx + 1} {im.filename}</p>
                        <p className="text-[10px] text-slate-400">
                          {im.annotation_count || 0} ann.
                          {im.image_tag ? <span className="ml-1 px-1 py-0.5 bg-sky-100 text-sky-700 rounded text-[9px]">{im.image_tag}</span> : null}
                        </p>
                      </div>
                      <button onClick={e => {
                  e.stopPropagation();
                  removeImage(im);
                }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                        <Trash2 size={12} />
                      </button>
                    </div>;
            })}
            </div>
          </GlassCard>
        </aside>

        {/* Center: canvas */}
        <section className="col-span-12 md:col-span-6 lg:col-span-7 flex flex-col min-h-0">
          {/* Image tag selector bar */}
          {selectedImageId && <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-500">Image Tag:</span>
              {IMAGE_TAG_OPTIONS.map(tag => <button key={tag} onClick={() => updateImageTag(selectedImage?.image_tag === tag ? null : tag)} className={['px-2 py-0.5 rounded-full text-[11px] font-medium border transition', selectedImage?.image_tag === tag ? 'bg-sky-600 text-white border-sky-600' : 'bg-white/80 text-slate-600 border-slate-300 hover:border-sky-400 hover:text-sky-700'].join(' ')}>
                  {tag}
                </button>)}
              {/* custom tag inline */}
              {selectedImage?.image_tag && !IMAGE_TAG_OPTIONS.includes(selectedImage.image_tag) && <button onClick={() => updateImageTag(null)} className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-sky-600 text-white border-sky-600">
                  {selectedImage.image_tag} ×
                </button>}
            </div>}
          <GlassCard className="p-2 flex-1 flex items-center justify-center min-h-[400px] max-h-[calc(100vh-180px)] overflow-hidden">
            {selectedImageId && imageObjectUrl ? <div ref={wrapperRef} className="w-full h-full flex items-center justify-center overflow-hidden">
                <canvas ref={canvasRef} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} className="cursor-crosshair shadow-md rounded-md select-none" />
              </div> : <div className="text-center text-slate-400 py-12">
                <ImageIcon size={32} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm">Select or upload an image to begin annotating.</p>
              </div>}
          </GlassCard>
          <p className="text-[11px] text-slate-400 text-center mt-2">
            Click & drag on empty space to draw a bounding box · Click a box to select · Drag handles to resize · <kbd className="px-1 py-0.5 bg-slate-200 rounded">Del</kbd> removes
          </p>
        </section>

        {/* Right: properties panel */}
        <aside className="col-span-12 md:col-span-3 flex flex-col min-h-0">
          <GlassCard className="p-4 flex-1 max-h-[calc(100vh-180px)] overflow-y-auto">
            <h3 className="text-sm font-heading font-bold text-slate-800 mb-3">
              {selectedAnn ? 'Annotation Details' : 'Properties'}
            </h3>
            {selectedAnn ? <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Component Tag</label>
                  <div className="flex gap-1 flex-wrap mb-1">
                    {allComponentTags.map(tag => <button key={tag} onClick={() => updateSelectedField('component_tag', selectedAnn.component_tag === tag ? null : tag)} className={['px-2 py-0.5 rounded-full text-[10px] font-medium border transition', selectedAnn.component_tag === tag ? 'bg-violet-600 text-white border-violet-600' : 'bg-white/80 text-slate-600 border-slate-300 hover:border-violet-400'].join(' ')}>
                        {tag}
                      </button>)}
                  </div>
                  {showCustomTagInput ? <div className="flex gap-1">
                      <input className="glass-input text-xs flex-1" value={customTagInput} onChange={e => setCustomTagInput(e.target.value)} onKeyDown={e => {
                  if (e.key === 'Enter') addCustomComponentTag();
                  if (e.key === 'Escape') {
                    setShowCustomTagInput(false);
                    setCustomTagInput('');
                  }
                }} placeholder="Custom tag…" autoFocus />
                      <button onClick={addCustomComponentTag} className="px-2 py-1 rounded-lg bg-violet-600 text-white text-[10px] font-semibold">Add</button>
                    </div> : <button onClick={() => setShowCustomTagInput(true)} className="inline-flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-800 font-semibold mt-0.5">
                      <Plus size={10} /> Custom tag
                    </button>}
                </div>
                <div>
                  <label className="block font-semibold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Severity</label>
                  <select className="glass-input text-xs" value={selectedAnn.severity} onChange={e => updateSelectedField('severity', e.target.value)}>
                    {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Issue Type</label>
                  <input className="glass-input text-xs" list="issue-type-suggestions" value={selectedAnn.issue_type || ''} onChange={e => updateSelectedField('issue_type', e.target.value)} placeholder="e.g. Conductor Damage" />
                  <datalist id="issue-type-suggestions">
                    {ISSUE_TYPE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block font-semibold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Remedy Action</label>
                  <textarea className="glass-input text-xs min-h-[60px]" value={selectedAnn.remedy_action || ''} onChange={e => updateSelectedField('remedy_action', e.target.value)} placeholder="Recommended corrective action…" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Comment</label>
                  <textarea className="glass-input text-xs min-h-[60px]" value={selectedAnn.comment || ''} onChange={e => updateSelectedField('comment', e.target.value)} placeholder="Inspector notes…" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Inspector Name</label>
                  <input className="glass-input text-xs" value={selectedAnn.inspector_name || ''} onChange={e => {
                localStorage.setItem('powerline_inspector_name', e.target.value);
                setInspectorName(e.target.value);
                updateSelectedField('inspector_name', e.target.value);
              }} placeholder="Your name" />
                </div>
                <div className="pt-3 border-t border-slate-100 flex gap-2">
                  <button onClick={deleteSelected} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100">
                    <Trash2 size={12} /> Delete
                  </button>
                  <button onClick={() => setSelectedAnnId(null)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200">
                    Deselect
                  </button>
                </div>
              </div> : <div className="space-y-3 text-xs text-slate-500">
                <p>Click and drag on the image to draw a new bounding box, or click an existing box to view and edit its details.</p>
                <div>
                  <label className="block font-semibold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Default Inspector Name</label>
                  <input className="glass-input text-xs" value={inspectorName} onChange={e => {
                setInspectorName(e.target.value);
                localStorage.setItem('powerline_inspector_name', e.target.value);
              }} placeholder="Used for new annotations" />
                </div>
                {annotations.length > 0 && <div className="pt-3 border-t border-slate-100">
                    <p className="font-semibold text-slate-600 text-[11px] mb-2">Annotations on this image:</p>
                    <ul className="space-y-1">
                      {annotations.map((a, i) => <li key={a.id}>
                          <button onClick={() => setSelectedAnnId(a.id)} className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 flex items-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{
                      background: SEV_COLOR[a.severity] || '#dc2626'
                    }} />
                            <span className="text-slate-600 truncate">
                              #{i + 1} · {SEV_LABEL[a.severity] || a.severity} · {a.issue_type || '—'}
                            </span>
                          </button>
                        </li>)}
                    </ul>
                  </div>}
              </div>}
          </GlassCard>
        </aside>
      </main>

      <ConfirmModal {...confirm || {
      show: false
    }} />
    </SidebarLayout>;
}
function getHandles(x, y, w, h) {
  return [{
    name: 'nw',
    cx: x,
    cy: y
  }, {
    name: 'n',
    cx: x + w / 2,
    cy: y
  }, {
    name: 'ne',
    cx: x + w,
    cy: y
  }, {
    name: 'e',
    cx: x + w,
    cy: y + h / 2
  }, {
    name: 'se',
    cx: x + w,
    cy: y + h
  }, {
    name: 's',
    cx: x + w / 2,
    cy: y + h
  }, {
    name: 'sw',
    cx: x,
    cy: y + h
  }, {
    name: 'w',
    cx: x,
    cy: y + h / 2
  }];
}