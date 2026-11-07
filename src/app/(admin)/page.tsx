'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ArrowRight, BadgeCheck, Building2, CalendarCheck, ClipboardList, Download, HeartPulse, type LucideIcon, MessageSquareWarning, Percent, RefreshCw, Stethoscope, Users, Wallet, BarChart3, FileSearch, CreditCard } from 'lucide-react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useGet } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api, qs } from '@/lib/api';
import { count, money, moneyCompact, pct, relative, title } from '@/lib/format';
import { ACCENT, Badge, Button, Card, CompactMoney as Money, IconTile, Select, Stat, type Accent } from '@/components/ui/primitives';
import { Breakdown, SeriesChart, pivot, seriesColor, type SeriesPoint } from '@/components/charts';
import { RequirePermission } from '@/components/layout/shell';

interface Overview {
  dataSource: string;
  range: { from: string; to: string };
  users: { total: number; byStatus: Record<string, number> };
  providers: { activeByType: Record<string, number>; byStatus: Record<string, number>; pendingVerificationCases: number };
  appointments: { inRange: number; byStatus: Record<string, number>; today: number; completionRate: number | null; cancellationRate: number | null; noShowRate: number | null };
  diagnosticOrders: { byStatus: Record<string, number> };
  pharmacyOrders: { byStatus: Record<string, number> };
  dispatch: { activeLiveRequests: number };
  finance: { grossTransactionValueMinor: number; commissionRevenueMinor: number; commissionTaxMinor: number; completedTransactions: number; refundsMinor: number; refundsCount: number; failedPayments: number; providerPayablesMinor: number; providersWithPayables: number; settlementBatchesByStatus: Record<string, number> };
  support: { openCases: number; slaBreached: number; avgResolutionHours: number | null };
}
interface Series { metric: string; unit: 'count' | 'INR_minor'; points: SeriesPoint[] }
interface AuditEvent { id: string; occurredAt: string; action: string; entityType: string; entityId: string | null; actorUserId: string | null; actorType?: string; outcome: string }

const RANGES = { '7': 'Last 7 Days', '30': 'Last 30 Days', '90': 'Last 90 Days', '365': 'Last 12 Months' } as const;
/** Start of the UTC day `d` days back: stable for the whole day, so query keys built from it never change between renders. */
const daysAgo = (d: number) => { const t = new Date(Date.now() - d * 86_400_000); t.setUTCHours(0, 0, 0, 0); return t.toISOString(); };
const INITIAL_FROM = daysAgo(30);
const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((s, v) => s + v, 0);

