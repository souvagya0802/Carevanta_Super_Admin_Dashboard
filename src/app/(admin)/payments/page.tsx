'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowLeftRight, Banknote, CreditCard, FileSearch, IndianRupee, Percent, RefreshCw, RotateCcw, ShieldCheck, Upload, Webhook as WebhookIcon, XCircle } from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useFilters, useGet } from '@/lib/hooks';
import { count, dateTime, money, relative, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, DescriptionList, Dialog, Field, FormSection, Input, PageHeader, Select, Skeleton, Textarea, cx, type Accent } from '@/components/ui/primitives';
import { CompactMoney, ErrorState } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import { InvoicesDialog } from '@/components/finance/invoices';
import { ProviderPicker, type ProviderRef } from '@/components/forms/provider-picker';
import { AmountRow, ExportButton, Kpi, Lifecycle, fmtBps, shortId, toMinor, useFinanceOverview } from '@/components/finance/shared';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Txn { id: string; reference: string; sourceType: string; sourceId: string | null; provider?: { id: string; displayName: string; type: string }; category: string; grossMinor: number; refundedMinor: number; currency: string; status: string; attribution: string; commissionEligible: boolean; eligibilityReason: string | null; serviceCompletedAt: string | null; createdAt: string }
interface Payment { id: string; transactionId: string; gateway: string; simulated: boolean; gatewayOrderId: string; gatewayPaymentId: string | null; amountMinor: number; refundedMinor: number; status: string; method: string | null; failureReason: string | null; capturedAt: string | null; createdAt: string }
interface Refund { id: string; reference: string; transactionId: string; paymentId: string | null; amountMinor: number; reason: string; status: string; requestedById: string | null; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; gatewayRefundId: string | null; processedAt: string | null; failureReason: string | null; createdAt: string }
interface Commission { id: string; policyCode: string; policyVersion: number; method: string; rateBps: number | null; flatMinor: number | null; taxRateBps: number; baseMinor: number; commissionMinor: number; taxMinor: number; providerNetMinor: number; status: string; calculatedAt: string; reversedAt: string | null }
interface Ledger { id: string; entryType: string; amountMinor: number; settlementItemId: string | null; createdAt: string }
interface TxnDetail extends Txn { payments: Payment[]; refunds: Refund[]; commissions: Commission[]; ledgerEntries: Ledger[] }
interface Webhook { id: string; gateway: string; eventId: string; eventType: string; processingStatus: string; processingError: string | null; receivedAt: string; processedAt: string | null }
interface Recon { id: string; runId: string; gateway: string; gatewayReference: string | null; paymentId: string | null; expectedMinor: number | null; actualMinor: number | null; expectedStatus: string | null; actualStatus: string | null; status: string; resolutionNote: string | null; createdAt: string; resolvedAt: string | null }

