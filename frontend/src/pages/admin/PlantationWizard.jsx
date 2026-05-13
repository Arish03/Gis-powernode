import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ChevronRight, Check, UploadCloud, Tag, MapPin, ShieldAlert, Edit2, 
  CheckCircle2, Loader2, X, FileImage, Download, Layers, Scan, 
  BarChart2, Cpu, AlertTriangle, RefreshCcw, Trees
} from 'lucide-react';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import ConfirmModal from '../../components/ConfirmModal';
import GlassCard from '../../components/ui/GlassCard';
import { useAuth } from '../../contexts/AuthContext';

const PIPELINE_STAGES = [
  { status: 'processing', label: '3D Reconstruction', sub: 'NodeODM photogrammetry', icon: Cpu },
  { status: 'downloading', label: 'Downloading Outputs', sub: 'Rasters from NodeODM', icon: Download },
  { status: 'tiling', label: 'Map Tile Generation', sub: 'XYZ tile pyramids', icon: Layers },
  { status: 'detecting', label: 'AI Tree Detection', sub: 'YOLOv9 crown localisation', icon: Scan },
  { status: 'computing_heights', label: 'Heights & Health', sub: 'CHM & Vegetation indices', icon: BarChart2 }
];

function getActiveStageIdx(status) {
  if (!status || status === 'queued') return -1;
  if (status === 'completed') return PIPELINE_STAGES.length;
  return PIPELINE_STAGES.findIndex(s => s.status === status);
}

