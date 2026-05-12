import { useState, useEffect } from 'react';
import { Plus, Server, Pencil, Trash2, Loader2, X, Zap, Wifi, WifiOff, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import SidebarLayout from '../../components/SidebarLayout';
import ConfirmModal from '../../components/ConfirmModal';

export default function ProcessingNodes() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [nodeForm, setNodeForm] = useState({ label: '', hostname: '', port: '3000', token: '' });
  const [nodeSaving, setNodeSaving] = useState(false);
  const [testingNodeId, setTestingNodeId] = useState(null);
  const [confirmModal, setConfirmModal] = useState({
    show: false, title: '', message: '', type: 'danger',
    onConfirm: () => {}, onCancel: () => setConfirmModal(p => ({ ...p, show: false })),
  });

  const fetchNodes = async () => {
    try {
      const res = await api.get('/processing-nodes/');
      setNodes(res.data);
    } catch (err) {
      console.error('Failed to fetch nodes', err);
      toast.error('Failed to load processing nodes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
    const interval = setInterval(fetchNodes, 15000);
    return () => clearInterval(interval);
  }, []);

  const openAddNode = () => {
    setEditingNode(null);
    setNodeForm({ label: '', hostname: '', port: '3000', token: '' });
    setShowNodeModal(true);
  };

  const openEditNode = (node) => {
    setEditingNode(node);
    setNodeForm({ label: node.label, hostname: node.hostname, port: String(node.port), token: node.token });
    setShowNodeModal(true);
  };

  const handleNodeSave = async () => {
    if (!nodeForm.hostname.trim()) {
      toast.error('Hostname is required');
      return;
    }
    const port = parseInt(nodeForm.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      toast.error('Port must be 1–65535');
      return;
    }
    setNodeSaving(true);
    try {
      const payload = {
        hostname: nodeForm.hostname.trim(),
        port,
        label: nodeForm.label.trim(),
        token: nodeForm.token,
      };
      if (editingNode) {
        await api.put(`/processing-nodes/${editingNode.id}`, payload);
        toast.success('Node updated');
      } else {
        await api.post('/processing-nodes/', payload);
        toast.success('Node created');
      }
      setShowNodeModal(false);
      fetchNodes();
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to save node';
      toast.error(msg);
    } finally {
      setNodeSaving(false);
    }
  };

  const handleTestNode = async (node) => {
    setTestingNodeId(node.id);
    try {
      const { data } = await api.post(`/processing-nodes/${node.id}/test`);
      toast.success(data.online ? `${node.label || node.hostname} is online` : `${node.label || node.hostname} is offline`);
      fetchNodes();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Test failed');
    } finally {
      setTestingNodeId(null);
    }
  };

  const handleDeleteNode = (node) => {
    setConfirmModal({
      show: true,
      title: 'Delete Processing Node',
      message: `Are you sure you want to delete "${node.label || `${node.hostname}:${node.port}`}"? Active tasks using this node will need reassignment.`,
      type: 'danger',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await api.delete(`/processing-nodes/${node.id}`);
          toast.success('Node deleted');
          setConfirmModal(p => ({ ...p, show: false }));
          fetchNodes();
        } catch (err) {
          toast.error('Failed to delete node');
          setConfirmModal(p => ({ ...p, show: false }));
        }
      },
      onCancel: () => setConfirmModal(p => ({ ...p, show: false })),
    });
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return 'Never';
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <SidebarLayout 
      title="Processing Nodes" 
      subtitle="Manage distributed NodeODM instances for drone photogrammetry."
      actions={
        <button className="btn-primary gap-2" onClick={openAddNode}>
          <Plus size={16} /> Add Node
        </button>
      }
    >
      <div className="space-y-6">
        {loading && nodes.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass-card p-6 space-y-4">
                <div className="skeleton h-6 w-1/2 rounded-lg" />
                <div className="skeleton h-4 w-3/4 rounded-lg" />
                <div className="skeleton h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <div className="glass-card py-20 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center mb-6">
              <Server size={32} className="text-slate-400" />
            </div>
            <h2 className="font-heading font-bold text-slate-800 text-xl mb-2">No Processing Nodes</h2>
            <p className="text-slate-500 text-sm max-w-sm mb-8">
              Connect a NodeODM instance to start processing drone imagery and generating 3D models.
            </p>
            <button className="btn-primary gap-2" onClick={openAddNode}>
              <Plus size={16} /> Add First Node
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {nodes.map(node => (
              <div
                key={node.id}
                className="relative bg-white/60 backdrop-blur-glass border border-white/80 rounded-2xl shadow-glass
                           hover:shadow-glass-hover transition-all duration-300 overflow-hidden group"
              >
                <div className={`absolute top-0 left-0 right-0 h-1 ${node.online ? 'bg-gradient-to-r from-emerald-400 to-teal-400' : 'bg-gradient-to-r from-rose-400 to-pink-400'}`} />
                
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${node.online ? 'bg-emerald-500 shadow-green-glow animate-pulse' : 'bg-rose-400'}`} />
                      <h3 className="font-heading font-bold text-slate-800 text-lg truncate max-w-[180px]">
                        {node.label || node.hostname}
                      </h3>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleTestNode(node)}
                        disabled={testingNodeId === node.id}
                        className="p-2 rounded-xl hover:bg-amber-50 text-slate-400 hover:text-amber-500 transition-colors disabled:opacity-50"
                        title="Test connection"
                      >
                        {testingNodeId === node.id ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                      </button>
                      <button onClick={() => openEditNode(node)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDeleteNode(node)} className="p-2 rounded-xl hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Endpoint</span>
                      <code className="text-xs bg-slate-50 px-2 py-1 rounded-md text-slate-600 border border-slate-100 w-fit">
                        {node.hostname}:{node.port}
                      </code>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/50 rounded-xl p-3 border border-white/80">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Queue</span>
                        <span className="text-lg font-bold text-slate-800">{node.online ? node.queue_count : '—'}</span>
                        <span className="text-[10px] text-slate-400 ml-1">tasks</span>
                      </div>
                      <div className="bg-white/50 rounded-xl p-3 border border-white/80">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Max Images</span>
                        <span className="text-lg font-bold text-slate-800">{node.max_images || '∞'}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        {node.online ? <Wifi size={14} className="text-emerald-500" /> : <WifiOff size={14} className="text-rose-400" />}
                        <span className="text-[11px] text-slate-500">
                          {node.online ? `Running v${node.engine_version || 'unknown'}` : 'Offline'}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Seen {timeAgo(node.last_refreshed)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showNodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white/95 backdrop-blur-glass rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="bg-gradient-to-r from-primary-600 to-teal-600 px-6 py-4 flex items-center justify-between">
              <h3 className="font-heading font-bold text-white text-lg">
                {editingNode ? 'Edit Processing Node' : 'Add New Node'}
              </h3>
              <button onClick={() => setShowNodeModal(false)} className="text-white/80 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Label</label>
                <input
                  type="text"
                  className="glass-input w-full"
                  placeholder="e.g. Master Node, GPU Worker 1"
                  value={nodeForm.label}
                  onChange={e => setNodeForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Hostname / IP</label>
                  <input
                    type="text"
                    className="glass-input w-full"
                    placeholder="192.168.1.50"
                    value={nodeForm.hostname}
                    onChange={e => setNodeForm(f => ({ ...f, hostname: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Port</label>
                  <input
                    type="number"
                    className="glass-input w-full"
                    placeholder="3000"
                    value={nodeForm.port}
                    onChange={e => setNodeForm(f => ({ ...f, port: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Access Token (Optional)</label>
                <input
                  type="password"
                  className="glass-input w-full"
                  placeholder="Bearer token for protected nodes"
                  value={nodeForm.token}
                  onChange={e => setNodeForm(f => ({ ...f, token: e.target.value }))}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button className="btn-secondary flex-1" onClick={() => setShowNodeModal(false)}>Cancel</button>
                <button className="btn-primary flex-1 gap-2" onClick={handleNodeSave} disabled={nodeSaving}>
                  {nodeSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  {nodeSaving ? 'Saving...' : 'Save & Connect'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal {...confirmModal} />
    </SidebarLayout>
  );
}
