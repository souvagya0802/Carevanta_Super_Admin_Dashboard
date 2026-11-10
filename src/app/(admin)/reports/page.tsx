'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowDownToLine, Clock, Download, FileSpreadsheet, Loader2, RefreshCw, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { count, date, dateTime, money, relative, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Tabs, Textarea, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { RequirePermission } from '@/components/layout/shell';
import { Breakdown, SeriesChart, pivot, type SeriesPoint } from '@/components/charts';

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface Series { metric: string; granularity: string; unit: 'count' | 'INR_minor'; points: SeriesPoint[] }
interface Geo { dataSource: string; regions: { code: string; name: string; district: string; status: string }[]; providersByDistrict: { district: string; type: string; count: number }[]; bookingsByDistrict: { district: string; count: number }[] }
interface Demand { specialities: { name: string; count: number }[]; tests: { name: string; count: number }[] }
interface ExportOptions { maxRows: number; retentionHours: number; processing: 'inline' | 'background'; types: { type: string; label: string; description: string; statuses: string[]; supportsProvider: boolean; dateField: string; requiresRange: boolean; columns: string[] }[] }
interface Job { id: string; exportType: string; filters: { from?: string; to?: string; status?: string; providerId?: string }; purpose: string; status: string; requestedById: string; requestedByName: string | null; rowCount: number | null; truncated: boolean; error: string | null; downloadCount: number; expiresAt: string | null; expired: boolean; startedAt: string | null; completedAt: string | null; createdAt: string }

/* ─── Metrics (what the series endpoint offers) ───────────────────────────── */
const METRICS: { key: string; label: string; kind: 'line' | 'bar'; exportType: string | null; hint: string }[] = [
  { key: 'appointments', label: 'Appointments', kind: 'bar', exportType: 'appointments', hint: 'Bookings created, stacked by status' },
  { key: 'registrations', label: 'Patient Registrations', kind: 'line', exportType: 'users', hint: 'New accounts created' },
  { key: 'provider_applications', label: 'Provider Applications', kind: 'bar', exportType: 'providers', hint: 'Submitted, approved and rejected' },
  { key: 'diagnostic_orders', label: 'Diagnostic Orders', kind: 'bar', exportType: null, hint: 'Lab and imaging orders by status' },
  { key: 'pharmacy_orders', label: 'Pharmacy Orders', kind: 'bar', exportType: null, hint: 'Medicine orders by status' },
  { key: 'gtv', label: 'Gross Transaction Value', kind: 'line', exportType: 'transactions', hint: 'Completed services, net of refunds, by category' },
  { key: 'commission', label: 'Commission Revenue', kind: 'line', exportType: 'transactions', hint: 'Final commission snapshots' },
  { key: 'refunds', label: 'Refunds', kind: 'line', exportType: 'transactions', hint: 'Refunds that succeeded' },
  { key: 'complaints', label: 'Complaints & Disputes', kind: 'bar', exportType: null, hint: 'Support cases opened, by type' },
];
const PRESETS = [{ days: 7, label: 'Last 7 Days' }, { days: 30, label: 'Last 30 Days' }, { days: 90, label: 'Last 90 Days' }, { days: 180, label: 'Last 180 Days' }, { days: 365, label: 'Last 12 Months' }];
const MAX_RANGE_DAYS = 366;
const DAY = 86_400_000;

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);
/** Clock reads live outside components so the React Compiler's purity rule holds; values are re-read on every render anyway. */
const nowMs = () => Date.now();
const today = () => toDateInput(new Date(nowMs()));
const startOfDay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const endOfDayExclusive = (s: string) => new Date(startOfDay(s).getTime() + DAY);
const suggestGranularity = (days: number): 'day' | 'week' | 'month' => (days <= 45 ? 'day' : days <= 200 ? 'week' : 'month');

/* ─── Page shell: tab in the URL so the overview's "Export" button lands on the right tab ── */
export default function ReportsPage() {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <ReportsInner />
    </Suspense>
  );
}

