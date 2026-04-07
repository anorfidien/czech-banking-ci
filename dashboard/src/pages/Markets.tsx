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
}

const BANK_COLORS: Record<string, string> = {
  raiffeisenbank: '#eab308', ceska_sporitelna: '#3b82f6', csob: '#10b981',
  komercni_banka: '#ef4444', moneta: '#a855f7', fio_banka: '#22c55e', unicredit: '#f97316',
  air_bank: '#06b6d4', partners_bank: '#00a19a', revolut_cz: '#6366f1',
};
const BANK_LABELS: Record<string, string> = {
  raiffeisenbank: 'Raiffeisenbank', ceska_sporitelna: 'Česká spořitelna', csob: 'ČSOB',
  komercni_banka: 'Komerční banka', moneta: 'Moneta', fio_banka: 'Fio banka', unicredit: 'UniCredit',
  air_bank: 'Air Bank', partners_bank: 'Partners Bank', revolut_cz: 'Revolut',
};

// Sidebar structure: label → series_id (drilldown-capable ones are single entries)
const SIDEBAR_SECTIONS: { label: string; metrics: { id: string; label: string }[] }[] = [
  {
    label: 'Profitability',
    metrics: [
      { id: 'roe_ytd', label: 'ROE' },
      { id: 'npat_ytd', label: 'NPAT' },
      { id: 'cir_ytd', label: 'Cost-to-Income Ratio' },
    ],
  },
  {
    label: 'Income',
    metrics: [
      { id: 'op_income_ytd', label: 'Operating Income' },
      { id: 'nii_ytd', label: 'Net Interest Income' },
      { id: 'nim_ytd', label: 'Net Interest Margin' },
      { id: 'net_op_income_ytd', label: 'Net Operating Income' },
    ],
  },
  {
    label: 'Expenses',
    metrics: [
      { id: 'op_expense_ytd', label: 'Operating Expenses' },
    ],
  },
  {
    label: 'Loans',
    metrics: [
      { id: 'loans_total', label: 'Total Loans' },
    ],
  },
  {
    label: 'Balance Sheet',
    metrics: [
      { id: 'total_assets', label: 'Total Assets' },
      { id: 'total_liabilities', label: 'Total Liabilities' },
      { id: 'total_equity', label: 'Total Equity' },
    ],
  },
  {
    label: 'Operations',
    metrics: [
      { id: 'clients', label: 'Clients' },
      { id: 'fte', label: 'FTE' },
    ],
  },
  {
    label: 'Risk & Regulatory',
    metrics: [
      { id: 'capital_adequacy', label: 'Capital Adequacy' },
      { id: 'risk_costs_qtd', label: 'Risk Costs' },
      { id: 'risk_charge', label: 'Risk Charge' },
    ],
  },
];

const DRILLDOWN_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1',
  '#06b6d4', '#a855f7', '#f43f5e', '#22c55e', '#f97316',
];

type ChartMode = 'line' | 'bar';
type YtdMode = 'ytd' | 'yearly' | 'quarterly';

// Metrics that are YTD cumulative and support de-cumulation
const YTD_METRICS = new Set([
  'npat_ytd', 'op_income_ytd', 'op_expense_ytd', 'net_op_income_ytd',
  'nii_ytd', 'net_fees_ytd', 'interest_income_ytd', 'interest_expense_ytd',
  'perex_ytd', 'gae_ytd', 'depreciation_ytd', 'reg_charges_ytd', 'other_op_result_ytd',
]);