export default function OverviewPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [days, setDays] = useState<keyof typeof RANGES>('30');
  const [from, setFrom] = useState(INITIAL_FROM);
  // Fixed when the page opens: computing it in render changed the query key on every render (DASH-2).
  const [gtvFrom] = useState(() => daysAgo(365));
  const granularity = Number(days) > 90 ? 'month' : Number(days) > 30 ? 'week' : 'day';
  const overview = useGet<Overview>(`/admin/analytics/overview${qs({ from })}`);
  const appts = useGet<Series>(`/admin/analytics/series${qs({ metric: 'appointments', granularity, from })}`);
  const gtv = useGet<Series>(`/admin/analytics/series${qs({ metric: 'gtv', granularity: 'month', from: gtvFrom })}`);
  const regs = useGet<Series>(`/admin/analytics/series${qs({ metric: 'registrations', granularity, from })}`);
  const apps = useGet<Series>(`/admin/analytics/series${qs({ metric: 'provider_applications', granularity, from })}`);
  const activity = useGet<AuditEvent[]>(can('audit.read') ? '/admin/audit-events?limit=8' : null);
  const refunds = useGet<{ id: string }[]>(can('finance.read') ? '/admin/finance/refunds?status=REQUESTED&limit=100' : null);
  const o = overview.data;
  const canUsers = can('users.read');
  // Audit events carry only the actor's id: resolve names through the user detail endpoint (shared cache with useGet).
  const actorIds = [...new Set((activity.data ?? []).map((e) => e.actorUserId).filter((id): id is string => !!id && id !== me?.id))];
  const actorQueries = useQueries({
    queries: actorIds.map((id) => ({
      queryKey: ['get', `/admin/users/${id}`],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<{ data: { fullName?: string | null; email?: string | null } }>(`/admin/users/${id}`, signal).then((r) => r.data),
      enabled: canUsers,
      staleTime: 5 * 60_000,
    })),
  });
  const actorName = (e: AuditEvent) => {
    if (!e.actorUserId) return e.actorType && e.actorType !== 'USER' ? title(e.actorType) : 'System';
    if (e.actorUserId === me?.id) return 'You';
    const u = actorQueries[actorIds.indexOf(e.actorUserId)]?.data;
    return u?.fullName || u?.email || 'A Team Member';
  };
  const n = (v: number | undefined) => (o ? count(v ?? 0) : '—');
  const loading = overview.isPending;
  const approvedProviders = o?.providers.byStatus.APPROVED ?? 0;
  const totalProviders = sum(o?.providers.byStatus);
  const firstName = me?.fullName.split(' ')[0] ?? 'there';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const refreshAll = () => qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).startsWith('/admin/analytics') });

  return (
    <RequirePermission anyOf={['analytics.read']}>
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-ink p-6 text-paper shadow-[var(--shadow-float)] lg:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-32 right-32 h-80 w-80 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Welcome Back, {firstName}</h1>
              <span className="rounded-lg bg-white/10 px-3 py-1 text-xs">{today}</span>
            </div>
            <p className="mt-1 text-sm text-grey-300">Here&apos;s your platform performance overview{o && o.dataSource !== 'production' ? ` · ${title(o.dataSource)} environment` : ''}.</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select aria-label="Time Range" value={days} onChange={(e) => { const d = e.target.value as keyof typeof RANGES; setDays(d); setFrom(daysAgo(Number(d))); }} className="h-10 min-w-0 flex-1 rounded-lg border-white/20 bg-white/10 text-paper focus:border-white sm:w-44 sm:flex-none [&>option]:text-ink">
              {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {can('exports.create') && <Link href="/reports"><Button variant="secondary" className="rounded-lg border-white/20 bg-white/10 text-paper hover:bg-white/20"><Download size={16} /> Export</Button></Link>}
            <Button variant="secondary" aria-label="Refresh" title="Refresh" className="h-10 w-10 rounded-lg border-white/20 bg-white/10 px-0 text-paper hover:bg-white/20" onClick={refreshAll}><RefreshCw size={16} /></Button>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <HeroTile icon={CalendarCheck} label="Appointments Today" value={count(o?.appointments.today)} sub={`${count(o?.appointments.inRange)} In Range`} loading={loading} />
          <HeroTile icon={ClipboardList} label="Pending Applications" value={count(o?.providers.pendingVerificationCases)} sub={`${count(approvedProviders)} Approved Providers`} loading={loading} />
          <HeroTile icon={CreditCard} label="Gross Transaction Value" value={<Money minor={o?.finance.grossTransactionValueMinor} />} sub={`${count(o?.finance.completedTransactions)} Completed`} loading={loading} />
          <HeroTile icon={Percent} label="Commission Revenue" value={<Money minor={o?.finance.commissionRevenueMinor} />} sub={`+ ${money(o?.finance.commissionTaxMinor)} Tax`} loading={loading} />
        </div>
      </section>

      {/* KPI cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Users} accent="blue" label="Registered Users" hint="All Login Identities" value={count(o?.users.total)} loading={loading} progress={o && o.users.total ? ((o.users.byStatus.ACTIVE ?? 0) / o.users.total) * 100 : null} progressLabel="Active" footer={<span>{n(o?.users.byStatus.PENDING_VERIFICATION)} Pending Verification · {n(o?.users.byStatus.SUSPENDED)} Suspended</span>} />
        <Stat icon={Building2} accent="green" label="Approved Providers" hint="Listed for Patients" value={count(approvedProviders)} loading={loading} progress={totalProviders ? (approvedProviders / totalProviders) * 100 : null} progressLabel="Of All Registered" footer={<span>{n(o?.providers.byStatus.SUBMITTED)} Submitted · {n(o?.providers.byStatus.UNDER_REVIEW)} Under Review</span>} />
        <Stat icon={CalendarCheck} accent="orange" label="Appointments in Range" hint="All Statuses" value={count(o?.appointments.inRange)} loading={loading} progress={o?.appointments.completionRate ?? null} progressLabel="Completion Rate" footer={<span>Cancellations {pct(o?.appointments.cancellationRate)} · No-Show {pct(o?.appointments.noShowRate)}</span>} />
        <Stat icon={Wallet} accent="purple" label="Provider Payables" hint="Unsettled Ledger Balance" value={<Money minor={o?.finance.providerPayablesMinor} />} loading={loading} footer={<span>{n(o?.finance.providersWithPayables)} Providers · {n(o?.finance.settlementBatchesByStatus.PENDING_APPROVAL)} Batches Awaiting Approval</span>} />
      </div>

      {/* Revenue analytics + live activity */}
      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title="Revenue Analytics" description="Gross Transaction Value by Month, Last 12 Months" actions={<Link href="/payments" className="inline-flex min-h-10 items-center text-xs font-medium underline-offset-2 hover:underline sm:min-h-0">All Transactions</Link>}>
          <MonthlyBars series={gtv.data} loading={gtv.isPending} />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat accent="blue" label="Gross Value" value={<Money minor={o?.finance.grossTransactionValueMinor} />} />
            <MiniStat accent="green" label="Commission" value={<Money minor={o?.finance.commissionRevenueMinor} />} />
            <MiniStat accent="red" label="Refunds" value={<Money minor={o?.finance.refundsMinor} />} />
            <MiniStat accent="purple" label="Completed" value={count(o?.finance.completedTransactions)} />
          </div>
        </Card>
        <Card title="Live Activity" description="Latest Audited Actions" actions={<span className="flex items-center gap-1.5 text-xs text-green"><span className="h-2 w-2 animate-pulse rounded-full bg-green" /> Live</span>}>
          {!can('audit.read') ? <p className="text-sm text-grey-500">Audit access is required to see activity.</p> : activity.isPending ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-grey-100" />)}</div> : (
            <ul className="divide-y divide-grey-100">
              {activity.data?.map((e, i) => {
                const [domain, verb] = e.action.split('.');
                return (
                  <li key={e.id} className="flex items-start gap-3 py-2.5 first:pt-0">
                    <IconTile icon={iconFor(domain ?? '')} accent={e.outcome === 'DENIED' ? 'red' : (['blue', 'green', 'orange', 'purple', 'teal'] as Accent[])[i % 5]!} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm"><span className="font-medium">{title(domain)}</span> {verb ? title(verb) : ''}{e.entityType && e.entityType.toLowerCase() !== domain ? <span className="text-grey-500"> · {title(e.entityType)}</span> : null}</p>
                      <p className="text-xs text-grey-500">{relative(e.occurredAt)} · By {actorName(e)}</p>
                    </div>
                    {e.outcome !== 'SUCCESS' && <Badge>{e.outcome}</Badge>}
                  </li>
                );
              })}
              {!activity.data?.length && <li className="py-2 text-sm text-grey-500">No activity yet.</li>}
            </ul>
          )}
          {can('audit.read') && <Link href="/audit" className="mt-3 block text-center text-sm font-medium underline-offset-2 hover:underline">View All Activity</Link>}
        </Card>
      </div>

      {/* Quick actions + pending */}
      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card title="Quick Actions" description="Frequently Used Admin Tasks">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {can('providers.create') && <ActionTile href="/providers/hospitals" icon={Building2} accent="blue" label="Register Provider" sub="Hospital, Lab, Pharmacy…" />}
            {can('providers.read') && <ActionTile href="/applications" icon={BadgeCheck} accent="green" label="Review Applications" sub={`${count(o?.providers.pendingVerificationCases)} Pending`} />}
            {can('finance.read') && <ActionTile href="/commission-rules" icon={Percent} accent="orange" label="Commission Rules" sub="Policies & Legal Gate" />}
            {can('finance.read') && <ActionTile href="/settlements" icon={Wallet} accent="purple" label="Settlements" sub={moneyCompact(o?.finance.providerPayablesMinor)} />}
            {can('analytics.read') && <ActionTile href="/reports" icon={BarChart3} accent="teal" label="Reports" sub="Analytics & Exports" />}
            {can('audit.read') && <ActionTile href="/audit" icon={FileSearch} accent="ink" label="Audit Logs" sub="Who Did What" />}
          </div>
        </Card>
        <Card title="Pending Actions" description="Items Needing Attention" actions={<Badge accent="red">{count((o?.providers.pendingVerificationCases ?? 0) + (refunds.data?.length ?? 0) + (o?.support.openCases ?? 0))} Pending</Badge>}>
          <div className="grid gap-3 md:grid-cols-3">
            <PendingTile accent="orange" icon={ClipboardList} count={o?.providers.pendingVerificationCases} title="Provider Verifications" sub="Applications Awaiting Checks and Approval" href="/applications" cta="Review Now" />
            <PendingTile accent="blue" icon={CreditCard} count={refunds.data?.length} title="Refund Approvals" sub="Requests Waiting for a Second Approver" href="/payments" cta="Review Now" />
            <PendingTile accent="red" icon={MessageSquareWarning} count={o?.support.openCases} title="Open Complaints" sub={`${count(o?.support.slaBreached)} Past SLA`} href="/support" cta="View Cases" />
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Bookings by Status" description="Appointments Created, Stacked by Status"><SeriesChart points={appts.data?.points} loading={appts.isPending} error={appts.error} retry={() => appts.refetch()} kind="bar" /></Card>
        <Card title="Provider Applications" description="Submitted, Approved and Rejected"><SeriesChart points={apps.data?.points} loading={apps.isPending} error={apps.error} retry={() => apps.refetch()} kind="bar" /></Card>
        <Card title="Registered Users Over Time"><SeriesChart points={regs.data?.points} loading={regs.isPending} error={regs.error} retry={() => regs.refetch()} /></Card>
        <Card title="Active Providers by Category"><Breakdown data={o?.providers.activeByType} /></Card>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card title="Accounts by Status"><Breakdown data={o?.users.byStatus} /></Card>
        <Card title="Diagnostic Orders"><Breakdown data={o?.diagnosticOrders.byStatus} /></Card>
        <Card title="Emergency Dispatch" description="Live Requests Right Now">
          <div className="flex items-center gap-4">
            <IconTile icon={HeartPulse} accent={o?.dispatch.activeLiveRequests ? 'red' : 'green'} size="lg" />
            <div><p className="tnum text-3xl font-bold">{n(o?.dispatch.activeLiveRequests)}</p><p className="text-sm text-grey-600">Active Live Requests</p></div>
          </div>
          <Link href="/dispatch" className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-medium underline-offset-2 hover:underline">Open Dispatch Console <ArrowRight size={14} /></Link>
        </Card>
      </div>
    </RequirePermission>
  );
}

