'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useFilters, useGet } from '@/lib/hooks';
import { dateTime, money, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, ConfirmDialog, DescriptionList, Dialog, Field, Input, PageHeader, Select, Textarea } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

interface Appt {
  id: string; reference: string; status: string; mode: string; source: string; attribution: string;
  patient: { id: string; fullName: string; relationship: string }; bookedByUserId: string;
  doctor: { id: string; displayName: string }; facility: { id: string; displayName: string; type: string }; location: { id: string; name: string; city: string };
  startsAt: string; endsAt: string; feeMinor: number; currency: string; statusReason: string | null; rescheduledFromId: string | null;
  confirmedAt: string | null; checkedInAt: string | null; completedAt: string | null; cancelledAt: string | null;
  transaction: { id: string; reference: string; status: string; commissionEligible: boolean } | null; version: number; createdAt: string;
}
const STATUSES = ['REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED_BY_PATIENT', 'CANCELLED_BY_PROVIDER', 'CANCELLED_BY_PLATFORM', 'REJECTED', 'NO_SHOW', 'RESCHEDULED'];
const ACTIONS: Record<string, string[]> = { REQUESTED: ['CONFIRM', 'REJECT', 'CANCEL'], CONFIRMED: ['CHECK_IN', 'NO_SHOW', 'CANCEL'], CHECKED_IN: ['COMPLETE', 'CANCEL'] };

