import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Layers3 } from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import GlassCard from '../../components/ui/GlassCard';
import Badge from '../../components/ui/Badge';
export default function ClientGroupsList() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/groups').then(r => {
      const data = r.data;
      const list = Array.isArray(data) ? data : data?.groups || [];
      setGroups(list);
    }).catch(e => console.error('Failed to load groups', e)).finally(() => setLoading(false));
  }, []);
  return <SidebarLayout title="Client Groups List">
      
      <main className="relative z-10 max-w-screen-xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-white/60">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="font-heading font-extrabold text-slate-800 text-2xl tracking-tight">Group Analyses</h1>
            <p className="text-sm text-slate-500">Temporal analysis across multiple surveys.</p>
          </div>
        </div>

        {loading ? <div className="skeleton h-32 w-full" /> : groups.length === 0 ? <GlassCard className="p-12 text-center text-slate-500">
            <Layers3 size={32} className="text-slate-300 mx-auto mb-3" />
            <h2 className="font-heading font-bold text-slate-700 text-lg mb-1">No group analyses yet</h2>
            <p className="text-sm">Your administrator hasn't created any multi-survey groups for your account yet.</p>
          </GlassCard> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {groups.map(g => <GlassCard key={g.id} className="p-5 cursor-pointer hover:shadow-glass-hover transition" onClick={() => navigate(`/client/groups/${g.id}`)}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3 className="font-heading font-bold text-slate-800 text-base flex-1">{g.name}</h3>
                  <Badge status={g.status}>{g.status}</Badge>
                </div>
                {g.location && <p className="text-xs text-slate-500 mb-2">{g.location}</p>}
                <div className="flex items-center gap-4 text-xs text-slate-600">
                  <span><b>{g.members?.length || 0}</b> timelines</span>
                  <span><b>{g.unified_tree_count ?? 0}</b> unified trees</span>
                </div>
              </GlassCard>)}
          </div>}
      </main>
    </SidebarLayout>;
}