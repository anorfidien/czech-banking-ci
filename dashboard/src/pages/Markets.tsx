import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { SlidersHorizontal, X, BarChart3, TrendingUp } from 'lucide-react';
import { api } from '../api';
import { cn } from '../utils';

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

interface MetricPoint {
  series_id: string;
  series_name: string;
  category: string;
  date: string;
  value: number;
  unit: string | null;
  competitor_id: string | null;
}

const BANK_COLORS: Record<string, string> = {
  raiffeisenbank: '#eab308',
  ceska_sporitelna: '#3b82f6',
  csob: '#10b981',
  komercni_banka: '#ef4444',
  moneta: '#a855f7',
  fio_banka: '#22c55e',
  unicredit: '#f97316',
};

const BANK_LABELS: Record<string, string> = {
  raiffeisenbank: 'Raiffeisenbank',
  ceska_sporitelna: 'Česká spořitelna',
  csob: 'ČSOB',
  komercni_banka: 'Komerční banka',
  moneta: 'Moneta',
  fio_banka: 'Fio banka',
  unicredit: 'UniCredit',
};

const CATEGORY_LABELS: Record<string, string> = {
  profitability: 'Profitability',
  income: 'Income',
  nii: 'Net Interest Income',
  loans: 'Loans',
  balance_sheet: 'Balance Sheet',
  expenses: 'Expenses',
  operations: 'Operations',
  efficiency: 'Efficiency',
  regulatory: 'Regulatory',
  risk: 'Risk',
  other: 'Other',
};

type ChartMode = 'line' | 'bar';

