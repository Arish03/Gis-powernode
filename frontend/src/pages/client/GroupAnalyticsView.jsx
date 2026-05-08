import { useEffect, useMemo, useState } from 'react';
import { Tooltip, Legend, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Trees, Activity, TrendingUp, TrendingDown, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import GlassCard from '../../components/ui/GlassCard';
import KpiCard from '../../components/KpiCard';
import WaterfallChart from '../../components/charts/WaterfallChart';
import AnalyticsView from './AnalyticsView';

/**
 * GroupAnalyticsView — dual mode:
 *   'snapshot'  : reuses single-project AnalyticsView on the selected timeline.
 *   'group'     : cross-timeline analytics (delta KPIs, waterfall, time series,
 *                 unified tree list).
 */
export default function GroupAnalyticsView({ group, onLocateTree }) {
  const members = useMemo(
    () => (group?.members || []).slice().sort((a, b) => a.timeline_index - b.timeline_index),
    [group]
  );
  const [mode, setMode] = useState('group');
  const [snapshotIdx, setSnapshotIdx] = useState(Math.max(0, members.length - 1));
  const [analytics, setAnalytics] = useState(null);
  const [unifiedList, setUnifiedList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!group?.id || group.status !== 'READY') { setLoading(false); return; }
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/groups/${group.id}/analytics`),
      api.get(`/groups/${group.id}/unified-trees/list`),
    ]).then(([a, u]) => {
      setAnalytics(a.data);
      const trees = Array.isArray(u.data) ? u.data : (u.data?.trees || []);
      setUnifiedList(trees);
    }).catch(e => {
      console.error('group analytics fetch failed', e);
      setError(e?.response?.data?.detail || e.message || 'Failed to load analytics');
    }).finally(() => setLoading(false));
  }, [group?.id, group?.status]);

  if (!group) return null;

  if (group.status !== 'READY') {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-slate-500">
        <GlassCard className="p-8 text-center max-w-md">
          <Activity size={32} className="text-slate-300 mx-auto mb-3" />
          <h2 className="font-heading font-bold text-slate-800 text-lg mb-1">Group not ready</h2>
          <p className="text-sm">Analytics will appear once matching completes. Current status: <b>{group.status}</b></p>
        </GlassCard>
      </div>
    );
  }

  const currentMember = members[snapshotIdx] || members[members.length - 1];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Mode + timeline selector */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 p-1 bg-white/70 backdrop-blur-md rounded-xl border border-white/80">
          <button onClick={() => setMode('group')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${mode === 'group' ? 'bg-primary-500 text-white' : 'text-slate-600'}`}>
            Group / Compare
          </button>
          <button onClick={() => setMode('snapshot')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${mode === 'snapshot' ? 'bg-primary-500 text-white' : 'text-slate-600'}`}>
            Snapshot
          </button>
        </div>
        {mode === 'snapshot' && (
          <select
            value={snapshotIdx}
            onChange={e => setSnapshotIdx(Number(e.target.value))}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white"
          >
            {members.map((m, i) => (
              <option key={m.id || i} value={i}>
                Timeline T{m.timeline_index}{m.project_name ? ` · ${m.project_name}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {mode === 'snapshot' && currentMember && (
        <AnalyticsView
          projectId={currentMember.project_id}
          projectInfo={{ name: currentMember.project_name }}
        />
      )}

      {mode === 'group' && (
        loading ? (
          <div className="skeleton h-32 w-full" />
        ) : error ? (
          <GlassCard className="p-6 text-sm text-red-600">Failed to load analytics: {error}</GlassCard>
        ) : !analytics ? (
          <div className="text-slate-500 text-sm">No analytics data.</div>
        ) : (
          <GroupModeBody analytics={analytics} unifiedList={unifiedList} members={members} onLocateTree={onLocateTree} />
        )
      )}
    </div>
  );
}

