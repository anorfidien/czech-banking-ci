/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  ScatterChart, 
  Scatter, 
  XAxis, 
  YAxis, 
  ZAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  LabelList,
  CartesianGrid
} from 'recharts';
import { 
  LayoutDashboard, 
  Database, 
  Layers, 
  FileText, 
  Search, 
  Bell, 
  MoreHorizontal,
  ArrowLeft,
  Info
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Bank {
  id: string;
  name: string;
  tier: 'T1' | 'T2' | 'T3';
  threat: number;
  digital: number;
  innovation: number;
  share: number;
  balanceSheet: number; // in Billion CZK
  revenue: number;      // in Billion CZK
  color: string;
}

const BANKS: Bank[] = [
  { id: 'cs', name: 'Česká spořitelna', tier: 'T1', threat: 85, digital: 72, innovation: 68, share: 20.1, balanceSheet: 1850, revenue: 48.2, color: '#3b82f6' },
  { id: 'csob', name: 'ČSOB', tier: 'T1', threat: 82, digital: 75, innovation: 70, share: 19.8, balanceSheet: 1920, revenue: 45.5, color: '#10b981' },
  { id: 'kb', name: 'Komerční banka', tier: 'T1', threat: 78, digital: 70, innovation: 65, share: 16.5, balanceSheet: 1540, revenue: 39.8, color: '#ef4444' },
  { id: 'air', name: 'Air Bank', tier: 'T2', threat: 72, digital: 88, innovation: 82, share: 4.1, balanceSheet: 165, revenue: 6.2, color: '#06b6d4' },
  { id: 'revolut', name: 'Revolut CZ', tier: 'T3', threat: 68, digital: 95, innovation: 92, share: 1.2, balanceSheet: 25, revenue: 1.8, color: '#6366f1' },
  { id: 'rb', name: 'Raiffeisenbank', tier: 'T1', threat: 60, digital: 68, innovation: 62, share: 7.2, balanceSheet: 620, revenue: 19.5, color: '#eab308' },
  { id: 'mbank', name: 'mBank', tier: 'T2', threat: 58, digital: 80, innovation: 72, share: 3.2, balanceSheet: 110, revenue: 3.5, color: '#f43f5e' },
  { id: 'moneta', name: 'Moneta Money Bank', tier: 'T2', threat: 55, digital: 65, innovation: 58, share: 5.3, balanceSheet: 410, revenue: 12.8, color: '#a855f7' },
  { id: 'unicredit', name: 'UniCredit Bank', tier: 'T2', threat: 50, digital: 62, innovation: 55, share: 4.5, balanceSheet: 880, revenue: 22.4, color: '#ef4444' },
  { id: 'fio', name: 'Fio banka', tier: 'T2', threat: 45, digital: 60, innovation: 55, share: 3.8, balanceSheet: 280, revenue: 5.1, color: '#22c55e' },
  { id: 'partners', name: 'Partners Banka', tier: 'T3', threat: 40, digital: 90, innovation: 85, share: 0.5, balanceSheet: 10, revenue: 0.5, color: '#00a19a' },
];

const TIER_INFO = {
  T1: { label: 'Tier 1 — Universal Banks', desc: 'Dominant incumbents, foreign-owned', count: 4, color: 'border-red-500 text-red-500 bg-red-50' },
  T2: { label: 'Tier 2 — Challengers', desc: 'Established mid-market & digital-first', count: 5, color: 'border-blue-500 text-blue-500 bg-blue-50' },
  T3: { label: 'Tier 3 — Fintechs & Neobanks', desc: 'Disruptors & new entrants', count: 2, color: 'border-slate-800 text-slate-800 bg-slate-50' },
};

type MetricKey = 'threat' | 'digital' | 'innovation' | 'share' | 'balanceSheet' | 'revenue';

const METRIC_LABELS: Record<MetricKey, string> = {
  threat: 'Threat Level',
  digital: 'Digital Maturity',
  innovation: 'Innovation Score',
  share: 'Market Share (%)',
  balanceSheet: 'Balance Sheet (B CZK)',
  revenue: 'Revenue (B CZK)',
};

const METRIC_DOMAINS: Record<MetricKey, [number, number]> = {
  threat: [0, 100],
  digital: [0, 100],
  innovation: [0, 100],
  share: [0, 25],
  balanceSheet: [0, 2000],
  revenue: [0, 50],
};

export default function App() {
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Bank; direction: 'asc' | 'desc' } | null>(null);
  
  // PowerBI style axis selection
  const [xAxisKey, setXAxisKey] = useState<MetricKey>('digital');
  const [yAxisKey, setYAxisKey] = useState<MetricKey>('threat');

  // Slicers
  const [selectedTiers, setSelectedTiers] = useState<string[]>(['T1', 'T2', 'T3']);

  const filteredBanks = useMemo(() => {
    let result = BANKS.filter(bank => 
      selectedTiers.includes(bank.tier) &&
      bank.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (sortConfig) {
      result.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [searchQuery, sortConfig, selectedTiers]);

  const toggleTier = (tier: string) => {
    setSelectedTiers(prev => 
      prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]
    );
  };

  const handleSort = (key: keyof Bank) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const selectedBank = useMemo(() => filteredBanks.find(b => b.id === selectedBankId), [selectedBankId, filteredBanks]);

  return (
    <div className="min-h-screen bg-[#f4f4f5] text-slate-600 font-sans selection:bg-yellow-400/30">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#fee600] rounded flex items-center justify-center text-black font-black text-xl shadow-sm">
            RB
          </div>
          <div>
            <h1 className="text-slate-900 font-bold text-lg leading-tight uppercase tracking-tight">Market Intelligence Monitor</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Czech Banking Sector • Strategic Analysis Platform</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-slate-900 font-mono text-sm font-bold">13:48:57</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">{filteredBanks.length} targets • 12 sources</div>
          </div>
          <div className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
        </div>
      </header>

      <div className="flex relative">
        {/* Sidebar - Static Metric Selection Widget */}
        <aside className="w-72 bg-white border-r border-slate-200 h-[calc(100vh-73px)] sticky top-[73px] overflow-y-auto p-6 transition-all duration-300 z-40">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
              <Layers size={14} className="text-yellow-500" /> Visualization Fields
            </h2>
          </div>

          <div className="space-y-10">
            {/* Tier Slicer */}
            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Market Tier</label>
              <div className="flex flex-wrap gap-2">
                {['T1', 'T2', 'T3'].map(tier => (
                  <button
                    key={tier}
                    onClick={() => toggleTier(tier)}
                    className={cn(
                      "px-3 py-1.5 rounded text-[10px] font-black border transition-all",
                      selectedTiers.includes(tier)
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-400 border-slate-200 hover:border-slate-400"
                    )}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>

            {/* X-Axis Selection */}
            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">X-Axis Metric</label>
              <div className="grid grid-cols-1 gap-1">
                {(Object.entries(METRIC_LABELS) as [MetricKey, string][]).map(([key, label]) => (
                  <button
                    key={`x-${key}`}
                    onClick={() => setXAxisKey(key)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-all border",
                      xAxisKey === key 
                        ? "bg-yellow-400 border-yellow-400 text-black shadow-sm" 
                        : "bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Y-Axis Selection */}
            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Y-Axis Metric</label>
              <div className="grid grid-cols-1 gap-1">
                {(Object.entries(METRIC_LABELS) as [MetricKey, string][]).map(([key, label]) => (
                  <button
                    key={`y-${key}`}
                    onClick={() => setYAxisKey(key)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-all border",
                      yAxisKey === key 
                        ? "bg-slate-800 border-slate-800 text-white shadow-sm" 
                        : "bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100">
              <button 
                onClick={() => {
                  setSelectedTiers(['T1', 'T2', 'T3']);
                  setXAxisKey('digital');
                  setYAxisKey('threat');
                }}
                className="w-full py-3 bg-slate-50 border border-slate-200 rounded text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all"
              >
                Reset All Fields
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 p-6 max-w-[1400px] mx-auto grid grid-cols-12 gap-6">
          {/* Top Row: Radar & Details */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-white border border-slate-200 rounded-lg p-8 h-[650px] flex flex-col shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Competitive Landscape Analysis</h2>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-[9px] font-bold uppercase text-slate-400">T1</span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-4">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-[9px] font-bold uppercase text-slate-400">T2</span>
                  </div>
                </div>
              </div>
              
              <div className="flex-1 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={true} horizontal={true} />
                    <XAxis 
                      type="number" 
                      dataKey={xAxisKey} 
                      domain={METRIC_DOMAINS[xAxisKey]} 
                      tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                      axisLine={{ stroke: '#e2e8f0' }}
                      tickLine={{ stroke: '#e2e8f0' }}
                      label={{ value: METRIC_LABELS[xAxisKey], position: 'bottom', offset: 40, fontSize: 9, fontWeight: 900, fill: '#64748b', textAnchor: 'middle', className: 'uppercase tracking-widest' }}
                    />
                    <YAxis 
                      type="number" 
                      dataKey={yAxisKey} 
                      domain={METRIC_DOMAINS[yAxisKey]} 
                      tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                      axisLine={{ stroke: '#e2e8f0' }}
                      tickLine={{ stroke: '#e2e8f0' }}
                      label={{ value: METRIC_LABELS[yAxisKey], angle: -90, position: 'left', offset: 40, fontSize: 9, fontWeight: 900, fill: '#64748b', textAnchor: 'middle', className: 'uppercase tracking-widest' }}
                    />
                    <ZAxis type="number" dataKey="share" range={[400, 400]} />
                    <Tooltip 
                      cursor={{ strokeDasharray: '3 3', stroke: '#e2e8f0' }} 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload as Bank;
                          return (
                            <div className="bg-white border border-slate-200 p-4 rounded shadow-2xl">
                              <div className="text-slate-900 font-black text-xs uppercase tracking-tight mb-2 border-b border-slate-100 pb-2">{data.name}</div>
                              <div className="space-y-1">
                                <div className="flex justify-between gap-8 text-[10px] font-bold">
                                  <span className="text-slate-400 uppercase">{METRIC_LABELS[xAxisKey]}</span>
                                  <span className="text-slate-900">{data[xAxisKey]}</span>
                                </div>
                                <div className="flex justify-between gap-8 text-[10px] font-bold">
                                  <span className="text-slate-400 uppercase">{METRIC_LABELS[yAxisKey]}</span>
                                  <span className="text-slate-900">{data[yAxisKey]}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Scatter data={filteredBanks} onClick={(data) => setSelectedBankId(data.id)} className="cursor-pointer">
                      {filteredBanks.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} stroke={entry.id === selectedBankId ? '#000' : '#fff'} strokeWidth={entry.id === selectedBankId ? 3 : 2} />
                      ))}
                      <LabelList 
                        dataKey="name" 
                        content={(props: any) => {
                          const { x, y, value } = props;
                          return (
                            <text 
                              x={x} 
                              y={y + 16} 
                              textAnchor="middle" 
                              className="text-[9px] font-black text-slate-900 pointer-events-none uppercase tracking-tighter"
                            >
                              {value.split(' ')[0]}
                            </text>
                          );
                        }} 
                      />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-4 space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-8 h-[380px] flex flex-col items-center justify-center text-center relative shadow-sm">
              {selectedBank ? (
                <div className="w-full animate-in fade-in zoom-in-95 duration-300">
                  <button onClick={() => setSelectedBankId(null)} className="absolute top-6 left-6 text-slate-400 hover:text-slate-900 transition-colors flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                    <ArrowLeft size={14} /> Back
                  </button>
                  <div className="mb-8">
                    <div className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center border-4 shadow-inner" style={{ borderColor: selectedBank.color, backgroundColor: `${selectedBank.color}10` }}>
                      <span className="text-slate-900 font-black text-2xl">{selectedBank.name[0]}</span>
                    </div>
                    <h3 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">{selectedBank.name}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">{TIER_INFO[selectedBank.tier].label}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-slate-50 rounded p-3">
                      <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Balance Sheet</div>
                      <div className="text-sm font-black text-slate-900">{selectedBank.balanceSheet}B CZK</div>
                    </div>
                    <div className="bg-slate-50 rounded p-3">
                      <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Revenue</div>
                      <div className="text-sm font-black text-slate-900">{selectedBank.revenue}B CZK</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="border-r border-slate-100 last:border-0 px-1">
                      <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Share</div>
                      <div className="text-lg font-black text-slate-900">{selectedBank.share}%</div>
                    </div>
                    <div className="border-r border-slate-100 last:border-0 px-1">
                      <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Digital</div>
                      <div className="text-lg font-black text-slate-900">{selectedBank.digital}</div>
                    </div>
                    <div className="border-r border-slate-100 last:border-0 px-1">
                      <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Threat</div>
                      <div className="text-lg font-black text-red-600">{selectedBank.threat}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-300 flex flex-col items-center gap-6">
                  <div className="w-24 h-24 rounded-full border-4 border-dashed border-slate-100 flex items-center justify-center">
                    <Info size={40} className="text-slate-100" />
                  </div>
                  <p className="text-xs font-black uppercase tracking-[0.2em]">Select a target for analysis</p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {(Object.entries(TIER_INFO) as [keyof typeof TIER_INFO, typeof TIER_INFO['T1']][]).map(([key, info], i) => (
                <div key={key} className="bg-white border border-slate-200 rounded-lg p-5 flex items-center justify-between group hover:border-yellow-400 transition-all shadow-sm">
                  <div className="flex items-center gap-5">
                    <div className={cn("w-10 h-10 rounded flex items-center justify-center font-black text-sm border-2", info.color)}>
                      {key}
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">{info.label}</h4>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{info.desc}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black text-slate-900">{filteredBanks.filter(b => b.tier === key).length} Targets</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="col-span-12">
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">Comparative Performance Matrix</h2>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                    <input 
                      type="text" 
                      placeholder="Filter by bank..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-white border border-slate-200 rounded py-2 pl-9 pr-10 text-[10px] font-bold uppercase tracking-wider text-slate-900 focus:outline-none focus:border-yellow-400 transition-colors w-72"
                    />
                    {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
                      >
                        <ArrowLeft size={12} className="rotate-45" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[10px] border-collapse">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100 bg-slate-50/30">
                      <th className="px-8 py-5 font-black uppercase tracking-widest cursor-pointer hover:text-slate-900 transition-colors" onClick={() => handleSort('name')}>
                        Bank Entity {sortConfig?.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-8 py-5 font-black uppercase tracking-widest cursor-pointer hover:text-slate-900 transition-colors" onClick={() => handleSort('tier')}>
                        Tier {sortConfig?.key === 'tier' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-8 py-5 font-black uppercase tracking-widest text-center cursor-pointer hover:text-slate-900 transition-colors" onClick={() => handleSort('threat')}>
                        Threat {sortConfig?.key === 'threat' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-8 py-5 font-black uppercase tracking-widest text-center cursor-pointer hover:text-slate-900 transition-colors" onClick={() => handleSort('digital')}>
                        Digital {sortConfig?.key === 'digital' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-8 py-5 font-black uppercase tracking-widest text-right cursor-pointer hover:text-slate-900 transition-colors" onClick={() => handleSort('balanceSheet')}>
                        Balance Sheet {sortConfig?.key === 'balanceSheet' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-8 py-5 font-black uppercase tracking-widest text-right cursor-pointer hover:text-slate-900 transition-colors" onClick={() => handleSort('revenue')}>
                        Revenue {sortConfig?.key === 'revenue' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-8 py-5 font-black uppercase tracking-widest text-right cursor-pointer hover:text-slate-900 transition-colors" onClick={() => handleSort('share')}>
                        Market Share {sortConfig?.key === 'share' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBanks.map((bank) => (
                      <tr key={bank.id} className={cn("border-b border-slate-50 hover:bg-yellow-50/30 transition-colors cursor-pointer group", selectedBankId === bank.id && "bg-yellow-50/50")} onClick={() => setSelectedBankId(bank.id)}>
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-4">
                            <div className="w-3 h-3 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: bank.color }} />
                            <span className="font-black text-slate-900 group-hover:text-black transition-colors text-xs tracking-tight">{bank.name}</span>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <span className={cn("px-2 py-1 rounded text-[9px] font-black border uppercase tracking-widest", bank.tier === 'T1' ? "border-red-200 text-red-600 bg-red-50" : bank.tier === 'T2' ? "border-blue-200 text-blue-600 bg-blue-50" : "border-slate-200 text-slate-600 bg-slate-50")}>
                            {bank.tier}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-center font-mono text-red-600 font-black text-xs">{bank.threat}</td>
                        <td className="px-8 py-5 text-center font-mono text-slate-900 font-black text-xs">{bank.digital}</td>
                        <td className="px-8 py-5 text-right font-mono text-slate-900 font-black text-xs">{bank.balanceSheet}B</td>
                        <td className="px-8 py-5 text-right font-mono text-slate-900 font-black text-xs">{bank.revenue}B</td>
                        <td className="px-8 py-5 text-right font-mono text-slate-900 font-black text-xs">{bank.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 sticky bottom-0 z-50">
        <div className="flex gap-8">
          <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> System Active</span>
          <span>Data Integrity: Verified</span>
        </div>
        <div className="flex gap-8">
          <button className="hover:text-slate-900 transition-colors">Legal Disclosure</button>
          <button className="hover:text-slate-900 transition-colors">Methodology</button>
          <span className="text-slate-300">© 2026 RB Market Intelligence</span>
        </div>
      </footer>
    </div>
  );
}