export default function Markets() {
  const [allSeries, setAllSeries] = useState<SeriesInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [metricsData, setMetricsData] = useState<MetricPoint[]>([]);

  // Selected metric (one at a time for comparison)
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  // Selected banks
  const [selectedBanks, setSelectedBanks] = useState<string[]>(Object.keys(BANK_COLORS));
  // Chart mode
  const [chartMode, setChartMode] = useState<ChartMode>('line');

  // Load available series
  useEffect(() => {
    api.getMetricsSeries().then((series: SeriesInfo[]) => {
      // Only bank-level metrics (with competitor_id)
      const bankSeries = series.filter((s) => s.competitor_id);
      setAllSeries(bankSeries);
      // Default: ROE YTD
      const defaultMetric = bankSeries.find((s) => s.series_id === 'roe_ytd')?.series_id
        || bankSeries[0]?.series_id || '';
      setSelectedMetric(defaultMetric);
    }).finally(() => setLoading(false));
  }, []);

  // Get unique metrics (deduplicate across banks)
  const uniqueMetrics = useMemo(() => {
    const seen = new Map<string, SeriesInfo>();
    for (const s of allSeries) {
      if (!seen.has(s.series_id)) seen.set(s.series_id, s);
    }
    return [...seen.values()];
  }, [allSeries]);

  // Group by category
  const categories = useMemo(() => {
    const cats = new Map<string, SeriesInfo[]>();
    for (const s of uniqueMetrics) {
      if (!cats.has(s.category)) cats.set(s.category, []);
      cats.get(s.category)!.push(s);
    }
    return cats;
  }, [uniqueMetrics]);

  // Fetch data when metric or banks change
  useEffect(() => {
    if (!selectedMetric || selectedBanks.length === 0) {
      setMetricsData([]);
      return;
    }
    setDataLoading(true);
    Promise.all(
      selectedBanks.map((bankId) =>
        api.getMetrics({ series_id: selectedMetric, competitor: bankId })
      )
    ).then((results) => {
      setMetricsData(results.flat());
    }).finally(() => setDataLoading(false));
  }, [selectedMetric, selectedBanks]);

  // Build chart data: pivot by date, one column per bank
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>();
    for (const m of metricsData) {
      if (!m.competitor_id) continue;
      if (!byDate.has(m.date)) byDate.set(m.date, { date: m.date });
      byDate.get(m.date)![m.competitor_id] = m.value;
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [metricsData]);

  // Latest values for the bar chart / summary
  const latestValues = useMemo(() => {
    const latest = new Map<string, { value: number; date: string }>();
    for (const m of metricsData) {
      if (!m.competitor_id) continue;
      const prev = latest.get(m.competitor_id);
      if (!prev || m.date > prev.date) {
        latest.set(m.competitor_id, { value: m.value, date: m.date });
      }
    }
    return latest;
  }, [metricsData]);

  const currentMetricInfo = uniqueMetrics.find((s) => s.series_id === selectedMetric);

  const toggleBank = useCallback((bankId: string) => {
    setSelectedBanks((prev) =>
      prev.includes(bankId) ? prev.filter((b) => b !== bankId) : [...prev, bankId]
    );
  }, []);

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto animate-pulse">
        <div className="bg-white border border-slate-200 rounded-lg h-[500px] shadow-sm" />
      </div>
    );
  }

  if (uniqueMetrics.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto">
        <div className="bg-white border border-slate-200 rounded-lg p-16 shadow-sm text-center">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">
            No bank financial data loaded
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
      {/* Left panel */}
      <div className="col-span-12 lg:col-span-3 space-y-4">
        {/* Bank selector */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-3">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Banks
          </label>
          <div className="space-y-1">
            {Object.entries(BANK_LABELS).map(([id, label]) => {
              const active = selectedBanks.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleBank(id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded text-[10px] font-bold transition-all border',
                    active
                      ? 'border-slate-200 bg-white text-slate-900'
                      : 'border-transparent bg-slate-50 text-slate-400'
                  )}
                >
                  <span
                    className={cn('w-3 h-3 rounded-sm shrink-0 border-2', active ? '' : 'opacity-30')}
                    style={{ backgroundColor: active ? BANK_COLORS[id] : '#e2e8f0', borderColor: BANK_COLORS[id] }}
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-1 pt-1">
            <button
              onClick={() => setSelectedBanks(Object.keys(BANK_COLORS))}
              className="flex-1 py-1.5 bg-slate-50 rounded text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all"
            >
              All
            </button>
            <button
              onClick={() => setSelectedBanks([])}
              className="flex-1 py-1.5 bg-slate-50 rounded text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-all"
            >
              None
            </button>
          </div>
        </div>

        {/* Metric selector by category */}
        {[...categories.entries()].map(([cat, metrics]) => (
          <div key={cat} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {CATEGORY_LABELS[cat] || cat}
            </label>
            <div className="space-y-0.5">
              {metrics.map((m) => (
                <button
                  key={m.series_id}
                  onClick={() => setSelectedMetric(m.series_id)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 rounded text-[10px] font-bold transition-all border',
                    selectedMetric === m.series_id
                      ? 'bg-[#fee600] border-[#fee600] text-black shadow-sm'
                      : 'bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  {m.series_name.replace(/ - YTD| - QTD| - EoP|\(mio CZK\)|\(%\)/g, '').trim()}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Main chart area */}
      <div className="col-span-12 lg:col-span-9 space-y-6">
        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">
                Bank Comparison
              </h2>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">
                {currentMetricInfo?.series_name || 'Select a metric'}
              </h3>
              {currentMetricInfo?.unit && (
                <span className="text-[10px] font-bold text-slate-400">{currentMetricInfo.unit}</span>
              )}
            </div>
            <div className="flex gap-1 bg-slate-100 rounded p-1">
              <button
                onClick={() => setChartMode('line')}
                className={cn(
                  'p-2 rounded transition-all',
                  chartMode === 'line' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
                )}
              >
                <TrendingUp size={14} />
              </button>
              <button
                onClick={() => setChartMode('bar')}
                className={cn(
                  'p-2 rounded transition-all',
                  chartMode === 'bar' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
                )}
              >
                <BarChart3 size={14} />
              </button>
            </div>
          </div>

          <div className="h-[420px]">
            {dataLoading ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-400 animate-pulse">
                Loading...
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-300">
                No data for selected metric & banks
              </div>
            ) : chartMode === 'line' ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    tickFormatter={(d: string) => {
                      const [y, m] = d.split('-');
                      return `Q${Math.ceil(Number(m) / 3)}/${y.slice(2)}`;
                    }}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    width={60}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(1)}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                    labelFormatter={(d) => {
                      const [y, m] = String(d).split('-');
                      return `Q${Math.ceil(Number(m) / 3)} ${y}`;
                    }}
                    formatter={(value: any, name: any) => [
                      `${Number(value).toLocaleString('cs-CZ')} ${currentMetricInfo?.unit || ''}`,
                      BANK_LABELS[name] || name,
                    ]}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-[9px] font-bold uppercase">{BANK_LABELS[value] || value}</span>
                    )}
                  />
                  {selectedBanks.map((bankId) => (
                    <Line
                      key={bankId}
                      type="monotone"
                      dataKey={bankId}
                      stroke={BANK_COLORS[bankId]}
                      strokeWidth={bankId === 'raiffeisenbank' ? 3 : 2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={selectedBanks
                    .filter((b) => latestValues.has(b))
                    .map((b) => ({
                      bank: BANK_LABELS[b] || b,
                      bankId: b,
                      value: latestValues.get(b)!.value,
                    }))
                    .sort((a, b) => b.value - a.value)}
                  margin={{ top: 5, right: 20, bottom: 60, left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="bank"
                    tick={{ fontSize: 9, fontWeight: 900, fill: '#334155' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    width={60}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(1)}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                    formatter={(value: any) => [
                      `${Number(value).toLocaleString('cs-CZ')} ${currentMetricInfo?.unit || ''}`,
                      currentMetricInfo?.series_name,
                    ]}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40} fill="#fee600" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Comparison table */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">
              {currentMetricInfo?.series_name || 'Metric'} — Quarterly Values
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] text-left border-collapse">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100 bg-slate-50/30">
                  <th className="px-4 py-3 font-black uppercase tracking-widest sticky left-0 bg-slate-50/30">Bank</th>
                  {chartData.map((d) => {
                    const [y, m] = String(d.date).split('-');
                    return (
                      <th key={d.date} className="px-3 py-3 font-black uppercase tracking-widest text-right whitespace-nowrap">
                        Q{Math.ceil(Number(m) / 3)}/{y.slice(2)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {selectedBanks.map((bankId) => (
                  <tr key={bankId} className="border-b border-slate-50 hover:bg-yellow-50/30 transition-colors">
                    <td className="px-4 py-2.5 sticky left-0 bg-white">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: BANK_COLORS[bankId] }} />
                        <span className={cn('font-black text-slate-900', bankId === 'raiffeisenbank' && 'text-[#b8960a]')}>
                          {BANK_LABELS[bankId]}
                        </span>
                      </div>
                    </td>
                    {chartData.map((d) => {
                      const val = d[bankId];
                      return (
                        <td key={d.date} className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {val != null ? Number(val).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
