import { useMemo } from 'react';

/**
 * TimelineSlider — horizontal slider pinned over a map.
 * @param {Array} members  [{ timeline_index, project_id, project_name, flight_date }]
 * @param {number} value   current timeline_index
 * @param {Function} onChange
 */
export default function TimelineSlider({ members = [], value, onChange, className = '' }) {
  const sorted = useMemo(
    () => [...members].sort((a, b) => a.timeline_index - b.timeline_index),
    [members]
  );
  if (sorted.length === 0) return null;
  const current = sorted.find(m => m.timeline_index === value) || sorted[0];

  return (
    <div className={`bg-white/85 backdrop-blur-lg border border-white/80 rounded-2xl shadow-glass px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Timeline</span>
        <span className="text-xs text-slate-400">
          {current.flight_date ? new Date(current.flight_date).toLocaleDateString() : `T${current.timeline_index}`}
          {` · ${current.project_name || 'Project'}`}
        </span>
      </div>
      <div className="relative pt-2 pb-6">
        <input
          type="range"
          min={sorted[0].timeline_index}
          max={sorted[sorted.length - 1].timeline_index}
          step={1}
          value={value ?? sorted[0].timeline_index}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-primary-500"
        />
        <div className="absolute inset-x-0 bottom-0 flex justify-between px-1 text-[10px] text-slate-400">
          {sorted.map(m => (
            <button
              key={m.timeline_index}
              onClick={() => onChange(m.timeline_index)}
              className={`font-medium transition-colors ${
                m.timeline_index === value ? 'text-primary-600' : 'hover:text-slate-600'
              }`}
            >
              T{m.timeline_index}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
