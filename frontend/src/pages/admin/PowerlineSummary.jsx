import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, Send, ShieldAlert, X } from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import GlassCard from '../../components/ui/GlassCard';
import ConfirmModal from '../../components/ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
const SEVERITY_OPTIONS = [{
  value: 'S5',
  label: 'Category A',
  color: '#b91c1c'
}, {
  value: 'S4',
  label: 'Category B',
  color: '#ea580c'
}, {
  value: 'S3',
  label: 'Category C',
  color: '#d97706'
}, {
  value: 'S2',
  label: 'Kuo',
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
export default function PowerlineSummary() {
  const {
    projectId
  } = useParams();
  const navigate = useNavigate();
  const {
    user
  } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [project, setProject] = useState(null);
  const [summary, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(null);

  // Form state
  const [reportSummary, setReportSummary] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [p, s] = await Promise.all([api.get(`/projects/${projectId}`), api.get(`/projects/${projectId}/powerline/summary`)]);
        if (cancelled) return;
        setProject(p.data);
        setSummaryData(s.data);
        setReportSummary(p.data.report_summary || '');
        setInspectorName(p.data.primary_inspector_name || '');
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.detail || 'Failed to load project.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const saveMeta = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.put(`/projects/${projectId}`, {
        report_summary: reportSummary,
        primary_inspector_name: inspectorName
      });
      setProject(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };
  const canPublish = isAdmin && reportSummary.trim() && inspectorName.trim() && (summary?.total_images || 0) > 0 && (summary?.total_annotations || 0) > 0;
  const publishProject = () => {
    setConfirm({
      show: true,
      title: 'Publish inspection report?',
      message: 'The assigned client will be able to view the gallery and download the PDF report. Make sure the summary and inspector name are saved first.',
      confirmLabel: 'Publish',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        setConfirm(null);
        setSaving(true);
        try {
          // Save latest summary first
          await api.put(`/projects/${projectId}`, {
            report_summary: reportSummary,
            primary_inspector_name: inspectorName
          });
          const r = await api.post(`/projects/${projectId}/publish`);
          setProject(r.data);
        } catch (e) {
          setError(e.response?.data?.detail || 'Failed to publish.');
        } finally {
          setSaving(false);
        }
      },
      onCancel: () => setConfirm(null)
    });
  };
  const submitForReview = async () => {
    setSaving(true);
    try {
      await api.put(`/projects/${projectId}`, {
        report_summary: reportSummary,
        primary_inspector_name: inspectorName,
        status: 'REVIEW_PENDING'
      });
      const res = await api.get(`/projects/${projectId}`);
      setProject(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to submit for review.');
    } finally {
      setSaving(false);
    }
  };
  const severityMap = useMemo(() => {
    const m = {};
    (summary?.severity_counts || []).forEach(s => {
      m[s.severity] = s.count;
    });
    return m;
  }, [summary]);
  if (loading) {
    return <SidebarLayout title="Powerline Summary">
        <div className="spinner" />
      </SidebarLayout>;
  }
  const statusLabel = project?.status === 'READY' ? 'Published' : project?.status === 'REVIEW_PENDING' ? 'Pending Review' : project?.status || 'Draft';
  return <SidebarLayout title="Powerline Summary">
      

      {/* Header */}
      <div className="relative z-10 max-w-screen-xl mx-auto w-full px-4 sm:px-6 mt-4 mb-4 flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(`/admin/projects/${projectId}/powerline/annotate`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-white">
          <ArrowLeft size={14} /> Back to Annotator
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-heading font-extrabold text-slate-800 text-xl truncate">
            {project?.name || 'Summary & Publish'}
          </h1>
          <p className="text-xs text-slate-500">Review project summary before publishing</p>
        </div>
        <span className={['px-2.5 py-1 rounded-full text-[11px] font-semibold', project?.status === 'READY' ? 'bg-emerald-100 text-emerald-700' : project?.status === 'REVIEW_PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'].join(' ')}>
          {statusLabel}
        </span>
        {saving && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 size={12} className="animate-spin" /> Saving…
          </span>}
        {saved && <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 size={12} /> Saved
          </span>}
      </div>

      {error && <div className="relative z-10 max-w-screen-xl mx-auto w-full px-4 sm:px-6 mb-3">
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={16} />
            <p className="text-red-700 text-xs flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X size={14} /></button>
          </div>
        </div>}

      <main className="relative z-10 max-w-screen-xl mx-auto w-full px-4 sm:px-6 pb-10 flex-1 grid grid-cols-12 gap-6">
        {/* Left: form */}
        <div className="col-span-12 md:col-span-8">
          <GlassCard className="p-6 space-y-5">
            <h2 className="text-base font-heading font-bold text-slate-800">Project Summary</h2>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
                Primary Inspector Name <span className="text-red-500">*</span>
              </label>
              <input className="glass-input text-sm" value={inspectorName} onChange={e => setInspectorName(e.target.value)} placeholder="Full name of the primary inspector" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
                Inspection Summary <span className="text-red-500">*</span>
              </label>
              <textarea className="glass-input text-sm min-h-[180px] resize-y" value={reportSummary} onChange={e => setReportSummary(e.target.value)} placeholder="Describe the inspection: scope, key findings, cost estimates, recommendations…" />
              <p className="text-[11px] text-slate-400 mt-1">
                This text appears on page 2 of the PDF report alongside the project map.
              </p>
            </div>

            {/* Save + action buttons */}
            <div className="flex items-center gap-3 pt-2 border-t border-slate-100 flex-wrap">
              <button onClick={saveMeta} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200 disabled:opacity-50">
                Save Draft
              </button>

              {isAdmin ? <button onClick={publishProject} disabled={!canPublish || saving} className="btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Send size={14} />
                  {project?.status === 'READY' ? 'Re-Publish' : 'Publish Project'}
                </button> : <button onClick={submitForReview} disabled={!reportSummary.trim() || !inspectorName.trim() || saving} className="btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Send size={14} /> Submit for Review
                </button>}

              {isAdmin && !canPublish && <p className="text-[11px] text-amber-600">
                  {!reportSummary.trim() || !inspectorName.trim() ? 'Fill in summary and inspector name to publish.' : 'At least one annotated image is required to publish.'}
                </p>}
            </div>
          </GlassCard>
        </div>

        {/* Right: stats rail */}
        <div className="col-span-12 md:col-span-4 space-y-4">
          <GlassCard className="p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Inspection Stats</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Images</span>
                <span className="font-semibold text-slate-800">{summary?.total_images ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Annotations</span>
                <span className="font-semibold text-slate-800">{summary?.total_annotations ?? '—'}</span>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Severity Distribution</h3>
            <div className="space-y-1.5">
              {SEVERITY_OPTIONS.map(o => <div key={o.value} className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{
                background: o.color
              }} />
                  <span className="text-xs text-slate-600 flex-1">{o.value}</span>
                  <span className="text-xs font-bold" style={{
                color: o.color
              }}>
                    {severityMap[o.value] || 0}
                  </span>
                </div>)}
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Client</h3>
            <p className="text-sm text-slate-700 font-medium">{project?.client_name || '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">{project?.location || ''}</p>
          </GlassCard>
        </div>
      </main>

      <ConfirmModal {...confirm || {
      show: false
    }} />
    </SidebarLayout>;
}