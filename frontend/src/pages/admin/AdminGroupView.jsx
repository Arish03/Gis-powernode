import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Map, BarChart3, Loader2, RefreshCcw, AlertTriangle } from 'lucide-react';
import api from '../../api/client';
import Navbar from '../../components/Navbar';
import GlassCard from '../../components/ui/GlassCard';
import Badge from '../../components/ui/Badge';
import GroupMapView from '../client/GroupMapView';
import GroupAnalyticsView from '../client/GroupAnalyticsView';

export default function AdminGroupView() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [progress, setProgress] = useState(null);
  const [activeView, setActiveView] = useState('map');
  const [loading, setLoading] = useState(true);

  const fetchGroup = async () => {
    try {
      const r = await api.get(`/groups/${groupId}`);
      setGroup(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const r = await api.get(`/groups/${groupId}/status`);
      setProgress(r.data);
    } catch {}
  };

  useEffect(() => {
    fetchGroup();
  }, [groupId]);

  useEffect(() => {
    if (!group || group.status === 'READY') return;
    fetchStatus();
    const t = setInterval(() => { fetchStatus(); fetchGroup(); }, 3000);
    return () => clearInterval(t);
  }, [group?.status]);

  const handleRecompute = async () => {
    try { await api.post(`/groups/${groupId}/recompute`); fetchGroup(); fetchStatus(); } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="page-bg min-h-screen flex items-center justify-center"><div className="spinner" /></div>
  );
  if (!group) return (
    <div className="page-bg min-h-screen"><Navbar /><div className="p-10 text-center text-red-500">Group not found</div></div>
  );

  return (
    <div className="page-bg min-h-screen flex flex-col">
      <Navbar />
      <header className="relative z-10 max-w-screen-2xl mx-auto w-full px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => navigate(group.client_id ? `/admin/clients/${group.client_id}/groups` : '/admin')}
                className="p-2 rounded-lg hover:bg-white/60">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-heading font-extrabold text-slate-800 text-xl">{group.name}</h1>
            <Badge status={group.status}>{group.status}</Badge>
          </div>
          <p className="text-xs text-slate-500">
            {(group.members?.length || 0)} projects · {group.unified_tree_count ?? 0} unified trees
          </p>
        </div>
        <div className="flex items-center gap-2">
          {group.status === 'READY' && (
            <>
              <button onClick={() => setActiveView('map')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${activeView === 'map' ? 'bg-primary-500 text-white' : 'bg-white/70 text-slate-600'}`}>
                <Map size={14} /> Map
              </button>
              <button onClick={() => setActiveView('analytics')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${activeView === 'analytics' ? 'bg-primary-500 text-white' : 'bg-white/70 text-slate-600'}`}>
                <BarChart3 size={14} /> Analytics
              </button>
            </>
          )}
          <button onClick={handleRecompute} title="Recompute matching"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 bg-white/70 text-slate-600 hover:bg-white">
            <RefreshCcw size={14} /> Recompute
          </button>
        </div>
      </header>

      {group.status === 'PROCESSING' && (
        <div className="max-w-screen-2xl mx-auto w-full px-4">
          <GlassCard className="p-4 flex items-center gap-3">
            <Loader2 className="animate-spin text-primary-500" size={20} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700">
                Matching in progress — {progress?.progress ?? 0}%
              </p>
              <p className="text-xs text-slate-500">{progress?.message || 'Building unified tree registry…'}</p>
              <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 transition-all" style={{ width: `${progress?.progress ?? 0}%` }} />
              </div>
            </div>
          </GlassCard>
        </div>
      )}

      {group.status === 'ERROR' && (
        <div className="max-w-screen-2xl mx-auto w-full px-4">
          <GlassCard className="p-4 flex items-center gap-3 border-red-200">
            <AlertTriangle className="text-red-500" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700">Matching failed</p>
              <p className="text-xs text-red-600">{group.processing_error}</p>
            </div>
          </GlassCard>
        </div>
      )}

      <main className="flex-1 flex flex-col relative z-0">
        {group.status === 'READY' ? (
          activeView === 'map' ? <GroupMapView group={group} /> : <GroupAnalyticsView group={group} />
        ) : group.status === 'PENDING' ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">Group pending — waiting for matcher to start.</div>
        ) : (
          <div className="flex-1" />
        )}
      </main>
    </div>
  );
}