function HeroTile({ icon: Icon, label, value, sub, loading }: { icon: LucideIcon; label: string; value: ReactNode; sub: string; loading?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10"><Icon size={18} aria-hidden /></span>
        {loading ? <div className="h-8 w-24 animate-pulse rounded bg-white/10" /> : <p className="tnum min-w-0 max-w-full truncate text-2xl font-bold lg:text-3xl">{value}</p>}
      </div>
      <p className="mt-3 text-sm text-grey-300">{label}</p>
      <p className="mt-0.5 text-xs text-grey-400">{loading ? ' ' : sub}</p>
    </div>
  );
}

function MiniStat({ accent, label, value }: { accent: Accent; label: string; value: ReactNode }) {
  return (
    <div className={`rounded-xl p-4 text-center ${ACCENT[accent].soft}`}>
      <p className={`tnum text-lg font-bold ${ACCENT[accent].text}`}>{value}</p>
      <p className="text-xs text-grey-600">{label}</p>
    </div>
  );
}

function ActionTile({ href, icon: Icon, accent, label, sub }: { href: string; icon: LucideIcon; accent: Accent; label: string; sub: string }) {
  return (
    <Link href={href} className={`group flex flex-col justify-between rounded-2xl p-4 text-paper shadow-sm transition-transform hover:-translate-y-0.5 ${ACCENT[accent].bg}`}>
      <Icon size={22} aria-hidden className="opacity-90" />
      <div className="mt-6"><p className="text-sm font-semibold">{label}</p><p className="text-xs opacity-80">{sub}</p></div>
    </Link>
  );
}