const TXN_STATUSES = ['PENDING_PAYMENT', 'PAID', 'PAY_AT_PROVIDER', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED'];
const PAYMENT_STATUSES = ['CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'REJECTED', 'FAILED'];
const WEBHOOK_STATUSES = ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'];
const RECON_STATUSES = ['AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'MISSING_INTERNAL', 'MISSING_AT_GATEWAY', 'MATCHED', 'RESOLVED'];
const REFUND_FLOW = ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED'] as const;
const MANUAL_METHODS = ['BANK_TRANSFER', 'UPI', 'CASH', 'CARD_POS', 'CHEQUE', 'OTHER'] as const;
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
/** Refunds a finance user may record as paid outside the gateway (never their own requests). */
const canRecordManualRefund = (r: Refund, meId: string | undefined, can: (p: string) => boolean) => can('finance.manual.record') && ['REQUESTED', 'APPROVED', 'FAILED'].includes(r.status) && r.requestedById !== meId;
const sourceHref = (t: Txn) => (t.sourceType === 'APPOINTMENT' ? `/appointments?q=${t.sourceId ?? ''}` : t.sourceType === 'PHARMACY_ORDER' ? `/pharmacy-orders?q=${t.sourceId ?? ''}` : t.sourceType === 'DIAGNOSTIC_ORDER' ? `/diagnostic-orders?q=${t.sourceId ?? ''}` : t.sourceType === 'DISPATCH_REQUEST' ? '/dispatch' : null);
const refundable = (t: TxnDetail | null | undefined) => (t ? t.payments.reduce((s, p) => s + (p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED' ? p.amountMinor - p.refundedMinor : 0), 0) - t.refunds.filter((r) => ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status)).reduce((s, r) => s + r.amountMinor, 0) : 0);

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function PaymentsPage() {
  return <Suspense fallback={null}><PaymentsInner /></Suspense>;
}

function PaymentsInner() {
  const sp = useSearchParams();
  const { can } = useAuth();
  const overview = useFinanceOverview(30);
  const [tab, setTab] = useState(sp.get('tab') ?? 'transactions');
  const [txnId, setTxnId] = useState<string | null>(sp.get('transactionId'));
  const [reviewing, setReviewing] = useState<Refund | null>(null);
  const [resolving, setResolving] = useState<Recon | null>(null);
  const fin = overview.data?.finance;
  const tabs: { key: string; label: string; icon: typeof CreditCard }[] = [
    { key: 'transactions', label: 'Transactions', icon: IndianRupee }, { key: 'payments', label: 'Payments', icon: CreditCard }, { key: 'refunds', label: 'Refunds', icon: RotateCcw }, { key: 'webhooks', label: 'Webhook Events', icon: WebhookIcon }, { key: 'reconciliation', label: 'Reconciliation', icon: ArrowLeftRight },
  ];
  return (
    <RequirePermission anyOf={['finance.read']}>
      <PageHeader title="Payments & Refunds" description="Payments are confirmed only by signature-verified gateway webhooks, never by the client. Refunds are maker–checker: the requester can never approve their own request, and the gateway's webhook confirms completion." />
      {can('analytics.read') && (
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi icon={IndianRupee} accent="blue" label="Gross Transaction Value · 30 Days" value={<CompactMoney minor={fin?.grossTransactionValueMinor} />} sub={`${count(fin?.completedTransactions)} Completed`} loading={overview.isPending} />
          <Kpi icon={Percent} accent="green" label="Commission Revenue · 30 Days" value={<CompactMoney minor={fin?.commissionRevenueMinor} />} sub={`+ ${money(fin?.commissionTaxMinor)} Tax Collected`} loading={overview.isPending} />
          <Kpi icon={RotateCcw} accent="orange" label="Refunded · 30 Days" value={<CompactMoney minor={fin?.refundsMinor} />} sub={`${count(fin?.refundsCount)} Refunds`} loading={overview.isPending} />
          <Kpi icon={XCircle} accent="red" label="Failed Payments · 30 Days" value={count(fin?.failedPayments)} loading={overview.isPending} />
        </div>
      )}
      <nav aria-label="Finance Sections" className="relative mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-grey-200 bg-paper p-1 shadow-[var(--shadow-card)]">
        {tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cx('inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition-colors', tab === t.key ? 'bg-ink font-medium text-paper shadow-sm' : 'text-grey-600 hover:bg-grey-100 hover:text-ink')}><t.icon size={15} aria-hidden /> {t.label}</button>)}
      </nav>

      {tab === 'transactions' && <TransactionsTab onOpen={setTxnId} />}
      {tab === 'payments' && <PaymentsTab onOpen={setTxnId} />}
      {tab === 'refunds' && <RefundsTab onOpen={setTxnId} onReview={setReviewing} />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'reconciliation' && <ReconciliationTab onResolve={setResolving} />}

      {txnId && <TransactionDialog id={txnId} onClose={() => setTxnId(null)} onReview={(r) => { setReviewing(r); }} />}
      {reviewing && <ReviewRefundDialog refund={reviewing} onClose={() => setReviewing(null)} />}
      {resolving && <ResolveDialog record={resolving} onClose={() => setResolving(null)} />}
    </RequirePermission>
  );
}

/* ─── Transactions ──────────────────────────────────────────────────────── */
function TransactionsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { filters, set } = useFilters({ status: '', commissionEligible: '' });
  const [provider, setProvider] = useState<ProviderRef | null>(null);
  const params = { ...filters, providerId: provider?.id ?? '' };
  const columns: ColumnDef<Txn, unknown>[] = [
    { header: 'Reference', cell: ({ row }) => <div><span className="font-mono text-xs">{row.original.reference}</span><p className="text-[11px] text-grey-500">{title(row.original.sourceType)} · {title(row.original.category)}</p></div> },
    { header: 'Provider', cell: ({ row }) => row.original.provider ? <Link className="underline-offset-2 hover:underline" href={`/providers/${row.original.provider.id}`} onClick={(e) => e.stopPropagation()}>{row.original.provider.displayName}</Link> : <span className="text-grey-400">—</span> },
    { header: 'Amount', cell: ({ row }) => <div className="tnum"><span>{money(row.original.grossMinor)}</span>{row.original.refundedMinor > 0 && <p className="text-[11px] text-red">−{money(row.original.refundedMinor)} refunded</p>}</div> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Attribution', cell: ({ row }) => <span className="text-xs">{title(row.original.attribution)}</span> },
    { header: 'Commission', cell: ({ row }) => row.original.commissionEligible ? <Badge accent="green">eligible</Badge> : row.original.serviceCompletedAt ? <span className="text-xs text-grey-500" title={row.original.eligibilityReason ?? ''}>not eligible</span> : <span className="text-xs text-grey-500">awaiting completion</span> },
    { header: 'Created', cell: ({ row }) => <span className="text-xs text-grey-600" title={dateTime(row.original.createdAt)}>{relative(row.original.createdAt)}</span> },
  ];
  return (
    <DataTable<Txn> path="/admin/finance/transactions" params={params} columns={columns} onRowClick={(t) => onOpen(t.id)} emptyTitle="No Transactions Match" emptyDescription="A transaction is created the moment a booking, order or ambulance trip is priced; payments, commission and the provider’s payable balance all hang off it. Clear the filters to see everything." queryKey={['txns']} toolbar={<>
      <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-48"><option value="">All Statuses</option>{TXN_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
      <Select aria-label="Commission" value={filters.commissionEligible} onChange={(e) => set('commissionEligible', e.target.value)} className="w-44"><option value="">Any Commission</option><option value="true">Commission Eligible</option><option value="false">Not Eligible</option></Select>
      <ProviderPicker value={provider} onChange={setProvider} className="w-72" placeholder="Filter by provider…" />
      <ExportButton type="transactions" filters={{ status: filters.status, providerId: provider?.id }} />
    </>} />
  );
}

/* ─── Payments ──────────────────────────────────────────────────────────── */
function PaymentsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [abandon, setAbandon] = useState<Payment | null>(null);
  const [invoicesOf, setInvoicesOf] = useState<Payment | null>(null);
  const columns: ColumnDef<Payment, unknown>[] = [
    { header: 'Gateway Order', cell: ({ row }) => <div><span className="font-mono text-xs">{row.original.gatewayOrderId}</span>{row.original.simulated && <Badge accent="blue">simulated</Badge>}<p className="text-[11px] text-grey-500">{row.original.gateway}</p></div> },
    { header: 'Gateway Payment ID', cell: ({ row }) => <span className="font-mono text-xs">{row.original.gatewayPaymentId ?? <span className="text-grey-400">not yet</span>}</span> },
    { header: 'Amount', cell: ({ row }) => <div className="tnum">{money(row.original.amountMinor)}{row.original.refundedMinor > 0 && <p className="text-[11px] text-red">−{money(row.original.refundedMinor)}</p>}</div> },
    { header: 'Status', cell: ({ row }) => <div><Badge>{row.original.status}</Badge>{row.original.failureReason && <p className="mt-0.5 max-w-xs text-[11px] text-red">{row.original.failureReason}</p>}</div> },
    { header: 'Method', cell: ({ row }) => <span className="text-xs">{row.original.method ? title(row.original.method) : '—'}</span> },
    { header: 'Captured', cell: ({ row }) => <span className="text-xs text-grey-600">{row.original.capturedAt ? dateTime(row.original.capturedAt) : '—'}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>{can('finance.manual.record') && row.original.status === 'CREATED' && <Button size="sm" variant="ghost" className="text-red" onClick={() => setAbandon(row.original)}>Mark Abandoned</Button>}{['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(row.original.status) ? <Button size="sm" variant="ghost" onClick={() => setInvoicesOf(row.original)}>Invoices</Button> : <Button size="sm" variant="ghost" disabled title="Available after payment">Invoices</Button>}<Button size="sm" variant="ghost" onClick={() => onOpen(row.original.transactionId)}>Transaction</Button></div> },
  ];
  return <>{abandon && <AbandonPaymentDialog payment={abandon} onClose={() => setAbandon(null)} />}{invoicesOf && <InvoicesDialog listPath={`/admin/finance/transactions/${invoicesOf.transactionId}/invoices`} title="Invoices" description={`Payment ${invoicesOf.gatewayOrderId} · tax invoice and any credit notes`} onClose={() => setInvoicesOf(null)} />}<DataTable<Payment> path="/admin/finance/payments" params={{ status }} columns={columns} onRowClick={(p) => onOpen(p.transactionId)} emptyTitle="No Payments" emptyDescription="A payment appears when a patient starts paying online; it is captured only after the gateway webhook is verified." queryKey={['payments']} toolbar={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48"><option value="">All Statuses</option>{PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>} /></>;
}

/* ─── Refunds ───────────────────────────────────────────────────────────── */
function RefundsTab({ onOpen, onReview }: { onOpen: (id: string) => void; onReview: (r: Refund) => void }) {
  const { can, me } = useAuth();
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState<Refund | null>(null);
  const columns: ColumnDef<Refund, unknown>[] = [
    { header: 'Refund', cell: ({ row }) => <div><span className="font-mono text-xs">{row.original.reference}</span><p className="text-[11px] text-grey-500">requested {relative(row.original.createdAt)} by {row.original.requestedById === me?.id ? 'you' : shortId(row.original.requestedById)}</p></div> },
    { header: 'Amount', cell: ({ row }) => <span className="tnum">{money(row.original.amountMinor)}</span> },
    { header: 'Reason', cell: ({ row }) => <div className="max-w-sm text-xs"><p>{row.original.reason}</p>{row.original.reviewNote && <p className="text-grey-500">Review: {row.original.reviewNote}</p>}{row.original.failureReason && <p className="text-red">{row.original.failureReason}</p>}</div> },
    { header: 'Status', cell: ({ row }) => <div><Badge>{row.original.status}</Badge>{row.original.gatewayRefundId && <p className="font-mono text-[11px] text-grey-500">{row.original.gatewayRefundId}</p>}</div> },
    { header: 'Reviewed', cell: ({ row }) => <span className="text-xs text-grey-600">{row.original.reviewedAt ? `${dateTime(row.original.reviewedAt)} by ${row.original.reviewedById === me?.id ? 'you' : shortId(row.original.reviewedById)}` : '—'}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => {
      const r = row.original;
      const self = r.requestedById === me?.id;
      return <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {can('finance.refunds.approve') && r.status === 'REQUESTED' && (self ? <span className="text-[11px] text-grey-500" title="You requested this refund; another approver must review it.">awaiting another approver</span> : <Button size="sm" variant="secondary" onClick={() => onReview(r)}>Review</Button>)}
        {canRecordManualRefund(r, me?.id, can) && <Button size="sm" variant="secondary" onClick={() => setManual(r)} title="The patient was paid back outside the gateway"><Banknote size={14} /> Record Manual Refund</Button>}
        <Button size="sm" variant="ghost" onClick={() => onOpen(r.transactionId)}>Transaction</Button>
      </div>;
    } },
  ];
  return <>{manual && <ManualRefundDialog refund={manual} onClose={() => setManual(null)} />}<DataTable<Refund> path="/admin/finance/refunds" params={{ status }} columns={columns} emptyTitle={status ? `No ${title(status).toLowerCase()} refunds` : 'No refunds'} emptyDescription="Refunds are requested from a transaction's detail view." queryKey={['refunds']} toolbar={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48"><option value="">All Statuses</option>{REFUND_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>} /></>;
}

/* ─── Webhooks ──────────────────────────────────────────────────────────── */
function WebhooksTab() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const replay = useAction((id: string) => api.post<{ data: { status: string } }>(`/admin/finance/webhook-events/${id}/replay`), { invalidate: ['/admin/finance'], success: 'Webhook re-processed' });
  const columns: ColumnDef<Webhook, unknown>[] = [
    { header: 'Event', cell: ({ row }) => <div><span className="font-mono text-xs">{row.original.eventType}</span><p className="text-[11px] text-grey-500">{row.original.gateway} · {row.original.eventId}</p></div> },
    { header: 'Processing', cell: ({ row }) => <div><Badge>{row.original.processingStatus}</Badge>{row.original.processingError && <p className="mt-0.5 max-w-md text-[11px] text-red">{row.original.processingError}</p>}</div> },
    { header: 'Received', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.receivedAt)}</span> },
    { header: 'Processed', cell: ({ row }) => <span className="text-xs text-grey-600">{row.original.processedAt ? dateTime(row.original.processedAt) : '—'}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => can('finance.manual.record') && row.original.processingStatus === 'FAILED' && <Button size="sm" variant="secondary" onClick={() => replay.mutate(row.original.id)} loading={replay.isPending} title="Re-run processing, e.g. after the order it refers to was created"><RefreshCw size={14} /> Replay</Button> },
  ];
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-xl bg-grey-50 px-3 py-2 text-xs text-grey-700"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-green" aria-hidden />Every webhook is verified with the gateway&apos;s HMAC signature over the raw body and de-duplicated by event id. IGNORED means a valid event we do not act on; FAILED events are retried by the worker and the error is shown here.</p>
      <DataTable<Webhook> path="/admin/finance/webhook-events" params={{ status }} columns={columns} emptyTitle="No Webhook Events Received" queryKey={['webhooks']} toolbar={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48"><option value="">All</option>{WEBHOOK_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>} />
    </div>
  );
}

/* ─── Reconciliation ────────────────────────────────────────────────────── */
interface Line { gatewayPaymentId: string; gatewayOrderId: string; amountMinor: number; currency: string; status: string }
const LINE_STATUSES = ['captured', 'failed', 'refunded', 'authorized'];

/** Parses a pasted/uploaded gateway statement: CSV with optional header, or whitespace/tab separated. */
function parseStatement(text: string): { lines: Line[]; errors: string[] } {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  const lines: Line[] = [];
  let start = 0;
  if (rows[0] && /payment|order|amount/i.test(rows[0]) && !/^\s*pay_/i.test(rows[0])) start = 1; // header row
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i]!.split(/[,\t;]|\s{2,}/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const [pid, oid, amt, cur, st] = cells;
    if (!pid || !oid || !amt) { errors.push(`Line ${i + 1}: need payment id, order id and amount`); continue; }
    const minor = toMinor(amt);
    if (minor == null) { errors.push(`Line ${i + 1}: invalid amount “${amt}”`); continue; }
    const status = (st ?? 'captured').toLowerCase();
    if (!LINE_STATUSES.includes(status)) { errors.push(`Line ${i + 1}: status must be one of ${LINE_STATUSES.join(', ')}`); continue; }
    lines.push({ gatewayPaymentId: pid.slice(0, 64), gatewayOrderId: oid.slice(0, 64), amountMinor: minor, currency: (cur || 'INR').toUpperCase().slice(0, 3), status });
  }
  return { lines, errors };
}

function ReconciliationTab({ onResolve }: { onResolve: (r: Recon) => void }) {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [runId, setRunId] = useState('');
  const [open, setOpen] = useState(false);
  const columns: ColumnDef<Recon, unknown>[] = [
    { header: 'Gateway Reference', cell: ({ row }) => <div><span className="font-mono text-xs">{row.original.gatewayReference ?? '—'}</span><p className="text-[11px] text-grey-500">{row.original.gateway}{row.original.paymentId ? ` · internal ${shortId(row.original.paymentId)}` : ''}</p></div> },
    { header: 'Expected (ours)', cell: ({ row }) => <span className="tnum text-xs">{row.original.expectedMinor != null ? money(row.original.expectedMinor) : '—'} {row.original.expectedStatus ? <Badge>{row.original.expectedStatus}</Badge> : null}</span> },
    { header: 'Actual (gateway)', cell: ({ row }) => <span className="tnum text-xs">{row.original.actualMinor != null ? money(row.original.actualMinor) : '—'} {row.original.actualStatus ? <Badge>{row.original.actualStatus}</Badge> : null}</span> },
    { header: 'Result', cell: ({ row }) => <div><Badge>{row.original.status}</Badge>{row.original.resolutionNote && <p className="mt-0.5 max-w-xs text-[11px] text-grey-600">{row.original.resolutionNote}</p>}</div> },
    { header: 'Run', cell: ({ row }) => <button type="button" onClick={() => setRunId(row.original.runId)} className="font-mono text-xs underline-offset-2 hover:underline" title="Show Only This Run">{shortId(row.original.runId)}</button> },
    { header: 'When', cell: ({ row }) => <span className="text-xs text-grey-600">{relative(row.original.createdAt)}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => can('finance.reconcile') && !['MATCHED', 'RESOLVED'].includes(row.original.status) && <Button size="sm" variant="secondary" onClick={() => onResolve(row.original)}>Resolve</Button> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-grey-600">Compare the gateway&apos;s settlement statement with our payments. Mismatches are listed first; each must be resolved with a note.</p>
        {can('finance.reconcile') && <Button size="sm" onClick={() => setOpen(true)}><Upload size={14} /> Run Reconciliation</Button>}
      </div>
      <DataTable<Recon> path="/admin/finance/reconciliation/records" params={{ status, runId }} columns={columns} emptyTitle="No Reconciliation Records" emptyDescription="Run a reconciliation with a gateway statement to populate this list." queryKey={['recon']} toolbar={<>
        <Select aria-label="Result" value={status} onChange={(e) => setStatus(e.target.value)} className="w-52"><option value="">All Results</option>{RECON_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
        {runId && <Button size="sm" variant="secondary" onClick={() => setRunId('')}>Run {shortId(runId)} ✕</Button>}
      </>} />
      {open && <RunReconciliationDialog onClose={() => setOpen(false)} onDone={(id) => { setOpen(false); setRunId(id); }} />}
    </div>
  );
}

function RunReconciliationDialog({ onClose, onDone }: { onClose: () => void; onDone: (runId: string) => void }) {
  const [gateway, setGateway] = useState<'RAZORPAY' | 'TEST_GATEWAY'>('RAZORPAY');
  const [range, setRange] = useState({ from: '', to: '' });
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ runId: string; counts: Record<string, number> } | null>(null);
  const parsed = useMemo(() => parseStatement(text), [text]);
  const rangeError = range.from && range.to && new Date(range.to) < new Date(range.from) ? 'End must be after start' : undefined;
  const total = parsed.lines.reduce((s, l) => s + l.amountMinor, 0);
  const run = useAction(() => api.post<{ data: { runId: string; counts: Record<string, number> } }>('/admin/finance/reconciliation/runs', { gateway, from: new Date(range.from).toISOString(), to: new Date(`${range.to}T23:59:59.999`).toISOString(), lines: parsed.lines }), { success: 'Reconciliation completed', invalidate: ['/admin/finance/reconciliation'], onSuccess: (r) => setResult(r.data) });
  const onFile = async (file: File | null) => { if (!file) return; if (file.size > 2 * 1024 * 1024) { setText(''); return alert('Statement file is larger than 2 MB'); } setText(await file.text()); };
  const ready = range.from && range.to && !rangeError && parsed.lines.length > 0 && parsed.lines.length <= 5000;
  return (
    <Dialog open onClose={onClose} size="lg" icon={ArrowLeftRight} title="Run a Reconciliation" description="Paste or upload the gateway statement for a period; we match each line to our payment records." footer={result ? <><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={() => onDone(result.runId)}>Show This Run’s Records</Button></> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => run.mutate()} loading={run.isPending} disabled={!ready}>Reconcile {parsed.lines.length ? `${parsed.lines.length} lines` : ''}</Button></>}>
      {result ? (
        <div className="space-y-3">
          <p className="text-grey-700">Run <span className="font-mono">{shortId(result.runId)}</span> finished.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(result.counts).map(([k, v]) => <div key={k} className={cx('rounded-xl px-3 py-2', k === 'MATCHED' ? 'bg-green-soft' : v > 0 ? 'bg-red-soft' : 'bg-grey-50')}><p className="tnum text-lg font-bold">{v}</p><p className="text-[11px] text-grey-600">{title(k)}</p></div>)}</div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Gateway" required><Select value={gateway} onChange={(e) => setGateway(e.target.value as typeof gateway)}><option value="RAZORPAY">Razorpay</option><option value="TEST_GATEWAY">Test gateway (non-production)</option></Select></Field>
            <Field label="Statement From" required><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            <Field label="Statement To" required error={rangeError}><Input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          </div>
          <Field label="Statement File" hint="CSV from the gateway dashboard · columns: payment id, order id, amount (₹), currency, status"><Input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} className="h-auto py-1.5" /></Field>
          <Field label="Or Paste Lines" hint="pay_xxx, order_xxx, 1500.00, INR, captured"><Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-32 font-mono text-xs" spellCheck={false} /></Field>
          {text && (
            <div className={cx('rounded-xl px-3 py-2 text-xs', parsed.errors.length ? 'bg-orange-soft' : 'bg-green-soft')}>
              <p className="font-medium">{parsed.lines.length} valid line{parsed.lines.length === 1 ? '' : 's'} · total {money(total)}{parsed.lines.length > 5000 && ' · over the 5,000-line limit, split the statement'}</p>
              {parsed.errors.slice(0, 5).map((er) => <p key={er} className="text-grey-700">{er}</p>)}
              {parsed.errors.length > 5 && <p className="text-grey-600">…and {parsed.errors.length - 5} more problems</p>}
            </div>
          )}
          <p className="flex items-start gap-2 text-xs text-grey-600"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-orange" aria-hidden />Payments we captured in this period that are missing from the statement are flagged MISSING_AT_GATEWAY, so make sure the statement covers the whole range.</p>
        </div>
      )}
    </Dialog>
  );
}

function ResolveDialog({ record: r, onClose }: { record: Recon; onClose: () => void }) {
  const [note, setNote] = useState('');
  const resolve = useAction(() => api.post(`/admin/finance/reconciliation/records/${r.id}/resolve`, { note }), { success: 'Exception resolved', invalidate: ['/admin/finance/reconciliation'], onSuccess: onClose });
  const hints: Record<string, string> = { AMOUNT_MISMATCH: 'Confirm which amount is right; if the gateway captured less, request a partial adjustment before resolving.', STATUS_MISMATCH: 'Check the gateway dashboard; a late webhook usually explains it.', MISSING_INTERNAL: 'The gateway has a payment we do not — look for a deleted or mis-keyed order.', MISSING_AT_GATEWAY: 'We captured a payment the statement lacks — verify the statement period or a possible chargeback.' };
  return (
    <Dialog open onClose={onClose} icon={FileSearch} title={`Resolve ${title(r.status)}`} description={r.gatewayReference ?? shortId(r.paymentId)} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => resolve.mutate()} loading={resolve.isPending} disabled={note.trim().length < 5}>Mark Resolved</Button></>}>
      <div className="space-y-3">
        <DescriptionList items={[{ label: 'Expected (ours)', value: `${r.expectedMinor != null ? money(r.expectedMinor) : '—'} ${r.expectedStatus ?? ''}` }, { label: 'Actual (gateway)', value: `${r.actualMinor != null ? money(r.actualMinor) : '—'} ${r.actualStatus ?? ''}` }]} />
        {hints[r.status] && <p className="rounded-xl bg-grey-50 px-3 py-2 text-xs text-grey-700">{hints[r.status]}</p>}
        <Field label="Resolution Note" required hint="What you checked and the outcome · at least 5 characters · audited"><Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} className="min-h-20" /></Field>
      </div>
    </Dialog>
  );
}

