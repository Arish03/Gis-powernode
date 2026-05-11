import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, FolderOpen, Activity, CheckCircle2, Loader2, ChevronRight, Server, Pencil, Trash2, X, Wifi, WifiOff, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import SidebarLayout from '../../components/SidebarLayout';
import KpiCard from '../../components/KpiCard';
import SearchInput from '../../components/ui/SearchInput';
import ConfirmModal from '../../components/ConfirmModal';

export default function AdminDashboard() {
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { isAdmin, isStaff } = useAuth();
  const navigate = useNavigate();

  // Processing nodes state
  const [nodes, setNodes] = useState([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [nodeForm, setNodeForm] = useState({ label: '', hostname: '', port: '3000', token: '' });
  const [nodeSaving, setNodeSaving] = useState(false);
  const [confirmModal, setConfirmModal] = useState({
    show: false, title: '', message: '', type: 'danger',
    onConfirm: () => {}, onCancel: () => setConfirmModal(p => ({ ...p, show: false })),
  });
  const [testingNodeId, setTestingNodeId] = useState(null);

  // Fetch nodes
  const fetchNodes = async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get('/processing-nodes/');
      setNodes(res.data);
    } catch (err) {
      console.error('Failed to fetch nodes', err);
    } finally {
      setNodesLoading(false);
    }
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const [clientsRes, projectsRes] = await Promise.all([
          api.get('/users/clients'),
          api.get('/projects'),
        ]);
        setClients(clientsRes.data);
        setProjects(projectsRes.data.projects);
      } catch (err) {
        console.error('Failed to fetch dashboard data', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    fetchNodes();
    const interval = setInterval(() => { fetchData(); fetchNodes(); }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Node CRUD handlers
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
        toast.success('Node updated & tested');
      } else {
        await api.post('/processing-nodes/', payload);
        toast.success('Node created & tested');
      }
      setShowNodeModal(false);
      await fetchNodes();
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
      await fetchNodes();
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
          await fetchNodes();
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

  // Build client cards with project stats
  const clientCards = clients.map(client => {
    const clientProjects = projects.filter(p => p.client_id === client.id);
    const readyCount = clientProjects.filter(p => p.status === 'READY').length;
    const processingCount = clientProjects.filter(p => ['PROCESSING', 'UPLOADING'].includes(p.status)).length;
    return { ...client, projectCount: clientProjects.length, readyCount, processingCount };
  });

  // Unassigned projects
  const unassignedProjects = projects.filter(p => !p.client_id);

  // KPI metrics
  const totalClients = clients.length;
  const totalProjects = projects.length;
  const processingCount = projects.filter(p => p.status === 'PROCESSING').length;
  const readyCount = projects.filter(p => p.status === 'READY').length;

  // Filter clients by search
  const filtered = clientCards.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.full_name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q);
  });

  return (
    <SidebarLayout
      title="Dashboard"
      subtitle="Manage clients and their plantation projects."
      actions={
        isStaff && (
          <button className="btn-secondary gap-2" onClick={() => navigate('/admin/clients')}>
            <Users size={16} /> Manage Clients
          </button>
        )
      }
    >
      <div className="space-y-6">

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Clients" value={loading ? '—' : totalClients} sub="Active accounts" color="blue" icon={Users} />
          <KpiCard label="Total Projects" value={loading ? '—' : totalProjects} sub="Across all clients" color="purple" icon={FolderOpen} />
          <KpiCard label="Processing" value={loading ? '—' : processingCount} sub="Background tasks" color="amber" icon={Loader2} />
          <KpiCard label="Ready" value={loading ? '—' : readyCount} sub="Available to clients" color="green" icon={CheckCircle2} />
        </div>

        {/* ── Processing Nodes Section (Admin Only) ────────────── */}
        {isAdmin && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server size={20} className="text-slate-600" />
                <h2 className="font-heading font-bold text-slate-800 text-lg">Processing Nodes</h2>
                <span className="text-xs text-slate-400 ml-1">
                  {nodes.filter(n => n.online).length}/{nodes.length} online
                </span>
              </div>
              <button className="btn-primary gap-2 text-sm" onClick={openAddNode}>
                <Plus size={14} /> Add Node
              </button>
            </div>

            {nodesLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2].map(i => (
                  <div key={i} className="glass-card p-5 space-y-3">
                    <div className="skeleton h-6 w-1/2 rounded-lg" />
                    <div className="skeleton h-4 w-3/4 rounded-lg" />
                    <div className="skeleton h-4 w-1/3 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : nodes.length === 0 ? (
              <div className="glass-card py-10 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                  <Server size={24} className="text-slate-400" />
                </div>
                <h3 className="font-heading font-bold text-slate-700 text-base mb-1">No Processing Nodes</h3>
                <p className="text-slate-400 text-sm max-w-sm">Add a NodeODM instance to start distributed processing.</p>
                <button className="btn-primary mt-4 gap-2 text-sm" onClick={openAddNode}>
                  <Plus size={14} /> Add Node
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {nodes.map(node => (
                  <div
                    key={node.id}
                    className="relative bg-white/60 backdrop-blur-glass border border-white/80 rounded-2xl shadow-glass
                               hover:shadow-glass-hover transition-all duration-200 overflow-hidden group"
                  >
                    <div className={`absolute top-0 left-0 right-0 h-0.5 ${node.online ? 'bg-gradient-to-r from-green-400 to-emerald-400' : 'bg-gradient-to-r from-red-400 to-rose-400'}`} />
                    <div className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${node.online ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
                          <h3 className="font-heading font-bold text-slate-800 text-sm truncate max-w-[180px]">
                            {node.label || `${node.hostname}:${node.port}`}
                          </h3>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleTestNode(node)}
                            disabled={testingNodeId === node.id}
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-500 transition-colors disabled:opacity-50"
                            title="Test connection"
                          >
                            {testingNodeId === node.id ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                          </button>
                          <button onClick={() => openEditNode(node)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDeleteNode(node)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-500 mb-3 font-mono">{node.hostname}:{node.port}</p>

                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="bg-white/70 rounded-lg px-2.5 py-1 text-slate-600">
                          Queue: <b className="text-slate-800">{node.online ? node.queue_count : '—'}</b>
                        </span>
                        {node.engine_version && (
                          <span className="bg-white/70 rounded-lg px-2.5 py-1 text-slate-600">
                            Engine: <b className="text-slate-800">{node.engine_version}</b>
                          </span>
                        )}
                        {node.max_images && (
                          <span className="bg-white/70 rounded-lg px-2.5 py-1 text-slate-600">
                            Max: <b className="text-slate-800">{node.max_images}</b>
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400 mt-3">
                        {node.online ? <Wifi size={11} className="inline mr-1 text-green-500" /> : <WifiOff size={11} className="inline mr-1 text-red-400" />}
                        Last seen: {timeAgo(node.last_refreshed)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1 min-w-0">
            <SearchInput value={search} onChange={setSearch} placeholder="Search clients by name…" />
          </div>
        </div>

        {/* Client count */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : `${filtered.length} client${filtered.length !== 1 ? 's' : ''}`}
            {unassignedProjects.length > 0 && ` · ${unassignedProjects.length} unassigned project${unassignedProjects.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* Client Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="glass-card p-5 space-y-3">
                <div className="skeleton h-10 w-10 rounded-full" />
                <div className="skeleton h-6 w-3/4 rounded-lg" />
                <div className="skeleton h-4 w-1/2 rounded-lg" />
                <div className="skeleton h-9 w-full rounded-xl mt-2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Unassigned card */}
            <div
              onClick={() => navigate('/admin/clients/unassigned/projects')}
              className="relative bg-amber-50/60 backdrop-blur-glass border border-amber-200/80 rounded-2xl shadow-glass
                         hover:shadow-glass-hover hover:-translate-y-0.5 hover:border-amber-300
                         transition-all duration-200 overflow-hidden group cursor-pointer"
            >
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-orange-400
                                opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center
                                    text-amber-600 text-sm font-bold">
                      ?
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-heading font-bold text-slate-800 text-base leading-snug">Unassigned</h3>
                      <p className="text-xs text-slate-500">Projects without a client</p>
                    </div>
                    <ChevronRight size={16} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 bg-white/60 rounded-xl px-3 py-2 text-center">
                      <p className="text-lg font-bold text-slate-800">{unassignedProjects.length}</p>
                      <p className="text-xs text-slate-500">Projects</p>
                    </div>
                  </div>
                </div>
            </div>

            {/* Client cards */}
            {filtered.map(client => {
              const initials = client.full_name
                ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??';
              return (
                <div
                  key={client.id}
                  onClick={() => navigate(`/admin/clients/${client.id}/projects`)}
                  className="relative bg-white/60 backdrop-blur-glass border border-white/80 rounded-2xl shadow-glass
                             hover:shadow-glass-hover hover:-translate-y-0.5 hover:border-primary-200
                             transition-all duration-200 overflow-hidden group cursor-pointer"
                >
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-400 to-teal-400
                                  opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-teal-500
                                      flex items-center justify-center text-white text-sm font-bold shadow-sm">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-heading font-bold text-slate-800 text-base leading-snug truncate">
                          {client.full_name}
                        </h3>
                        <p className="text-xs text-slate-500 truncate">@{client.username}</p>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                    </div>

                    {/* Stats row */}
                    <div className="flex gap-3">
                      <div className="flex-1 bg-white/60 rounded-xl px-3 py-2 text-center">
                        <p className="text-lg font-bold text-slate-800">{client.projectCount}</p>
                        <p className="text-xs text-slate-500">Projects</p>
                      </div>
                      <div className="flex-1 bg-green-50/60 rounded-xl px-3 py-2 text-center">
                        <p className="text-lg font-bold text-green-700">{client.readyCount}</p>
                        <p className="text-xs text-slate-500">Ready</p>
                      </div>
                      {client.processingCount > 0 && (
                        <div className="flex-1 bg-amber-50/60 rounded-xl px-3 py-2 text-center">
                          <p className="text-lg font-bold text-amber-700">{client.processingCount}</p>
                          <p className="text-xs text-slate-500">Active</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {filtered.length === 0 && unassignedProjects.length === 0 && (
              <div className="sm:col-span-2 xl:col-span-3 glass-card py-16 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
                  <Users size={28} className="text-primary-400" />
                </div>
                <h3 className="font-heading font-bold text-slate-700 text-lg mb-1">No Clients Found</h3>
                <p className="text-slate-400 text-sm max-w-sm">
                  {search ? 'Try adjusting your search.' : 'Create your first client to get started.'}
                </p>
                {isAdmin && !search && (
                  <button className="btn-primary mt-5 gap-2" onClick={() => navigate('/admin/clients')}>
                    <Plus size={16} /> Add Client
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add/Edit Node Modal ──────────────────────────────── */}
      {showNodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white/95 backdrop-blur-glass rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-slide-up">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h3 className="font-heading font-bold text-slate-800 text-lg">
                {editingNode ? 'Edit Processing Node' : 'Add Processing Node'}
              </h3>
              <button onClick={() => setShowNodeModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Label <span className="text-slate-400">(optional)</span></label>
                <input
                  type="text"
                  className="glass-input w-full"
                  placeholder="My GPU Node"
                  value={nodeForm.label}
                  onChange={e => setNodeForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hostname <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  className="glass-input w-full"
                  placeholder="node-odm-1 or 192.168.1.50"
                  value={nodeForm.hostname}
                  onChange={e => setNodeForm(f => ({ ...f, hostname: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Port <span className="text-red-400">*</span></label>
                <input
                  type="number"
                  className="glass-input w-full"
                  placeholder="3000"
                  value={nodeForm.port}
                  onChange={e => setNodeForm(f => ({ ...f, port: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Token <span className="text-slate-400">(optional)</span></label>
                <input
                  type="password"
                  className="glass-input w-full"
                  placeholder="Bearer token for node auth"
                  value={nodeForm.token}
                  onChange={e => setNodeForm(f => ({ ...f, token: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button className="btn-secondary" onClick={() => setShowNodeModal(false)}>Cancel</button>
                <button className="btn-primary gap-2" onClick={handleNodeSave} disabled={nodeSaving}>
                  {nodeSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {nodeSaving ? 'Testing…' : 'Save & Test'}
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
