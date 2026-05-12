import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import ProjectWizard from './pages/admin/ProjectWizard';
import AdminClients from './pages/admin/AdminClients';
import AdminSubAdmins from './pages/admin/AdminSubAdmins';
import ProjectEdit from './pages/admin/ProjectEdit';
import ClientProjects from './pages/admin/ClientProjects';
import GroupProjectWizard from './pages/admin/GroupProjectWizard';
import AdminGroupView from './pages/admin/AdminGroupView';
import GroupProjectsList from './pages/admin/GroupProjectsList';
import ClientGroupPortal from './pages/client/ClientGroupPortal';
import ClientGroupsList from './pages/client/ClientGroupsList';
import MapView from './pages/client/MapView';
import AnalyticsView from './pages/client/AnalyticsView';
import PowerlineAnnotator from './pages/admin/PowerlineAnnotator';
import PowerlineSummary from './pages/admin/PowerlineSummary';
import PowerlineReportView from './pages/client/PowerlineReportView';

// New Pages
import ProcessingNodes from './pages/admin/ProcessingNodes';
import PlantationProjects from './pages/admin/PlantationProjects';
import PowerlineProjects from './pages/admin/PowerlineProjects';
import PlantationWizard from './pages/admin/PlantationWizard';
import PowerlineWizard from './pages/admin/PowerlineWizard';

// Layout shim for Client Portal
import { useState, useEffect } from 'react';
import { FolderOpen, ArrowLeft, Layers3 } from 'lucide-react';
import api from './api/client';
import SidebarLayout from './components/SidebarLayout';
import TopbarActions from './components/TopbarActions';