/* ─── Transaction detail ────────────────────────────────────────────────── */
function TransactionDialog({ id, onClose, onReview }: { id: string; onClose: () => void; onReview: (r: Refund) => void }) {
  const { can, me } = useAuth();
  const detail = useGet<TxnDetail>(`/admin/finance/transactions/${id}`);
  const [refunding, setRefunding] = useState(false);
  const [offline, setOffline] = useState(false);
  const [manualRefund, setManualRefund] = useState<Refund | null>(null);
  const [abandon, setAbandon] = useState<Payment | null>(null);
  const t = detail.data;
  const canOffline = can('finance.manual.record') && !!t && ['PENDING_PAYMENT', 'PAY_AT_PROVIDER'].includes(t.status);
  const openCheckout = t?.payments.find((p) => p.status === 'CREATED' && p.gateway !== 'MANUAL');
  const refundableMinor = refundable(t);
  const net = t ? t.grossMinor - t.refundedMinor : 0;
  const commission = t?.commissions.find((c) => c.status !== 'REVERSED') ?? t?.commissions.at(-1);
  const src = t ? sourceHref(t) : null;
  return (
    <Dialog open onClose={onClose} size="full" icon={IndianRupee} title={t ? `Transaction ${t.reference}` : 'Transaction'} description={t ? `${title(t.sourceType)} · ${title(t.category)} · ${t.provider?.displayName ?? 'no provider'}` : undefined}
      footer={<>{canOffline && <Button variant="secondary" onClick={() => setOffline(true)} disabled={!!openCheckout} title={openCheckout ? 'An online checkout is still open; mark it abandoned first' : 'Money received outside the gateway'}><Banknote size={14} /> Record Offline Payment</Button>}{can('finance.refunds.request') && t && refundableMinor > 0 && <Button variant="secondary" onClick={() => setRefunding(true)}><RotateCcw size={14} /> Request Refund</Button>}{src && <Link href={src}><Button variant="secondary">Open {title(t!.sourceType).toLowerCase()}</Button></Link>}<Button onClick={onClose}>Close</Button></>}>
      {detail.isPending ? <Skeleton rows={6} /> : detail.isError ? <ErrorState error={detail.error} retry={() => detail.refetch()} /> : t && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Tile label="Gross Value" value={money(t.grossMinor)} accent="blue" />
            <Tile label="Refunded" value={money(t.refundedMinor)} accent={t.refundedMinor ? 'red' : 'ink'} sub={refundableMinor > 0 ? `${money(refundableMinor)} still refundable` : undefined} />
            <Tile label="Net Collected" value={money(net)} accent="green" />
            <Tile label="Platform Commission" value={commission ? money(commission.commissionMinor + commission.taxMinor) : '—'} accent="purple" sub={commission ? `${commission.policyCode} v${commission.policyVersion} · ${commission.status.toLowerCase()}` : t.commissionEligible ? 'calculated on completion' : (t.eligibilityReason ?? 'not eligible')} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <FormSection title="Details" icon={FileSearch} accent="ink">
              <DescriptionList items={[{ label: 'Status', value: <Badge>{t.status}</Badge> }, { label: 'Attribution', value: `${title(t.attribution)}${t.attribution === 'PROVIDER_DIRECT' ? ' (walk-in)' : ''}` }, { label: 'Provider', value: t.provider ? <Link href={`/providers/${t.provider.id}`} className="underline-offset-2 hover:underline">{t.provider.displayName}</Link> : '—' }, { label: 'Source', value: `${title(t.sourceType)} ${shortId(t.sourceId)}` }, { label: 'Service Completed', value: t.serviceCompletedAt ? dateTime(t.serviceCompletedAt) : 'Not Yet' }, { label: 'Created', value: dateTime(t.createdAt) }, { label: 'Commission Eligibility', value: t.commissionEligible ? 'Eligible' : (t.eligibilityReason ?? 'Not Eligible') }, { label: 'Currency', value: t.currency }]} />
            </FormSection>
            <FormSection title="Commission Snapshots" icon={Percent} accent="purple" hint="Frozen at completion; a later policy change never alters them. A refund reverses and recalculates on the remaining base.">
              {t.commissions.length === 0 ? <p className="text-xs text-grey-500">No commission calculated yet.</p> : (
                <div className="space-y-2">{t.commissions.map((c) => (
                  <div key={c.id} className={cx('rounded-xl border p-3', c.status === 'REVERSED' ? 'border-grey-200 opacity-60' : 'border-grey-200')}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-mono">{c.policyCode} v{c.policyVersion} · {c.method === 'PERCENTAGE' ? fmtBps(c.rateBps ?? 0) : money(c.flatMinor)}{c.taxRateBps ? ` + ${fmtBps(c.taxRateBps)} tax` : ''}</span><span className="flex items-center gap-2 text-grey-500"><Badge>{c.status}</Badge>{dateTime(c.calculatedAt)}</span></div>
                    <AmountRow label="Base" minor={c.baseMinor} /><AmountRow label="Commission" minor={c.commissionMinor} negative /><AmountRow label="Tax" minor={c.taxMinor} negative /><AmountRow label="Provider Net" minor={c.providerNetMinor} strong />
                  </div>
                ))}</div>
              )}
            </FormSection>
            <FormSection title="Payments" icon={CreditCard} accent="blue">
              {t.payments.length === 0 ? <p className="text-xs text-grey-500">{t.status === 'PAY_AT_PROVIDER' ? 'Paid at the provider; no online payment.' : 'No online payment started.'}</p> : (
                <ul className="divide-y divide-grey-100 text-xs">{t.payments.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><p className="font-mono">{p.gatewayOrderId}{p.gatewayPaymentId ? ` · ${p.gatewayPaymentId}` : ''}</p><p className="text-grey-500">{p.gateway}{p.simulated ? ' (simulated)' : ''}{p.method ? ` · ${title(p.method)}` : ''}{p.capturedAt ? ` · captured ${dateTime(p.capturedAt)}` : ''}</p>{p.failureReason && <p className="text-red">{p.failureReason}</p>}{can('finance.manual.record') && p.status === 'CREATED' && p.gateway !== 'MANUAL' && <Button size="sm" variant="ghost" className="mt-1 text-red" onClick={() => setAbandon(p)}>Mark Abandoned</Button>}</div><div className="tnum text-right"><p>{money(p.amountMinor)}</p><Badge>{p.status}</Badge>{p.gateway === 'MANUAL' && <p className="text-[11px] text-grey-500">recorded manually</p>}</div></li>)}</ul>
              )}
            </FormSection>
            <FormSection title="Refunds" icon={RotateCcw} accent="orange">
              {t.refunds.length === 0 ? <p className="text-xs text-grey-500">No refunds.</p> : (
                <ul className="divide-y divide-grey-100 text-xs">{t.refunds.map((r) => <li key={r.id} className="space-y-1 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono">{r.reference}</span><span className="tnum">{money(r.amountMinor)} <Badge>{r.status}</Badge></span></div><Lifecycle steps={REFUND_FLOW} current={r.status} terminal={r.status === 'REJECTED' || r.status === 'FAILED' ? { status: r.status } : undefined} /><p className="text-grey-600">{r.reason}</p>{r.reviewNote && <p className="text-grey-500">Review: {r.reviewNote}</p>}<div className="flex flex-wrap items-center gap-1">{can('finance.refunds.approve') && r.status === 'REQUESTED' && r.requestedById !== me?.id && <Button size="sm" variant="secondary" onClick={() => onReview(r)}>Review</Button>}{canRecordManualRefund(r, me?.id, can) && <Button size="sm" variant="secondary" onClick={() => setManualRefund(r)}><Banknote size={14} /> Record Manual Refund</Button>}{r.status === 'APPROVED' && <span className="text-[11px] text-orange">approved — pay the patient and record it</span>}</div></li>)}</ul>
              )}
            </FormSection>
            <FormSection title="Ledger Entries" icon={ArrowLeftRight} accent="teal" hint="Append-only. Positive entries are owed to the provider; negative entries are commission, tax or clawbacks." className="xl:col-span-2">
              {t.ledgerEntries.length === 0 ? <p className="text-xs text-grey-500">Nothing posted yet — entries are written when the service is completed.</p> : (
                <table className="w-full text-xs"><thead className="text-left text-grey-500"><tr><th className="py-1 font-medium">Entry</th><th className="py-1 font-medium">Settled</th><th className="py-1 font-medium">When</th><th className="py-1 text-right font-medium">Amount</th></tr></thead>
                  <tbody>{t.ledgerEntries.map((e) => <tr key={e.id} className="border-t border-grey-100"><td className="py-1.5">{title(e.entryType)}</td><td className="py-1.5">{e.settlementItemId ? <Badge accent="green">settled</Badge> : <span className="text-grey-500">unsettled</span>}</td><td className="py-1.5 text-grey-600">{dateTime(e.createdAt)}</td><td className={cx('tnum py-1.5 text-right', e.amountMinor < 0 && 'text-red')}>{e.amountMinor < 0 ? '−' : ''}{money(Math.abs(e.amountMinor))}</td></tr>)}
                  <tr className="border-t border-grey-200 font-semibold"><td className="py-1.5" colSpan={3}>Provider Balance from This Transaction</td><td className="tnum py-1.5 text-right">{money(t.ledgerEntries.reduce((s, e) => s + e.amountMinor, 0))}</td></tr></tbody></table>
              )}
            </FormSection>
          </div>
        </div>
      )}
      {refunding && t && <RequestRefundDialog txn={t} refundableMinor={refundableMinor} onClose={() => setRefunding(false)} onDone={() => { setRefunding(false); void detail.refetch(); }} />}
      {offline && t && <OfflinePaymentDialog txn={t} onClose={() => setOffline(false)} onDone={() => { setOffline(false); void detail.refetch(); }} />}
      {manualRefund && <ManualRefundDialog refund={manualRefund} onClose={() => setManualRefund(null)} onDone={() => { setManualRefund(null); void detail.refetch(); }} />}
      {abandon && <AbandonPaymentDialog payment={abandon} onClose={() => setAbandon(null)} onDone={() => { setAbandon(null); void detail.refetch(); }} />}
    </Dialog>
  );
}

