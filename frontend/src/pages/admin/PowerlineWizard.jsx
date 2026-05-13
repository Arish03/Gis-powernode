import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ChevronRight, Tag, MapPin, ShieldAlert, Zap, X
} from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import GlassCard from '../../components/ui/GlassCard';

export default function PowerlineWizard() {
  const { projectId: id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlClientId = searchParams.get('clientId');
  const isEditing = !!id;

  const [loading, setLoading] = useState(isEditing);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    client_id: urlClientId || '',
    description: '',
    project_type: 'POWERLINE'
  });

  useEffect(() => {
    const init = async () => {
      try {
        const clientsRes = await api.get('/users/clients');
        setClients(clientsRes.data);
        
        if (isEditing) {
          const res = await api.get(`/projects/${id}`);
          setFormData({
            name: res.data.name,
            location: res.data.location || '',
            client_id: res.data.client_id || '',
            description: res.data.description || '',
            project_type: 'POWERLINE'
          });
        }
      } catch (err) {
        setError('Failed to load project details.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [id, isEditing]);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (isEditing) {
        await api.put(`/projects/${id}`, formData);
        navigate(`/admin/projects/${id}/powerline/annotate`);
      } else {
        const res = await api.post('/projects', formData);
        // After creation, go straight to annotation/upload for powerline
        navigate(`/admin/projects/${res.data.id}/powerline/annotate`);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save project.');
    }
  };

  if (loading) return <SidebarLayout title="Powerline Wizard"><div className="spinner" /></SidebarLayout>;

  return (
    <SidebarLayout title="Powerline Wizard" subtitle="Configure a new transmission line inspection">
      <div className="max-w-2xl mx-auto mt-12">
        <div className="mb-8 text-center">
          <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Zap size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">New Powerline Project</h1>
          <p className="text-sm text-slate-500">Enter project details to start uploading inspection images.</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl text-xs mb-6 flex items-start gap-3 animate-fade-in">
            <ShieldAlert size={16} className="shrink-0" />
            <div className="flex-1">
              <p className="font-bold mb-0.5">Error Saving Project</p>
              <p>{error}</p>
            </div>
            <button onClick={() => setError('')}><X size={14} /></button>
          </div>
        )}

        <GlassCard className="p-8">
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Project Name <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Tag size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    className="glass-input pl-10" 
                    placeholder="e.g. 220kV Line - Section A"
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                    required 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Location</label>
                <div className="relative">
                  <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    className="glass-input pl-10" 
                    placeholder="Tower range or region"
                    value={formData.location} 
                    onChange={e => setFormData({...formData, location: e.target.value})} 
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Assign Client</label>
              <select 
                className="glass-input" 
                value={formData.client_id} 
                onChange={e => setFormData({...formData, client_id: e.target.value})}
              >
                <option value="">Select a Client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.full_name || c.username}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Description</label>
              <textarea 
                className="glass-input min-h-[100px] resize-none" 
                placeholder="Details about the inspection, line voltage, number of towers, etc."
                value={formData.description} 
                onChange={e => setFormData({...formData, description: e.target.value})}
              />
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button type="submit" className="btn-primary px-8 gap-2">
                Continue to Upload <ChevronRight size={18} />
              </button>
            </div>
          </form>
        </GlassCard>
      </div>
    </SidebarLayout>
  );
}
