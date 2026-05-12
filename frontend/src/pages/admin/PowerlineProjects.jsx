import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Zap, Search, Filter, MoreHorizontal, 
  MapPin, Calendar, CheckCircle2, Loader2, AlertCircle,
  ChevronRight, ArrowUpRight, Activity, ShieldCheck
} from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import SearchInput from '../../components/ui/SearchInput';

export default function PowerlineProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await api.get('/projects');
        const filtered = (res.data.projects || []).filter(p => p.project_type === 'POWERLINE');
        setProjects(filtered);
      } catch (err) {
        console.error('Failed to fetch projects', err);
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
  }, []);

  const filtered = projects.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    (p.location || '').toLowerCase().includes(search.toLowerCase())
  );

  const getStatusStyle = (status) => {
    switch (status) {
      case 'READY': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'PROCESSING': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'ERROR': return 'bg-rose-100 text-rose-700 border-rose-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <SidebarLayout 
      title="Powerline Projects" 
      subtitle="Manual inspection and transmission line reporting."
      actions={
        <button className="btn-primary gap-2" onClick={() => navigate('/admin/projects/powerline/new')}>
          <Plus size={16} /> New Powerline Project
        </button>
      }
    >
      <div className="space-y-6">
        {/* Stats Summary Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
              <Zap size={20} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Length</p>
              <p className="text-xl font-bold text-slate-800">142 km</p>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <ShieldCheck size={20} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inspected Spans</p>
              <p className="text-xl font-bold text-slate-800">482</p>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <Activity size={20} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Critical Issues</p>
              <p className="text-xl font-bold text-slate-800">8</p>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
              <Calendar size={20} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last 30 Days</p>
              <p className="text-xl font-bold text-slate-800">+4</p>
            </div>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1 w-full">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by line name or region..." />
          </div>
          <button className="btn-secondary gap-2 shrink-0">
            <Filter size={16} /> Filters
          </button>
        </div>

        {/* Projects Table */}
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200/60">
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Line / Project</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Region</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Spans</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Length (km)</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [1, 2].map(i => (
                    <tr key={i}>
                      <td colSpan="6" className="px-6 py-8">
                        <div className="skeleton h-8 w-full rounded-lg" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <AlertCircle size={32} className="text-slate-300" />
                        <p className="text-slate-500 font-medium">No powerline projects found</p>
                        <button className="text-primary-600 text-sm font-bold mt-2" onClick={() => navigate('/admin/projects/powerline/new')}>
                          Create your first inspection
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map(project => (
                    <tr 
                      key={project.id} 
                      className="group hover:bg-slate-50/50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/admin/projects/${project.id}/view`)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                            <Zap size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-800 truncate">{project.name}</div>
                            <div className="text-[11px] text-slate-400 truncate">Inspection {new Date(project.created_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <MapPin size={12} />
                          <span className="truncate max-w-[150px]">{project.location || 'Not specified'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="text-sm font-semibold text-slate-700">24</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="text-sm font-bold text-slate-800">8.2</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusStyle(project.status)}`}>
                          {project.status === 'READY' && <CheckCircle2 size={10} />}
                          {project.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            className="p-2 rounded-lg hover:bg-white text-slate-400 hover:text-primary-600 transition-colors shadow-sm border border-transparent hover:border-slate-100"
                            onClick={(e) => { e.stopPropagation(); navigate(`/admin/projects/${project.id}/view`); }}
                          >
                            <ArrowUpRight size={16} />
                          </button>
                          <button className="p-2 rounded-lg hover:bg-white text-slate-400 hover:text-slate-600 transition-colors shadow-sm border border-transparent hover:border-slate-100">
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
            <p className="text-[11px] text-slate-500 font-medium">
              Showing <span className="text-slate-800 font-bold">{filtered.length}</span> projects
            </p>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
