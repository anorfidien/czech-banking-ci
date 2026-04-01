import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const SEVERITY_COLORS: Record<number, { bg: string; text: string; dot: string; label: string }> = {
  1: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Low' },
  2: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Info' },
  3: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Medium' },
  4: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'High' },
  5: { bg: 'bg-red-100', text: 'text-red-900', dot: 'bg-red-700', label: 'Critical' },
};

export const SOURCE_LABELS: Record<string, string> = {
  ares: 'ARES',
  job_postings: 'Jobs',
  news: 'News',
  google_news: 'Google News',
};

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('cs-CZ', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
