import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, GripVertical, AlertTriangle, Trees, Loader2 } from 'lucide-react';
import api from '../../api/client';
import Navbar from '../../components/Navbar';
import GlassCard from '../../components/ui/GlassCard';

/**
 * GroupProjectWizard — 2-step flow to create a Project Group.
 * Step 1: metadata + client (locked when clientId query param provided).
 * Step 2: drag-drop ordering of READY child projects.
 */
export default function GroupProjectWizard() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialClientId = params.get('clientId') || '';

  const [step, setStep] = useState(1);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(initialClientId);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState([]); // ordered list of project ids
  const [flightDates, setFlightDates] = useState({}); // {projectId: 'YYYY-MM-DD'}
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/users/clients').then(r => setClients(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId || step !== 2) return;
    setLoadingProjects(true);
    api.get(`/projects?client_id=${clientId}&status=READY`)
      .then(r => setProjects(r.data.projects || []))
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, [clientId, step]);

  const availableProjects = useMemo(
    () => projects.filter(p => !selected.includes(p.id)),
    [projects, selected]
  );
  const selectedProjects = useMemo(
    () => selected.map(id => projects.find(p => p.id === id)).filter(Boolean),
    [selected, projects]
  );

  const moveItem = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= selected.length) return;
    const next = [...selected];
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    setSelected(next);
  };

  const canSubmit = clientId && name.trim() && selected.length >= 2;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        client_id: clientId,
        name: name.trim(),
        location: location.trim() || null,
        description: description.trim() || null,
        project_ids: selected,
      };
      const fd = selected
        .map(pid => flightDates[pid] ? { project_id: pid, flight_date: flightDates[pid] } : null)
        .filter(Boolean);
      if (fd.length) payload.flight_dates = fd;

      const res = await api.post('/groups', payload);
      navigate(`/admin/groups/${res.data.id}/view`);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to create group');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-bg min-h-screen">
      <Navbar />
      <main className="relative z-10 max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/60">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="font-heading font-extrabold text-slate-800 text-2xl">New Project Group</h1>
            <p className="text-sm text-slate-500">Link multiple READY projects of a single client into an ordered timeline.</p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-3 text-sm">
          <div className={`flex items-center gap-2 ${step >= 1 ? 'text-primary-700 font-semibold' : 'text-slate-400'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-primary-500 text-white' : 'bg-slate-200'}`}>1</span>
            Metadata
          </div>
          <span className="flex-1 h-px bg-slate-200" />
          <div className={`flex items-center gap-2 ${step >= 2 ? 'text-primary-700 font-semibold' : 'text-slate-400'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-primary-500 text-white' : 'bg-slate-200'}`}>2</span>
            Timeline
          </div>
        </div>

        {step === 1 && (
          <GlassCard className="p-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Client</label>
              <select
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                disabled={!!initialClientId}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl bg-white disabled:bg-slate-50"
              >
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.full_name || c.username}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Group Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl bg-white"
                placeholder="e.g. Block 14 — 2023→2025 Timeline"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Location</label>
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl bg-white"
              />
            </div>
            <div className="flex justify-end">
              <button
                disabled={!clientId || !name.trim()}
                onClick={() => setStep(2)}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              >
                Next <ArrowRight size={16} />
              </button>
            </div>
          </GlassCard>
        )}

        {step === 2 && (
          <GlassCard className="p-6 space-y-5">
            <p className="text-sm text-slate-500">
              Pick at least 2 READY projects and order them from <b>oldest</b> (T0) to newest.
              Boundaries must chain-intersect.
            </p>

            {loadingProjects ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="animate-spin" size={16} /> Loading projects…</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Available */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Available ({availableProjects.length})</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {availableProjects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setSelected(prev => [...prev, p.id])}
                        className="w-full text-left p-3 rounded-xl bg-white border border-slate-200 hover:border-primary-300 hover:bg-primary-50/30 transition"
                      >
                        <div className="flex items-center gap-2">
                          <Trees size={14} className="text-primary-500" />
                          <span className="font-medium text-slate-800 text-sm">{p.name}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{p.location || '—'}</p>
                      </button>
                    ))}
                    {availableProjects.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No more READY projects available.</p>
                    )}
                  </div>
                </div>

                {/* Selected (ordered) */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                    Timeline ({selected.length}) — top is T0
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {selectedProjects.map((p, idx) => (
                      <div key={p.id} className="p-3 rounded-xl bg-white border border-primary-200 shadow-sm">
                        <div className="flex items-center gap-2">
                          <GripVertical size={14} className="text-slate-400" />
                          <span className="text-xs font-mono text-primary-600 font-bold">T{idx}</span>
                          <span className="font-medium text-slate-800 text-sm flex-1 truncate">{p.name}</span>
                          <button onClick={() => moveItem(idx, idx - 1)} disabled={idx === 0}
                                  className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30">↑</button>
                          <button onClick={() => moveItem(idx, idx + 1)} disabled={idx === selected.length - 1}
                                  className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30">↓</button>
                          <button onClick={() => setSelected(prev => prev.filter(id => id !== p.id))}
                                  className="text-xs text-red-500 hover:text-red-700 ml-1">×</button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-[10px] text-slate-500 uppercase">Flight date</label>
                          <input
                            type="date"
                            value={flightDates[p.id] || ''}
                            onChange={e => setFlightDates({ ...flightDates, [p.id]: e.target.value })}
                            className="text-xs border border-slate-200 rounded px-2 py-0.5 bg-white"
                          />
                        </div>
                      </div>
                    ))}
                    {selected.length === 0 && (
                      <p className="text-xs text-slate-400 italic">Add projects from the left to build the timeline.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertTriangle size={16} className="mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="btn-secondary inline-flex items-center gap-2">
                <ArrowLeft size={16} /> Back
              </button>
              <button
                disabled={!canSubmit || submitting}
                onClick={handleSubmit}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                Create Group
              </button>
            </div>
          </GlassCard>
        )}
      </main>
    </div>
  );
}
