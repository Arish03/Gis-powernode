import React, { useState } from 'react';
import { Map, BarChart3, ChevronDown } from 'lucide-react';

export function ViewBtn({ children, active, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold
                  transition-all duration-150
        ${active
          ? 'bg-primary-600 text-white shadow-green-glow-sm'
          : 'text-slate-500 hover:text-slate-700'}`}
    >
      {icon}{children}
    </button>
  );
}

export default function TopbarActions({
  projects = [],
  selectedProjectId,
  onProjectChange,
  activeView,
  onViewChange,
  showViewToggle = false,
  showProjectSelector = false,
}) {
  const [projectDropOpen, setProjectDropOpen] = useState(false);
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="flex items-center gap-3">
      {showProjectSelector && projects.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setProjectDropOpen(!projectDropOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200
                       bg-white/70 backdrop-blur-sm text-sm font-medium text-slate-700
                       hover:border-primary-300 transition-all min-w-40 max-w-56"
          >
            <span className="truncate">{selectedProject?.name || 'Select Project'}</span>
            <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${projectDropOpen ? 'rotate-180' : ''}`} />
          </button>
          {projectDropOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProjectDropOpen(false)} />
              <div className="absolute top-full right-0 mt-1 w-64 bg-white/95 backdrop-blur-sm
                              border border-slate-200 rounded-xl shadow-glass-hover py-1 z-50">
                {projects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { onProjectChange(p.id); setProjectDropOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors
                      ${p.id === selectedProjectId
                        ? 'text-primary-700 bg-primary-50 font-medium'
                        : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showViewToggle && (
        <div className="flex bg-slate-100/80 rounded-full p-1 border border-slate-200/60">
          <ViewBtn active={activeView === 'map'} onClick={() => onViewChange('map')} icon={<Map size={13} />}>
            Map
          </ViewBtn>
          <ViewBtn active={activeView === 'analytics'} onClick={() => onViewChange('analytics')} icon={<BarChart3 size={13} />}>
            Analytics
          </ViewBtn>
        </div>
      )}
    </div>
  );
}
