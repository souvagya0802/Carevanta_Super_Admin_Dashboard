'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CheckCircle2, Clock, Eye, FileCheck2, Hourglass, Search, UserCheck, UserRound, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useFilters, useGet } from '@/lib/hooks';
import { count, dateTime, relative, title } from '@/lib/format';
import { PROVIDER_TYPES } from '@/lib/providers-meta';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, ErrorState, Input, PageHeader, Select, Skeleton, Tabs, cx } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

export interface CaseRow {
  id: string; status: string; kind: string;
  provider: { id: string; displayName: string; type: string; status: string; district: string | null };
  assignedToId: string | null; assignedToName: string | null;
  requiredChecks: number; requiredPassed: number; failedChecks: number; outstanding: string[];
  createdAt: string; ageHours: number; overdue: boolean;
}
interface Stats { byStatus: Record<string, number>; openByProviderType: Record<string, number>; open: number; unassigned: number; mine: number; overdue: number; awaitingProvider: number; slaHours: number; decided7d: number; approved7d: number; avgDecisionHours7d: number | null }

const VIEWS = [
  { key: 'open', label: 'All Open' },
  { key: 'mine', label: 'My Queue' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'awaiting', label: 'Awaiting Provider' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'decided', label: 'Decided' },
] as const;
export type QueueView = (typeof VIEWS)[number]['key'];

const age = (h: number) => (h < 1 ? 'just now' : h < 48 ? `${h} h` : `${Math.round(h / 24)} d`);

/**
 * Shared verification queue. The Applications page opens on "All Open" for
 * registrars; the Credential Verification page opens on "My Queue" for
 * verifiers. Both show the same data, filters and health tiles.
 */
export function CaseQueue({ defaultView, heading, description, permission }: { defaultView: QueueView; heading: string; description: string; permission: string }) {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <CaseQueueInner defaultView={defaultView} heading={heading} description={description} permission={permission} />
    </Suspense>
  );
}

