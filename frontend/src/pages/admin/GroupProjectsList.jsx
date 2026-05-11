import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Layers } from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import GlassCard from '../../components/ui/GlassCard';
import Badge from '../../components/ui/Badge';
export default function GroupProjectsList() {
  const {
    clientId
  } = useParams();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const fetch = async () => {
    try {
      const [gRes, cRes] = await Promise.all([api.get(`/groups?client_id=${clientId}`), api.get('/users/clients').catch(() => ({
        data: []
      }))]);
      setGroups(gRes.data.groups || []);
      setClient((cRes.data || []).find(c => c.id === clientId));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetch();
    const t = setInterval(fetch, 8000);
    return () => clearInterval(t);
  }, [clientId]);
  return <SidebarLayout title="Group Projects List">
      
      <main className="relative z-10 max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-white/60">
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="font-heading font-extrabold text-slate-800 text-2xl">Project Groups</h1>
              <p className="text-sm text-slate-500">
                {client ? `Client: ${client.full_name || client.username}` : 'Loading…'}
              </p>
            </div>
          </div>
          <button onClick={() => navigate(`/admin/groups/new?clientId=${clientId}`)} className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} /> New Group
          </button>
        </div>

        {loading ? <div className="skeleton h-24 w-full" /> : groups.length === 0 ? <GlassCard className="p-10 text-center">
            <Layers size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No project groups yet for this client.</p>
          </GlassCard> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map(g => <GlassCard key={g.id} className="p-5 cursor-pointer hover:shadow-glass-hover transition" onClick={() => navigate(`/admin/groups/${g.id}/view`)}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-heading font-bold text-slate-800 text-lg truncate">{g.name}</h3>
                  <Badge status={g.status}>{g.status}</Badge>
                </div>
                <p className="text-xs text-slate-500 mb-3 line-clamp-2">{g.description || '—'}</p>
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <span>{g.member_count ?? (g.members?.length || 0)} projects</span>
                  {g.unified_tree_count != null && <span>· {g.unified_tree_count} unified trees</span>}
                </div>
              </GlassCard>)}
          </div>}
      </main>
    </SidebarLayout>;
}