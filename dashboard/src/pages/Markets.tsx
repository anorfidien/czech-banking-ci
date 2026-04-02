import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area,
} from 'recharts';
import { ChevronDown, ChevronRight, BarChart3, TrendingUp } from 'lucide-react';
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
  detailed_profitability: 'Detailed P&L',
  detailed_income: 'Detailed Income',
  detailed_expenses: 'Detailed Expenses',
  detailed_balance_sheet: 'Detailed BS',
  detailed_loans: 'Detailed Loans',
  detailed_nii: 'Detailed NII',
  detailed_risk: 'Detailed Risk',
  other: 'Other',
};

// Single loan metric — drill-down shows the breakdown
const LOAN_METRIC_ID = 'loans_total';

const DRILLDOWN_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1',
  '#06b6d4', '#a855f7', '#f43f5e', '#22c55e', '#f97316',
  '#84cc16', '#e879f9', '#fb923c', '#38bdf8', '#c084fc',
];

type ChartMode = 'line' | 'bar';

export default function Markets() {
  const [allSeries, setAllSeries] = useState<SeriesInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [metricsData, setMetricsData] = useState<any[]>([]);

  const [selectedMetric, setSelectedMetric] = useState<string>('');
  const [selectedBanks, setSelectedBanks] = useState<string[]>(Object.keys(BANK_COLORS));
  const [chartMode, setChartMode] = useState<ChartMode>('line');

  // Loan drill-down state
  const [loanDrillLevel, setLoanDrillLevel] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<any[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const HIDDEN_CATEGORIES = useMemo(() => new Set(['loan_drilldown', 'loans_growth']), []);

  useEffect(() => {
    api.getMetricsSeries().then((series: SeriesInfo[]) => {
      const bankSeries = series.filter((s) => s.competitor_id && !HIDDEN_CATEGORIES.has(s.category));
      setAllSeries(bankSeries);
      const def = bankSeries.find((s) => s.series_id === 'roe_ytd')?.series_id || bankSeries[0]?.series_id || '';
      setSelectedMetric(def);
    }).finally(() => setLoading(false));
  }, []);

  const uniqueMetrics = useMemo(() => {
    const seen = new Map<string, SeriesInfo>();
    for (const s of allSeries) {
      if (!seen.has(s.series_id)) seen.set(s.series_id, s);
    }
    return [...seen.values()];
  }, [allSeries]);

  // Group by category, but merge all loan-related into single "Loans" entry
  const categories = useMemo(() => {
    const cats = new Map<string, SeriesInfo[]>();
    const loanIds = new Set([LOAN_METRIC_ID, 'loans_retail', 'loans_commercial', 'mortgages']);

    for (const s of uniqueMetrics) {
      if (loanIds.has(s.series_id)) continue;
      if (!cats.has(s.category)) cats.set(s.category, []);
      cats.get(s.category)!.push(s);
    }
    return cats;
  }, [uniqueMetrics]);

  const isLoanMode = selectedMetric === LOAN_METRIC_ID;

  // Fetch comparison data
  useEffect(() => {
    if (!selectedMetric || selectedBanks.length === 0) {
      setMetricsData([]);
      return;
    }
    setDataLoading(true);
    setLoanDrillLevel(null);
    Promise.all(
      selectedBanks.map((bankId) => api.getMetrics({ series_id: selectedMetric, competitor: bankId }))
    ).then((results) => setMetricsData(results.flat()))
      .finally(() => setDataLoading(false));
  }, [selectedMetric, selectedBanks]);

  // Fetch drill-down when a bank is expanded
  useEffect(() => {
    if (!loanDrillLevel) {
      setDrillData([]);
      return;
    }
    setDrillLoading(true);
    api.getDrilldown({ competitor: loanDrillLevel })
      .then(setDrillData)
      .finally(() => setDrillLoading(false));
  }, [loanDrillLevel]);

  // Pivot comparison data by date
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>();
    for (const m of metricsData) {
      if (!m.competitor_id) continue;
      if (!byDate.has(m.date)) byDate.set(m.date, { date: m.date });
      byDate.get(m.date)![m.competitor_id] = m.value;
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [metricsData]);

  // Pivot drill-down data
  const { drillChartData, drillCategories } = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>();
    const cats = new Set<string>();
    for (const d of drillData) {
      const label = d.series_name.replace(' (%)', '');
      cats.add(label);
      if (!byDate.has(d.date)) byDate.set(d.date, { date: d.date });
      byDate.get(d.date)![label] = d.value;
    }
    return {
      drillChartData: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
      drillCategories: [...cats],
    };
  }, [drillData]);

  const latestValues = useMemo(() => {
    const latest = new Map<string, { value: number; date: string }>();
    for (const m of metricsData) {
      if (!m.competitor_id) continue;
      const prev = latest.get(m.competitor_id);
      if (!prev || m.date > prev.date) latest.set(m.competitor_id, { value: m.value, date: m.date });
    }
    return latest;
  }, [metricsData]);

  const currentMetricInfo = uniqueMetrics.find((s) => s.series_id === selectedMetric)
    || (isLoanMode ? { series_name: 'Total Loans (mio CZK)', unit: 'mio CZK' } : null);

  const toggleBank = useCallback((bankId: string) => {
    setSelectedBanks((prev) => prev.includes(bankId) ? prev.filter((b) => b !== bankId) : [...prev, bankId]);
  }, []);

  const fmtQ = (d: string) => { const [y, m] = d.split('-'); return `Q${Math.ceil(Number(m) / 3)}/${y.slice(2)}`; };
  const fmtVal = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(1);

  if (loading) return <div className="max-w-[1400px] mx-auto animate-pulse"><div className="bg-white border border-slate-200 rounded-lg h-[500px] shadow-sm" /></div>;
  if (uniqueMetrics.length === 0) return <div className="max-w-[1400px] mx-auto"><div className="bg-white border border-slate-200 rounded-lg p-16 shadow-sm text-center"><div className="text-[10px] font-black uppercase tracking-widest text-slate-300 mb-4">No data</div><code className="text-xs font-mono bg-slate-100 px-3 py-1.5 rounded text-slate-500">ci-monitor collect --source market</code></div></div>;

  return (
    <div className="max-w-[1400px] mx-auto grid grid-cols-12 gap-6">
      {/* Left panel */}
      <div className="col-span-12 lg:col-span-3 space-y-4">
        {/* Bank selector */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-3">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Banks</label>
          <div className="space-y-1">
            {Object.entries(BANK_LABELS).map(([id, label]) => {
              const active = selectedBanks.includes(id);
              return (
                <button key={id} onClick={() => toggleBank(id)}
                  className={cn('w-full flex items-center gap-2 px-3 py-2 rounded text-[10px] font-bold transition-all border',
                    active ? 'border-slate-200 bg-white text-slate-900' : 'border-transparent bg-slate-50 text-slate-400')}>
                  <span className={cn('w-3 h-3 rounded-sm shrink-0 border-2', active ? '' : 'opacity-30')}
                    style={{ backgroundColor: active ? BANK_COLORS[id] : '#e2e8f0', borderColor: BANK_COLORS[id] }} />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-1 pt-1">
            <button onClick={() => setSelectedBanks(Object.keys(BANK_COLORS))} className="flex-1 py-1.5 bg-slate-50 rounded text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all">All</button>
            <button onClick={() => setSelectedBanks([])} className="flex-1 py-1.5 bg-slate-50 rounded text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-all">None</button>
          </div>
        </div>

        {/* LOANS — single button */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loans</label>
          <button onClick={() => { setSelectedMetric(LOAN_METRIC_ID); setLoanDrillLevel(null); }}
            className={cn('w-full text-left px-3 py-1.5 rounded text-[10px] font-bold transition-all border',
              isLoanMode ? 'bg-[#fee600] border-[#fee600] text-black shadow-sm' : 'bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900')}>
            Total Loans
          </button>
        </div>

        {/* Other metric categories */}
        {[...categories.entries()].map(([cat, metrics]) => (
          <div key={cat} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{CATEGORY_LABELS[cat] || cat}</label>
            <div className="space-y-0.5">
              {metrics.map((m) => (
                <button key={m.series_id} onClick={() => { setSelectedMetric(m.series_id); setLoanDrillLevel(null); }}
                  className={cn('w-full text-left px-3 py-1.5 rounded text-[10px] font-bold transition-all border',
                    selectedMetric === m.series_id ? 'bg-[#fee600] border-[#fee600] text-black shadow-sm' : 'bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900')}>
                  {m.series_name.replace(/ - YTD| - QTD| - EoP|\(mio CZK\)|\(%\)/g, '').trim()}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Main chart area */}
      <div className="col-span-12 lg:col-span-9 space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm">
          {/* Header with drill-down controls */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">Bank Comparison</h2>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">
                {(currentMetricInfo as any)?.series_name || 'Select a metric'}
              </h3>
            </div>
            <div className="flex items-center gap-3">
              {isLoanMode && !loanDrillLevel && (
                <span className="text-[9px] font-bold text-slate-400 uppercase">Click a bank below to drill down</span>
              )}
              <div className="flex gap-1 bg-slate-100 rounded p-1">
                <button onClick={() => setChartMode('line')} className={cn('p-2 rounded transition-all', chartMode === 'line' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400')}><TrendingUp size={14} /></button>
                <button onClick={() => setChartMode('bar')} className={cn('p-2 rounded transition-all', chartMode === 'bar' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400')}><BarChart3 size={14} /></button>
              </div>
            </div>
          </div>

          {/* Drill-down breadcrumb when active */}
          {loanDrillLevel && (
            <div className="flex items-center gap-2 mb-4 py-2 px-3 bg-slate-50 rounded">
              <button onClick={() => setLoanDrillLevel(null)} className="text-[10px] font-black text-blue-600 uppercase tracking-wider hover:underline">
                Total Loans (All Banks)
              </button>
              <ChevronRight size={12} className="text-slate-400" />
              <span className="text-[10px] font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BANK_COLORS[loanDrillLevel] }} />
                {BANK_LABELS[loanDrillLevel]} — Loan Breakdown
              </span>
              <span className="ml-auto text-[9px] font-bold text-slate-400">mio CZK</span>
            </div>
          )}

          {/* Chart */}
          <div className="h-[420px]">
            {(dataLoading || drillLoading) ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-400 animate-pulse">Loading...</div>
            ) : loanDrillLevel ? (
              /* DRILL-DOWN: stacked area for one bank */
              drillChartData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-300">No drill-down data for {BANK_LABELS[loanDrillLevel]}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={drillChartData} margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} tickFormatter={fmtQ} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} width={60}
                      tickFormatter={fmtVal} />
                    <Tooltip contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                      labelFormatter={(d) => fmtQ(String(d))}
                      formatter={(value: any, name: any) => [`${Number(value).toLocaleString('cs-CZ')} mio CZK`, name]} />
                    <Legend formatter={(v: string) => <span className="text-[8px] font-bold">{v}</span>} />
                    {drillCategories.map((cat, i) => (
                      <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={DRILLDOWN_COLORS[i % DRILLDOWN_COLORS.length]} fill={DRILLDOWN_COLORS[i % DRILLDOWN_COLORS.length]} fillOpacity={0.7} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-300">No data</div>
            ) : chartMode === 'line' ? (
              /* COMPARISON: line chart */
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} tickFormatter={fmtQ} axisLine={{ stroke: '#e2e8f0' }} />
                  <YAxis tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} width={60} tickFormatter={fmtVal} />
                  <Tooltip contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                    labelFormatter={(d) => fmtQ(String(d))}
                    formatter={(value: any, name: any) => [`${Number(value).toLocaleString('cs-CZ')} ${(currentMetricInfo as any)?.unit || ''}`, BANK_LABELS[name] || name]} />
                  <Legend formatter={(v: string) => <span className="text-[9px] font-bold uppercase">{BANK_LABELS[v] || v}</span>} />
                  {selectedBanks.map((bankId) => (
                    <Line key={bankId} type="monotone" dataKey={bankId} stroke={BANK_COLORS[bankId]} strokeWidth={bankId === 'raiffeisenbank' ? 3 : 2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              /* COMPARISON: bar chart */
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectedBanks.filter((b) => latestValues.has(b)).map((b) => ({ bank: BANK_LABELS[b], value: latestValues.get(b)!.value })).sort((a, b) => b.value - a.value)}
                  margin={{ top: 5, right: 20, bottom: 60, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="bank" tick={{ fontSize: 9, fontWeight: 900, fill: '#334155' }} axisLine={{ stroke: '#e2e8f0' }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} width={60} tickFormatter={fmtVal} />
                  <Tooltip contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                    formatter={(value: any) => [`${Number(value).toLocaleString('cs-CZ')} ${(currentMetricInfo as any)?.unit || ''}`, (currentMetricInfo as any)?.series_name]} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40} fill="#fee600" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bank drill-down buttons — only in loan mode, when not already drilled */}
        {isLoanMode && !loanDrillLevel && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <ChevronDown size={14} className="text-[#e6cf00]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Drill into bank loan portfolio</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedBanks.map((bankId) => (
                <button key={bankId} onClick={() => setLoanDrillLevel(bankId)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-[#fee600] hover:bg-yellow-50 transition-all">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BANK_COLORS[bankId] }} />
                  {BANK_LABELS[bankId]}
                  <ChevronRight size={10} className="text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Data table — shows drill-down data or comparison data */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">
              {loanDrillLevel
                ? `${BANK_LABELS[loanDrillLevel]} — Loan Breakdown`
                : `${(currentMetricInfo as any)?.series_name || 'Metric'} — Quarterly Values`}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] text-left border-collapse">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100 bg-slate-50/30">
                  <th className="px-4 py-3 font-black uppercase tracking-widest sticky left-0 bg-slate-50/30">
                    {loanDrillLevel ? 'Category' : 'Bank'}
                  </th>
                  {(loanDrillLevel ? drillChartData : chartData).map((d) => (
                    <th key={d.date} className="px-3 py-3 font-black uppercase tracking-widest text-right whitespace-nowrap">{fmtQ(String(d.date))}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loanDrillLevel ? (
                  drillCategories.map((cat, i) => (
                    <tr key={cat} className="border-b border-slate-50">
                      <td className="px-4 py-2.5 sticky left-0 bg-white">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: DRILLDOWN_COLORS[i % DRILLDOWN_COLORS.length] }} />
                          <span className="font-bold text-slate-900">{cat}</span>
                        </div>
                      </td>
                      {drillChartData.map((d) => (
                        <td key={d.date} className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {d[cat] != null ? Number(d[cat]).toLocaleString('cs-CZ') : '—'}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  selectedBanks.map((bankId) => (
                    <tr key={bankId} className="border-b border-slate-50 hover:bg-yellow-50/30 transition-colors">
                      <td className="px-4 py-2.5 sticky left-0 bg-white">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: BANK_COLORS[bankId] }} />
                          <span className={cn('font-black text-slate-900', bankId === 'raiffeisenbank' && 'text-[#b8960a]')}>{BANK_LABELS[bankId]}</span>
                        </div>
                      </td>
                      {chartData.map((d) => (
                        <td key={d.date} className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {d[bankId] != null ? Number(d[bankId]).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