function Tile({ label, value, accent, sub }: { label: string; value: string; accent: Accent; sub?: string }) {
  const bg: Record<Accent, string> = { ink: 'bg-grey-50', blue: 'bg-blue-soft', green: 'bg-green-soft', orange: 'bg-orange-soft', purple: 'bg-purple-soft', red: 'bg-red-soft', teal: 'bg-teal-soft' };
  return <div className={cx('rounded-2xl px-4 py-3', bg[accent])}><p className="text-[11px] text-grey-600">{label}</p><p className="tnum text-lg font-bold">{value}</p>{sub && <p className="truncate text-[11px] text-grey-600" title={sub}>{sub}</p>}</div>;
}

function RequestRefundDialog({ txn, refundableMinor, onClose, onDone }: { txn: TxnDetail; refundableMinor: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const minor = toMinor(amount);
  const amountError = !amount ? undefined : minor == null || minor <= 0 ? 'Enter a positive amount' : minor > refundableMinor ? `At most ${money(refundableMinor)} is refundable` : undefined;
  const request = useAction(() => api.post('/admin/finance/refunds', { transactionId: txn.id, amountMinor: minor, reason: reason.trim() }, newIdempotencyKey('refund')), { success: 'Refund requested — awaiting a second approver', invalidate: ['/admin/finance'], onSuccess: onDone, onError: (e) => { if (e instanceof ApiError) setServerError(e.message); } });
  const pendingOthers = txn.refunds.filter((r) => ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status));
  return (
    <Dialog open onClose={onClose} icon={RotateCcw} title="Request a Refund" description={`${txn.reference} · ${money(refundableMinor)} refundable`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => request.mutate()} loading={request.isPending} disabled={!minor || !!amountError || reason.trim().length < 5}>Request Refund</Button></>}>
      <div className="space-y-3">
        <p className="text-grey-700">A different user with refund-approval rights must approve before the gateway is called. The patient is refunded through the original payment method.</p>
        {pendingOthers.length > 0 && <p className="rounded-xl bg-orange-soft px-3 py-2 text-xs text-grey-800">{pendingOthers.length} refund{pendingOthers.length === 1 ? ' is' : 's are'} already in progress on this transaction ({money(pendingOthers.reduce((s, r) => s + r.amountMinor, 0))}); the refundable amount above already excludes them.</p>}
        {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
        <Field label="Amount (₹)" required error={amountError} hint={`Maximum ${money(refundableMinor)}`}>
          <div className="flex gap-2"><Input type="number" min={0.01} max={refundableMinor / 100} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amountError} /><Button variant="secondary" onClick={() => setAmount((refundableMinor / 100).toFixed(2))}>Full</Button></div>
        </Field>
        <Field label="Reason" required hint="Shown to the approver and kept in the audit log · at least 5 characters"><Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 1000))} className="min-h-20" placeholder="e.g. Provider cancelled the appointment; patient requested a full refund" /></Field>
      </div>
    </Dialog>
  );
}