function GroupModeBody({ analytics, unifiedList, members, onLocateTree }) {
  const d = analytics.delta_kpis || {};
  const snaps = analytics.snapshots || [];
  const rawWaterfall = analytics.waterfall || [];
  const series = analytics.time_series || [];

  const projectNameById = useMemo(() => {
    const m = {};
    (members || []).forEach(x => { m[x.project_id] = x.project_name; });
    return m;
  }, [members]);

  // Transform backend waterfall rows [{start,dead,new,end, from_timeline_index, to_timeline_index}]
  // into chart buckets: baseline + (lost negative, new positive) pairs + final total.
  const chartBuckets = useMemo(() => {
    if (!rawWaterfall.length) return [];
    const first = rawWaterfall[0];
    const buckets = [{ label: `T${first.from_timeline_index}`, value: first.start, type: 'base' }];
    rawWaterfall.forEach(r => {
      const pair = `T${r.from_timeline_index}→T${r.to_timeline_index}`;
      if (r.dead) buckets.push({ label: `${pair} lost`, value: -Number(r.dead), type: 'negative' });
      if (r.new) buckets.push({ label: `${pair} new`, value: Number(r.new), type: 'positive' });
    });
    const last = rawWaterfall[rawWaterfall.length - 1];
    buckets.push({ label: `T${last.to_timeline_index}`, value: last.end, type: 'total' });
    return buckets;
  }, [rawWaterfall]);

  const lineData = useMemo(
    () => series.map(p => ({
      label: `T${p.timeline_index}`,
      avg_height: p.average_height,
      health_score: p.health_score,
    })),
    [series]
  );

  const nowSnap = snaps[snaps.length - 1] || {};
  const firstSnap = snaps[0] || {};
  const netDelta = d.net_tree_count ?? ((nowSnap.total_trees || 0) - (firstSnap.total_trees || 0));

  return (
    <>
      <div>
        <h1 className="font-heading font-extrabold text-slate-800 text-3xl tracking-tight mb-1">Group Analytics</h1>
        <p className="text-sm text-slate-500">Cross-timeline changes in canopy, health, and inventory.</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard color="blue"   label="Δ Total trees"  value={formatDelta(netDelta)}                 sub={`Now ${nowSnap.total_trees ?? '—'}`} icon={Trees} />
        <KpiCard color="green"  label="New trees"      value={d.new_count ?? 0}                      sub="Across timelines" icon={TrendingUp} />
        <KpiCard color="red"    label="Missing trees"  value={d.mortality_count ?? 0}                sub={`Mortality ${(d.mortality_rate ?? 0).toFixed ? d.mortality_rate.toFixed(1) : '0.0'}%`} icon={TrendingDown} />
        <KpiCard color="purple" label="Δ Health"       value={formatDelta(d.health_score_delta, '%')} sub={`Now ${nowSnap.health_score != null ? Math.round(nowSnap.health_score) + '%' : '—'}`} icon={Activity} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <GlassCard className="p-6">
          <h3 className="font-heading font-bold text-slate-800 text-lg mb-4">Inventory Waterfall</h3>
          {chartBuckets.length ? (
            <WaterfallChart buckets={chartBuckets} />
          ) : (
            <p className="text-sm text-slate-500">Not enough timelines.</p>
          )}
        </GlassCard>
        <GlassCard className="p-6">
          <h3 className="font-heading font-bold text-slate-800 text-lg mb-4">Health &amp; Height Over Time</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="health_score" name="Health %" stroke="#16a34a" strokeWidth={2} />
                <Line type="monotone" dataKey="avg_height" name="Avg Height (m)" stroke="#2563eb" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>

      {snaps.length > 0 && (
        <GlassCard className="p-6">
          <h3 className="font-heading font-bold text-slate-800 text-lg mb-4">Per-Timeline Snapshots</h3>
          <div className="overflow-x-auto">
            <table className="glass-table w-full">
              <thead>
                <tr>
                  <th className="pl-4">Timeline</th>
                  <th>Project</th>
                  <th>Total trees</th>
                  <th>Avg height (m)</th>
                  <th>Health score</th>
                  <th>Area (ha)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {snaps.map(s => (
                  <tr key={s.timeline_index}>
                    <td className="pl-4 py-2 font-mono text-xs">T{s.timeline_index}</td>
                    <td className="py-2 text-sm">{projectNameById[s.project_id] || '—'}</td>
                    <td className="py-2">{s.total_trees}</td>
                    <td className="py-2 font-mono text-xs">{s.average_height != null ? Number(s.average_height).toFixed(2) : '—'}</td>
                    <td className="py-2">{s.health_score != null ? `${Math.round(s.health_score)}%` : '—'}</td>
                    <td className="py-2 font-mono text-xs">{s.area_hectares != null ? Number(s.area_hectares).toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <UnifiedTreeTable items={unifiedList} members={members} onLocateTree={onLocateTree} />
    </>
  );
}

// ── formatDelta ─────────────────────────────────────────────
function formatDelta(v, suffix = '') {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  const sign = n > 0 ? '+' : '';
  return `${sign}${Math.round(n)}${suffix}`;
}

// ── Health helpers ──────────────────────────────────────────
const HEALTH_ABBR = { Healthy: 'H', Moderate: 'M', Poor: 'P' };
const HEALTH_COLOR = {
  Healthy: 'text-green-600 bg-green-50',
  Moderate: 'text-amber-600 bg-amber-50',
  Poor: 'text-red-600 bg-red-50',
};

function ObsBox({ label, obs }) {
  if (!obs || obs.observation_type === 'MISSING') {
    return (
      <div className="flex-none w-[68px] rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-center">
        <div className="text-[10px] font-bold text-slate-500 mb-0.5">{label}</div>
        <div className="text-[10px] text-slate-400">—</div>
        <div className="text-[9px] font-semibold text-red-400 mt-0.5">MISS</div>
      </div>
    );
  }
  const isNew = obs.observation_type === 'NEW';
  const hc = HEALTH_COLOR[obs.health_status] || 'text-slate-500 bg-slate-100';
  return (
    <div className={`flex-none w-[68px] rounded-lg border p-1.5 text-center shadow-sm ${isNew ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-[10px] font-bold text-slate-500 mb-0.5">{label}{isNew && <span className="ml-0.5 text-blue-500">★</span>}</div>
      <div className="text-[11px] font-mono font-semibold text-slate-700">
        {obs.height_m != null ? `${Number(obs.height_m).toFixed(1)}m` : '—'}
      </div>
      {obs.health_status ? (
        <span className={`inline-block mt-0.5 px-1 rounded text-[9px] font-bold ${hc}`}>
          {HEALTH_ABBR[obs.health_status] || obs.health_status[0]}
        </span>
      ) : (
        <span className="text-[9px] text-slate-400 mt-0.5">—</span>
      )}
    </div>
  );
}

function DeltaArrow({ from, to }) {
  const fromOk = from?.observation_type !== 'MISSING';
  const toOk = to?.observation_type !== 'MISSING';
  const hDelta = fromOk && toOk && from?.height_m != null && to?.height_m != null
    ? Number(to.height_m) - Number(from.height_m) : null;
  const healthChanged = fromOk && toOk && from?.health_status && to?.health_status && from.health_status !== to.health_status;

  return (
    <div className="flex-none w-10 flex flex-col items-center justify-center gap-0.5 shrink-0">
      {hDelta != null && (
        <span className={`text-[9px] font-bold leading-none ${hDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {hDelta >= 0 ? '+' : ''}{hDelta.toFixed(1)}m
        </span>
      )}
      <span className="text-slate-300 text-sm leading-none">→</span>
      {healthChanged && (
        <span className="text-[8px] font-semibold text-amber-600 leading-none">
          {HEALTH_ABBR[from.health_status] || '?'}→{HEALTH_ABBR[to.health_status] || '?'}
        </span>
      )}
    </div>
  );
}

function TimelineBar({ observations, sortedMembers }) {
  const obsByIdx = {};
  (observations || []).forEach(o => { obsByIdx[o.timeline_index] = o; });
  return (
    <div className="flex items-center overflow-x-auto pb-0.5">
      {sortedMembers.map((m, i) => {
        const obs = obsByIdx[m.timeline_index];
        const prevObs = i > 0 ? obsByIdx[sortedMembers[i - 1].timeline_index] : null;
        return (
          <div key={m.timeline_index} className="flex items-center">
            {i > 0 && <DeltaArrow from={prevObs} to={obs} />}
            <ObsBox label={`T${m.timeline_index}`} obs={obs} />
          </div>
        );
      })}
    </div>
  );
}

const STATUS_STYLE = {
  PERSISTED: 'bg-emerald-100 text-emerald-700',
  MISSING: 'bg-red-100 text-red-700',
  NEW: 'bg-blue-100 text-blue-700',
};

const PAGE_SIZE = 25;

function UnifiedTreeTable({ items, members, onLocateTree }) {
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const list = Array.isArray(items) ? items : [];
  const sortedMembers = useMemo(
    () => (members || []).slice().sort((a, b) => a.timeline_index - b.timeline_index),
    [members],
  );
  const filtered = useMemo(() => {
    if (filter === 'ALL') return list;
    return list.filter(t => t.current_status === filter);
  }, [filter, list]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleFilter = (v) => { setFilter(v); setPage(0); };

  return (
    <GlassCard className="overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading font-bold text-slate-800 text-lg leading-tight">Unified Tree Registry</h3>
          <p className="text-xs text-slate-500 mt-0.5">{filtered.length} of {list.length} unified trees</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {['ALL', 'PERSISTED', 'MISSING', 'NEW'].map(v => (
            <button key={v} onClick={() => handleFilter(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${filter === v ? 'bg-primary-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-2 flex items-center gap-4 text-[10px] text-slate-500 border-b border-slate-50 bg-slate-50/50">
        <span className="font-bold text-slate-400 uppercase tracking-wider">Legend:</span>
        <span><span className="font-bold text-green-600">+0.5m</span> / <span className="text-red-500 font-bold">-0.3m</span> — height delta</span>
        <span><span className="font-bold text-amber-600">H→M</span> — health change</span>
        <span><span className="font-bold text-blue-500">★</span> — newly appeared tree</span>
        <span><span className="font-semibold text-red-400">MISS</span> — undetected at that survey</span>
      </div>

      <div className="divide-y divide-slate-50">
        {pageItems.length === 0 && (
          <div className="p-10 text-center text-sm text-slate-400">No trees match this filter.</div>
        )}
        {pageItems.map(tree => (
          <div key={tree.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/50 transition-colors">
            {/* Unified Tree ID */}
            <div className="flex-none w-16 text-center">
              <span className="inline-block font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">
                UT #{tree.unified_index}
              </span>
            </div>

            {/* Timeline Bar */}
            <div className="flex-1 min-w-0">
              <TimelineBar observations={tree.observations || []} sortedMembers={sortedMembers} />
            </div>

            {/* Current Status */}
            <div className="flex-none">
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${STATUS_STYLE[tree.current_status] || 'bg-slate-100 text-slate-600'}`}>
                {tree.current_status}
              </span>
            </div>

            {/* Locate on Map */}
            <div className="flex-none">
              <button
                onClick={() => onLocateTree && onLocateTree(tree)}
                disabled={!onLocateTree}
                title="Locate on map"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-40 transition-colors"
              >
                <MapPin size={12} /> Locate
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <span className="text-xs text-slate-500">
            Page {page + 1} of {totalPages} · {filtered.length} trees
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 text-slate-600">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 text-slate-600">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
