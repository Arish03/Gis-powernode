import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Map, BarChart3 } from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import Badge from '../../components/ui/Badge';
import GroupMapView from './GroupMapView';
import GroupAnalyticsView from './GroupAnalyticsView';
export default function ClientGroupPortal() {
  const {
    groupId
  } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState('map');
  const [locateTarget, setLocateTarget] = useState(null);
  const handleLocateTree = tree => {
    // Find the best lat/lng: use baseline or first DETECTED observation
    let lat = tree.baseline_latitude;
    let lng = tree.baseline_longitude;
    let timelineIdx = tree.first_seen_timeline_index ?? 0;
    if (lat == null || lng == null) {
      const obs = (tree.observations || []).find(o => o.observation_type !== 'MISSING');
      if (obs) {
        lat = obs.latitude;
        lng = obs.longitude;
        timelineIdx = obs.timeline_index;
      }
    }
    if (lat == null || lng == null) return;
    setLocateTarget({
      lat,
      lng,
      timelineIdx
    });
    setActiveView('map');
  };
  useEffect(() => {
    api.get(`/groups/${groupId}`).then(r => setGroup(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [groupId]);
  if (loading) return <SidebarLayout title="Client Group Portal"><div className="spinner" /></SidebarLayout>;
  if (!group) return <SidebarLayout title="Client Group Portal"><div className="p-10 text-center text-red-500">Group not found</div></SidebarLayout>;
  return <SidebarLayout title="Client Group Portal">
      
      <header className="relative z-10 max-w-screen-2xl mx-auto w-full px-4 pt-4 pb-2 flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-white/60">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-heading font-extrabold text-slate-800 text-xl">{group.name}</h1>
            <Badge status={group.status}>{group.status}</Badge>
          </div>
          <p className="text-xs text-slate-500">
            {group.members?.length || 0} timelines · {group.unified_tree_count ?? 0} unified trees
          </p>
        </div>
        {group.status === 'READY' && <div className="flex items-center gap-2">
            <button onClick={() => setActiveView('map')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${activeView === 'map' ? 'bg-primary-500 text-white' : 'bg-white/70 text-slate-600'}`}>
              <Map size={14} /> Map
            </button>
            <button onClick={() => setActiveView('analytics')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${activeView === 'analytics' ? 'bg-primary-500 text-white' : 'bg-white/70 text-slate-600'}`}>
              <BarChart3 size={14} /> Analytics
            </button>
          </div>}
      </header>

      <main className="flex-1 flex flex-col relative z-0">
        {group.status === 'READY' ? activeView === 'map' ? <GroupMapView group={group} locateTarget={locateTarget} /> : <GroupAnalyticsView group={group} onLocateTree={handleLocateTree} /> : <div className="flex-1 flex items-center justify-center text-slate-500">
            This group is not ready yet.
          </div>}
      </main>
    </SidebarLayout>;
}