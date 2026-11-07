'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Banknote, BookOpen, CheckCircle2, Clock, Landmark, Plus, Scale, Users, Wallet, XCircle } from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { count, dateTime, money, relative, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, CompactMoney, ConfirmDialog, DescriptionList, Dialog, EmptyState, ErrorState, Field, FormSection, Input, PageHeader, Progress, Skeleton, Textarea, cx } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import { ExportButton, Kpi, Lifecycle, MoneyFlow, shortId, useFinanceOverview } from '@/components/finance/shared';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Item { id: string; providerId: string; providerName?: string; amountMinor: number; status: string; payoutReference: string | null; paidAt: string | null; failureReason: string | null; attemptCount: number }
interface Batch { id: string; reference: string; status: string; periodEnd: string; totalMinor: number; itemCount: number; createdById: string; approvedById: string | null; approvedAt: string | null; completedAt: string | null; notes: string | null; createdAt: string; items?: Item[]; skipped?: Skipped[] }
interface Skipped { providerId: string; reason: string; amountMinor: number }
interface Payable { providerId: string; displayName: string; unsettledMinor: number; entries: number; hasVerifiedPayoutAccount: boolean }
interface LedgerEntry { id: string; entryType: string; amountMinor: number; transactionId: string | null; settlementItemId: string | null; description: string | null; createdAt: string }