function formatBytes(b) {
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function PlantationWizard() {
  const { projectId: id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlClientId = searchParams.get('clientId');
  const { user } = useAuth();
  const isEditing = !!id;
  const isSubAdmin = user?.role === 'SUB_ADMIN';

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(isEditing);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    client_id: urlClientId || '',
    description: '',
    project_type: 'TREE'
  });

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadPhase, setUploadPhase] = useState('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const fileInputRef = useRef(null);
  
  const [procStatus, setProcStatus] = useState(null);
  const [procProgress, setProcProgress] = useState(0);
  const [procMessage, setProcMessage] = useState('');
  const [procError, setProcError] = useState('');
  const pollRef = useRef(null);
  const [treeCount, setTreeCount] = useState(null);

  const [processingNodes, setProcessingNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState('auto');

  useEffect(() => {
    const init = async () => {
      try {
        const clientsRes = await api.get('/users/clients');
        setClients(clientsRes.data);
        
        try {
          const nodesRes = await api.get('/processing-nodes/');
          setProcessingNodes(nodesRes.data);
        } catch {}

        if (isEditing) {
          const res = await api.get(`/projects/${id}`);
          setFormData({
            name: res.data.name,
            location: res.data.location || '',
            client_id: res.data.client_id || '',
            description: res.data.description || '',
            project_type: 'TREE'
          });

          const statusRes = await api.get(`/projects/${id}/drone-status`);
          const ds = statusRes.data.status;
          if (ds === 'uploading') {
            setStagedCount(statusRes.data.image_count || 0);
            setCurrentStep(2);
          } else if (['queued', 'processing', 'downloading', 'tiling', 'detecting', 'computing_heights'].includes(ds)) {
            setProcStatus(ds);
            setProcProgress(statusRes.data.progress || 0);
            setCurrentStep(3);
          } else if (ds === 'completed') {
            setProcStatus('completed');
            setTreeCount(res.data.tree_count);
            setCurrentStep(isSubAdmin ? 3 : 4);
          } else {
            setCurrentStep(2);
          }
        }
      } catch (err) {
        setError('Failed to load project.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [id, isEditing]);

  useEffect(() => {
    if (currentStep === 3 && !isSubAdmin && procStatus !== 'failed' && procStatus !== 'completed') {
      pollRef.current = setInterval(async () => {
        try {
          const res = await api.get(`/projects/${id}/drone-status`);
          setProcStatus(res.data.status);
          setProcProgress(res.data.progress || 0);
          setProcMessage(res.data.message || '');
          if (res.data.status === 'completed') {
            clearInterval(pollRef.current);
            setCurrentStep(4);
          } else if (res.data.status === 'failed') {
            clearInterval(pollRef.current);
            setProcError(res.data.error || 'Processing failed');
          }
        } catch {}
      }, 3000);
    }
    return () => clearInterval(pollRef.current);
  }, [currentStep, procStatus]);

  const handleSaveDetails = async (e) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await api.put(`/projects/${id}`, formData);
        setCurrentStep(2);
      } else {
        const res = await api.post('/projects', formData);
        navigate(`/admin/projects/plantation/new/${res.data.id}`, { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save.');
    }
  };

  const handleStageImages = async () => {
    setUploadPhase('uploading');
    const fd = new FormData();
    selectedFiles.forEach(f => fd.append('files', f));
    try {
      const res = await api.post(`/projects/${id}/drone-upload`, fd, {
        onUploadProgress: e => setUploadProgress(Math.round(e.loaded * 100 / e.total))
      });
      setStagedCount(res.data.total_staged);
      setUploadPhase('idle');
      setSelectedFiles([]);
    } catch (err) {
      setUploadPhase('idle');
      setError('Upload failed.');
    }
  };

  const handleStartProcessing = async () => {
    try {
      const payload = selectedNodeId !== 'auto' ? { processing_node_id: selectedNodeId } : {};
      await api.post(`/projects/${id}/drone-process`, payload);
      setProcStatus('queued');
      setCurrentStep(3);
    } catch (err) {
      setError('Failed to start.');
    }
  };

  if (loading) return <SidebarLayout title="Plantation Wizard"><div className="spinner" /></SidebarLayout>;

  return (
    <SidebarLayout title="Plantation Wizard" subtitle="Create and process a tree analytics project">
      <div className="max-w-2xl mx-auto mt-8">
        {/* Step Indicator */}
        <div className="flex justify-between mb-8 px-4">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`flex flex-col items-center ${currentStep >= s ? 'text-primary-600' : 'text-slate-300'}`}>
              <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mb-1 ${currentStep >= s ? 'border-primary-500 bg-primary-50' : 'border-slate-200'}`}>
                {currentStep > s ? <Check size={16} /> : s}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider">{['Details', 'Upload', 'Process', 'Results'][s-1]}</span>
            </div>
          ))}
        </div>

        {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs mb-4 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>}

        {currentStep === 1 && (
          <GlassCard className="p-6">
            <h2 className="font-heading font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Trees className="text-emerald-500" size={20} /> Project Details
            </h2>
            <form onSubmit={handleSaveDetails} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Project Name</label>
                <input type="text" className="glass-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Location</label>
                <input type="text" className="glass-input" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Client</label>
                <select className="glass-input" value={formData.client_id} onChange={e => setFormData({...formData, client_id: e.target.value})}>
                  <option value="">Select Client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <button type="submit" className="btn-primary w-full gap-2">Next Step <ChevronRight size={16} /></button>
            </form>
          </GlassCard>
        )}

        {currentStep === 2 && (
          <GlassCard className="p-6">
            <h2 className="font-heading font-bold text-slate-800 mb-4 flex items-center gap-2">
              <UploadCloud className="text-blue-500" size={20} /> Upload Images
            </h2>
            <div 
              className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-primary-400 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current.click()}
            >
              <input type="file" multiple hidden ref={fileInputRef} onChange={e => setSelectedFiles(Array.from(e.target.files))} />
              <FileImage size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm text-slate-600 font-medium">Click or drag images here</p>
              <p className="text-[10px] text-slate-400 mt-1">Only .JPG images are supported</p>
            </div>

            {selectedFiles.length > 0 && (
              <div className="mt-4 p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                <span className="text-xs text-slate-600 font-bold">{selectedFiles.length} files selected</span>
                <button onClick={handleStageImages} disabled={uploadPhase === 'uploading'} className="btn-primary py-1.5 px-3 text-xs">
                  {uploadPhase === 'uploading' ? 'Uploading...' : 'Upload Now'}
                </button>
              </div>
            )}

            {stagedCount > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-primary-600 font-bold">{stagedCount} images ready</span>
                <div className="flex gap-2">
                  <select value={selectedNodeId} onChange={e => setSelectedNodeId(e.target.value)} className="glass-input text-xs py-1">
                    <option value="auto">Auto Select Node</option>
                    {processingNodes.map(n => <option key={n.id} value={n.id}>{n.label || n.hostname}</option>)}
                  </select>
                  <button onClick={handleStartProcessing} className="btn-primary py-1.5 px-3 text-xs">Start AI Processing</button>
                </div>
              </div>
            )}
          </GlassCard>
        )}

        {currentStep === 3 && (
          <GlassCard className="p-8 text-center">
            {procStatus === 'failed' ? (
              <>
                <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Processing Failed</h2>
                <p className="text-sm text-slate-500 mb-6">{procError}</p>
                <button onClick={() => setCurrentStep(2)} className="btn-secondary">Back to Upload</button>
              </>
            ) : (
              <>
                <Loader2 size={48} className="text-primary-500 animate-spin mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Processing Pipeline</h2>
                <p className="text-sm text-slate-500 mb-6">{procMessage || 'The AI is currently analyzing your data...'}</p>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden mb-8">
                  <div className="h-full bg-primary-500 transition-all" style={{ width: `${procProgress}%` }} />
                </div>
                <div className="space-y-4 text-left max-w-xs mx-auto">
                  {PIPELINE_STAGES.map((s, i) => {
                    const active = getActiveStageIdx(procStatus) === i;
                    const done = getActiveStageIdx(procStatus) > i;
                    return (
                      <div key={s.status} className={`flex items-center gap-3 ${done ? 'text-primary-600' : active ? 'text-slate-800' : 'text-slate-300'}`}>
                        {done ? <Check size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : <div className="w-3.5" />}
                        <span className="text-xs font-bold">{s.label}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </GlassCard>
        )}

        {currentStep === 4 && (
          <GlassCard className="p-10 text-center">
            <div className="w-16 h-16 bg-primary-50 text-primary-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-2">Processing Complete!</h2>
            <p className="text-sm text-slate-500 mb-6">Your plantation project is ready for review.</p>
            {treeCount && <div className="bg-primary-50 text-primary-700 px-4 py-2 rounded-full inline-block font-bold mb-8">{treeCount} Trees Detected</div>}
            <div className="flex gap-3 justify-center">
              <button onClick={() => navigate(`/admin/projects/${id}/edit`)} className="btn-primary">View Inventory</button>
              <button onClick={() => navigate('/admin')} className="btn-secondary">Dashboard</button>
            </div>
          </GlassCard>
        )}
      </div>
    </SidebarLayout>
  );
}
