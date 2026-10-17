'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useFilters } from '@/lib/hooks';
import { date, dateTime, money, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, ConfirmDialog, DescriptionList, Dialog, Field, Input, PageHeader, Select, Textarea } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

interface Order {
  id: string; reference: string; status: string; provider: { id: string; displayName: string }; patient: { id: string; fullName: string }; fulfilment: string; deliveryPincode: string | null; prescriptionId: string | null;
  totalMinor: number; currency: string; statusReason: string | null; items: { id: string; medicine: { name: string; strength: string | null; schedule: string }; batchNumber: string | null; expiryDate: string | null; quantity: number; unitPriceMinor: number }[];
  transaction: { id: string; status: string } | null; createdAt: string;
}
const STATUSES = ['PLACED', 'PRESCRIPTION_REVIEW', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED'];
const NEXT: Record<string, string[]> = { PLACED: ['ACCEPTED', 'REJECTED', 'CANCELLED'], PRESCRIPTION_REVIEW: ['ACCEPTED', 'REJECTED', 'CANCELLED'], ACCEPTED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'CANCELLED'], READY_FOR_PICKUP: ['DELIVERED', 'CANCELLED'], OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED'] };

export default function PharmacyOrdersPage() {
  const { can } = useAuth();
  const { filters, set } = useFilters({ status: '', providerId: '' });
  const [selected, setSelected] = useState<Order | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const advance = useAction(() => api.post<{ data: Order }>(`/admin/pharmacy-orders/${selected!.id}/status`, { status: next, reason: reason || undefined }), { success: 'Order updated', invalidate: ['/admin/pharmacy-orders'], onSuccess: (r) => { setNext(null); setSelected(r.data); setReason(''); } });
  const columns: ColumnDef<Order, unknown>[] = [
    { header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span> },
    { header: 'Pharmacy', cell: ({ row }) => <Link className="underline" href={`/providers/${row.original.provider.id}`} onClick={(e) => e.stopPropagation()}>{row.original.provider.displayName}</Link> },
    { header: 'Patient', cell: ({ row }) => row.original.patient.fullName },
    { header: 'Items', cell: ({ row }) => <span className="text-xs">{row.original.items.length} line{row.original.items.length === 1 ? '' : 's'}{row.original.prescriptionId ? ' · Rx' : ''}</span> },
    { header: 'Fulfilment', cell: ({ row }) => title(row.original.fulfilment) },
    { header: 'Total', cell: ({ row }) => <span className="tnum">{money(row.original.totalMinor)}</span> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Placed', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.createdAt)}</span> },
  ];
  return (
    <RequirePermission anyOf={['pharmacy.read']}>
      <PageHeader title="Pharmacy orders" description="Stock is reserved first-expiry-first-out at order time and released on cancellation. Scheduled medicines need a pharmacist-approved prescription before acceptance." />
      <DataTable<Order> path="/admin/pharmacy-orders" params={filters} columns={columns} onRowClick={setSelected} emptyTitle="No pharmacy orders" toolbar={<><Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-56"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select><Input aria-label="Pharmacy provider id" placeholder="Pharmacy provider id" value={filters.providerId} onChange={(e) => set('providerId', e.target.value.trim())} className="w-64" /></>} />
      <Dialog open={!!selected && !next} onClose={() => setSelected(null)} title={selected ? `Order ${selected.reference}` : ''} wide footer={<>{can('pharmacy.manage') && selected && (NEXT[selected.status] ?? []).map((s) => <Button key={s} variant={['REJECTED', 'CANCELLED', 'RETURNED'].includes(s) ? 'danger' : 'secondary'} onClick={() => setNext(s)}>{title(s)}</Button>)}<Button variant="ghost" onClick={() => setSelected(null)}>Close</Button></>}>
        {selected && (
          <div className="space-y-4">
            <p><Badge>{selected.status}</Badge> {selected.statusReason && <span className="ml-2 text-grey-600">{selected.statusReason}</span>}</p>
            <DescriptionList items={[{ label: 'Pharmacy', value: selected.provider.displayName }, { label: 'Patient', value: selected.patient.fullName }, { label: 'Fulfilment', value: `${title(selected.fulfilment)}${selected.deliveryPincode ? ` to ${selected.deliveryPincode}` : ''}` }, { label: 'Prescription', value: selected.prescriptionId ? selected.prescriptionId.slice(0, 8) : 'Not required' }, { label: 'Total', value: money(selected.totalMinor) }, { label: 'Payment', value: selected.transaction ? title(selected.transaction.status) : '—' }]} />
            <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-grey-500"><tr><th className="py-1">Medicine</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Unit</th></tr></thead><tbody>{selected.items.map((i) => <tr key={i.id} className="border-t border-grey-200"><td className="py-1">{i.medicine.name} {i.medicine.strength} <Badge>{i.medicine.schedule}</Badge></td><td className="font-mono text-xs">{i.batchNumber ?? '—'}</td><td className="text-xs">{date(i.expiryDate)}</td><td className="tnum">{i.quantity}</td><td className="tnum">{money(i.unitPriceMinor)}</td></tr>)}</tbody></table>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!next} onClose={() => setNext(null)} onConfirm={() => advance.mutate()} title={`Mark as ${title(next ?? '')}`} message={['REJECTED', 'CANCELLED', 'RETURNED'].includes(next ?? '') ? 'Reserved stock is released and any captured payment goes to refund review.' : next === 'DELIVERED' ? 'Stock is decremented and the transaction is completed.' : 'The order moves to the next step.'} confirmLabel={title(next ?? '')} loading={advance.isPending} danger={['REJECTED', 'CANCELLED', 'RETURNED'].includes(next ?? '')}>
        <Field label="Reason / note" className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </RequirePermission>
  );
}
