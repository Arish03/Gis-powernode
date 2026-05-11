import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  FolderOpen, Map, BarChart3, Users, Settings, LogOut, 
  Menu, X, Layers3, ShieldAlert, FileText 
} from 'lucide-react';

export default function SidebarLayout({ children, title, subtitle, actions }) {
  const { user, logout, isAdmin, isStaff } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  const initials = user?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??';

  const NavItem = ({ to, icon, label, exact = false }) => {
    const isActive = exact ? location.pathname === to : location.pathname.startsWith(to);
    return (
      <button 
        onClick={() => { navigate(to); setMobileOpen(false); }}
        className={`sidebar-item ${isActive ? 'active' : ''}`}
      >
        <span className="flex-shrink-0 opacity-80">{icon}</span>
        {label}
      </button>
    );
  };

  return (
    <div className="page-bg flex h-screen overflow-hidden">
      {/* Background blobs for Glassmorphism effect */}
      <div className="blob-container">
        <div className="blob blob-green" />
        <div className="blob blob-teal" />
      </div>

      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex sidebar-glass w-[240px] flex-col z-20">
        <div className="p-5 flex items-center gap-3 shrink-0 cursor-pointer select-none" onClick={() => navigate(isStaff ? '/admin' : '/')}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-teal-500 flex items-center justify-center shadow-green-glow-sm">
            <span className="text-white text-sm font-bold">PV</span>
          </div>
          <div className="leading-tight">
            <div className="font-heading font-bold text-slate-800 text-base">PlantView</div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">GIS Platform</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
          {/* Overview Section */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">Overview</div>
            <NavItem to={isStaff ? "/admin" : "/"} exact icon={<FolderOpen size={16} />} label="Dashboard" />
            <NavItem to={isStaff ? "/admin/map" : "/client/map"} icon={<Map size={16} />} label="Live Map" />
            <NavItem to={isStaff ? "/admin/analytics" : "/client/analytics"} icon={<BarChart3 size={16} />} label="Analytics" />
          </div>

          {/* Management Section (Staff Only) */}
          {isStaff && (
            <div className="space-y-1">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">Management</div>
              <NavItem to="/admin/clients" icon={<Users size={16} />} label="Clients" />
              {isAdmin && (
                <NavItem to="/admin/sub-admins" icon={<ShieldAlert size={16} />} label="Sub Admins" />
              )}
            </div>
          )}

          {/* Reports Section */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">Reports</div>
            <NavItem to="/reports" icon={<FileText size={16} />} label="Generated Reports" />
          </div>
        </div>

        <div className="p-4 border-t border-white/60 mt-auto shrink-0 flex items-center gap-3 cursor-pointer hover:bg-white/40 transition-colors" onClick={handleLogout}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-teal-500 flex items-center justify-center text-white text-[11px] font-bold shadow-sm shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{user?.full_name}</div>
            <div className="text-[11px] text-slate-400 capitalize truncate">{user?.role}</div>
          </div>
          <LogOut size={16} className="text-slate-400 hover:text-red-500 transition-colors shrink-0" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 z-10 relative overflow-hidden">
        {/* Topbar */}
        <header className="glass-nav px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <button className="md:hidden text-slate-500 hover:text-slate-700" onClick={() => setMobileOpen(true)}>
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-800 leading-tight">{title}</h1>
              {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {actions}
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto h-full">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="w-[260px] bg-white h-full relative z-10 flex flex-col shadow-2xl animate-slide-right">
            <div className="p-4 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-teal-500 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">PV</span>
                </div>
                <span className="font-heading font-bold text-slate-800 text-lg">PlantView</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-slate-500 p-1">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
               <div className="space-y-1">
                 <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">Overview</div>
                 <NavItem to={isStaff ? "/admin" : "/"} exact icon={<FolderOpen size={16} />} label="Dashboard" />
               </div>
               {isStaff && (
                 <div className="space-y-1">
                   <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">Management</div>
                   <NavItem to="/admin/clients" icon={<Users size={16} />} label="Clients" />
                   {isAdmin && (
                     <NavItem to="/admin/sub-admins" icon={<ShieldAlert size={16} />} label="Sub Admins" />
                   )}
                 </div>
               )}
            </div>
            
            <div className="p-4 border-t border-slate-100 flex items-center gap-3">
              <button onClick={handleLogout} className="btn-danger w-full">
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