export default function AppointmentsPage() {
  const { can } = useAuth();
  const { filters, set } = useFilters({ status: '', doctorProviderId: '', facilityProviderId: '', from: '', to: '' });
  const [selected, setSelected] = useState<Appt | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reschedule, setReschedule] = useState(false);
  const [newSlotId, setNewSlotId] = useState('');
  const events = useGet<{ fromStatus: string | null; toStatus: string; actorKind: string; note: string | null; createdAt: string }[]>(selected ? `/admin/appointments/${selected.id}/events` : null);
  const inv = ['/admin/appointments'];
  const act = useAction(() => api.post<{ data: Appt & { refundRequestedMinor: number } }>(`/admin/appointments/${selected!.id}/actions`, { action, reason: reason || undefined }), {
    success: 'Appointment updated', invalidate: inv,
    onSuccess: (r) => { if (r.data.refundRequestedMinor > 0) alert(`A refund of ${money(r.data.refundRequestedMinor)} was requested for finance approval.`); setAction(null); setSelected(r.data); setReason(''); },
  });
  const move = useAction(() => api.post<{ data: Appt }>(`/admin/appointments/${selected!.id}/reschedule`, { newSlotId }), { success: 'Rescheduled', invalidate: inv, onSuccess: (r) => { setReschedule(false); setSelected(r.data); } });

  const columns: ColumnDef<Appt, unknown>[] = [
    { header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span> },
    { header: 'When', cell: ({ row }) => <span className="text-xs">{dateTime(row.original.startsAt)}</span> },
    { header: 'Patient', cell: ({ row }) => row.original.patient.fullName },
    { header: 'Doctor', cell: ({ row }) => <Link className="underline" href={`/providers/${row.original.doctor.id}`} onClick={(e) => e.stopPropagation()}>{row.original.doctor.displayName}</Link> },
    { header: 'Facility', cell: ({ row }) => <span className="text-xs">{row.original.facility.displayName} · {row.original.location.name}</span> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Source', cell: ({ row }) => <span className="text-xs">{title(row.original.source)} · {title(row.original.attribution)}</span> },
    { header: 'Fee', cell: ({ row }) => <span className="tnum">{money(row.original.feeMinor)}</span> },
    { header: 'Payment', cell: ({ row }) => row.original.transaction ? <Badge>{row.original.transaction.status}</Badge> : '—' },
  ];

  return (
    <RequirePermission anyOf={['bookings.read']}>
      <PageHeader title="Appointments" description="Every booking with its lifecycle. Status changes are validated server-side; cancellations with captured payments open a refund request." />
      <DataTable<Appt>
        path="/admin/appointments"
        params={{ status: filters.status, doctorProviderId: filters.doctorProviderId, facilityProviderId: filters.facilityProviderId, from: filters.from ? new Date(filters.from).toISOString() : '', to: filters.to ? new Date(filters.to).toISOString() : '' }}
        columns={columns}
        onRowClick={setSelected}
        emptyTitle="No appointments match"
        toolbar={
          <>
            <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-56"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
            <Input aria-label="Doctor provider id" placeholder="Doctor provider id" value={filters.doctorProviderId} onChange={(e) => set('doctorProviderId', e.target.value.trim())} className="w-64" />
            <Input aria-label="Facility provider id" placeholder="Facility provider id" value={filters.facilityProviderId} onChange={(e) => set('facilityProviderId', e.target.value.trim())} className="w-64" />
            <Input type="date" aria-label="Created from" value={filters.from} onChange={(e) => set('from', e.target.value)} className="w-40" />
            <Input type="date" aria-label="Created to" value={filters.to} onChange={(e) => set('to', e.target.value)} className="w-40" />
          </>
        }
      />
      <Dialog open={!!selected && !action && !reschedule} onClose={() => setSelected(null)} title={selected ? `Appointment ${selected.reference}` : ''} wide footer={
        <>
          {can('bookings.manage') && selected && (ACTIONS[selected.status] ?? []).map((a) => <Button key={a} variant={a === 'CANCEL' || a === 'REJECT' ? 'danger' : 'secondary'} onClick={() => setAction(a)}>{title(a)}</Button>)}
          {can('bookings.manage') && selected && (selected.status === 'REQUESTED' || selected.status === 'CONFIRMED') && <Button variant="secondary" onClick={() => setReschedule(true)}>Reschedule</Button>}
          <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
        </>
      }>
        {selected && (
          <div className="space-y-4">
            <p><Badge>{selected.status}</Badge> {selected.statusReason && <span className="ml-2 text-grey-600">{selected.statusReason}</span>}</p>
            <DescriptionList items={[
              { label: 'Patient', value: `${selected.patient.fullName} (${selected.patient.relationship.toLowerCase()})` }, { label: 'Doctor', value: selected.doctor.displayName },
              { label: 'Facility', value: `${selected.facility.displayName} — ${selected.location.name}, ${selected.location.city}` }, { label: 'Slot', value: `${dateTime(selected.startsAt)} – ${dateTime(selected.endsAt).split(', ').pop()}` },
              { label: 'Mode', value: title(selected.mode) }, { label: 'Source / attribution', value: `${title(selected.source)} · ${title(selected.attribution)}` },
              { label: 'Fee', value: money(selected.feeMinor) }, { label: 'Payment', value: selected.transaction ? <Link className="underline" href={`/payments?transactionId=${selected.transaction.id}`}>{selected.transaction.reference} · {title(selected.transaction.status)}{selected.transaction.commissionEligible ? ' · commissionable' : ''}</Link> : '—' },
              { label: 'Confirmed', value: dateTime(selected.confirmedAt) }, { label: 'Checked in', value: dateTime(selected.checkedInAt) }, { label: 'Completed', value: dateTime(selected.completedAt) }, { label: 'Booked', value: dateTime(selected.createdAt) },
            ]} />
            <div>
              <h3 className="text-xs font-semibold uppercase text-grey-500">Timeline</h3>
              <ul className="mt-1 divide-y divide-grey-200 text-xs">{events.data?.map((e, i) => <li key={i} className="flex justify-between gap-2 py-1"><span>{e.fromStatus ? `${title(e.fromStatus)} → ` : ''}{title(e.toStatus)} by {e.actorKind.toLowerCase()}{e.note ? ` — ${e.note}` : ''}</span><span className="shrink-0 text-grey-500">{dateTime(e.createdAt)}</span></li>)}</ul>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!action} onClose={() => setAction(null)} onConfirm={() => act.mutate()} title={`${title(action ?? '')} appointment`} message={action === 'CANCEL' || action === 'REJECT' ? 'The slot is released. If an online payment was captured, a refund request is created for finance approval.' : action === 'COMPLETE' ? 'Completion finalises the transaction and freezes the commission snapshot.' : 'This action is recorded in the appointment timeline.'} confirmLabel={title(action ?? '')} loading={act.isPending} danger={action === 'CANCEL' || action === 'REJECT'}>
        <Field label={action === 'CANCEL' || action === 'REJECT' ? 'Reason (required)' : 'Note'} className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <Dialog open={reschedule} onClose={() => setReschedule(false)} title="Reschedule" footer={<><Button variant="ghost" onClick={() => setReschedule(false)}>Cancel</Button><Button onClick={() => move.mutate()} loading={move.isPending} disabled={!newSlotId}>Move</Button></>}>
        <Field label="New slot id" hint="Must be an open slot with the same doctor and fee; find ids under the doctor's schedule"><Input value={newSlotId} onChange={(e) => setNewSlotId(e.target.value.trim())} /></Field>
      </Dialog>
    </RequirePermission>
  );
}
