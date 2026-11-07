'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Eye, FileText, Flag, Link2, MessageSquare, Plus, RefreshCw, Search, ShieldAlert, UserCheck, UserRound, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useFilters, useGet } from '@/lib/hooks';
import { count, dateTime, relative, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, Checkbox, Dialog, ErrorState, Field, FormSection, Input, PageHeader, Select, Skeleton, Tabs, Textarea, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { RequirePermission } from '@/components/layout/shell';

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface Case {
  id: string; reference: string; type: string; category: string; priority: string; status: string; subject: string; description: string;
  reporterUserId: string | null; reporterName: string | null; provider: { id: string; displayName: string } | null; transaction: { id: string; reference: string } | null;
  assignedToId: string | null; assignedToName: string | null; createdById: string | null; createdByName: string | null;
  slaDueAt: string | null; slaHours: number; slaBreached: boolean; slaRemainingMinutes: number | null;
  resolution: string | null; resolvedAt: string | null; resolutionHours: number | null; resolvedWithinSla: boolean | null;
  allowedTransitions: string[]; version: number; createdAt: string; updatedAt: string;
}
interface Event { id: string; kind: string; authorId: string | null; authorName: string | null; body: string | null; isInternal: boolean; metadata: { from?: string; to?: string; assigneeId?: string | null; assigneeName?: string | null } | null; createdAt: string }
interface Options { types: { type: string; categories: string[] }[]; priorities: { priority: string; slaHours: number }[]; statuses: string[]; openStatuses: string[]; transitions: Record<string, string[]>; agents: { id: string; fullName: string }[] }
interface Stats { byStatus: Record<string, number>; byPriorityOpen: Record<string, number>; open: number; unassigned: number; breached: number; dueWithin4h: number; mine: number; resolved7d: number; resolvedWithinSla7d: number; avgResolutionHours7d: number | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = [
  { key: 'open', label: 'All Open' },
  { key: 'mine', label: 'My Queue' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'breached', label: 'SLA Breached' },
  { key: 'due', label: 'Due in 4 h' },
  { key: 'closed', label: 'Resolved & Closed' },
] as const;
type View = (typeof VIEWS)[number]['key'];
const STATUS_HELP: Record<string, string> = {
  IN_PROGRESS: 'Someone is actively working the case.',
  AWAITING_REPORTER: 'Waiting for the patient or provider to reply; the SLA clock keeps running.',
  ESCALATED: 'Needs a senior decision, finance, or legal. Say why.',
  RESOLVED: 'Explain what was done. The reporter sees this text.',
  CLOSED: 'Final. Nothing more can be added. Give a reason if the case was not resolved.',
};

/** Human SLA label with a colour: red when overdue, orange when under 2 h or 25 % of the window, green otherwise. */
function slaInfo(c: Case): { label: string; tone: 'red' | 'orange' | 'green' | 'ink' } {
  if (c.slaRemainingMinutes == null) {
    if (c.resolvedWithinSla === true) return { label: 'Met', tone: 'green' };
    if (c.resolvedWithinSla === false) return { label: 'Missed', tone: 'red' };
    return { label: '—', tone: 'ink' };
  }
  const m = c.slaRemainingMinutes;
  const fmt = (mins: number) => (mins >= 60 * 48 ? `${Math.round(mins / 1440)} d` : mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} m` : `${mins} m`);
  if (m < 0) return { label: `Overdue by ${fmt(-m)}`, tone: 'red' };
  const window = c.slaHours * 60;
  return { label: `${fmt(m)} left`, tone: m < 120 || m < window * 0.25 ? 'orange' : 'green' };
}
const priorityAccent = (p: string): 'red' | 'orange' | 'blue' | 'ink' => (p === 'URGENT' ? 'red' : p === 'HIGH' ? 'orange' : p === 'MEDIUM' ? 'blue' : 'ink');

/* ─── Page shell ──────────────────────────────────────────────────────────── */
export default function SupportPage() {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <SupportInner />
    </Suspense>
  );
}

function SupportInner() {
  const { can, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const manage = can('support.manage');
  const view: View = (VIEWS.find((v) => v.key === params.get('view'))?.key ?? 'open');
  const openCaseId = params.get('case');
  const navigate = (next: { view?: View; case?: string | null }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.view) sp.set('view', next.view);
    if (next.case === null) sp.delete('case');
    else if (next.case) sp.set('case', next.case);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const options = useGet<Options>('/admin/support-cases/options');
  const stats = useGet<Stats>('/admin/support-cases/stats', { refetchInterval: 60_000 });
  const { filters, set, reset } = useFilters({ q: '', status: '', priority: '', type: '', category: '' });
  const q = useDebounced(filters.q.trim());
  const [creating, setCreating] = useState(false);
  const inv = ['/admin/support-cases'];
  const assignMe = useAction((c: Case) => api.post<{ data: Case }>(`/admin/support-cases/${c.id}/assign`, { assigneeId: me!.id }), { success: 'Assigned to you', invalidate: inv });

  const viewParams = useMemo(() => {
    switch (view) {
      case 'mine': return { assignedToMe: 'true', openOnly: 'true' };
      case 'unassigned': return { unassignedOnly: 'true', openOnly: 'true' };
      case 'breached': return { breachedOnly: 'true' };
      case 'due': return { dueWithinHours: 4 };
      case 'closed': return {};
      default: return { openOnly: 'true' };
    }
  }, [view]);
  const closedFilter = view === 'closed' && !filters.status ? { status: '' } : {};
  const categories = options.data?.types.find((t) => t.type === filters.type)?.categories ?? Array.from(new Set(options.data?.types.flatMap((t) => t.categories) ?? []));
  const anyFilter = Object.values(filters).some(Boolean);
  const s = stats.data;

  const columns: ColumnDef<Case, unknown>[] = [
    { header: 'Case', cell: ({ row }) => <div className="min-w-56"><p className="line-clamp-1 font-medium" title={row.original.subject}>{row.original.subject}</p><p className="font-mono text-xs text-grey-500">{row.original.reference} · {title(row.original.type)} · {title(row.original.category)}</p></div> },
    { header: 'Priority', cell: ({ row }) => <Badge accent={priorityAccent(row.original.priority)}>{row.original.priority}</Badge> },
    { header: 'Status', cell: ({ row }) => <span className="flex flex-wrap gap-1"><Badge>{row.original.status}</Badge>{row.original.slaBreached && <Badge accent="red">SLA Breached</Badge>}</span> },
    { header: 'SLA', cell: ({ row }) => { const i = slaInfo(row.original); return <span className={cx('tnum text-xs font-medium', i.tone === 'red' && 'text-red', i.tone === 'orange' && 'text-orange', i.tone === 'green' && 'text-green', i.tone === 'ink' && 'text-grey-500')} title={row.original.slaDueAt ? `Due ${dateTime(row.original.slaDueAt)}` : undefined}>{i.label}</span>; } },
    { header: 'Assigned', cell: ({ row }) => row.original.assignedToId ? <span className="text-xs">{row.original.assignedToId === me?.id ? 'You' : (row.original.assignedToName ?? row.original.assignedToId.slice(0, 8))}</span> : <span className="text-xs text-grey-400">Unassigned</span> },
    { header: 'Provider', cell: ({ row }) => row.original.provider ? <Link className="text-xs underline underline-offset-2" href={`/providers/${row.original.provider.id}`} onClick={(e) => e.stopPropagation()}>{row.original.provider.displayName}</Link> : <span className="text-xs text-grey-400">—</span> },
    { header: 'Opened', cell: ({ row }) => <span className="text-xs text-grey-600" title={dateTime(row.original.createdAt)}>{relative(row.original.createdAt)}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => (
      <span className="flex justify-end gap-1">
        {manage && !row.original.assignedToId && options.data?.openStatuses.includes(row.original.status) && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); assignMe.mutate(row.original); }} loading={assignMe.isPending}><UserCheck size={14} /> Take</Button>}
        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); navigate({ case: row.original.id }); }}><Eye size={14} /> View</Button>
      </span>
    ) },
  ];

  return (
    <RequirePermission anyOf={['support.read']}>
      <PageHeader title="Complaints & Disputes" description="Every case carries a reference, a priority-based SLA, an assignee, a timeline and audited status changes." actions={manage && <Button onClick={() => setCreating(true)}><Plus size={16} /> Open Case</Button>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile icon={FileText} label="Open" value={s ? count(s.open) : null} sub={s ? Object.entries(s.byPriorityOpen).filter(([, n]) => n).map(([p, n]) => `${title(p)} ${n}`).join(' · ') || 'Nothing open' : ''} onClick={() => navigate({ view: 'open' })} active={view === 'open'} />
        <StatTile icon={Users} label="My Queue" value={s ? count(s.mine) : null} sub="Assigned to you" onClick={() => navigate({ view: 'mine' })} active={view === 'mine'} />
        <StatTile icon={UserRound} label="Unassigned" value={s ? count(s.unassigned) : null} sub="Nobody is working these" tone={s?.unassigned ? 'warn' : undefined} onClick={() => navigate({ view: 'unassigned' })} active={view === 'unassigned'} />
        <StatTile icon={ShieldAlert} label="SLA Breached" value={s ? count(s.breached) : null} sub={s?.dueWithin4h ? `${count(s.dueWithin4h)} more due within 4 h` : 'None due within 4 h'} tone={s?.breached ? 'bad' : s?.dueWithin4h ? 'warn' : undefined} onClick={() => navigate({ view: 'breached' })} active={view === 'breached'} />
        <StatTile icon={CheckCircle2} label="Resolved · 7 Days" value={s ? count(s.resolved7d) : null} sub={s && s.resolved7d ? `${Math.round((s.resolvedWithinSla7d / s.resolved7d) * 100)}% within SLA · avg ${s.avgResolutionHours7d ?? '—'} h` : 'No resolutions yet'} onClick={() => navigate({ view: 'closed' })} active={view === 'closed'} />
      </div>
      {stats.isError && <div className="mt-3"><ErrorState error={stats.error} retry={() => stats.refetch()} /></div>}

      <div className="mt-4">
        <Tabs tabs={VIEWS.map((v) => ({ key: v.key, label: v.label, count: v.key === 'mine' ? s?.mine : v.key === 'unassigned' ? s?.unassigned : v.key === 'breached' ? s?.breached : v.key === 'due' ? s?.dueWithin4h : undefined }))} active={view} onChange={(k) => navigate({ view: k as View })} />
      </div>

      <Card className="mt-4" padded={false}>
        <div className="p-5">
          <DataTable<Case>
            path="/admin/support-cases"
            params={{ ...viewParams, ...closedFilter, q, status: filters.status, priority: filters.priority, type: filters.type, category: filters.category }}
            columns={columns}
            onRowClick={(c) => navigate({ case: c.id })}
            emptyTitle={anyFilter ? 'No Cases Match' : view === 'mine' ? 'Your Queue Is Empty' : view === 'breached' ? 'No SLA Breaches' : view === 'unassigned' ? 'Everything Is Assigned' : view === 'due' ? 'Nothing Due in the Next 4 Hours' : view === 'closed' ? 'No Resolved or Closed Cases Yet' : 'No Open Cases'}
            emptyDescription={anyFilter ? 'Try clearing a filter.' : view === 'open' && manage ? 'Open a case when a patient or provider raises a complaint, dispute or refund request.' : undefined}
            refetchInterval={(rows) => (rows.some((c) => c.slaRemainingMinutes != null && c.slaRemainingMinutes < 240) ? 60_000 : false)}
            toolbar={
              <>
                <div className="relative"><Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" /><Input aria-label="Search" placeholder="Reference or Subject" value={filters.q} onChange={(e) => set('q', e.target.value)} className="w-64 pl-9" /></div>
                {view === 'closed' && <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-40"><option value="">Resolved & Closed</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></Select>}
                {view === 'open' && <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-44"><option value="">All Open Statuses</option>{options.data?.openStatuses.map((x) => <option key={x} value={x}>{title(x)}</option>)}</Select>}
                <Select aria-label="Priority" value={filters.priority} onChange={(e) => set('priority', e.target.value)} className="w-36"><option value="">Any Priority</option>{options.data?.priorities.map((p) => <option key={p.priority} value={p.priority}>{title(p.priority)} · {p.slaHours} h</option>)}</Select>
                <Select aria-label="Type" value={filters.type} onChange={(e) => { set('type', e.target.value); set('category', ''); }} className="w-44"><option value="">Any Type</option>{options.data?.types.map((t) => <option key={t.type} value={t.type}>{title(t.type)}</option>)}</Select>
                <Select aria-label="Category" value={filters.category} onChange={(e) => set('category', e.target.value)} className="w-48"><option value="">Any Category</option>{categories.map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select>
                {anyFilter && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
              </>
            }
          />
        </div>
      </Card>

      {openCaseId && <CaseDialog id={openCaseId} options={options.data} manage={manage} meId={me?.id} onClose={() => { navigate({ case: null }); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[1] === 'string' && (x.queryKey[1] as string).startsWith('/admin/support-cases') }); }} />}
      {creating && options.data && <CreateCaseDialog options={options.data} onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); navigate({ view: 'open', case: c.id }); }} />}
    </RequirePermission>
  );
}

function StatTile({ icon: Icon, label, value, sub, tone, onClick, active }: { icon: typeof FileText; label: string; value: string | null; sub: string; tone?: 'warn' | 'bad'; onClick: () => void; active: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('rounded-lg border p-3 text-left transition-colors', active ? 'border-ink' : 'border-grey-200 hover:border-grey-400', tone === 'bad' ? 'bg-red-soft' : tone === 'warn' ? 'bg-orange-soft' : 'bg-paper')}>
      <div className="flex items-center gap-2"><Icon size={16} aria-hidden className={cx(tone === 'bad' ? 'text-red' : tone === 'warn' ? 'text-orange' : 'text-grey-500')} /><p className="text-xs font-medium text-grey-600">{label}</p></div>
      {value === null ? <div className="mt-1 h-7 w-14 animate-pulse rounded bg-grey-100" /> : <p className={cx('tnum mt-1 text-xl font-bold', tone === 'bad' && 'text-red', tone === 'warn' && 'text-orange')}>{value}</p>}
      <p className="truncate text-xs text-grey-500" title={sub}>{sub}</p>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Case detail
   ═══════════════════════════════════════════════════════════════════════════ */
function CaseDialog({ id, options, manage, meId, onClose }: { id: string; options: Options | undefined; manage: boolean; meId: string | undefined; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const kase = useGet<Case>(`/admin/support-cases/${id}`);
  const events = useGet<Event[]>(`/admin/support-cases/${id}/events`);
  const c = kase.data;
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(true);
  const [transition, setTransition] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const inv = [`/admin/support-cases/${id}`, '/admin/support-cases'];
  const refetchAll = () => { void kase.refetch(); void events.refetch(); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[1] === 'string' && (x.queryKey[1] as string).startsWith('/admin/support-cases') }); };
  const onConflict = (e: unknown) => { if (e instanceof ApiError && e.status === 409) { toast.error(e, 'Someone else changed this case'); refetchAll(); } };

  const addComment = useAction(() => api.post(`/admin/support-cases/${id}/comments`, { body: comment.trim(), isInternal: internal }), { success: internal ? 'Internal note added' : 'Reply added — visible to the reporter', invalidate: inv, onSuccess: () => { setComment(''); void events.refetch(); } });
  const assign = useAction((assigneeId: string | null) => api.post<{ data: Case }>(`/admin/support-cases/${id}/assign`, { assigneeId }), { success: 'Assignment updated', invalidate: inv, onSuccess: () => void events.refetch(), onError: onConflict });
  const setPriority = useAction((priority: string) => api.patch<{ data: Case }>(`/admin/support-cases/${id}`, { priority }), { success: 'Priority updated — SLA recalculated', invalidate: inv, onError: onConflict });
  const changeStatus = useAction(() => api.post<{ data: Case }>(`/admin/support-cases/${id}/status`, { status: transition, note: note.trim() || undefined, expectedVersion: c!.version }), { success: 'Status updated', invalidate: inv, onSuccess: () => { setTransition(null); setNote(''); void events.refetch(); }, onError: onConflict });

  const isOpen = !!c && (options?.openStatuses ?? ['OPEN', 'IN_PROGRESS', 'AWAITING_REPORTER', 'ESCALATED']).includes(c.status);
  const noteRequired = transition === 'RESOLVED' || transition === 'ESCALATED' || (transition === 'CLOSED' && c?.status !== 'RESOLVED');
  const sla = c ? slaInfo(c) : null;
  const nextSla = (p: string) => { if (!c || !options) return null; const h = options.priorities.find((x) => x.priority === p)?.slaHours ?? 0; return new Date(Date.parse(c.createdAt) + h * 3_600_000); };

  return (
    <Dialog open onClose={onClose} size="full" icon={MessageSquare} title={c ? `${c.reference} — ${c.subject}` : 'Loading Case…'} description={c ? `${title(c.type)} · ${title(c.category)} · opened ${relative(c.createdAt)} by ${c.createdByName ?? 'system'}` : undefined}
      footer={
        <>
          {manage && c && c.allowedTransitions.map((s) => <Button key={s} variant={s === 'CLOSED' ? 'danger' : s === 'RESOLVED' ? 'primary' : 'secondary'} onClick={() => { setTransition(s); setNote(''); }}>{s === 'IN_PROGRESS' && c.status === 'RESOLVED' ? 'Reopen' : title(s)}</Button>)}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      {kase.isPending ? <Skeleton rows={8} /> : kase.isError || !c ? <ErrorState error={kase.error ?? new Error('Case not found')} retry={() => kase.refetch()} /> : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <FormSection title="What Happened" icon={FileText} accent="blue">
              <p className="whitespace-pre-wrap text-sm">{c.description}</p>
              {c.resolution && <div className="mt-3 rounded-lg border border-green/30 bg-green-soft p-3 text-sm"><p className="text-xs font-semibold text-green">Resolution · shown to the reporter</p><p className="mt-1 whitespace-pre-wrap">{c.resolution}</p>{c.resolvedAt && <p className="mt-1 text-xs text-grey-600">Resolved {dateTime(c.resolvedAt)} after {c.resolutionHours} h · SLA {c.resolvedWithinSla ? 'met' : 'missed'}</p>}</div>}
            </FormSection>

            <FormSection title="Timeline" icon={Clock} accent="purple" hint="Comments marked internal never reach the reporter.">
              {events.isPending ? <Skeleton rows={4} /> : events.isError ? <ErrorState error={events.error} retry={() => events.refetch()} /> : (
                <ol className="space-y-3">
                  {events.data!.map((e) => {
                    const Icon = e.kind === 'COMMENT' ? MessageSquare : e.kind === 'ASSIGNMENT' ? UserCheck : e.kind === 'ESCALATION' ? Flag : ArrowRight;
                    return (
                      <li key={e.id} className="flex gap-3">
                        <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', e.kind === 'ESCALATION' ? 'bg-red-soft text-red' : e.kind === 'COMMENT' && !e.isInternal ? 'bg-green-soft text-green' : 'bg-grey-100 text-grey-600')}><Icon size={14} aria-hidden /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-grey-500"><span className="font-medium text-ink">{e.authorName ?? 'System'}</span> · {dateTime(e.createdAt)}
                            {e.kind === 'STATUS_CHANGE' && e.metadata?.to && <> · {e.metadata.from ? <>{title(e.metadata.from)} → </> : null}<span className="font-medium text-ink">{title(e.metadata.to)}</span></>}
                            {e.kind === 'ESCALATION' && <> · <span className="font-medium text-red">Escalated</span></>}
                            {e.kind === 'ASSIGNMENT' && <> · {e.metadata?.assigneeId ? <>assigned to <span className="font-medium text-ink">{e.metadata.assigneeName ?? e.metadata.assigneeId.slice(0, 8)}</span></> : 'unassigned'}</>}
                            {e.kind === 'COMMENT' && <> · {e.isInternal ? <Badge>Internal</Badge> : <Badge accent="green">Visible to Reporter</Badge>}</>}
                          </p>
                          {e.body && <p className="mt-0.5 whitespace-pre-wrap text-sm">{e.body}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {manage && isOpen ? (
                <div className="mt-4 space-y-2 border-t border-grey-100 pt-4">
                  <Textarea placeholder={internal ? 'Internal note for the team…' : 'Reply to the reporter…'} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-20" maxLength={5000} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Checkbox label="Internal Note (Not Shown to the Reporter)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                    <Button size="sm" onClick={() => addComment.mutate()} loading={addComment.isPending} disabled={!comment.trim()}><MessageSquare size={14} /> {internal ? 'Add Note' : 'Send Reply'}</Button>
                  </div>
                </div>
              ) : manage && <p className="mt-3 text-xs text-grey-500">This case is {title(c.status).toLowerCase()}; {c.status === 'RESOLVED' ? 'reopen it to comment again.' : 'nothing more can be added.'}</p>}
            </FormSection>
          </div>

          <div className="space-y-4">
            <FormSection title="Status & SLA" icon={ShieldAlert} accent={sla?.tone === 'red' ? 'red' : sla?.tone === 'orange' ? 'orange' : 'green'}>
              <div className="flex flex-wrap gap-1.5"><Badge>{c.status}</Badge><Badge accent={priorityAccent(c.priority)}>{c.priority}</Badge>{c.slaBreached && <Badge accent="red">SLA Breached</Badge>}</div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-grey-500">SLA Window</dt><dd className="tnum">{c.slaHours} h</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-grey-500">Due</dt><dd className="tnum text-right" title={dateTime(c.slaDueAt)}>{c.slaDueAt ? dateTime(c.slaDueAt) : '—'}</dd></div>
                {sla && <div className="flex justify-between gap-2"><dt className="text-grey-500">Clock</dt><dd className={cx('font-medium', sla.tone === 'red' && 'text-red', sla.tone === 'orange' && 'text-orange', sla.tone === 'green' && 'text-green')}>{sla.label}</dd></div>}
                <div className="flex justify-between gap-2"><dt className="text-grey-500">Last Update</dt><dd>{relative(c.updatedAt)}</dd></div>
              </dl>
              {manage && isOpen && (
                <Field label="Priority" className="mt-3" hint={`Changing it recalculates the SLA from the time the case was opened${c.status !== 'OPEN' ? '' : ''}`}>
                  <Select value={c.priority} onChange={(e) => { const p = e.target.value; const due = nextSla(p); if (due && due.getTime() < Date.now() && !window.confirm(`With ${title(p)} priority the SLA would already be overdue (due ${dateTime(due.toISOString())}). Change anyway?`)) return; setPriority.mutate(p); }} disabled={setPriority.isPending}>
                    {options?.priorities.map((p) => <option key={p.priority} value={p.priority}>{title(p.priority)} · {p.slaHours} h SLA</option>)}
                  </Select>
                </Field>
              )}
            </FormSection>

            <FormSection title="Assignee" icon={UserCheck} accent="teal">
              {c.assignedToId ? <p className="text-sm font-medium">{c.assignedToId === meId ? 'You' : (c.assignedToName ?? c.assignedToId.slice(0, 8))}</p> : <p className="text-sm text-grey-500">Unassigned</p>}
              {manage && isOpen && (
                <div className="mt-2 space-y-2">
                  {c.assignedToId !== meId && <Button size="sm" variant="secondary" className="w-full" onClick={() => assign.mutate(meId!)} loading={assign.isPending}><UserCheck size={14} /> Assign to Me</Button>}
                  <Select aria-label="Assign To" value={c.assignedToId ?? ''} onChange={(e) => assign.mutate(e.target.value || null)} disabled={assign.isPending || !options}>
                    <option value="">Unassigned</option>
                    {options?.agents.map((a) => <option key={a.id} value={a.id}>{a.id === meId ? `${a.fullName} (you)` : a.fullName}</option>)}
                  </Select>
                  {options && options.agents.length === 0 && <p className="text-xs text-grey-500">No active users hold the support permission.</p>}
                </div>
              )}
            </FormSection>

            <FormSection title="Linked To" icon={Link2} accent="orange">
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-grey-500">Provider</dt><dd>{c.provider ? <Link className="underline underline-offset-2" href={`/providers/${c.provider.id}`}>{c.provider.displayName}</Link> : '—'}</dd></div>
                <div><dt className="text-xs text-grey-500">Transaction</dt><dd>{c.transaction ? <Link className="font-mono text-xs underline underline-offset-2" href={`/payments?transactionId=${c.transaction.id}`}>{c.transaction.reference}</Link> : '—'}</dd></div>
                <div><dt className="text-xs text-grey-500">Reporter</dt><dd>{c.reporterUserId ? <Link className="underline underline-offset-2" href={`/users/${c.reporterUserId}`}>{c.reporterName ?? c.reporterUserId.slice(0, 8)}</Link> : <span className="text-grey-500">Not a Platform User</span>}</dd></div>
                <div><dt className="text-xs text-grey-500">Opened By</dt><dd>{c.createdByName ?? '—'}</dd></div>
              </dl>
            </FormSection>
          </div>
        </div>
      )}

      {transition && c && (
        <Dialog open onClose={() => setTransition(null)} title={transition === 'IN_PROGRESS' && c.status === 'RESOLVED' ? 'Reopen Case' : `Mark as ${title(transition)}`} description={STATUS_HELP[transition]} icon={transition === 'CLOSED' ? ShieldAlert : transition === 'RESOLVED' ? CheckCircle2 : Flag}
          footer={<><Button variant="ghost" onClick={() => setTransition(null)} disabled={changeStatus.isPending}>Cancel</Button><Button variant={transition === 'CLOSED' ? 'danger' : 'primary'} onClick={() => changeStatus.mutate()} loading={changeStatus.isPending} disabled={noteRequired && note.trim().length < 5}>{transition === 'IN_PROGRESS' && c.status === 'RESOLVED' ? 'Reopen' : title(transition)}</Button></>}>
          {transition === 'CLOSED' && c.status !== 'RESOLVED' && <p className="mb-3 flex items-start gap-2 rounded-lg border border-orange/30 bg-orange-soft p-3 text-xs text-grey-700"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden /> Closing without resolving means the reporter gets no resolution text. Prefer Resolve if something was done.</p>}
          <Field label={transition === 'RESOLVED' ? 'Resolution' : transition === 'ESCALATED' ? 'Why Escalate' : 'Note'} required={noteRequired} hint={transition === 'RESOLVED' ? 'Visible to the reporter. Say what was done and what they should expect.' : noteRequired ? 'At least 5 characters; recorded on the timeline.' : 'Optional; recorded on the timeline.'}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-28" maxLength={5000} autoFocus />
          </Field>
        </Dialog>
      )}
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Create
   ═══════════════════════════════════════════════════════════════════════════ */
function CreateCaseDialog({ options, onClose, onCreated }: { options: Options; onClose: () => void; onCreated: (c: Case) => void }) {
  const [f, setF] = useState({ type: options.types[0]?.type ?? 'COMPLAINT', category: options.types[0]?.categories[0] ?? '', customCategory: '', priority: 'MEDIUM', subject: '', description: '', providerId: '', providerName: '', reporterUserId: '', reporterName: '', transactionId: '' });
  const [providerQ, setProviderQ] = useState('');
  const [reporterQ, setReporterQ] = useState('');
  const pq = useDebounced(providerQ.trim());
  const rq = useDebounced(reporterQ.trim());
  const providers = useGet<{ id: string; displayName: string; type: string; status: string }[]>(pq.length >= 2 ? `/admin/providers?q=${encodeURIComponent(pq)}&limit=8` : null);
  const reporters = useGet<{ id: string; fullName: string; email: string | null; phone: string | null }[]>(rq.length >= 2 ? `/admin/users?q=${encodeURIComponent(rq)}&limit=8` : null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const categories = options.types.find((t) => t.type === f.type)?.categories ?? [];
  const category = f.category === '__custom' ? f.customCategory.trim().toUpperCase().replace(/\s+/g, '_') : f.category;
  const sla = options.priorities.find((p) => p.priority === f.priority)?.slaHours;

  const problems: Record<string, string> = {};
  if (f.subject.trim().length < 3) problems.subject = 'At least 3 characters';
  if (f.description.trim().length < 5) problems.description = 'At least 5 characters';
  if (category.length < 2) problems.category = 'Pick or type a category';
  if (f.transactionId && !UUID.test(f.transactionId)) problems.transactionId = 'Paste the transaction ID (UUID) from Payments';
  const valid = Object.keys(problems).length === 0;

  const create = useAction(
    () => api.post<{ data: Case }>('/admin/support-cases', { type: f.type, category, priority: f.priority, subject: f.subject.trim(), description: f.description.trim(), providerId: f.providerId || undefined, reporterUserId: f.reporterUserId || undefined, transactionId: f.transactionId || undefined }),
    { success: 'Case opened', invalidate: ['/admin/support-cases'], onSuccess: (r) => onCreated(r.data), onError: (e) => { if (e instanceof ApiError) setFieldErrors(e.fieldErrors); } },
  );

  return (
    <Dialog open onClose={onClose} size="lg" icon={Plus} title="Open Case" description="Record a complaint, dispute, refund request or report so it gets an owner and an SLA."
      footer={<><Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!valid}><CheckCircle2 size={16} /> Open Case</Button></>}>
      <div className="space-y-4">
        <FormSection title="Classification" icon={Flag} accent="blue" hint="Type decides the suggested categories; priority sets the SLA clock.">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Type" required><Select value={f.type} onChange={(e) => { const t = e.target.value; const first = options.types.find((x) => x.type === t)?.categories[0] ?? ''; setF({ ...f, type: t, category: f.category === '__custom' ? '__custom' : first }); }}>{options.types.map((t) => <option key={t.type} value={t.type}>{title(t.type)}</option>)}</Select></Field>
            <Field label="Category" required error={fieldErrors.category ?? (f.category === '__custom' && f.customCategory ? problems.category : undefined)}>
              <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c} value={c}>{title(c)}</option>)}<option value="__custom">Other (Type Your Own)…</option></Select>
              {f.category === '__custom' && <Input className="mt-2" placeholder="e.g. Parking Charges" value={f.customCategory} onChange={(e) => setF({ ...f, customCategory: e.target.value })} maxLength={64} />}
            </Field>
            <Field label="Priority" required hint={sla ? `Must be resolved within ${sla} h` : undefined}><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{options.priorities.map((p) => <option key={p.priority} value={p.priority}>{title(p.priority)} · {p.slaHours} h</option>)}</Select></Field>
          </div>
        </FormSection>
        <FormSection title="Summary" icon={FileText} accent="purple">
          <div className="grid gap-3">
            <Field label="Subject" required error={fieldErrors.subject ?? (f.subject ? problems.subject : undefined)}><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} placeholder="One line a colleague would understand" autoFocus /></Field>
            <Field label="Description" required error={fieldErrors.description ?? (f.description ? problems.description : undefined)} hint="What happened, when, and what the reporter expects. No clinical details beyond what is needed."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-28" maxLength={5000} /></Field>
          </div>
        </FormSection>
        <FormSection title="Links" icon={Link2} accent="orange" hint="Optional, but linking makes the case show up on the provider and user pages.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Provider" error={fieldErrors.providerId}>
              {f.providerId ? <div className="flex items-center justify-between rounded-lg border border-grey-200 px-3 py-2 text-sm"><span className="truncate">{f.providerName}</span><button type="button" className="text-xs text-grey-500 underline-offset-2 hover:underline" onClick={() => setF({ ...f, providerId: '', providerName: '' })}>Change</button></div> : (
                <div className="relative">
                  <Input placeholder="Search by name…" value={providerQ} onChange={(e) => setProviderQ(e.target.value)} />
                  {pq.length >= 2 && (
                    <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-grey-200 bg-paper py-1 text-sm shadow-[var(--shadow-float)]">
                      {providers.isPending ? <li className="px-3 py-2 text-grey-500">Searching…</li> : providers.data?.length ? providers.data.map((p) => <li key={p.id}><button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-grey-50" onClick={() => { setF({ ...f, providerId: p.id, providerName: p.displayName }); setProviderQ(''); }}><span className="truncate">{p.displayName}</span><span className="ml-2 shrink-0 text-xs text-grey-500">{title(p.type)}</span></button></li>) : <li className="px-3 py-2 text-grey-500">No Providers Match</li>}
                    </ul>
                  )}
                </div>
              )}
            </Field>
            <Field label="Reporter (Platform User)" error={fieldErrors.reporterUserId} hint="Leave empty for walk-in or phone complaints">
              {f.reporterUserId ? <div className="flex items-center justify-between rounded-lg border border-grey-200 px-3 py-2 text-sm"><span className="truncate">{f.reporterName}</span><button type="button" className="text-xs text-grey-500 underline-offset-2 hover:underline" onClick={() => setF({ ...f, reporterUserId: '', reporterName: '' })}>Change</button></div> : (
                <div className="relative">
                  <Input placeholder="Search name, email or mobile…" value={reporterQ} onChange={(e) => setReporterQ(e.target.value)} />
                  {rq.length >= 2 && (
                    <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-grey-200 bg-paper py-1 text-sm shadow-[var(--shadow-float)]">
                      {reporters.isPending ? <li className="px-3 py-2 text-grey-500">Searching…</li> : reporters.data?.length ? reporters.data.map((u) => <li key={u.id}><button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-grey-50" onClick={() => { setF({ ...f, reporterUserId: u.id, reporterName: u.fullName }); setReporterQ(''); }}><span className="truncate">{u.fullName}</span><span className="ml-2 shrink-0 text-xs text-grey-500">{u.email ?? u.phone ?? ''}</span></button></li>) : <li className="px-3 py-2 text-grey-500">No Users Match</li>}
                    </ul>
                  )}
                </div>
              )}
            </Field>
            <Field label="Transaction ID" error={fieldErrors.transactionId ?? (f.transactionId ? problems.transactionId : undefined)} hint="For disputes and refunds: copy it from Payments & Refunds" className="md:col-span-2"><Input placeholder="00000000-0000-0000-0000-000000000000" value={f.transactionId} onChange={(e) => setF({ ...f, transactionId: e.target.value.trim() })} /></Field>
          </div>
        </FormSection>
        <p className="flex items-center gap-1.5 text-xs text-grey-500"><RefreshCw size={12} aria-hidden /> The case opens as OPEN and unassigned. Take it from the queue or assign it on the case page.</p>
      </div>
    </Dialog>
  );
}
