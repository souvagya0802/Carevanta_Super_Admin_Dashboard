'use client';

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMemo } from 'react';
import { money, count } from '@/lib/format';
import { ACCENT, ACCENT_ORDER, EmptyState, ErrorState, Skeleton, type Accent } from './ui/primitives';

/** Colourful series palette; the same hexes as the UI accents so legends match badges. */
export const SERIES_COLORS = ACCENT_ORDER.map((a) => ACCENT[a].hex);

/** Map a status-like series name to a stable colour where one is obvious. */
export function seriesColor(name: string, index: number): string {
  const k = name.toUpperCase();
  const pick = (a: Accent) => ACCENT[a].hex;
  if (/COMPLETED|APPROVED|PAID|DELIVERED|SUCCE/.test(k)) return pick('green');
  if (/CANCEL|REJECT|FAIL|NO_SHOW|REFUND/.test(k)) return pick('red');
  if (/REQUEST|PENDING|SUBMITTED|REVIEW|PROCESS/.test(k)) return pick('orange');
  if (/CONFIRM|CHECKED|SCHEDUL/.test(k)) return pick('blue');
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

export interface SeriesPoint {
  bucket: string;
  value: number;
  group: string | null;
}

/** Pivot API series points into one row per bucket with a column per group. */
export function pivot(points: SeriesPoint[]) {
  const groups = Array.from(new Set(points.map((p) => p.group ?? 'value')));
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const key = p.bucket.slice(0, 10);
    const row = byBucket.get(key) ?? { bucket: key };
    row[p.group ?? 'value'] = ((row[p.group ?? 'value'] as number) ?? 0) + p.value;
    byBucket.set(key, row);
  }
  return { groups, rows: Array.from(byBucket.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))) };
}

const shortDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

interface ChartProps {
  points?: SeriesPoint[];
  unit?: 'count' | 'INR_minor';
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  height?: number;
  kind?: 'line' | 'bar';
  emptyTitle?: string;
}

export function SeriesChart({ points, unit = 'count', loading, error, retry, height = 260, kind = 'line', emptyTitle = 'No data in this range' }: ChartProps) {
  const { groups, rows } = useMemo(() => pivot(points ?? []), [points]);
  if (loading) return <Skeleton rows={4} />;
  if (error) return <ErrorState error={error} retry={retry} />;
  if (!rows.length) return <EmptyState title={emptyTitle} />;
  const fmt = (v: number) => (unit === 'INR_minor' ? money(v) : count(v));
  const axisFmt = (v: number) => (unit === 'INR_minor' ? `₹${Math.round(v / 100).toLocaleString('en-IN')}` : count(v));
  const common = { data: rows, margin: { top: 8, right: 8, left: 0, bottom: 0 } };
  const tooltipStyle = { border: '1px solid #e5e7eb', borderRadius: 12, fontSize: 12, boxShadow: '0 10px 30px -10px rgb(16 24 40 / 0.25)' };
  return (
    <div style={{ height }} role="img" aria-label={`${kind} chart with ${groups.length} series over ${rows.length} buckets`}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'bar' ? (
          <BarChart {...common} barCategoryGap="25%">
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={shortDate} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={axisFmt} width={64} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(l) => shortDate(String(l))} contentStyle={tooltipStyle} cursor={{ fill: '#f3f4f6' }} />
            {groups.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />}
            {groups.map((g, i) => (
              <Bar key={g} dataKey={g} name={g.replace(/_/g, ' ').toLowerCase()} stackId="a" fill={seriesColor(g, i)} radius={i === groups.length - 1 ? [6, 6, 0, 0] : 0} />
            ))}
          </BarChart>
        ) : (
          <LineChart {...common}>
            <CartesianGrid stroke="#eef0f3" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={shortDate} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={axisFmt} width={64} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(l) => shortDate(String(l))} contentStyle={tooltipStyle} />
            {groups.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />}
            {groups.map((g, i) => (
              <Line key={g} type="monotone" dataKey={g} name={g.replace(/_/g, ' ').toLowerCase()} stroke={seriesColor(g, i)} dot={false} strokeWidth={2.25} isAnimationActive={false} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal breakdown of a {key: number} map as coloured bars (e.g. status counts). */
export function Breakdown({ data, formatter = count, colored = true }: { data: Record<string, number> | undefined; formatter?: (n: number) => string; colored?: boolean }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  if (!entries.length) return <p className="text-sm text-grey-500">No data</p>;
  return (
    <ul className="space-y-2.5 text-sm">
      {entries.map(([k, v], i) => (
        <li key={k}>
          <div className="flex justify-between text-xs">
            <span className="truncate text-grey-700">{k.replace(/_/g, ' ')}</span>
            <span className="tnum ml-2 font-medium">{formatter(v)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-grey-100">
            <div className="h-full rounded-full" style={{ width: `${Math.round((v / max) * 100)}%`, background: colored ? seriesColor(k, i) : '#0a0a0a' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