function ClientPortal() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [activeView, setActiveView] = useState('map');
  const [loading, setLoading] = useState(true);
  const [groupCount, setGroupCount] = useState(0);

  const { user } = useAuth(); // Needed to check if user is admin
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await api.get('/projects');
        setProjects(res.data.projects);
        if (res.data.projects.length > 0) {
          setSelectedProjectId(res.data.projects[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch projects', err);
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
    api.get('/groups').then(r => {
      const data = r.data;
      const list = Array.isArray(data) ? data : (data?.groups || []);
      setGroupCount(list.length);
    }).catch(() => {});
  }, []);

  // Root redirect for staff (admin + sub-admin)
  const role = user?.role?.toUpperCase();
  if (role === 'ADMIN' || role === 'SUB_ADMIN') {
    return <Navigate to="/admin" replace />;
  }

  if (loading) return (
    <div className="page-bg flex items-center justify-center">
      <div className="spinner" />
    </div>
  );

  if (projects.length === 0) {
    return (
      <SidebarLayout title="Client Portal">
        <div className="flex justify-center py-16">
          <div className="bg-white/70 backdrop-blur-xl border border-white/90 rounded-2xl shadow-glass p-12 flex flex-col items-center text-center max-w-lg">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <FolderOpen size={28} className="text-slate-400" />
            </div>
            <h2 className="font-heading font-bold text-slate-800 text-xl mb-2">No Projects Found</h2>
            <p className="text-sm text-slate-500">You don't have any projects assigned yet. Please contact your system administrator to get started.</p>
            {groupCount > 0 && (
              <button
                onClick={() => navigate('/client/groups')}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl
                           bg-gradient-to-r from-primary-500 to-teal-500 text-white text-sm font-semibold"
              >
                <Layers3 size={16} /> View {groupCount} Group {groupCount === 1 ? 'Analysis' : 'Analyses'}
              </button>
            )}
          </div>
        </div>
      </SidebarLayout>
    );
  }

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const isPowerline = selectedProject?.project_type === 'POWERLINE';

  return (
    <SidebarLayout
      title="Client Portal"
      actions={
        <TopbarActions
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={setSelectedProjectId}
          activeView={activeView}
          onViewChange={setActiveView}
          showViewToggle={!!selectedProjectId && !isPowerline}
          showProjectSelector={true}
        />
      }
    >
      <div className="flex flex-col h-[calc(100vh-120px)] space-y-4">
        {groupCount > 0 && (
          <div className="shrink-0">
            <button
              onClick={() => navigate('/client/groups')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl
                         bg-gradient-to-r from-primary-500 to-teal-500 text-white text-sm font-semibold
                         shadow-green-glow-sm hover:shadow-green-glow transition"
            >
              <Layers3 size={16} />
              View Group Analyses
              <span className="px-1.5 py-0.5 rounded-md bg-white/25 text-xs font-bold">{groupCount}</span>
            </button>
          </div>
        )}
        <div className="flex-1 relative rounded-2xl overflow-hidden glass-card p-1">
          {isPowerline ? (
            <PowerlineReportView projectId={selectedProjectId} projectInfo={selectedProject} />
          ) : activeView === 'map' ? (
            <MapView projectId={selectedProjectId} projectInfo={selectedProject} />
          ) : (
            <AnalyticsView projectId={selectedProjectId} projectInfo={selectedProject} onLocateOnMap={() => setActiveView('map')} />
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}

function AdminProjectView() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [activeView, setActiveView] = useState('map');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/projects/${projectId}`)
      .then(res => setProject(res.data))
      .catch(err => console.error('Failed to fetch project', err))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return (
    <div className="page-bg flex items-center justify-center min-h-screen">
      <div className="spinner" />
    </div>
  );

  if (!project) return (
    <SidebarLayout title="Project View">
      <div className="text-center py-16">
        <p className="text-red-500 font-bold">Project not found</p>
        <button onClick={() => navigate('/admin')} className="btn-secondary mt-4">Back to Admin</button>
      </div>
    </SidebarLayout>
  );

  return (
    <SidebarLayout
      title={project.name || "Project View"}
      actions={
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const clientId = project.client_id;
              navigate(clientId ? `/admin/clients/${clientId}/projects` : '/admin');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                       bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm
                       text-xs font-semibold text-slate-600 hover:bg-white hover:text-slate-800 transition-all"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <TopbarActions
            projects={[project]}
            selectedProjectId={project.id}
            onProjectChange={() => {}}
            activeView={activeView}
            onViewChange={setActiveView}
            showViewToggle={project.project_type !== 'POWERLINE'}
            showProjectSelector={false}
          />
        </div>
      }
    >
      <div className="flex-1 relative rounded-2xl overflow-hidden glass-card p-1 h-[calc(100vh-120px)]">
        {project.project_type === 'POWERLINE' ? (
          <PowerlineReportView projectId={project.id} projectInfo={project} adminPreview />
        ) : activeView === 'map' ? (
          <MapView projectId={project.id} projectInfo={project} />
        ) : (
          <AnalyticsView projectId={project.id} projectInfo={project} onLocateOnMap={() => setActiveView('map')} />
        )}
      </div>
    </SidebarLayout>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          {/* Staff Routes (ADMIN + SUB_ADMIN) */}
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute requiredRole="staff">
                <AdminDashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/new" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ProjectWizard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/:projectId/wizard" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ProjectWizard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/plantation" 
            element={
              <ProtectedRoute requiredRole="staff">
                <PlantationProjects />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/plantation/new" 
            element={
              <ProtectedRoute requiredRole="staff">
                <PlantationWizard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/powerline" 
            element={
              <ProtectedRoute requiredRole="staff">
                <PowerlineProjects />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/powerline/new" 
            element={
              <ProtectedRoute requiredRole="staff">
                <PowerlineWizard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/processing-nodes" 
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <ProcessingNodes />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/clients" 
            element={
              <ProtectedRoute requiredRole="staff">
                <AdminClients />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/sub-admins" 
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <AdminSubAdmins />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/clients/:clientId/projects" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ClientProjects />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/:projectId/edit" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ProjectEdit />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/:projectId/view" 
            element={
              <ProtectedRoute requiredRole="staff">
                <AdminProjectView />
              </ProtectedRoute>
            } 
          />
          <Route
            path="/admin/projects/:projectId/powerline/annotate"
            element={
              <ProtectedRoute requiredRole="staff">
                <PowerlineAnnotator />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/projects/:projectId/powerline/summary"
            element={
              <ProtectedRoute requiredRole="staff">
                <PowerlineSummary />
              </ProtectedRoute>
            }
          />

          {/* Group Routes */}
          <Route
            path="/admin/groups/new"
            element={
              <ProtectedRoute requiredRole="staff">
                <GroupProjectWizard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/groups/:groupId/view"
            element={
              <ProtectedRoute requiredRole="staff">
                <AdminGroupView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/clients/:clientId/groups"
            element={
              <ProtectedRoute requiredRole="staff">
                <GroupProjectsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/client/groups"
            element={
              <ProtectedRoute>
                <ClientGroupsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/client/groups/:groupId"
            element={
              <ProtectedRoute>
                <ClientGroupPortal />
              </ProtectedRoute>
            }
          />

          {/* Client Routes */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <ClientPortal />
              </ProtectedRoute>
            } 
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
