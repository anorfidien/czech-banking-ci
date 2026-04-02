import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api';
import { cn } from '../utils';

interface MetricPoint {
  id: number;
  source: string;
  series_id: string;
  series_name: string;
  category: string;
  date: string;
  value: number;
  unit: string | null;
  competitor_id: string | null;
  captured_at: string;
}

interface SeriesInfo {
  series_id: string;
  series_name: string;
  category: string;
  unit: string | null;
  competitor_id: string | null;
  points: number;
  first_date: string;
  last_date: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  rates: 'Interest Rates',
  fx: 'Exchange Rates',
  macro: 'Macro Indicators',
  banking: 'Banking Sector',
};

const LINE_COLORS = [
  '#eab308', '#3b82f6', '#ef4444', '#10b981', '#6366f1',
  '#f97316', '#06b6d4', '#a855f7', '#f43f5e', '#22c55e',
];

export default function Markets() {
  const [allSeries, setAllSeries] = useState<SeriesInfo[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);
  const [metricsData, setMetricsData] = useState<MetricPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  // Date range slider
  const [dateRange, setDateRange] = useState<[string, string]>(['2023-01-01', '2026-12-31']);

  // Load available series
  useEffect(() => {
    api.getMetricsSeries().then((series) => {
      setAllSeries(series);
      // Auto-select first 2 series if available
      const initial = series.slice(0, 2).map((s: SeriesInfo) => s.series_id);
      setSelectedSeries(initial);
      // Set date range from data
      if (series.length > 0) {
        const minDate = series.reduce((m: string, s: SeriesInfo) => s.first_date < m ? s.first_date : m, series[0].first_date as string);
        const maxDate = series.reduce((m: string, s: SeriesInfo) => s.last_date > m ? s.last_date : m, series[0].last_date as string);
        setDateRange([minDate, maxDate]);
      }
    }).finally(() => setLoading(false));
  }, []);

  // Fetch data when selection or range changes
  useEffect(() => {
    if (selectedSeries.length === 0) {
      setMetricsData([]);
      return;
    }
    setDataLoading(true);
    Promise.all(
      selectedSeries.map((sid) =>
        api.getMetrics({ series_id: sid, since: dateRange[0], until: dateRange[1] })
      )
    ).then((results) => {
      setMetricsData(results.flat());
    }).finally(() => setDataLoading(false));
  }, [selectedSeries, dateRange]);

  // Group by category
  const categories = useMemo(() => {
    const cats = new Map<string, SeriesInfo[]>();
    for (const s of allSeries) {
      const cat = s.category;
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat)!.push(s);
    }
    return cats;
  }, [allSeries]);

  // Build chart data: merge all series by date
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const m of metricsData) {
      if (!byDate.has(m.date)) byDate.set(m.date, { date: m.date } as any);
      byDate.get(m.date)![m.series_id] = m.value;
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [metricsData]);

  // Get units for selected series (for Y-axis labeling)
  const selectedUnits = useMemo(() => {
    const units = new Set<string>();
    for (const sid of selectedSeries) {
      const s = allSeries.find((x) => x.series_id === sid);
      if (s?.unit) units.add(s.unit);
    }
    return [...units];
  }, [selectedSeries, allSeries]);

  const toggleSeries = (sid: string) => {
    setSelectedSeries((prev) =>
      prev.includes(sid) ? prev.filter((s) => s !== sid) : [...prev, sid]
    );
  };

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto animate-pulse">
        <div className="bg-white border border-slate-200 rounded-lg h-[500px] shadow-sm" />
      </div>
    );
  }

  if (allSeries.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto">
        <div className="bg-white border border-slate-200 rounded-lg p-16 shadow-sm text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">
            No market data collected yet
          </div>
          <code className="text-xs font-mono bg-slate-100 px-3 py-1.5 rounded text-slate-500">
            ci-monitor collect --source market
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto grid grid-cols-12 gap-6">
      {/* Left panel: series selector + date range */}
      <div className="col-span-12 lg:col-span-3 space-y-4">
        {/* Date range */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-[#e6cf00]" />
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date Range</label>
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-[9px] font-bold text-slate-400 uppercase">From</label>
              <input
                type="date"
                value={dateRange[0]}
                onChange={(e) => setDateRange([e.target.value, dateRange[1]])}
                className="w-full bg-slate-50 border border-slate-200 rounded py-1.5 px-2 text-[10px] font-bold text-slate-900 focus:outline-none focus:border-[#fee600]"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-400 uppercase">To</label>
              <input
                type="date"
                value={dateRange[1]}
                onChange={(e) => setDateRange([dateRange[0], e.target.value])}
                className="w-full bg-slate-50 border border-slate-200 rounded py-1.5 px-2 text-[10px] font-bold text-slate-900 focus:outline-none focus:border-[#fee600]"
              />
            </div>
          </div>
          {/* Quick presets */}
          <div className="flex flex-wrap gap-1">
            {[
              { label: '1Y', months: 12 },
              { label: '2Y', months: 24 },
              { label: '3Y', months: 36 },
              { label: 'All', months: 0 },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  if (p.months === 0) {
                    const minD = allSeries.reduce((m, s) => s.first_date < m ? s.first_date : m, allSeries[0].first_date);
                    const maxD = allSeries.reduce((m, s) => s.last_date > m ? s.last_date : m, allSeries[0].last_date);
                    setDateRange([minD, maxD]);
                  } else {
                    const end = new Date();
                    const start = new Date();
                    start.setMonth(start.getMonth() - p.months);
                    setDateRange([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]);
                  }
                }}
                className="px-2 py-1 rounded text-[9px] font-black border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Series selector */}
        {[...categories.entries()].map(([cat, series]) => (
          <div key={cat} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {CATEGORY_LABELS[cat] || cat}
            </label>
            <div className="space-y-1">
              {series.map((s, i) => {
                const isSelected = selectedSeries.includes(s.series_id);
                const colorIdx = selectedSeries.indexOf(s.series_id);
                return (
                  <button
                    key={s.series_id}
                    onClick={() => toggleSeries(s.series_id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded text-[10px] font-bold transition-all border flex items-center gap-2',
                      isSelected
                        ? 'bg-slate-800 border-slate-800 text-white shadow-sm'
                        : 'bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                    )}
                  >
                    {isSelected && (
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: LINE_COLORS[colorIdx % LINE_COLORS.length] }}
                      />
                    )}
                    <span className="truncate">{s.series_name}</span>
                    <span className="text-[8px] ml-auto opacity-60 shrink-0">{s.points}pts</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {selectedSeries.length > 0 && (
          <button
            onClick={() => setSelectedSeries([])}
            className="w-full py-2.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-all flex items-center justify-center gap-1"
          >
            <X size={10} /> Clear Selection
          </button>
        )}
      </div>

      {/* Main chart area */}
      <div className="col-span-12 lg:col-span-9 space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
              Market Data — {selectedSeries.length} Series Selected
            </h2>
            {selectedUnits.length > 0 && (
              <div className="text-[9px] font-bold text-slate-400">
                Units: {selectedUnits.join(', ')}
              </div>
            )}
          </div>

          <div className="h-[450px]">
            {selectedSeries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-300">
                Select series from the left panel
              </div>
            ) : dataLoading ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-400 animate-pulse">
                Loading data...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    tickFormatter={(d: string) => d.slice(2, 10)}
                    axisLine={{ stroke: '#e2e8f0' }}
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    width={50}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 6,
                      border: '1px solid #e2e8f0',
                    }}
                    labelFormatter={(d) => `${d}`}
                    formatter={(value, name) => {
                      const s = allSeries.find((x) => x.series_id === name);
                      return [
                        `${Number(value).toFixed(2)} ${s?.unit || ''}`,
                        s?.series_name || name,
                      ];
                    }}
                  />
                  <Legend
                    formatter={(value: string) => {
                      const s = allSeries.find((x) => x.series_id === value);
                      return <span className="text-[9px] font-bold uppercase">{s?.series_name || value}</span>;
                    }}
                  />
                  {selectedSeries.map((sid, i) => (
                    <Line
                      key={sid}
                      type="monotone"
                      dataKey={sid}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Data summary table */}
        {selectedSeries.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">
                Series Summary
              </h3>
            </div>
            <table className="w-full text-[10px] text-left border-collapse">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100 bg-slate-50/30">
                  <th className="px-6 py-3 font-black uppercase tracking-widest">Series</th>
                  <th className="px-6 py-3 font-black uppercase tracking-widest">Category</th>
                  <th className="px-6 py-3 font-black uppercase tracking-widest text-right">Latest</th>
                  <th className="px-6 py-3 font-black uppercase tracking-widest text-right">Min</th>
                  <th className="px-6 py-3 font-black uppercase tracking-widest text-right">Max</th>
                  <th className="px-6 py-3 font-black uppercase tracking-widest text-right">Points</th>
                  <th className="px-6 py-3 font-black uppercase tracking-widest">Range</th>
                </tr>
              </thead>
              <tbody>
                {selectedSeries.map((sid, i) => {
                  const info = allSeries.find((s) => s.series_id === sid);
                  const points = metricsData.filter((m) => m.series_id === sid);
                  const values = points.map((p) => p.value);
                  const latest = points.length > 0 ? points[points.length - 1] : null;
                  return (
                    <tr key={sid} className="border-b border-slate-50">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }}
                          />
                          <span className="font-bold text-slate-900">{info?.series_name || sid}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-slate-500 uppercase">{info?.category}</td>
                      <td className="px-6 py-3 text-right font-mono font-black text-slate-900">
                        {latest ? `${latest.value.toFixed(2)} ${info?.unit || ''}` : '—'}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-slate-500">
                        {values.length > 0 ? Math.min(...values).toFixed(2) : '—'}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-slate-500">
                        {values.length > 0 ? Math.max(...values).toFixed(2) : '—'}
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-slate-900">{points.length}</td>
                      <td className="px-6 py-3 text-slate-500 font-mono">
                        {info?.first_date?.slice(0, 7)} — {info?.last_date?.slice(0, 7)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