function PendingTile({ accent, icon, count: n, title: t, sub, href, cta }: { accent: Accent; icon: LucideIcon; count: number | undefined; title: string; sub: string; href: string; cta: string }) {
  return (
    <div className={`rounded-2xl border border-grey-200 p-4 ${ACCENT[accent].soft}`}>
      <div className="flex items-start justify-between">
        <IconTile icon={icon} accent={accent} />
        <span className={`tnum flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-bold text-paper ${ACCENT[accent].bg}`}>{n ?? '—'}</span>
      </div>
      <p className="mt-4 text-sm font-semibold">{t}</p>
      <p className="text-xs text-grey-600">{sub}</p>
      <Link href={href} className={`mt-4 inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-paper ${ACCENT[accent].bg} hover:opacity-90`}>{cta} <ArrowRight size={14} /></Link>
    </div>
  );
}

function MonthlyBars({ series, loading }: { series: Series | undefined; loading: boolean }) {
  if (loading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-grey-100" />)}</div>;
  const rows = pivot(series?.points ?? []).rows.map((r) => ({ bucket: String(r.bucket), total: Object.entries(r).filter(([k]) => k !== 'bucket').reduce((s, [, v]) => s + Number(v), 0) }));
  if (!rows.length) return <p className="rounded-xl border border-dashed border-grey-300 px-4 py-8 text-center text-sm text-grey-500">No completed transactions yet. Revenue appears here once services are completed and paid.</p>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <ul className="space-y-3">
      {rows.slice(-6).map((r, i) => {
        const w = Math.max(4, Math.round((r.total / max) * 100));
        const month = new Date(r.bucket).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        return (
          <li key={r.bucket}>
            <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium">{month}</span><span className="tnum font-semibold">{money(r.total)}</span></div>
            <div className="h-9 overflow-hidden rounded-xl bg-grey-100">
              <div className="flex h-full items-center justify-end rounded-xl pr-3 text-xs font-semibold text-paper" style={{ width: `${w}%`, background: seriesColor(`m${i}`, i) }}>{w}%</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function iconFor(domain: string): LucideIcon {
  switch (domain) {
    case 'auth': case 'user': return Users;
    case 'provider': case 'verification': return Building2;
    case 'appointment': case 'schedule': case 'slot': return CalendarCheck;
    case 'affiliation': return Stethoscope;
    case 'finance': case 'payment': case 'refund': case 'settlement': case 'commission_policy': return CreditCard;
    case 'support_case': return MessageSquareWarning;
    case 'dispatch': case 'ambulance': return HeartPulse;
    default: return FileSearch;
  }
}