const BATCH_FLOW = ['PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED'] as const;
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function SettlementsPage() {
  const { can } = useAuth();
  const overview = useFinanceOverview(30);
  const [tab, setTab] = useState<'batches' | 'payables'>('batches');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [ledgerOf, setLedgerOf] = useState<Payable | null>(null);
  const fin = overview.data?.finance;
  const byStatus = fin?.settlementBatchesByStatus ?? {};
  const columns: ColumnDef<Batch, unknown>[] = [
    { header: 'Batch', cell: ({ row }) => <div><span className="font-mono text-xs">{row.original.reference}</span><p className="text-[11px] text-grey-500">prepared {relative(row.original.createdAt)}</p></div> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Total', cell: ({ row }) => <span className="tnum font-medium">{money(row.original.totalMinor)}</span> },
    { header: 'Providers', cell: ({ row }) => <span className="tnum">{row.original.itemCount}</span> },
    { header: 'Entries Up To', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.periodEnd)}</span> },
    { header: 'Approved', cell: ({ row }) => <span className="text-xs text-grey-600">{row.original.approvedAt ? dateTime(row.original.approvedAt) : '—'}</span> },
    { header: 'Completed', cell: ({ row }) => <span className="text-xs text-grey-600">{row.original.completedAt ? dateTime(row.original.completedAt) : '—'}</span> },
  ];
  return (
    <RequirePermission anyOf={['finance.read']}>
      <PageHeader title="Provider Settlements" description="Provider earnings accrue in an append-only ledger. After the hold period a batch is prepared by one finance user and approved by another; every bank transfer is recorded with its UTR before an item is marked paid. Nothing is settled twice." actions={<>{<ExportButton type="settlements" />}{can('finance.settlements.create') && <Button onClick={() => setPreparing(true)}><Plus size={16} /> Prepare Batch</Button>}</>} />
      {can('analytics.read') && (
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi icon={Wallet} accent="purple" label="Owed to Providers" value={<CompactMoney minor={fin?.providerPayablesMinor} />} sub={`${count(fin?.providersWithPayables)} Providers with a Balance`} loading={overview.isPending} />
          <Kpi icon={Clock} accent="orange" label="Batches Awaiting Approval" value={count(byStatus.PENDING_APPROVAL ?? 0)} loading={overview.isPending} sub="Needs a different approver than the maker" />
          <Kpi icon={Banknote} accent="blue" label="Approved · Payouts in Progress" value={count((byStatus.APPROVED ?? 0) + (byStatus.PROCESSING ?? 0))} loading={overview.isPending} />
          <Kpi icon={AlertTriangle} accent="red" label="Partially Failed" value={count(byStatus.PARTIALLY_FAILED ?? 0)} loading={overview.isPending} sub="Failed items return to the pool" />
        </div>
      )}
      <MoneyFlow className="mb-4" />
      <nav aria-label="Settlement Sections" className="relative mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-grey-200 bg-paper p-1 shadow-[var(--shadow-card)]">
        {([['batches', 'Settlement Batches', Landmark], ['payables', 'Payable Balances', Users]] as const).map(([k, l, Icon]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition-colors', tab === k ? 'bg-ink font-medium text-paper shadow-sm' : 'text-grey-600 hover:bg-grey-100 hover:text-ink')}><Icon size={15} aria-hidden /> {l}</button>)}
      </nav>
      {tab === 'batches' && <DataTable<Batch> path="/admin/finance/settlements" columns={columns} onRowClick={(b) => setBatchId(b.id)} emptyTitle="No Settlement Batches Yet" emptyDescription="Nothing has been earned yet: batches appear once completed, paid services have posted ledger entries older than the hold period for providers with a verified payout account. See the flow above." queryKey={['settlements']} />}
      {tab === 'payables' && <PayablesTab onPrepare={() => setPreparing(true)} onLedger={setLedgerOf} />}
      {batchId && <BatchDialog id={batchId} onClose={() => setBatchId(null)} />}
      {preparing && <PrepareBatchDialog onClose={() => setPreparing(false)} onCreated={(id) => { setPreparing(false); setBatchId(id); }} />}
      {ledgerOf && <LedgerDialog payable={ledgerOf} onClose={() => setLedgerOf(null)} />}
    </RequirePermission>
  );
}

/* ─── Payables ──────────────────────────────────────────────────────────── */
function PayablesTab({ onPrepare, onLedger }: { onPrepare: () => void; onLedger: (p: Payable) => void }) {
  const { can } = useAuth();
  const payables = useGet<Payable[]>('/admin/finance/payables?limit=200');
  const [sort, setSort] = useState<'amount' | 'name'>('amount');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const rows = useMemo(() => (payables.data ?? []).filter((p) => !onlyBlocked || !p.hasVerifiedPayoutAccount).sort((a, b) => (sort === 'amount' ? b.unsettledMinor - a.unsettledMinor : a.displayName.localeCompare(b.displayName))), [payables.data, sort, onlyBlocked]);
  const totals = useMemo(() => { const all = payables.data ?? []; return { total: all.reduce((s, p) => s + p.unsettledMinor, 0), ready: all.filter((p) => p.hasVerifiedPayoutAccount && p.unsettledMinor > 0).reduce((s, p) => s + p.unsettledMinor, 0), blocked: all.filter((p) => !p.hasVerifiedPayoutAccount).length, negative: all.filter((p) => p.unsettledMinor < 0).length }; }, [payables.data]);
  return (
    <Card title="Providers with Unsettled Ledger Entries" description="Entries older than the hold period are collected into the next batch. Providers without a verified payout account, or that are suspended, are skipped and keep accruing." actions={<><label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" className="accent-black" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} /> Only Blocked</label><select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-8 rounded-lg border border-grey-300 bg-paper px-2 text-xs"><option value="amount">Largest First</option><option value="name">By Name</option></select>{can('finance.settlements.create') && totals.ready > 0 && <Button size="sm" onClick={onPrepare}><Plus size={14} /> Prepare Batch</Button>}</>} padded={false}>
      {payables.isPending ? <div className="p-5"><Skeleton /></div> : payables.isError ? <div className="p-5"><ErrorState error={payables.error} retry={() => payables.refetch()} /></div> : (payables.data ?? []).length === 0 ? <div className="p-5"><EmptyState title="Nothing Outstanding" description="Every completed, paid service has been settled." /></div> : (
        <>
          <div className="grid grid-cols-2 gap-3 border-b border-grey-100 px-5 py-3 text-xs md:grid-cols-4">
            <div><p className="text-grey-500">Total Unsettled</p><p className="tnum text-base font-bold">{money(totals.total)}</p></div>
            <div><p className="text-grey-500">Ready for the Next Batch</p><p className="tnum text-base font-bold text-green">{money(totals.ready)}</p></div>
            <div><p className="text-grey-500">Blocked (no verified account)</p><p className="tnum text-base font-bold text-orange">{totals.blocked}</p></div>
            <div><p className="text-grey-500">Owing commission (negative)</p><p className="tnum text-base font-bold">{totals.negative}</p></div>
          </div>
          {rows.length === 0 ? <div className="p-5"><EmptyState title="No Blocked Providers" /></div> : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-grey-500"><tr className="border-b border-grey-100"><th className="px-5 py-2.5 font-medium">Provider</th><th className="py-2.5 font-medium">Unsettled</th><th className="py-2.5 font-medium">Entries</th><th className="py-2.5 font-medium">Payout Account</th><th className="px-5 py-2.5 text-right font-medium">Actions</th></tr></thead>
                <tbody>{rows.map((p) => (
                  <tr key={p.providerId} className="border-b border-grey-100 last:border-0 hover:bg-grey-50">
                    <td className="px-5 py-3"><Link className="font-medium underline-offset-2 hover:underline" href={`/providers/${p.providerId}`}>{p.displayName}</Link></td>
                    <td className={cx('tnum py-3 font-medium', p.unsettledMinor < 0 && 'text-red')}>{p.unsettledMinor < 0 ? '−' : ''}{money(Math.abs(p.unsettledMinor))}{p.unsettledMinor < 0 && <p className="text-[11px] font-normal text-grey-500">provider owes commission</p>}</td>
                    <td className="tnum py-3">{p.entries}</td>
                    <td className="py-3">{p.hasVerifiedPayoutAccount ? <Badge accent="green">verified</Badge> : <div><Badge accent="orange">missing</Badge><p className="text-[11px] text-grey-500">will be skipped</p></div>}</td>
                    <td className="px-5 py-3 text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => onLedger(p)}><BookOpen size={14} /> Ledger</Button>{!p.hasVerifiedPayoutAccount && <Link href={`/providers/${p.providerId}`}><Button size="sm" variant="secondary">Add Account</Button></Link>}</div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function LedgerDialog({ payable: p, onClose }: { payable: Payable; onClose: () => void }) {
  const { can } = useAuth();
  const balance = useGet<{ balanceMinor: number; unsettledMinor: number }>(`/admin/finance/providers/${p.providerId}/balance`);
  const [adjusting, setAdjusting] = useState(false);
  const columns: ColumnDef<LedgerEntry, unknown>[] = [
    { header: 'Entry', cell: ({ row }) => <div><p className="text-xs">{title(row.original.entryType)}</p>{row.original.description && <p className="text-[11px] text-grey-500">{row.original.description}</p>}</div> },
    { header: 'Transaction', cell: ({ row }) => row.original.transactionId ? <Link href={`/payments?transactionId=${row.original.transactionId}`} className="font-mono text-xs underline-offset-2 hover:underline">{shortId(row.original.transactionId)}</Link> : <span className="text-xs text-grey-400">—</span> },
    { header: 'Settled', cell: ({ row }) => row.original.settlementItemId ? <Badge accent="green">settled</Badge> : <span className="text-xs text-grey-500">unsettled</span> },
    { header: 'When', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.createdAt)}</span> },
    { header: 'Amount', cell: ({ row }) => <span className={cx('tnum text-xs', row.original.amountMinor < 0 && 'text-red')}>{row.original.amountMinor < 0 ? '−' : ''}{money(Math.abs(row.original.amountMinor))}</span> },
  ];
  return (
    <Dialog open onClose={onClose} size="lg" icon={BookOpen} title={`Ledger — ${p.displayName}`} description="Append-only; every settlement references the exact entries it paid." footer={<>{can('finance.manual.record') && <Button variant="secondary" onClick={() => setAdjusting(true)}><Scale size={14} /> Post Adjustment</Button>}<Link href={`/providers/${p.providerId}`}><Button variant="secondary">Open Provider</Button></Link><Button onClick={onClose}>Close</Button></>}>
      {adjusting && <AdjustmentDialog providerId={p.providerId} providerName={p.displayName} onClose={() => setAdjusting(false)} onDone={() => { setAdjusting(false); void balance.refetch(); }} />}
      <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-grey-50 px-3 py-2"><p className="text-grey-500">Lifetime Balance</p><p className="tnum text-base font-bold">{balance.data ? money(balance.data.balanceMinor) : '…'}</p></div>
        <div className="rounded-xl bg-purple-soft px-3 py-2"><p className="text-grey-600">Unsettled</p><p className="tnum text-base font-bold">{balance.data ? money(balance.data.unsettledMinor) : '…'}</p></div>
      </div>
      <DataTable<LedgerEntry> path={`/admin/finance/providers/${p.providerId}/ledger`} columns={columns} pageSize={15} emptyTitle="No Ledger Entries" queryKey={['ledger', p.providerId]} />
    </Dialog>
  );
}

/* ─── Prepare batch ─────────────────────────────────────────────────────── */
function PrepareBatchDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const payables = useGet<Payable[]>('/admin/finance/payables?limit=200');
  const [notes, setNotes] = useState('');
  const [asOf, setAsOf] = useState('');
  const [problem, setProblem] = useState<{ message: string; skipped: Skipped[]; cutoff?: string } | null>(null);
  const ready = (payables.data ?? []).filter((p) => p.hasVerifiedPayoutAccount && p.unsettledMinor > 0);
  const blocked = (payables.data ?? []).filter((p) => !p.hasVerifiedPayoutAccount && p.unsettledMinor > 0);
  const create = useAction(() => api.post<{ data: Batch }>('/admin/finance/settlements', { notes: notes.trim() || undefined, ...(asOf ? { asOf: new Date(asOf).toISOString() } : {}) }, newIdempotencyKey('settle')), {
    success: 'Batch prepared — it now needs approval by another user', invalidate: ['/admin/finance'], onSuccess: (r) => onCreated(r.data.id),
    onError: (e) => { if (e instanceof ApiError) { const d = (e.details ?? {}) as { skipped?: Skipped[]; cutoff?: string }; setProblem({ message: e.message, skipped: d.skipped ?? [], cutoff: d.cutoff }); } },
  });
  return (
    <Dialog open onClose={onClose} size="lg" icon={Landmark} title="Prepare a Settlement Batch" description="Collects every unsettled ledger entry older than the hold period for providers with a positive balance and a verified payout account." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { setProblem(null); create.mutate(); }} loading={create.isPending} disabled={payables.isPending || ready.length === 0}>Prepare Batch</Button></>}>
      <div className="space-y-4">
        {payables.isPending ? <Skeleton rows={3} /> : (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-green-soft px-3 py-2"><p className="text-grey-600">Providers Ready</p><p className="tnum text-base font-bold">{ready.length}</p><p className="text-grey-600">up to {money(ready.reduce((s, p) => s + p.unsettledMinor, 0))} before the hold-period cut-off</p></div>
            <div className="rounded-xl bg-orange-soft px-3 py-2"><p className="text-grey-600">Will Be Skipped</p><p className="tnum text-base font-bold">{blocked.length}</p><p className="text-grey-600">no verified payout account · {money(blocked.reduce((s, p) => s + p.unsettledMinor, 0))}</p></div>
          </div>
        )}
        {!payables.isPending && ready.length === 0 && <p className="rounded-xl bg-grey-50 px-3 py-2 text-xs text-grey-700">No provider is ready for settlement. Verify payout accounts on the provider pages, or wait for entries to pass the hold period.</p>}
        {problem && (
          <div role="alert" className="space-y-2 rounded-xl bg-red-soft px-3 py-2 text-xs text-grey-800">
            <p className="font-medium text-red">{problem.message}</p>
            {problem.cutoff && <p>Only entries created before {dateTime(problem.cutoff)} qualify (hold period).</p>}
            {problem.skipped.length > 0 && <ul className="list-disc pl-4">{problem.skipped.map((s) => <li key={s.providerId}>{shortId(s.providerId)} · {money(s.amountMinor)} · {s.reason}</li>)}</ul>}
          </div>
        )}
        <Field label="Include Entries Up To" hint="Optional. Defaults to now; the hold period is still subtracted. Use this to close a calendar month exactly."><Input type="datetime-local" value={asOf} max={nowLocal()} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Field label="Notes" hint="Shown to the approver and on the batch · optional"><Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 1000))} className="min-h-16" placeholder="e.g. October 2026 settlement, week 2" /></Field>
        <p className="text-xs text-grey-500">Preparing a batch is idempotent and reserves the ledger entries immediately so two people cannot settle the same earnings. You will not be able to approve your own batch.</p>
      </div>
    </Dialog>
  );
}

/* ─── Batch detail ──────────────────────────────────────────────────────── */
function BatchDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, me } = useAuth();
  const batch = useGet<Batch>(`/admin/finance/settlements/${id}`);
  const [payout, setPayout] = useState<Item | null>(null);
  const [failure, setFailure] = useState<Item | null>(null);
  const [confirm, setConfirm] = useState<null | 'approve' | 'cancel'>(null);
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const onErr = (e: unknown) => { if (e instanceof ApiError) setServerError(e.message); };
  const refresh = () => void batch.refetch();
  const approve = useAction(() => api.post(`/admin/finance/settlements/${id}/approve`), { success: 'Batch approved — payouts can now be recorded', invalidate: ['/admin/finance'], onSuccess: () => { setConfirm(null); refresh(); }, onError: onErr });
  const cancel = useAction(() => api.post(`/admin/finance/settlements/${id}/cancel`, { reason: reason.trim() }), { success: 'Batch cancelled; entries returned to the pool', invalidate: ['/admin/finance'], onSuccess: () => { setConfirm(null); setReason(''); refresh(); }, onError: onErr });
  const b = batch.data;
  const isMaker = b?.createdById === me?.id;
  const items = b?.items ?? [];
  const paid = items.filter((i) => i.status === 'PAID');
  const failed = items.filter((i) => i.status === 'FAILED');
  const pending = items.filter((i) => i.status === 'PENDING');
  const paidMinor = paid.reduce((s, i) => s + i.amountMinor, 0);
  const canApprove = can('finance.settlements.approve') && b?.status === 'PENDING_APPROVAL' && !isMaker;
  const canCancel = can('finance.settlements.create') && !!b && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(b.status) && paid.length === 0;
  const canRecord = can('finance.settlements.record') && !!b && ['APPROVED', 'PROCESSING'].includes(b.status);
  const terminal = b && (b.status === 'CANCELLED' ? { status: 'CANCELLED', label: 'Cancelled' } : b.status === 'PARTIALLY_FAILED' ? { status: 'PARTIALLY_FAILED', label: 'Partially Failed' } : undefined);

  return (
    <Dialog open onClose={onClose} size="full" icon={Landmark} title={b ? `Batch ${b.reference}` : 'Settlement Batch'} description={b ? `${money(b.totalMinor)} across ${b.itemCount} provider${b.itemCount === 1 ? '' : 's'} · entries up to ${dateTime(b.periodEnd)}` : undefined}
      footer={<>
        {b?.status === 'PENDING_APPROVAL' && can('finance.settlements.approve') && <Button onClick={() => setConfirm('approve')} disabled={!canApprove} title={isMaker ? 'You prepared this batch; another approver must approve it' : undefined}><CheckCircle2 size={14} /> Approve Batch</Button>}
        {canCancel && <Button variant="danger" onClick={() => { setReason(''); setConfirm('cancel'); }}>Cancel Batch</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      {batch.isPending ? <Skeleton rows={6} /> : batch.isError ? <ErrorState error={batch.error} retry={refresh} /> : b && (
        <div className="space-y-4">
          <Lifecycle steps={BATCH_FLOW} current={b.status} terminal={terminal} />
          {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
          {b.status === 'PENDING_APPROVAL' && isMaker && <p className="flex items-start gap-2 rounded-xl bg-orange-soft px-3 py-2 text-xs text-grey-800"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />You prepared this batch, so a different user with approval rights must approve it (maker–checker).</p>}
          {b.status === 'PENDING_APPROVAL' && !isMaker && can('finance.settlements.approve') && <p className="rounded-xl bg-blue-soft px-3 py-2 text-xs text-grey-800">Review the items below. Approving authorises the finance team to make these bank transfers.</p>}
          <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <FormSection title="Summary" icon={Wallet} accent="purple">
                <DescriptionList items={[{ label: 'Status', value: <Badge>{b.status}</Badge> }, { label: 'Total', value: money(b.totalMinor) }, { label: 'Prepared', value: `${dateTime(b.createdAt)} by ${isMaker ? 'you' : shortId(b.createdById)}` }, { label: 'Approved', value: b.approvedAt ? `${dateTime(b.approvedAt)} by ${b.approvedById === me?.id ? 'you' : shortId(b.approvedById)}` : 'Not Yet' }, { label: 'Completed', value: b.completedAt ? dateTime(b.completedAt) : '—' }, { label: 'Notes', value: b.notes ?? '—' }]} />
              </FormSection>
              <FormSection title="Payout Progress" icon={Banknote} accent="green">
                <div className="mb-1 flex justify-between text-xs"><span>{paid.length} of {items.length} paid</span><span className="tnum font-medium">{money(paidMinor)} / {money(b.totalMinor)}</span></div>
                <Progress value={b.totalMinor ? (paidMinor / b.totalMinor) * 100 : 0} accent="green" />
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-grey-50 py-2"><p className="tnum font-bold">{pending.length}</p><p className="text-grey-500">pending</p></div><div className="rounded-lg bg-green-soft py-2"><p className="tnum font-bold">{paid.length}</p><p className="text-grey-600">paid</p></div><div className="rounded-lg bg-red-soft py-2"><p className="tnum font-bold">{failed.length}</p><p className="text-grey-600">failed</p></div></div>
                {failed.length > 0 && <p className="mt-2 text-[11px] text-grey-600">Failed items returned their ledger entries to the pool; they are picked up by the next batch after the account is fixed.</p>}
              </FormSection>
              {b.skipped && b.skipped.length > 0 && <FormSection title="Skipped at Preparation" icon={XCircle} accent="orange"><ul className="space-y-1 text-xs">{b.skipped.map((s) => <li key={s.providerId}><Link href={`/providers/${s.providerId}`} className="font-mono underline-offset-2 hover:underline">{shortId(s.providerId)}</Link> · {money(s.amountMinor)} · {s.reason}</li>)}</ul></FormSection>}
            </div>
            <FormSection title="Items" icon={Users} accent="blue" hint={canRecord ? 'Make each bank transfer, then record its UTR here. Record a failure if the bank rejects it.' : b.status === 'PENDING_APPROVAL' ? 'Payouts can be recorded once the batch is approved.' : undefined}>
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-grey-500"><tr className="border-b border-grey-100"><th className="py-2 font-medium">Provider</th><th className="py-2 font-medium">Amount</th><th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Bank Reference</th>{canRecord && <th className="py-2 text-right font-medium">Actions</th>}</tr></thead>
                  <tbody>{items.map((i) => (
                    <tr key={i.id} className="border-b border-grey-100 last:border-0">
                      <td className="py-2.5"><Link className="underline-offset-2 hover:underline" href={`/providers/${i.providerId}`}>{i.providerName ?? shortId(i.providerId)}</Link>{i.attemptCount > 1 && <p className="text-[11px] text-grey-500">attempt {i.attemptCount}</p>}</td>
                      <td className="tnum py-2.5 font-medium">{money(i.amountMinor)}</td>
                      <td className="py-2.5"><Badge>{i.status}</Badge>{i.failureReason && <p className="mt-0.5 max-w-xs text-[11px] text-red">{i.failureReason}</p>}</td>
                      <td className="py-2.5 text-xs">{i.payoutReference ? <span className="font-mono">{i.payoutReference}</span> : <span className="text-grey-400">—</span>}{i.paidAt && <p className="text-grey-500">{dateTime(i.paidAt)}</p>}</td>
                      {canRecord && <td className="py-2.5 text-right">{i.status === 'PENDING' && <div className="flex justify-end gap-1"><Button size="sm" onClick={() => setPayout(i)}>Record Payout</Button><Button size="sm" variant="ghost" className="text-red" onClick={() => setFailure(i)}>Failed</Button></div>}</td>}
                    </tr>
                  ))}</tbody>
                  <tfoot><tr className="border-t border-grey-200 font-semibold"><td className="py-2">Total</td><td className="tnum py-2">{money(b.totalMinor)}</td><td colSpan={canRecord ? 3 : 2} /></tr></tfoot>
                </table>
              </div>
            </FormSection>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirm === 'approve'} onClose={() => setConfirm(null)} onConfirm={() => approve.mutate()} loading={approve.isPending} title="Approve This Batch?" confirmLabel="Approve" message={b ? `You authorise bank transfers totalling ${money(b.totalMinor)} to ${b.itemCount} provider${b.itemCount === 1 ? '' : 's'}. Each transfer is still recorded individually with its UTR.` : ''} />
      <ConfirmDialog open={confirm === 'cancel'} onClose={() => setConfirm(null)} onConfirm={() => cancel.mutate()} loading={cancel.isPending} danger title="Cancel This Batch?" confirmLabel="Cancel Batch" message="All ledger entries return to the unsettled pool and will be collected by the next batch. Only possible while nothing has been paid.">
        <Field label="Reason" required className="mt-3" hint="At least 5 characters · audited"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" /></Field>
      </ConfirmDialog>
      {payout && <RecordPayoutDialog item={payout} onClose={() => setPayout(null)} onDone={() => { setPayout(null); refresh(); }} />}
      {failure && <RecordFailureDialog item={failure} onClose={() => setFailure(null)} onDone={() => { setFailure(null); refresh(); }} />}
    </Dialog>
  );
}

function RecordPayoutDialog({ item: i, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [utr, setUtr] = useState('');
  const [paidAt, setPaidAt] = useState(nowLocal);
  const [maxNow] = useState(nowLocal);
  const [openedMs] = useState(() => Date.now()); // captured once: no clock reads during render
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const utrError = utr && !/^[A-Z0-9]{8,32}$/.test(utr) ? '8–32 letters and digits (as printed on the bank confirmation)' : undefined;
  const dateError = paidAt && new Date(paidAt).getTime() > openedMs + 5 * 60_000 ? 'Cannot be in the future' : undefined;
  const record = useAction(() => api.post(`/admin/finance/settlement-items/${i.id}/payout`, { payoutReference: utr, paidAt: new Date(paidAt).toISOString(), evidenceNote: note.trim() || undefined }), { success: 'Payout recorded', invalidate: ['/admin/finance'], onSuccess: onDone, onError: (e) => { if (e instanceof ApiError) setServerError(e.message); } });
  return (
    <Dialog open onClose={onClose} icon={Banknote} title="Record Bank Payout" description={`${money(i.amountMinor)} to ${i.providerName ?? shortId(i.providerId)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => record.mutate()} loading={record.isPending} disabled={!utr || !!utrError || !paidAt || !!dateError}>Mark Paid</Button></>}>
      <div className="space-y-3">
        <p className="text-grey-700">Record this only after the bank confirms the transfer. The UTR must be unique across all payouts — a duplicate is rejected.</p>
        {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
        <Field label="Bank UTR / Transaction Reference" required error={utrError} hint="NEFT/RTGS/IMPS reference"><Input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32))} className="font-mono" aria-invalid={!!utrError} autoFocus /></Field>
        <Field label="Paid At" required error={dateError}><Input type="datetime-local" value={paidAt} max={maxNow} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        <Field label="Evidence Note" hint="Optional · e.g. statement line or approver initials"><Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} /></Field>
      </div>
    </Dialog>
  );
}

function RecordFailureDialog({ item: i, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const record = useAction(() => api.post(`/admin/finance/settlement-items/${i.id}/failure`, { reason: reason.trim() }), { success: 'Failure recorded; entries returned to the pool for retry', invalidate: ['/admin/finance'], onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} icon={XCircle} title="Record Failed Transfer" description={`${money(i.amountMinor)} to ${i.providerName ?? shortId(i.providerId)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => record.mutate()} loading={record.isPending} disabled={reason.trim().length < 5}>Record Failure</Button></>}>
      <div className="space-y-3">
        <p className="text-grey-700">The provider&apos;s ledger entries go back to the unsettled pool and are collected again by the next batch. Fix the payout account on the provider page first if the bank rejected the beneficiary.</p>
        <Field label="Bank's Reason" required hint="e.g. Account closed, IFSC invalid, name mismatch · at least 5 characters"><Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 1000))} className="min-h-20" /></Field>
      </div>
    </Dialog>
  );
}

/** Manual ledger credit/debit: append-only and audited, the alternative to editing the database. */
function AdjustmentDialog({ providerId, providerName, onClose, onDone }: { providerId: string; providerName: string; onClose: () => void; onDone: () => void }) {
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const rupees = Number(amount);
  const minor = Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null;
  const amountError = !amount ? undefined : minor == null ? 'Enter a positive amount' : minor > 100_000_000 ? 'Limited to ₹10,00,000 per entry; split larger corrections' : undefined;
  const postAdj = useAction(() => api.post<{ data: { balanceMinor: number } }>(`/admin/finance/providers/${providerId}/adjustments`, { amountMinor: direction === 'CREDIT' ? minor : -(minor ?? 0), reason: reason.trim() }), { success: 'Adjustment posted', invalidate: ['/admin/finance'], onSuccess: onDone, onError: (e) => { if (e instanceof ApiError) setServerError(e.message); } });
  return (
    <Dialog open onClose={onClose} icon={Scale} title="Post a Ledger Adjustment" description={providerName} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={direction === 'DEBIT' ? 'danger' : 'primary'} onClick={() => postAdj.mutate()} loading={postAdj.isPending} disabled={!minor || !!amountError || reason.trim().length < 10}>{direction === 'CREDIT' ? 'Credit Provider' : 'Debit Provider'}</Button></>}>
      <div className="space-y-3">
        <p className="text-grey-700">Adjustments are append-only entries with your name and reason. A credit increases what the provider is paid in the next batch; a debit reduces it. To undo one, post the opposite entry.</p>
        {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
        <div role="radiogroup" aria-label="Direction" className="inline-flex rounded-xl bg-grey-100 p-1">
          {(['CREDIT', 'DEBIT'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)} className={cx('rounded-lg px-4 py-1.5 text-sm transition-colors', direction === d ? 'bg-paper font-semibold shadow-sm' : 'text-grey-600 hover:text-ink')}>{d === 'CREDIT' ? 'Credit (Owed to Provider)' : 'Debit (Owed by Provider)'}</button>)}
        </div>
        <Field label="Amount (₹)" required error={amountError}><Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amountError} /></Field>
        <Field label="Reason" required hint="Ticket or document reference and why · at least 10 characters · audited and shown on the ledger"><Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} className="min-h-20" placeholder="e.g. Goodwill credit for payout delayed by bank outage (CAS-00042)" /></Field>
      </div>
    </Dialog>
  );
}
