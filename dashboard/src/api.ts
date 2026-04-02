import type { Signal, Competitor, CollectorRun, Summary } from './types';

const BASE = '/api';

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getSummary: () => get<Summary>(`${BASE}/summary`),

  getSignals: (params?: {
    competitor?: string;
    source?: string;
    severity?: string;
    since?: string;
    limit?: string;
  }) => get<Signal[]>(`${BASE}/signals`, params),

  getCompetitors: () => get<Competitor[]>(`${BASE}/competitors`),

  getStatus: () => get<CollectorRun[]>(`${BASE}/status`),

  getMetrics: (params?: {
    series_id?: string;
    category?: string;
    competitor?: string;
    since?: string;
    until?: string;
  }) => get<any[]>(`${BASE}/metrics`, params),

  getMetricsSeries: () => get<any[]>(`${BASE}/metrics/series`),

  getDrilldown: (params: { competitor: string; pct?: string }) =>
    get<any[]>(`${BASE}/metrics/drilldown`, params),
};