export default function Markets() {
  const [loading, setLoading] = useState(true);
  const [allSeries, setAllSeries] = useState<SeriesInfo[]>([]);
  const [drilldownConfig, setDrilldownConfig] = useState<Record<string, string[]>>({});

  const [selectedMetric, setSelectedMetric] = useState('roe_ytd');
  const [selectedBanks, setSelectedBanks] = useState<string[]>(Object.keys(BANK_COLORS));
  const [chartMode, setChartMode] = useState<ChartMode>('line');
  const [showMarketShare, setShowMarketShare] = useState(false);
  const [ytdMode, setYtdMode] = useState<YtdMode>('ytd');

  // Drill-down into one bank
  const [drillBank, setDrillBank] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<any[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // Main comparison data
  const [metricsData, setMetricsData] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const hasDrilldown = selectedMetric in drilldownConfig;

  // Load series + drilldown config
  useEffect(() => {
    Promise.all([api.getMetricsSeries(), api.getDrilldownConfig()])
      .then(([series, dd]) => { setAllSeries(series); setDrilldownConfig(dd); })
      .finally(() => setLoading(false));
  }, []);

  // Fetch comparison data
  useEffect(() => {
    if (!selectedMetric || selectedBanks.length === 0) { setMetricsData([]); return; }
    setDataLoading(true);
    setDrillBank(null);
    Promise.all(selectedBanks.map((b) => api.getMetrics({ series_id: selectedMetric, competitor: b })))
      .then((r) => setMetricsData(r.flat()))
      .finally(() => setDataLoading(false));
  }, [selectedMetric, selectedBanks]);

  // Fetch drill-down
  useEffect(() => {
    if (!drillBank || !hasDrilldown) { setDrillData([]); return; }
    setDrillLoading(true);
    api.getDrilldown({ competitor: drillBank, parent: selectedMetric })
      .then(setDrillData)
      .finally(() => setDrillLoading(false));
  }, [drillBank, selectedMetric]);

  // Pivot comparison by date
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>();
    for (const m of metricsData) {
      if (!m.competitor_id) continue;
      if (!byDate.has(m.date)) byDate.set(m.date, { date: m.date });
      byDate.get(m.date)![m.competitor_id] = m.value;
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [metricsData]);

  const isYtdMetric = YTD_METRICS.has(selectedMetric);

  // YTD transformations: yearly (Q4 only) and quarterly (de-cumulated)
  const ytdData = useMemo(() => {
    if (!isYtdMetric || ytdMode === 'ytd') return chartData;

    if (ytdMode === 'yearly') {
      // Only keep Q4 rows (month = 12)
      return chartData.filter((row) => {
        const month = String(row.date).split('-')[1];
        return month === '12';
      });
    }

    // quarterly: de-cumulate by subtracting previous quarter within same year
    const result: Record<string, any>[] = [];
    for (let i = 0; i < chartData.length; i++) {
      const row = chartData[i];
      const [year, month] = String(row.date).split('-');
      const isQ1 = month === '03';
      const out: Record<string, any> = { date: row.date };

      for (const b of selectedBanks) {
        const val = (row[b] as number) ?? null;
        if (val === null) { out[b] = null; continue; }

        if (isQ1 || i === 0) {
          out[b] = val; // Q1 is already standalone
        } else {
          const prevRow = chartData[i - 1];
          const prevYear = String(prevRow.date).split('-')[0];
          const prevVal = (prevRow[b] as number) ?? null;
          if (prevVal !== null && prevYear === year) {
            out[b] = val - prevVal;
          } else {
            out[b] = val; // new year, no previous to subtract
          }
        }
      }
      result.push(out);
    }
    return result;
  }, [chartData, selectedBanks, isYtdMetric, ytdMode]);

  // % share version
  const shareData = useMemo(() => {
    const src = isYtdMetric ? ytdData : chartData;
    return src.map((row) => {
      const out: Record<string, any> = { date: row.date };
      let total = 0;
      for (const b of selectedBanks) total += Math.abs((row[b] as number) || 0);
      for (const b of selectedBanks) out[b] = total > 0 ? ((row[b] as number) || 0) / total * 100 : 0;
      return out;
    });
  }, [chartData, ytdData, selectedBanks, isYtdMetric]);

  // Pivot drill-down + apply YTD transform
  const { ddChart, ddCats } = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>();
    const cats = new Set<string>();
    for (const d of drillData) {
      cats.add(d.series_name);
      if (!byDate.has(d.date)) byDate.set(d.date, { date: d.date });
      byDate.get(d.date)![d.series_name] = d.value;
    }
    let rawData = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const catList = [...cats];

    if (isYtdMetric && ytdMode !== 'ytd' && rawData.length > 0) {
      if (ytdMode === 'yearly') {
        rawData = rawData.filter((row) => String(row.date).split('-')[1] === '12');
      } else {
        // quarterly: de-cumulate each category
        const result: Record<string, any>[] = [];
        for (let i = 0; i < rawData.length; i++) {
          const row = rawData[i];
          const [year, month] = String(row.date).split('-');
          const isQ1 = month === '03';
          const out: Record<string, any> = { date: row.date };
          for (const cat of catList) {
            const val = (row[cat] as number) ?? null;
            if (val === null) { out[cat] = null; continue; }
            if (isQ1 || i === 0) {
              out[cat] = val;
            } else {
              const prevRow = rawData[i - 1];
              const prevYear = String(prevRow.date).split('-')[0];
              const prevVal = (prevRow[cat] as number) ?? null;
              out[cat] = (prevVal !== null && prevYear === year) ? val - prevVal : val;
            }
          }
          result.push(out);
        }
        rawData = result;
      }
    }

    return { ddChart: rawData, ddCats: catList };
  }, [drillData, isYtdMetric, ytdMode]);

  // Current metric info
  const metricInfo = useMemo(() => {
    for (const sec of SIDEBAR_SECTIONS) {
      const m = sec.metrics.find((x) => x.id === selectedMetric);
      if (m) return m;
    }
    return { id: selectedMetric, label: selectedMetric };
  }, [selectedMetric]);

  const metricUnit = useMemo(() => {
    const s = allSeries.find((x) => x.series_id === selectedMetric);
    return s?.unit || '';
  }, [allSeries, selectedMetric]);

  const toggleBank = useCallback((b: string) => {
    setSelectedBanks((p) => p.includes(b) ? p.filter((x) => x !== b) : [...p, b]);
  }, []);

  const isPercent = metricUnit === '%';

  const fmtQ = (d: string) => {
    const [y, m] = d.split('-');
    if (isYtdMetric && ytdMode === 'yearly') return y;
    return `Q${Math.ceil(Number(m) / 3)}/${y.slice(2)}`;
  };

  // Format for Y-axis ticks
  const fmtAxis = (v: number) => {
    if (showMarketShare) return `${v.toFixed(0)}%`;
    if (isPercent) return `${(v * 100).toFixed(0)}%`;
    return v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(1);
  };

  // Format for table cells and tooltips
  const fmtCell = (v: number) => {
    if (showMarketShare) return `${v.toFixed(1)}%`;
    if (isPercent) return `${(v * 100).toFixed(1)}%`;
    return Math.round(v).toLocaleString('cs-CZ');
  };

  // Format for tooltip with unit
  const fmtTooltip = (v: number) => {
    if (showMarketShare) return `${Number(v).toFixed(1)}%`;
    if (isPercent) return `${(Number(v) * 100).toFixed(1)}%`;
    return `${Math.round(Number(v)).toLocaleString('cs-CZ')} ${metricUnit}`;
  };

  const baseData = isYtdMetric ? ytdData : chartData;
  const activeData = showMarketShare ? shareData : baseData;

  if (loading) return <div className="max-w-[1400px] mx-auto animate-pulse"><div className="bg-white border border-slate-200 rounded-lg h-[500px] shadow-sm" /></div>;

  return (
    <div className="max-w-[1400px] mx-auto grid grid-cols-12 gap-6">
      {/* ── Left panel ────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-3 space-y-4">
        {/* Banks */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-3">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Banks</label>
          <div className="space-y-1">
            {Object.entries(BANK_LABELS).map(([id, label]) => (
              <button key={id} onClick={() => toggleBank(id)}
                className={cn('w-full flex items-center gap-2 px-3 py-2 rounded text-[10px] font-bold transition-all border',
                  selectedBanks.includes(id) ? 'border-slate-200 bg-white text-slate-900' : 'border-transparent bg-slate-50 text-slate-400')}>
                <span className={cn('w-3 h-3 rounded-sm shrink-0 border-2', selectedBanks.includes(id) ? '' : 'opacity-30')}
                  style={{ backgroundColor: selectedBanks.includes(id) ? BANK_COLORS[id] : '#e2e8f0', borderColor: BANK_COLORS[id] }} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-1 pt-1">
            <button onClick={() => setSelectedBanks(Object.keys(BANK_COLORS))} className="flex-1 py-1.5 bg-slate-50 rounded text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-all">All</button>
            <button onClick={() => setSelectedBanks([])} className="flex-1 py-1.5 bg-slate-50 rounded text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-all">None</button>
          </div>
        </div>

        {/* Metrics */}
        {SIDEBAR_SECTIONS.map((sec) => (
          <div key={sec.label} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{sec.label}</label>
            <div className="space-y-0.5">
              {sec.metrics.map((m) => {
                const isDrill = m.id in drilldownConfig;
                return (
                  <button key={m.id} onClick={() => { setSelectedMetric(m.id); setDrillBank(null); setShowMarketShare(false); setYtdMode('ytd'); }}
                    className={cn('w-full text-left px-3 py-1.5 rounded text-[10px] font-bold transition-all border flex items-center justify-between',
                      selectedMetric === m.id ? 'bg-[#fee600] border-[#fee600] text-black shadow-sm' : 'bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900')}>
                    <span>{m.label}</span>
                    {isDrill && <ChevronRight size={10} className="opacity-40" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Main area ─────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-9 space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">Bank Comparison</h2>
              <h3 className="text-lg font-black text-slate-900 tracking-tight">{metricInfo.label}</h3>
              {metricUnit && <span className="text-[10px] font-bold text-slate-400">{metricUnit}</span>}
            </div>
            <div className="flex items-center gap-2">
              {isYtdMetric && (
                <div className="flex gap-1 bg-slate-100 rounded p-1">
                  {(['ytd', 'yearly', 'quarterly'] as YtdMode[]).map((m) => (
                    <button key={m} onClick={() => setYtdMode(m)}
                      className={cn('px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all',
                        ytdMode === m ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400')}>
                      {m === 'ytd' ? 'YTD' : m === 'yearly' ? 'Yearly' : 'Quarterly'}
                    </button>
                  ))}
                </div>
              )}
              {!drillBank && (
                <>
                  <div className="flex gap-1 bg-slate-100 rounded p-1">
                    <button onClick={() => setShowMarketShare(false)} className={cn('px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all', !showMarketShare ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400')}>Absolute</button>
                    <button onClick={() => setShowMarketShare(true)} className={cn('px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all', showMarketShare ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400')}>% Share</button>
                  </div>
                  <div className="flex gap-1 bg-slate-100 rounded p-1">
                    <button onClick={() => setChartMode('line')} className={cn('p-2 rounded transition-all', chartMode === 'line' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400')}><TrendingUp size={14} /></button>
                    <button onClick={() => setChartMode('bar')} className={cn('p-2 rounded transition-all', chartMode === 'bar' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400')}><BarChart3 size={14} /></button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Breadcrumb */}
          {drillBank && (
            <div className="flex items-center gap-2 mb-4 py-2 px-3 bg-slate-50 rounded">
              <button onClick={() => setDrillBank(null)} className="text-[10px] font-black text-blue-600 uppercase tracking-wider hover:underline">
                {metricInfo.label} (All Banks)
              </button>
              <ChevronRight size={12} className="text-slate-400" />
              <span className="text-[10px] font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BANK_COLORS[drillBank] }} />
                {BANK_LABELS[drillBank]} — Breakdown
              </span>
              <span className="ml-auto text-[9px] font-bold text-slate-400">{metricUnit}</span>
            </div>
          )}

          {/* Chart */}
          <div className="h-[420px]">
            {(dataLoading || drillLoading) ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-400 animate-pulse">Loading...</div>
            ) : drillBank ? (
              /* DRILL-DOWN: stacked area */
              ddChart.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-300">No breakdown data</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={ddChart} margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} tickFormatter={fmtQ} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} width={60} tickFormatter={fmtAxis} />
                    <Tooltip contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                      labelFormatter={(d) => fmtQ(String(d))}
                      formatter={(value: any, name: any) => [fmtTooltip(value), name]} />
                    <Legend formatter={(v: string) => <span className="text-[8px] font-bold">{v}</span>} />
                    {ddCats.map((cat, i) => (
                      <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={DRILLDOWN_COLORS[i % DRILLDOWN_COLORS.length]} fill={DRILLDOWN_COLORS[i % DRILLDOWN_COLORS.length]} fillOpacity={0.7} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )
            ) : activeData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[10px] font-black uppercase tracking-widest text-slate-300">No data</div>
            ) : chartMode === 'line' ? (
              /* LINE */
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeData} margin={{ top: 5, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} tickFormatter={fmtQ} axisLine={{ stroke: '#e2e8f0' }} />
                  <YAxis tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} width={60}
                    tickFormatter={fmtAxis} />
                  <Tooltip contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                    labelFormatter={(d) => fmtQ(String(d))}
                    formatter={(value: any, name: any) => [fmtTooltip(value), BANK_LABELS[name] || name]} />
                  <Legend formatter={(v: string) => <span className="text-[9px] font-bold uppercase">{BANK_LABELS[v] || v}</span>} />
                  {selectedBanks.map((b) => (
                    <Line key={b} type="monotone" dataKey={b} stroke={BANK_COLORS[b]} strokeWidth={b === 'raiffeisenbank' ? 3 : 2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              /* BAR */
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectedBanks.filter((b) => activeData.some((d) => d[b] != null)).map((b) => {
                    const last = [...activeData].reverse().find((d) => d[b] != null);
                    return { bank: BANK_LABELS[b], value: last ? last[b] : 0 };
                  }).sort((a, b) => b.value - a.value)} margin={{ top: 5, right: 20, bottom: 60, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="bank" tick={{ fontSize: 9, fontWeight: 900, fill: '#334155' }} axisLine={{ stroke: '#e2e8f0' }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} width={60}
                    tickFormatter={fmtAxis} />
                  <Tooltip contentStyle={{ fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #e2e8f0' }}
                    formatter={(value: any) => [fmtTooltip(value), metricInfo.label]} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40} fill="#fee600" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Drill-down buttons */}
        {hasDrilldown && !drillBank && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <ChevronDown size={14} className="text-[#e6cf00]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Drill into {metricInfo.label.toLowerCase()} breakdown
              </span>
              <span className="text-[9px] font-bold text-slate-300 ml-2">
                ({drilldownConfig[selectedMetric]?.join(', ')})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedBanks.map((b) => (
                <button key={b} onClick={() => setDrillBank(b)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-[10px] font-bold bg-white border border-slate-200 text-slate-700 hover:border-[#fee600] hover:bg-yellow-50 transition-all">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BANK_COLORS[b] }} />
                  {BANK_LABELS[b]}
                  <ChevronRight size={10} className="text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Data table */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">
              {drillBank ? `${BANK_LABELS[drillBank]} — ${metricInfo.label} Breakdown` : `${metricInfo.label} — Quarterly Values`}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] text-left border-collapse">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100 bg-slate-50/30">
                  <th className="px-4 py-3 font-black uppercase tracking-widest sticky left-0 bg-slate-50/30">{drillBank ? 'Category' : 'Bank'}</th>
                  {(drillBank ? ddChart : activeData).map((d) => (
                    <th key={d.date} className="px-3 py-3 font-black uppercase tracking-widest text-right whitespace-nowrap">{fmtQ(String(d.date))}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drillBank ? (
                  ddCats.map((cat, i) => (
                    <tr key={cat} className="border-b border-slate-50">
                      <td className="px-4 py-2.5 sticky left-0 bg-white">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: DRILLDOWN_COLORS[i % DRILLDOWN_COLORS.length] }} />
                          <span className="font-bold text-slate-900">{cat}</span>
                        </div>
                      </td>
                      {ddChart.map((d) => (
                        <td key={d.date} className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {d[cat] != null ? Math.round(Number(d[cat])).toLocaleString('cs-CZ') : '—'}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  selectedBanks.map((b) => (
                    <tr key={b} className="border-b border-slate-50 hover:bg-yellow-50/30 transition-colors">
                      <td className="px-4 py-2.5 sticky left-0 bg-white">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: BANK_COLORS[b] }} />
                          <span className={cn('font-black text-slate-900', b === 'raiffeisenbank' && 'text-[#b8960a]')}>{BANK_LABELS[b]}</span>
                        </div>
                      </td>
                      {activeData.map((d) => (
                        <td key={d.date} className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {d[b] != null ? fmtCell(Number(d[b])) : '—'}
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