function ReportsInner() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs = [...(can('analytics.read') ? [{ key: 'analytics', label: 'Analytics' }] : []), ...(can('exports.read') ? [{ key: 'exports', label: 'Exports' }] : [])];
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.key === requested) ? requested! : (tabs[0]?.key ?? 'analytics');
  const setTab = (next: string) => router.replace(`${pathname}?tab=${next}`, { scroll: false });
  // Analytics → Exports hand-off ("Export These Rows") carries the data set and range.
  const [prefill, setPrefill] = useState<{ exportType: string; from: string; to: string } | null>(null);

  return (
    <RequirePermission anyOf={['analytics.read', 'exports.read']}>
      <PageHeader title="Reports & Exports" description="Time-series views over live platform data, and bounded CSV exports. Every export is purpose-logged and every download is audited." />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-4 space-y-4">
        {tab === 'analytics' && can('analytics.read') && <AnalyticsTab onExport={(p) => { setPrefill(p); setTab('exports'); }} canExport={can('exports.create')} />}
        {tab === 'exports' && can('exports.read') && <ExportsTab prefill={prefill} />}
      </div>
    </RequirePermission>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Analytics
   ═══════════════════════════════════════════════════════════════════════════ */
function AnalyticsTab({ onExport, canExport }: { onExport: (p: { exportType: string; from: string; to: string }) => void; canExport: boolean }) {
  const [metric, setMetric] = useState('appointments');
  const [range, setRange] = useState(() => ({ from: toDateInput(new Date(nowMs() - 90 * DAY)), to: today() }));
  const [granularityOverride, setGranularityOverride] = useState<'day' | 'week' | 'month' | null>(null);

  // Validate the custom range before anything is fetched.
  const from = startOfDay(range.from);
  const to = endOfDayExclusive(range.to);
  const spanDays = Math.round((to.getTime() - from.getTime()) / DAY);
  const rangeError = Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ? 'Enter both dates' : from >= to ? 'From must be before To' : spanDays > MAX_RANGE_DAYS ? `Range may not exceed ${MAX_RANGE_DAYS} days` : to.getTime() > nowMs() + DAY ? 'To cannot be in the future' : null;
  const granularity = granularityOverride ?? suggestGranularity(spanDays);
  const q = rangeError ? null : qs({ from: from.toISOString(), to: to.toISOString() });
  const m = METRICS.find((x) => x.key === metric)!;

  const series = useGet<Series>(q ? `/admin/analytics/series${qs({ metric, granularity, from: from.toISOString(), to: to.toISOString() })}` : null);
  // Same window immediately before, for the comparison tile.
  const prevFrom = new Date(from.getTime() - spanDays * DAY);
  const previous = useGet<Series>(q ? `/admin/analytics/series${qs({ metric, granularity: 'month', from: prevFrom.toISOString(), to: from.toISOString() })}` : null);
  const geo = useGet<Geo>(q ? `/admin/analytics/geography${q}` : null);
  const demand = useGet<Demand>(q ? `/admin/analytics/service-demand${q}` : null);

  const total = useMemo(() => (series.data?.points ?? []).reduce((s, p) => s + p.value, 0), [series.data]);
  const prevTotal = useMemo(() => (previous.data?.points ?? []).reduce((s, p) => s + p.value, 0), [previous.data]);
  const buckets = useMemo(() => pivot(series.data?.points ?? []), [series.data]);
  const peak = useMemo(() => {
    let best: { bucket: string; value: number } | null = null;
    for (const row of buckets.rows) {
      const v = Object.entries(row).filter(([k]) => k !== 'bucket').reduce((s, [, x]) => s + Number(x), 0);
      if (!best || v > best.value) best = { bucket: String(row.bucket), value: v };
    }
    return best;
  }, [buckets]);
  const fmt = (v: number) => (series.data?.unit === 'INR_minor' ? money(v) : count(v));
  const change = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null;

  const applyPreset = (days: number) => { setRange({ from: toDateInput(new Date(nowMs() - days * DAY)), to: today() }); setGranularityOverride(null); };
  const downloadChartCsv = () => {
    const header = ['bucket', ...buckets.groups];
    const lines = [header.join(','), ...buckets.rows.map((r) => header.map((h) => (h === 'bucket' ? String(r.bucket) : String(r[h] ?? 0))).join(','))];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `carevanta-${metric}-${granularity}-${range.from}-to-${range.to}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  const providersByDistrict = useMemo(() => {
    const types = Array.from(new Set((geo.data?.providersByDistrict ?? []).map((x) => x.type))).sort();
    const rows = new Map<string, Record<string, number>>();
    for (const x of geo.data?.providersByDistrict ?? []) rows.set(x.district, { ...(rows.get(x.district) ?? {}), [x.type]: x.count });
    const list = Array.from(rows.entries()).map(([district, byType]) => ({ district, byType, total: Object.values(byType).reduce((s, v) => s + v, 0) })).sort((a, b) => b.total - a.total);
    return { types, list };
  }, [geo.data]);

  return (
    <>
      {geo.data && geo.data.dataSource !== 'production' && <p className="rounded-lg border border-orange/30 bg-orange-soft px-3 py-2 text-xs text-orange">Figures come from the <strong>{title(geo.data.dataSource)}</strong> environment, not production.</p>}

      <Card title="Time Series" description={m.hint} actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value)} className="h-8 w-52 text-xs">{METRICS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>
          <Select aria-label="Granularity" value={granularity} onChange={(e) => setGranularityOverride(e.target.value as 'day' | 'week' | 'month')} className="h-8 w-28 text-xs"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></Select>
          <Select aria-label="Preset Range" value={PRESETS.find((p) => toDateInput(new Date(nowMs() - p.days * DAY)) === range.from && range.to === today())?.days ?? 'custom'} onChange={(e) => { if (e.target.value !== 'custom') applyPreset(Number(e.target.value)); }} className="h-8 w-36 text-xs">{PRESETS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}<option value="custom">Custom</option></Select>
          <Input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => { setRange({ ...range, from: e.target.value }); setGranularityOverride(null); }} className="h-8 w-36 text-xs" />
          <span className="text-xs text-grey-500">to</span>
          <Input type="date" aria-label="To" value={range.to} min={range.from} max={today()} onChange={(e) => { setRange({ ...range, to: e.target.value }); setGranularityOverride(null); }} className="h-8 w-36 text-xs" />
        </div>
      }>
        {rangeError ? <EmptyState title={rangeError} description="Adjust the dates to load the chart." /> : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label={`Total · ${spanDays} Days`} value={series.isPending ? null : fmt(total)} sub={`${count(buckets.rows.length)} ${granularity === 'day' ? 'days' : granularity === 'week' ? 'weeks' : 'months'} with data`} />
              <Tile label="Previous Period" value={previous.isPending ? null : fmt(prevTotal)} sub={`${date(prevFrom.toISOString())} – ${date(new Date(from.getTime() - 1).toISOString())}`} />
              <Tile label="Change" value={series.isPending || previous.isPending ? null : change == null ? (total > 0 ? 'New' : '—') : `${change > 0 ? '+' : ''}${change}%`} sub={change == null ? 'No activity in the previous period' : 'Against the previous period'} tone={change == null ? undefined : change >= 0 ? 'up' : 'down'} />
              <Tile label={`Peak ${title(granularity)}`} value={series.isPending ? null : peak ? fmt(peak.value) : '—'} sub={peak ? date(peak.bucket) : 'No data in range'} />
            </div>
            <SeriesChart points={series.data?.points} unit={series.data?.unit} loading={series.isPending} error={series.error} retry={() => series.refetch()} kind={m.kind} height={320} emptyTitle={`No ${m.label.toLowerCase()} between ${date(from.toISOString())} and ${date(new Date(to.getTime() - 1).toISOString())}`} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-grey-100 pt-3 text-xs text-grey-500">
              <span>Buckets are {granularity === 'day' ? 'calendar days' : granularity === 'week' ? 'ISO weeks starting Monday' : 'calendar months'} in UTC. Figures refresh every 30 seconds.</span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => series.refetch()} disabled={series.isFetching}><RefreshCw size={14} className={cx(series.isFetching && 'animate-spin')} /> Refresh</Button>
                <Button size="sm" variant="secondary" onClick={downloadChartCsv} disabled={!buckets.rows.length}><ArrowDownToLine size={14} /> Chart CSV</Button>
                {canExport && m.exportType && <Button size="sm" variant="secondary" onClick={() => onExport({ exportType: m.exportType!, from: range.from, to: range.to })}><FileSpreadsheet size={14} /> Export These Rows</Button>}
              </span>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Approved Providers by District" description="Active locations of approved providers" className="lg:col-span-2">
          {geo.isPending ? <Skeleton rows={3} /> : geo.isError ? <ErrorState error={geo.error} retry={() => geo.refetch()} /> : providersByDistrict.list.length === 0 ? <p className="text-sm text-grey-500">No approved providers with an active location yet.</p> : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-grey-500"><tr><th className="py-1 pr-3">District</th>{providersByDistrict.types.map((t) => <th key={t} className="px-2 py-1 text-right">{title(t)}</th>)}<th className="py-1 pl-2 text-right">Total</th></tr></thead>
                <tbody>
                  {providersByDistrict.list.map((r) => (
                    <tr key={r.district} className="border-t border-grey-100">
                      <td className="py-1.5 pr-3 font-medium">{r.district}</td>
                      {providersByDistrict.types.map((t) => <td key={t} className="tnum px-2 py-1.5 text-right text-grey-700">{r.byType[t] ? count(r.byType[t]) : <span className="text-grey-300">·</span>}</td>)}
                      <td className="tnum py-1.5 pl-2 text-right font-semibold">{count(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Service Regions" description="Operational groupings from Settings">
          {geo.isPending ? <Skeleton rows={3} /> : geo.isError ? <ErrorState error={geo.error} retry={() => geo.refetch()} /> : geo.data?.regions.length ? (
            <ul className="text-sm">{geo.data.regions.map((r) => <li key={r.code} className="flex items-center justify-between border-t border-grey-100 py-1.5 first:border-0"><span>{r.name} <span className="text-xs text-grey-500">{r.district}</span></span><Badge>{r.status}</Badge></li>)}</ul>
          ) : <p className="text-sm text-grey-500">No service regions yet. <Link href="/settings?tab=regions" className="underline underline-offset-2">Create one in Settings</Link>.</p>}
        </Card>
        <Card title="Bookings by District" description="Appointments in the selected range">{geo.isPending ? <Skeleton rows={3} /> : geo.isError ? <ErrorState error={geo.error} /> : geo.data?.bookingsByDistrict.length ? <Breakdown data={Object.fromEntries(geo.data.bookingsByDistrict.map((x) => [x.district, x.count]))} /> : <p className="text-sm text-grey-500">No bookings in this range.</p>}</Card>
        <Card title="Demand by Speciality" description="Appointments by the doctor's primary speciality">{demand.isPending ? <Skeleton rows={3} /> : demand.isError ? <ErrorState error={demand.error} retry={() => demand.refetch()} /> : demand.data?.specialities.length ? <Breakdown data={Object.fromEntries(demand.data.specialities.map((x) => [x.name, x.count]))} /> : <p className="text-sm text-grey-500">No appointments in this range.</p>}</Card>
        <Card title="Most Ordered Tests" description="Diagnostic order lines in the selected range">{demand.isPending ? <Skeleton rows={3} /> : demand.isError ? <ErrorState error={demand.error} /> : demand.data?.tests.length ? <Breakdown data={Object.fromEntries(demand.data.tests.map((x) => [x.name, x.count]))} /> : <p className="text-sm text-grey-500">No diagnostic orders in this range.</p>}</Card>
      </div>
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string | null; sub: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-lg border border-grey-200 bg-grey-50 p-3">
      <p className="text-xs font-medium text-grey-500">{label}</p>
      {value === null ? <div className="mt-1 h-7 w-24 animate-pulse rounded-sm bg-grey-200" /> : (
        <p className={cx('tnum mt-1 flex items-center gap-1 text-xl font-bold', tone === 'up' && 'text-green', tone === 'down' && 'text-red')}>{tone === 'up' ? <TrendingUp size={16} aria-hidden /> : tone === 'down' ? <TrendingDown size={16} aria-hidden /> : null}{value}</p>
      )}
      <p className="line-clamp-2 text-xs text-grey-500">{sub}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Exports
   ═══════════════════════════════════════════════════════════════════════════ */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(['QUEUED', 'RUNNING']);

function ExportsTab({ prefill }: { prefill: { exportType: string; from: string; to: string } | null }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const options = useGet<ExportOptions>('/admin/exports/options');
  const [f, setF] = useState(() => ({ exportType: prefill?.exportType ?? 'providers', from: prefill?.from ?? '', to: prefill?.to ?? '', status: '', providerId: '', purpose: '' }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const info = options.data?.types.find((t) => t.type === f.exportType) ?? options.data?.types[0];

  // Client-side checks mirror the API's so nothing is submitted that will be refused.
  const problems = useMemo(() => {
    const p: Record<string, string> = {};
    if (!info) return p;
    if (f.from && f.to && startOfDay(f.from) >= endOfDayExclusive(f.to)) p.to = 'To must be on or after From';
    if (info.requiresRange && (!f.from || !f.to)) p.from = `${info.label} exports need a date range`;
    if (f.to && endOfDayExclusive(f.to).getTime() > nowMs() + DAY) p.to = 'To cannot be in the future';
    if (f.providerId && !UUID.test(f.providerId)) p.providerId = 'Paste the provider ID (UUID) from the provider page';
    if (f.purpose.trim().length < 5) p.purpose = 'At least 5 characters — this is written to the audit log';
    return p;
  }, [f, info]);
  const valid = info && Object.keys(problems).length === 0;

  const create = useAction(
    () => api.post<{ data: Job }>('/admin/exports', { exportType: f.exportType, purpose: f.purpose.trim(), filters: { from: f.from ? startOfDay(f.from).toISOString() : undefined, to: f.to ? endOfDayExclusive(f.to).toISOString() : undefined, status: f.status || undefined, providerId: info?.supportsProvider && f.providerId ? f.providerId : undefined } }),
    {
      invalidate: ['/admin/exports'],
      onSuccess: (r) => {
        setFieldErrors({});
        setF({ ...f, purpose: '' });
        const j = r.data;
        if (j.status === 'COMPLETED') toast.success(`${title(j.exportType)} export ready`, `${count(j.rowCount)} rows${j.truncated ? ` (capped at ${count(options.data?.maxRows)})` : ''} · expires ${relative(j.expiresAt).replace(' ago', '')}`);
        else if (j.status === 'FAILED') toast.error(new Error(j.error ?? 'Export failed'));
        else toast.success('Export queued', 'It will appear below as soon as the worker finishes it.');
      },
      onError: (e) => { if (e instanceof ApiError) { const field = (e.body.details as { field?: string } | undefined)?.field; setFieldErrors(field ? { [field.replace('filters.', '')]: e.message } : e.fieldErrors); } },
    },
  );

  const download = async (job: Job) => {
    try {
      const { blob, filename } = await api.blob(`/admin/exports/${job.id}/download`);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).startsWith('/admin/exports') });
    } catch (e) { toast.error(e); }
  };
  const requestAgain = (job: Job) => {
    setF({ exportType: job.exportType, from: job.filters.from ? job.filters.from.slice(0, 10) : '', to: job.filters.to ? new Date(new Date(job.filters.to).getTime() - 1).toISOString().slice(0, 10) : '', status: job.filters.status ?? '', providerId: job.filters.providerId ?? '', purpose: job.purpose });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const describeFilters = (j: Job) => {
    const parts: string[] = [];
    if (j.filters.from || j.filters.to) parts.push(`${j.filters.from ? date(j.filters.from) : '…'} – ${j.filters.to ? date(new Date(new Date(j.filters.to).getTime() - 1).toISOString()) : '…'}`);
    if (j.filters.status) parts.push(title(j.filters.status));
    if (j.filters.providerId) parts.push(`Provider ${j.filters.providerId.slice(0, 8)}`);
    return parts.length ? parts.join(' · ') : 'All Rows';
  };
  const expiryLabel = (j: Job) => {
    if (!j.expiresAt) return null;
    const ms = new Date(j.expiresAt).getTime() - nowMs();
    if (ms <= 0) return 'Expired';
    const h = Math.floor(ms / 3_600_000);
    return h >= 1 ? `Expires in ${h} h` : `Expires in ${Math.max(1, Math.round(ms / 60_000))} min`;
  };

  const columns: ColumnDef<Job, unknown>[] = [
    { header: 'Data Set', cell: ({ row }) => <div className="min-w-40"><p className="font-medium">{options.data?.types.find((t) => t.type === row.original.exportType)?.label ?? title(row.original.exportType)}</p><p className="line-clamp-2 text-xs text-grey-500" title={row.original.purpose}>{row.original.purpose}</p></div> },
    { header: 'Filters', cell: ({ row }) => <span className="text-xs text-grey-700">{describeFilters(row.original)}</span> },
    { header: 'Status', cell: ({ row }) => {
      const j = row.original;
      const label = j.expired ? 'EXPIRED' : j.status;
      return (
        <div className="space-y-0.5">
          <span className="flex items-center gap-1.5">{ACTIVE.has(j.status) && <Loader2 size={12} className="animate-spin text-grey-500" aria-hidden />}<Badge>{label}</Badge>{j.truncated && <Badge accent="orange" tone="PENDING">Capped</Badge>}</span>
          {j.error && <p className="max-w-60 text-xs text-red" title={j.error}>{j.error.slice(0, 120)}</p>}
          {!j.expired && j.status === 'COMPLETED' && <p className="flex items-center gap-1 text-xs text-grey-500"><Clock size={11} aria-hidden /> {expiryLabel(j)}</p>}
        </div>
      );
    } },
    { header: 'Rows', cell: ({ row }) => <span className="tnum">{count(row.original.rowCount)}</span> },
    { header: 'Downloads', cell: ({ row }) => <span className="tnum">{row.original.downloadCount}</span> },
    { header: 'Requested', cell: ({ row }) => <div className="text-xs text-grey-600"><p>{row.original.requestedByName ?? row.original.requestedById.slice(0, 8)}</p><p title={dateTime(row.original.createdAt)}>{relative(row.original.createdAt)}</p></div> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => {
      const j = row.original;
      const canDownload = j.status === 'COMPLETED' && !j.expired;
      const canRetry = can('exports.create') && (j.expired || j.status === 'FAILED');
      return (
        <span className="flex justify-end gap-1">
          {canDownload && <Button size="sm" variant="secondary" onClick={() => download(j)} title="Every download is written to the sensitive-access log"><Download size={14} /> Download</Button>}
          {canRetry && <Button size="sm" variant="ghost" onClick={() => requestAgain(j)}><RotateCcw size={14} /> Request Again</Button>}
        </span>
      );
    } },
  ];

  return (
    <>
      {can('exports.create') && (
        <Card title="Request an Export" description={options.data ? `CSV, up to ${count(options.data.maxRows)} rows, kept for ${options.data.retentionHours} hours. ${options.data.processing === 'inline' ? 'Prepared immediately.' : 'Prepared by the background worker, usually within a minute.'}` : undefined}>
          {options.isPending ? <Skeleton rows={4} /> : options.isError || !info ? <ErrorState error={options.error ?? new Error('Export options unavailable')} retry={() => options.refetch()} /> : (
            <>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Data Set" required className="md:col-span-3 xl:col-span-1"><Select value={f.exportType} onChange={(e) => { setF({ ...f, exportType: e.target.value, status: '', providerId: '' }); setFieldErrors({}); }}>{options.data.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select></Field>
                  <Field label={`From (${title(info.dateField)})`} required={info.requiresRange} error={fieldErrors.from ?? problems.from}><Input type="date" value={f.from} max={f.to || today()} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
                  <Field label="To" required={info.requiresRange} error={fieldErrors.to ?? problems.to} hint="Inclusive"><Input type="date" value={f.to} min={f.from || undefined} max={today()} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
                  {info.statuses.length > 0 && (
                    <Field label="Status" error={fieldErrors.status}><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All Statuses</option>{info.statuses.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
                  )}
                  {info.supportsProvider && (
                    <Field label="Provider" error={fieldErrors.providerId ?? problems.providerId} hint="Optional — paste a provider ID to narrow the export" className="md:col-span-2"><Input placeholder="00000000-0000-0000-0000-000000000000" value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value.trim() })} /></Field>
                  )}
                  <Field label="Purpose" required error={fieldErrors.purpose ?? (f.purpose ? problems.purpose : undefined)} hint="Recorded in the audit log with your name" className="md:col-span-3"><Textarea value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} className="min-h-16" placeholder="e.g. Monthly reconciliation with the finance team" /></Field>
                </div>
                <aside className="rounded-lg border border-grey-200 bg-grey-50 p-4 text-sm">
                  <p className="font-medium">{info.label}</p>
                  <p className="mt-1 text-xs text-grey-600">{info.description}</p>
                  <p className="mt-3 text-xs font-semibold text-grey-500">Columns</p>
                  <p className="mt-1 font-mono text-[11px] leading-5 text-grey-700">{info.columns.join(', ')}</p>
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-grey-600"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-orange" aria-hidden /> No clinical content, documents or secrets are ever exported. Amount columns are in paise.</p>
                </aside>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!valid}><FileSpreadsheet size={16} /> Request Export</Button>
                {!valid && f.purpose && <p className="text-xs text-grey-500">{Object.values(problems)[0]}</p>}
              </div>
            </>
          )}
        </Card>
      )}
      <Card title="Export History" description="Newest first. Completed files can be downloaded until they expire; failed or expired exports can be requested again." padded={false}>
        <div className="p-5 pt-0">
          <DataTable<Job> path="/admin/exports" columns={columns} emptyTitle="No Exports Yet" emptyDescription={can('exports.create') ? 'Request one above — it appears here with its status and download link.' : 'Exports requested by administrators appear here.'} refetchInterval={(rows) => (rows.some((j) => ACTIVE.has(j.status)) ? 5_000 : false)} />
        </div>
      </Card>
    </>
  );
}