function ReviewRefundDialog({ refund: r, onClose }: { refund: Refund; onClose: () => void }) {
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const review = useAction(() => api.post(`/admin/finance/refunds/${r.id}/review`, { decision, note: note.trim() }), { success: decision === 'APPROVE' ? 'Refund approved and sent to the gateway' : 'Refund rejected', invalidate: ['/admin/finance'], onSuccess: onClose, onError: (e) => { if (e instanceof ApiError) setServerError(e.message); } });
  return (
    <Dialog open onClose={onClose} icon={ShieldCheck} title={`Review Refund ${r.reference}`} description={`${money(r.amountMinor)} · requested ${relative(r.createdAt)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={decision === 'REJECT' ? 'danger' : 'primary'} onClick={() => review.mutate()} loading={review.isPending} disabled={note.trim().length < 5}>{decision === 'APPROVE' ? 'Approve Refund' : 'Reject Refund'}</Button></>}>
      <div className="space-y-3">
        <p className="rounded-xl bg-grey-50 px-3 py-2 text-xs text-grey-700"><span className="font-medium">Requester’s reason:</span> {r.reason}</p>
        {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
        <div role="radiogroup" aria-label="Decision" className="inline-flex rounded-xl bg-grey-100 p-1">
          {(['APPROVE', 'REJECT'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={decision === d} onClick={() => setDecision(d)} className={cx('rounded-lg px-4 py-1.5 text-sm transition-colors', decision === d ? 'bg-paper font-semibold shadow-sm' : 'text-grey-600 hover:text-ink')}>{d === 'APPROVE' ? 'Approve' : 'Reject'}</button>)}
        </div>
        <p className="text-xs text-grey-600">{decision === 'APPROVE' ? `${money(r.amountMinor)} is sent to the gateway now. Completion is confirmed by the gateway's webhook; the provider's ledger is clawed back and commission recalculated on the remaining base.` : 'Nothing is sent to the gateway. The requester sees your note.'}</p>
        <Field label="Review Note" required hint="At least 5 characters · audited"><Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} className="min-h-20" /></Field>
      </div>
    </Dialog>
  );
}

/* ─── Manual operations (the audited alternative to touching the database) ── */
function OfflinePaymentDialog({ txn, onClose, onDone }: { txn: TxnDetail; onClose: () => void; onDone: () => void }) {
  const due = txn.grossMinor - txn.payments.filter((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED').reduce((s, p) => s + p.amountMinor, 0);
  const [receivedBy, setReceivedBy] = useState<'PLATFORM' | 'PROVIDER'>('PLATFORM');
  const [amount, setAmount] = useState((due / 100).toFixed(2));
  const [method, setMethod] = useState<(typeof MANUAL_METHODS)[number]>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(nowLocal);
  const [maxNow] = useState(nowLocal);
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const minor = toMinor(amount);
  const amountError = receivedBy === 'PROVIDER' ? undefined : !amount ? 'Required' : minor == null || minor <= 0 ? 'Enter a positive amount' : minor > due ? `Only ${money(due)} is still due` : undefined;
  const refError = reference && reference.trim().length < 3 ? 'At least 3 characters' : undefined;
  const record = useAction(() => api.post(`/admin/finance/transactions/${txn.id}/manual-payments`, { receivedBy, ...(receivedBy === 'PLATFORM' ? { amountMinor: minor } : {}), method, reference: reference.trim() || undefined, receivedAt: new Date(receivedAt).toISOString(), note: note.trim() }), { success: receivedBy === 'PLATFORM' ? 'Payment recorded' : 'Marked as paid at the provider', invalidate: ['/admin/finance'], onSuccess: onDone, onError: (e) => { if (e instanceof ApiError) setServerError(e.message); } });
  const ready = !amountError && !refError && note.trim().length >= 5 && !!receivedAt;
  return (
    <Dialog open onClose={onClose} size="lg" icon={Banknote} title="Record an Offline Payment" description={`${txn.reference} · ${money(due)} due`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => record.mutate()} loading={record.isPending} disabled={!ready}>{receivedBy === 'PLATFORM' ? 'Record Payment' : 'Mark Paid at Provider'}</Button></>}>
      <div className="space-y-4">
        <p className="text-grey-700">Use this when money moved outside the payment gateway. It is recorded with your name and reason in the audit log and can never be edited afterwards; a mistake is corrected with a refund or a ledger adjustment.</p>
        {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
        <Field label="Who Received the Money?" required>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {([['PLATFORM', 'The Platform', 'Bank transfer / UPI / cash deposit into the platform account. A payment is captured; once fully paid the provider is owed the earning.'], ['PROVIDER', 'The Provider, at the Counter', 'The patient paid the provider directly. The platform holds no money; the provider owes commission when the service completes.']] as const).map(([v, l, d]) => (
              <button key={v} type="button" role="radio" aria-checked={receivedBy === v} onClick={() => setReceivedBy(v)} className={cx('rounded-xl border p-3 text-left text-xs', receivedBy === v ? 'border-ink bg-grey-50' : 'border-grey-200 hover:bg-grey-50')}><p className="text-sm font-semibold">{l}</p><p className="mt-1 text-grey-600">{d}</p></button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          {receivedBy === 'PLATFORM' && <Field label="Amount Received (₹)" required error={amountError} hint={`Up to ${money(due)}; partial amounts are allowed`}><Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amountError} /></Field>}
          <Field label="Method" required><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{MANUAL_METHODS.map((m) => <option key={m} value={m}>{title(m)}</option>)}</Select></Field>
          <Field label="Receipt / Bank Reference" error={refError} hint={receivedBy === 'PLATFORM' ? 'UTR, UPI reference or receipt number; must be unique' : 'Optional receipt number'}><Input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className="font-mono" maxLength={60} /></Field>
          <Field label="Received At" required><Input type="datetime-local" value={receivedAt} max={maxNow} onChange={(e) => setReceivedAt(e.target.value)} /></Field>
          <Field label="Reason / Evidence" required className="md:col-span-2" hint="Who confirmed the money and where · at least 5 characters · audited"><Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} className="min-h-16" placeholder="e.g. NEFT seen in the platform current account statement on 17 Oct, confirmed by accounts" /></Field>
        </div>
      </div>
    </Dialog>
  );
}

function ManualRefundDialog({ refund: r, onClose, onDone }: { refund: Refund; onClose: () => void; onDone?: () => void }) {
  const [method, setMethod] = useState<(typeof MANUAL_METHODS)[number]>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [processedAt, setProcessedAt] = useState(nowLocal);
  const [maxNow] = useState(nowLocal);
  const [note, setNote] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const record = useAction(() => api.post(`/admin/finance/refunds/${r.id}/record-manual`, { method, reference: reference.trim() || undefined, processedAt: new Date(processedAt).toISOString(), note: note.trim() }), { success: 'Refund recorded as paid', invalidate: ['/admin/finance'], onSuccess: () => (onDone ?? onClose)(), onError: (e) => { if (e instanceof ApiError) setServerError(e.message); } });
  return (
    <Dialog open onClose={onClose} icon={Banknote} title={`Record Manual Refund ${r.reference}`} description={`${money(r.amountMinor)} · currently ${title(r.status).toLowerCase()}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => record.mutate()} loading={record.isPending} disabled={note.trim().length < 5 || !processedAt}>Record Refund</Button></>}>
      <div className="space-y-3">
        <p className="text-grey-700">Use this after you have paid the patient back outside the gateway. {r.status === 'REQUESTED' ? 'You will be recorded as the approver, so you must not be the requester.' : 'The ledger is clawed back and commission recalculated exactly as for a gateway refund.'}</p>
        {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Method" required><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{MANUAL_METHODS.map((m) => <option key={m} value={m}>{title(m)}</option>)}</Select></Field>
          <Field label="Bank / UPI Reference" hint="Optional but recommended"><Input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className="font-mono" maxLength={60} /></Field>
          <Field label="Paid to the Patient At" required><Input type="datetime-local" value={processedAt} max={maxNow} onChange={(e) => setProcessedAt(e.target.value)} /></Field>
        </div>
        <Field label="Note" required hint="At least 5 characters · audited"><Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} className="min-h-16" /></Field>
      </div>
    </Dialog>
  );
}

function AbandonPaymentDialog({ payment: p, onClose, onDone }: { payment: Payment; onClose: () => void; onDone?: () => void }) {
  const [reason, setReason] = useState('');
  const mark = useAction(() => api.post(`/admin/finance/payments/${p.id}/mark-abandoned`, { reason: reason.trim() }), { success: 'Checkout marked abandoned', invalidate: ['/admin/finance'], onSuccess: () => (onDone ?? onClose)() });
  return (
    <Dialog open onClose={onClose} icon={XCircle} title="Mark Checkout as Abandoned" description={`${p.gatewayOrderId} · ${money(p.amountMinor)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => mark.mutate()} loading={mark.isPending} disabled={reason.trim().length < 5}>Mark Abandoned</Button></>}>
      <div className="space-y-3">
        <p className="text-grey-700">Closes an online checkout the patient never finished so an offline payment can be recorded. If the gateway later reports a capture for this order, the webhook is kept for reconciliation and will not double-pay.</p>
        <Field label="Reason" required hint="At least 5 characters · audited"><Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 1000))} className="min-h-16" placeholder="e.g. Patient closed the checkout and paid cash at the desk" /></Field>
      </div>
    </Dialog>
  );
}
