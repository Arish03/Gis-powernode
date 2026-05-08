import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

/**
 * WaterfallChart — stacked-bar waterfall using transparent spacer bars.
 *
 * Input buckets: [{ label, value, type: 'base'|'positive'|'negative'|'total' }, ...]
 * We transform them into rows with { label, spacer, delta, total, fill } where
 * `spacer` is rendered transparent and `delta` is the visible portion.
 */
export default function WaterfallChart({ buckets = [], height = 280 }) {
  if (!buckets.length) return null;

  // Compute running cumulative sum; first and last are absolute (base/total)
  let cum = 0;
  const data = buckets.map((b, i) => {
    const isAbs = b.type === 'base' || b.type === 'total';
    const v = Number(b.value) || 0;
    if (isAbs) {
      cum = v;
      return { label: b.label, spacer: 0, delta: v, _type: b.type, _display: v };
    }
    if (v >= 0) {
      const row = { label: b.label, spacer: cum, delta: v, _type: 'positive', _display: v };
      cum += v;
      return row;
    } else {
      const newCum = cum + v; // v is negative
      const row = { label: b.label, spacer: newCum, delta: -v, _type: 'negative', _display: v };
      cum = newCum;
      return row;
    }
  });

  const colorFor = (t) => {
    switch (t) {
      case 'base': return '#64748b';
      case 'positive': return '#16a34a';
      case 'negative': return '#dc2626';
      case 'total': return '#2563eb';
      default: return '#94a3b8';
    }
  };

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
          <Tooltip
            cursor={{ fill: 'rgba(59,130,246,0.05)' }}
            formatter={(_, __, { payload }) => [payload._display, payload.label]}
            contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}
          />
          <Bar dataKey="spacer" stackId="a" fill="transparent" />
          <Bar dataKey="delta" stackId="a" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={colorFor(d._type)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