function CaseQueueInner({ defaultView, heading, description, permission }: { defaultView: QueueView; heading: string; description: string; permission: string }) {
  const { can, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: QueueView = VIEWS.find((v) => v.key === params.get('view'))?.key ?? defaultView;
  const setView = (v: string) => router.replace(`${pathname}?view=${v}`, { scroll: false });
  const stats = useGet<Stats>('/admin/verification-cases/stats', { refetchInterval: 60_000 });
  const { filters, set, reset } = useFilters({ q: '', providerType: '', kind: '', status: '' });
  const q = useDebounced(filters.q.trim());
  const assignMe = useAction((c: CaseRow) => api.post(`/admin/verification-cases/${c.id}/assign`, { assigneeId: me!.id }), { success: 'Assigned to you', invalidate: ['/admin/verification-cases'] });
  const s = stats.data;

  const viewParams = useMemo(() => {
    switch (view) {
      case 'mine': return { assignedToMe: 'true' };
      case 'unassigned': return { unassignedOnly: 'true' };
      case 'awaiting': return { status: 'AWAITING_PROVIDER' };
      case 'overdue': return { overdueOnly: 'true' };
      case 'decided': return { decidedOnly: 'true' };
      default: return {};
    }
  }, [view]);
  const anyFilter = Object.values(filters).some(Boolean);

  const columns: ColumnDef<CaseRow, unknown>[] = [
    { header: 'Provider', cell: ({ row }) => <div className="min-w-48"><p className="font-medium">{row.original.provider.displayName}</p><p className="text-xs text-grey-500">{title(row.original.provider.type)}{row.original.provider.district ? ` · ${row.original.provider.district}` : ''} · {row.original.kind === 'CHANGE_REQUEST' ? 'Change Request' : 'Onboarding'}</p></div> },
    { header: 'Case', cell: ({ row }) => <span className="flex flex-wrap gap-1"><Badge>{row.original.status}</Badge>{row.original.overdue && <Badge accent="red">Overdue</Badge>}</span> },
    { header: 'Required Checks', cell: ({ row }) => {
      const r = row.original; const done = r.requiredPassed === r.requiredChecks;
      return (
        <div className="min-w-36">
          <div className="flex items-center gap-2"><span className={cx('tnum text-sm font-medium', done ? 'text-green' : r.failedChecks ? 'text-red' : '')}>{r.requiredPassed}/{r.requiredChecks}</span>{r.failedChecks > 0 && <Badge accent="red">{r.failedChecks} Failed</Badge>}</div>
          <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-grey-100"><div className={cx('h-full rounded-full', done ? 'bg-green' : 'bg-ink')} style={{ width: `${r.requiredChecks ? Math.round((r.requiredPassed / r.requiredChecks) * 100) : 0}%` }} /></div>
          {r.outstanding.length > 0 && <p className="mt-1 truncate text-[11px] text-grey-500" title={r.outstanding.map(title).join(', ')}>Next: {title(r.outstanding[0])}{r.outstanding.length > 1 ? ` +${r.outstanding.length - 1}` : ''}</p>}
        </div>
      );
    } },
    { header: 'Assigned', cell: ({ row }) => row.original.assignedToId ? <span className="text-xs">{row.original.assignedToId === me?.id ? 'You' : (row.original.assignedToName ?? row.original.assignedToId.slice(0, 8))}</span> : <span className="text-xs text-grey-400">Unassigned</span> },
    { header: 'Age', cell: ({ row }) => <span className={cx('text-xs', row.original.overdue ? 'font-medium text-red' : 'text-grey-600')} title={dateTime(row.original.createdAt)}>{age(row.original.ageHours)}{s ? ` / ${s.slaHours} h` : ''}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => (
      <span className="flex justify-end gap-1">
        {can('providers.verify') && !row.original.assignedToId && ['OPEN', 'IN_REVIEW', 'AWAITING_PROVIDER'].includes(row.original.status) && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); assignMe.mutate(row.original); }} loading={assignMe.isPending}><UserCheck size={14} /> Take</Button>}
        <Link href={`/applications/${row.original.id}`} onClick={(e) => e.stopPropagation()}><Button size="sm" variant="secondary" tabIndex={-1}><Eye size={14} /> Open</Button></Link>
      </span>
    ) },
  ];

  return (
    <RequirePermission anyOf={[permission]}>
      <PageHeader title={heading} description={description} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile icon={FileCheck2} label="Open Cases" value={s ? count(s.open) : null} sub={s ? Object.entries(s.openByProviderType).map(([t, n]) => `${title(t)} ${n}`).join(' · ') || 'Nothing open' : ''} active={view === 'open'} onClick={() => setView('open')} />
        <Tile icon={Users} label="My Queue" value={s ? count(s.mine) : null} sub="Assigned to you" active={view === 'mine'} onClick={() => setView('mine')} />
        <Tile icon={UserRound} label="Unassigned" value={s ? count(s.unassigned) : null} sub="Waiting for a verifier" tone={s?.unassigned ? 'warn' : undefined} active={view === 'unassigned'} onClick={() => setView('unassigned')} />
        <Tile icon={Hourglass} label="Overdue" value={s ? count(s.overdue) : null} sub={s ? `Older than ${s.slaHours} h · ${count(s.awaitingProvider)} awaiting provider` : ''} tone={s?.overdue ? 'bad' : undefined} active={view === 'overdue'} onClick={() => setView('overdue')} />
        <Tile icon={CheckCircle2} label="Decided · 7 Days" value={s ? count(s.decided7d) : null} sub={s && s.decided7d ? `${count(s.approved7d)} approved · avg ${s.avgDecisionHours7d ?? '—'} h to decide` : 'No decisions yet'} active={view === 'decided'} onClick={() => setView('decided')} />
      </div>
      {stats.isError && <div className="mt-3"><ErrorState error={stats.error} retry={() => stats.refetch()} /></div>}
      <div className="mt-4"><Tabs tabs={VIEWS.map((v) => ({ key: v.key, label: v.label, count: v.key === 'mine' ? s?.mine : v.key === 'unassigned' ? s?.unassigned : v.key === 'overdue' ? s?.overdue : v.key === 'awaiting' ? s?.awaitingProvider : undefined }))} active={view} onChange={setView} /></div>
      <Card className="mt-4" padded={false}>
        <div className="p-5">
          <DataTable<CaseRow>
            path="/admin/verification-cases"
            params={{ ...viewParams, q, providerType: filters.providerType, kind: filters.kind, status: view === 'open' || view === 'decided' ? filters.status : '' }}
            columns={columns}
            onRowClick={(c) => router.push(`/applications/${c.id}`)}
            emptyTitle={anyFilter ? 'No Cases Match' : view === 'mine' ? 'Your Queue Is Empty' : view === 'unassigned' ? 'Everything Is Assigned' : view === 'overdue' ? 'Nothing Overdue' : view === 'awaiting' ? 'No Case Is Waiting on a Provider' : view === 'decided' ? 'No Decisions Yet' : 'No Open Applications'}
            emptyDescription={anyFilter ? 'Try clearing a filter.' : view === 'open' ? 'A case opens when a provider is submitted for verification from its record.' : undefined}
            toolbar={
              <>
                <div className="relative"><Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" /><Input aria-label="Search provider" placeholder="Provider Name" value={filters.q} onChange={(e) => set('q', e.target.value)} className="w-64 pl-9" /></div>
                <Select aria-label="Provider type" value={filters.providerType} onChange={(e) => set('providerType', e.target.value)} className="w-48"><option value="">All Provider Types</option>{PROVIDER_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select>
                <Select aria-label="Kind" value={filters.kind} onChange={(e) => set('kind', e.target.value)} className="w-44"><option value="">Onboarding & Changes</option><option value="ONBOARDING">Onboarding</option><option value="CHANGE_REQUEST">Change Request</option></Select>
                {view === 'open' && <Select aria-label="Case status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-44"><option value="">All Open Statuses</option>{['OPEN', 'IN_REVIEW', 'AWAITING_PROVIDER'].map((x) => <option key={x} value={x}>{title(x)}</option>)}</Select>}
                {view === 'decided' && <Select aria-label="Decision" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-40"><option value="">All Decisions</option>{['APPROVED', 'REJECTED', 'CANCELLED'].map((x) => <option key={x} value={x}>{title(x)}</option>)}</Select>}
                {anyFilter && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
              </>
            }
          />
        </div>
      </Card>
      {s && s.overdue > 0 && view !== 'overdue' && <p className="mt-3 flex items-center gap-1.5 text-xs text-red"><AlertTriangle size={12} aria-hidden /> {count(s.overdue)} case{s.overdue > 1 ? 's are' : ' is'} past the {s.slaHours}-hour target. <button type="button" className="underline underline-offset-2" onClick={() => setView('overdue')}>Show them</button></p>}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-grey-500"><Clock size={12} aria-hidden /> Figures refresh every minute. Decisions are audited; a provider can never be verified by whoever registered it. Last refreshed {stats.dataUpdatedAt ? relative(new Date(stats.dataUpdatedAt).toISOString()) : '—'}.</p>
    </RequirePermission>
  );
}

function Tile({ icon: Icon, label, value, sub, tone, active, onClick }: { icon: typeof FileCheck2; label: string; value: string | null; sub: string; tone?: 'warn' | 'bad'; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('rounded-lg border p-3 text-left transition-colors', active ? 'border-ink' : 'border-grey-200 hover:border-grey-400', tone === 'bad' ? 'bg-red-soft' : tone === 'warn' ? 'bg-orange-soft' : 'bg-paper')}>
      <div className="flex items-center gap-2"><Icon size={16} aria-hidden className={cx(tone === 'bad' ? 'text-red' : tone === 'warn' ? 'text-orange' : 'text-grey-500')} /><p className="text-xs font-medium text-grey-600">{label}</p></div>
      {value === null ? <div className="mt-1 h-7 w-14 animate-pulse rounded bg-grey-100" /> : <p className={cx('tnum mt-1 text-xl font-bold', tone === 'bad' && 'text-red', tone === 'warn' && 'text-orange')}>{value}</p>}
      <p className="truncate text-xs text-grey-500" title={sub}>{sub}</p>
    </button>
  );
}
