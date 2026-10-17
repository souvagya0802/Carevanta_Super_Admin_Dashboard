'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useFilters } from '@/lib/hooks';
import { dateTime, money, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, ConfirmDialog, DescriptionList, Dialog, Field, Input, PageHeader, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { RequirePermission } from '@/components/layout/shell';

interface Order {
  id: string; reference: string; status: string; provider: { id: string; displayName: string; type: string }; patient: { id: string; fullName: string }; collectionMode: string; collectionPincode: string | null; scheduledAt: string | null;
  source: string; attribution: string; totalMinor: number; statusReason: string | null; items: { id: string; serviceName: string; priceMinor: number }[];
  reports: { id: string; version: number; status: string; publishedAt: string | null; correctionReason: string | null; supersedesId: string | null }[]; transaction: { id: string; status: string; reference: string } | null; createdAt: string;
}
const STATUSES = ['REQUESTED', 'CONFIRMED', 'SAMPLE_COLLECTED', 'PROCESSING', 'REPORT_READY', 'COMPLETED', 'CANCELLED', 'REJECTED'];
const NEXT: Record<string, string[]> = { REQUESTED: ['CONFIRMED', 'REJECTED', 'CANCELLED'], CONFIRMED: ['SAMPLE_COLLECTED', 'CANCELLED'], SAMPLE_COLLECTED: ['PROCESSING', 'CANCELLED'], PROCESSING: ['REPORT_READY'], REPORT_READY: ['COMPLETED'] };

export default function DiagnosticOrdersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { filters, set } = useFilters({ status: '', providerId: '' });
  const [selected, setSelected] = useState<Order | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const advance = useAction(() => api.post<{ data: Order }>(`/admin/diagnostic-orders/${selected!.id}/status`, { status: next, reason: reason || undefined }), { success: 'Order updated', invalidate: ['/admin/diagnostic-orders'], onSuccess: (r) => { setNext(null); setSelected(r.data); setReason(''); } });
  const openReport = async (reportId: string) => {
    const purpose = window.prompt('Purpose for opening this medical report (logged):');
    if (!purpose || purpose.trim().length < 5) return;
    try {
      const { blob, filename } = await api.blob(`/admin/diagnostic-orders/${selected!.id}/reports/${reportId}/file?purpose=${encodeURIComponent(purpose.trim())}`);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(e); }
  };
  const columns: ColumnDef<Order, unknown>[] = [
    { header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span> },
    { header: 'Provider', cell: ({ row }) => <Link className="underline" href={`/providers/${row.original.provider.id}`} onClick={(e) => e.stopPropagation()}>{row.original.provider.displayName}</Link> },
    { header: 'Patient', cell: ({ row }) => row.original.patient.fullName },
    { header: 'Tests', cell: ({ row }) => <span className="text-xs">{row.original.items.map((i) => i.serviceName).join(', ')}</span> },
    { header: 'Collection', cell: ({ row }) => <span className="text-xs">{title(row.original.collectionMode)}{row.original.scheduledAt ? ` · ${dateTime(row.original.scheduledAt)}` : ''}</span> },
    { header: 'Total', cell: ({ row }) => <span className="tnum">{money(row.original.totalMinor)}</span> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Reports', cell: ({ row }) => <span className="text-xs">{row.original.reports.length ? `v${Math.max(...row.original.reports.map((r) => r.version))}` : '—'}</span> },
  ];
  return (
    <RequirePermission anyOf={['diagnostics.read']}>
      <PageHeader title="Diagnostic orders & reports" description="Lab and imaging orders. Reports are versioned: corrections create a new version with a reason and never overwrite the original. Every report opened here is logged with its purpose." />
      <DataTable<Order> path="/admin/diagnostic-orders" params={filters} columns={columns} onRowClick={setSelected} emptyTitle="No diagnostic orders" toolbar={<><Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-52"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select><Input aria-label="Provider id" placeholder="Lab / imaging provider id" value={filters.providerId} onChange={(e) => set('providerId', e.target.value.trim())} className="w-64" /></>} />
      <Dialog open={!!selected && !next} onClose={() => setSelected(null)} title={selected ? `Order ${selected.reference}` : ''} wide footer={<>{can('diagnostics.manage') && selected && (NEXT[selected.status] ?? []).map((s) => <Button key={s} variant={['REJECTED', 'CANCELLED'].includes(s) ? 'danger' : 'secondary'} onClick={() => setNext(s)}>{title(s)}</Button>)}<Button variant="ghost" onClick={() => setSelected(null)}>Close</Button></>}>
        {selected && (
          <div className="space-y-4">
            <p><Badge>{selected.status}</Badge> {selected.statusReason && <span className="ml-2 text-grey-600">{selected.statusReason}</span>}</p>
            <DescriptionList items={[{ label: 'Provider', value: selected.provider.displayName }, { label: 'Patient', value: selected.patient.fullName }, { label: 'Collection', value: `${title(selected.collectionMode)}${selected.collectionPincode ? ` at ${selected.collectionPincode}` : ''}` }, { label: 'Scheduled', value: dateTime(selected.scheduledAt) }, { label: 'Source', value: `${title(selected.source)} · ${title(selected.attribution)}` }, { label: 'Total', value: money(selected.totalMinor) }, { label: 'Payment', value: selected.transaction ? `${selected.transaction.reference} · ${title(selected.transaction.status)}` : '—' }]} />
            <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-grey-500"><tr><th className="py-1">Test</th><th>Price</th></tr></thead><tbody>{selected.items.map((i) => <tr key={i.id} className="border-t border-grey-200"><td className="py-1">{i.serviceName}</td><td className="tnum">{money(i.priceMinor)}</td></tr>)}</tbody></table>
            <div>
              <h3 className="text-xs font-semibold uppercase text-grey-500">Reports</h3>
              {selected.reports.length === 0 ? <p className="text-sm text-grey-500">No report published yet.</p> : (
                <ul className="divide-y divide-grey-200 text-sm">{selected.reports.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 py-1"><span>Version {r.version} <Badge>{r.status}</Badge> <span className="text-xs text-grey-500">{dateTime(r.publishedAt)}{r.correctionReason ? ` · ${r.correctionReason}` : ''}</span></span>{can('diagnostics.reports.read') && <Button size="sm" variant="ghost" onClick={() => openReport(r.id)}>Open (logged)</Button>}</li>)}</ul>
              )}
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!next} onClose={() => setNext(null)} onConfirm={() => advance.mutate()} title={`Mark as ${title(next ?? '')}`} message={next === 'COMPLETED' ? 'Completes the transaction and freezes the commission.' : next === 'REPORT_READY' ? 'Requires a published report.' : ['REJECTED', 'CANCELLED'].includes(next ?? '') ? 'Any captured payment goes to refund review.' : 'The order moves to the next step.'} confirmLabel={title(next ?? '')} loading={advance.isPending} danger={['REJECTED', 'CANCELLED'].includes(next ?? '')}>
        <Field label="Reason / note" className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </RequirePermission>
  );
}
