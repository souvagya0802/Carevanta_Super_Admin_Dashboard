'use client';

import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useFilters, useGet } from '@/lib/hooks';
import { dateTime, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, ConfirmDialog, DescriptionList, Dialog, Field, Input, PageHeader, Select, Textarea } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

interface Dispatch {
  id: string; reference: string; mode: string; isTest: boolean; status: string; pickupDistrict: string | null; pickupLatitude: number | null; pickupLongitude: number | null; requiredVehicleType: string | null;
  ambulanceConfirmed: boolean; confirmedBy: null | { operator: { id: string; displayName: string }; vehicle: { id: string; registrationNumber: string; vehicleType: string } | null; confirmationSource: string | null; etaMinutes: number | null };
  escalatedAt: string | null; escalationNote: string | null; closedAt: string | null; createdAt: string;
  assignments: { id: string; operator: { id: string; displayName: string }; vehicle: { registrationNumber: string } | null; status: string; confirmationSource: string | null; offeredAt: string; respondedAt: string | null; etaMinutes: number | null }[];
  events: { fromStatus: string | null; toStatus: string; actorKind: string; note: string | null; createdAt: string }[];
}
const STATUSES = ['RECEIVED', 'SEARCHING', 'OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PATIENT_ONBOARD', 'AT_DESTINATION', 'COMPLETED', 'CANCELLED', 'NO_PROVIDER_AVAILABLE', 'ESCALATED'];

export default function DispatchPage() {
  const { can } = useAuth();
  const { filters, set } = useFilters({ mode: 'LIVE', status: '' });
  const [selected, setSelected] = useState<Dispatch | null>(null);
  const [action, setAction] = useState<null | 'escalate' | 'cancel'>(null);
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState<{ assignmentId: string } | null>(null);
  const [phoneForm, setPhoneForm] = useState({ vehicleId: '', etaMinutes: '15', confirmedWith: '' });
  const inv = ['/admin/dispatch'];
  const act = useAction(() => api.post<{ data: Dispatch }>(`/admin/dispatch/${selected!.id}/${action}`, action === 'escalate' ? { note } : { reason: note }), { success: 'Request updated', invalidate: inv, onSuccess: (r) => { setAction(null); setSelected(r.data); setNote(''); } });
  const regions = useGet<{ id: string; district: string; state: string; status: string }[]>(can('dispatch.manage') ? '/admin/regions' : null);
  const districts = Array.from(new Set((regions.data ?? []).filter((x) => x.status !== 'PAUSED').map((x) => x.district))).sort();
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillDistrict, setDrillDistrict] = useState('');
  const drill = useAction(() => api.post<{ data: Dispatch }>('/admin/dispatch/test', drillDistrict ? { district: drillDistrict } : {}), { success: 'Test drill opened (no operators notified)', invalidate: inv, onSuccess: (r) => { setDrillOpen(false); setSelected(r.data); } });
  const confirmPhone = useAction(() => api.post<{ data: Dispatch }>(`/admin/dispatch/${selected!.id}/assignments/${phone!.assignmentId}/phone-confirmation`, { vehicleId: phoneForm.vehicleId, etaMinutes: Number(phoneForm.etaMinutes), confirmedWith: phoneForm.confirmedWith }), { success: 'Acceptance recorded', invalidate: inv, onSuccess: (r) => { setPhone(null); setSelected(r.data); } });
  const columns: ColumnDef<Dispatch, unknown>[] = [
    { header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}{row.original.isTest && <Badge>test</Badge>}</span> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Ambulance', cell: ({ row }) => row.original.ambulanceConfirmed ? <span className="text-xs">{row.original.confirmedBy?.operator.displayName} · {row.original.confirmedBy?.vehicle?.registrationNumber} · ETA {row.original.confirmedBy?.etaMinutes} min</span> : <span className="text-xs text-grey-500">not confirmed</span> },
    { header: 'Pickup', cell: ({ row }) => <span className="text-xs">{row.original.pickupDistrict ?? '—'}{row.original.pickupLatitude != null ? ` (${row.original.pickupLatitude}, ${row.original.pickupLongitude})` : ''}</span> },
    { header: 'Offers', cell: ({ row }) => <span className="tnum text-xs">{row.original.assignments.length}</span> },
    { header: 'Received', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.createdAt)}</span> },
  ];
  return (
    <RequirePermission anyOf={['dispatch.read']}>
      <PageHeader title="Ambulance dispatch" description="Every emergency request tells the caller to dial 112 first. A request shows an ambulance only after an operator confirmed it. Live dispatch is controlled by the emergency.live_dispatch_enabled setting." actions={can('dispatch.manage') && <Button variant="secondary" onClick={() => { setDrillDistrict(districts[0] ?? ''); setDrillOpen(true); }}>Open test drill</Button>} />
      <Dialog open={drillOpen} onClose={() => setDrillOpen(false)} title="Open a test drill" description="Simulates an emergency request without notifying any operator." footer={<><Button variant="ghost" onClick={() => setDrillOpen(false)}>Cancel</Button><Button onClick={() => drill.mutate()} loading={drill.isPending}>Open drill</Button></>}>
        <Field label="District" hint="Districts come from your service regions; leave empty to drill without a pickup district">
          <Input list="drill-districts" value={drillDistrict} onChange={(e) => setDrillDistrict(e.target.value)} placeholder={regions.isPending ? 'Loading regions…' : 'Any district'} />
          <datalist id="drill-districts">{districts.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
      </Dialog>
      <DataTable<Dispatch> path="/admin/dispatch" params={filters} columns={columns} onRowClick={setSelected} emptyTitle="No dispatch requests" toolbar={<><Select aria-label="Mode" value={filters.mode} onChange={(e) => set('mode', e.target.value)} className="w-40"><option value="">All</option><option value="LIVE">Live</option><option value="TEST">Test drills</option></Select><Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-56"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></>} queryKey={['dispatch']} />
      <Dialog open={!!selected && !action && !phone} onClose={() => setSelected(null)} title={selected ? `Request ${selected.reference}${selected.isTest ? ' (TEST)' : ''}` : ''} wide footer={<>{can('dispatch.manage') && selected && !['COMPLETED', 'CANCELLED'].includes(selected.status) && <><Button variant="secondary" onClick={() => setAction('escalate')}>Escalate</Button><Button variant="danger" onClick={() => setAction('cancel')}>Cancel request</Button></>}<Button variant="ghost" onClick={() => setSelected(null)}>Close</Button></>}>
        {selected && (
          <div className="space-y-4">
            <p><Badge>{selected.status}</Badge> {selected.ambulanceConfirmed ? <Badge tone="ACTIVE">ambulance confirmed</Badge> : <Badge tone="SUSPENDED">no confirmed ambulance</Badge>}</p>
            <DescriptionList items={[{ label: 'Pickup', value: `${selected.pickupDistrict ?? '—'}${selected.pickupLatitude != null ? ` (${selected.pickupLatitude}, ${selected.pickupLongitude})` : ''}` }, { label: 'Vehicle type needed', value: selected.requiredVehicleType ?? 'any' }, { label: 'Confirmed by', value: selected.confirmedBy ? `${selected.confirmedBy.operator.displayName} · ${selected.confirmedBy.vehicle?.registrationNumber ?? ''} · ${title(selected.confirmedBy.confirmationSource)}` : '—' }, { label: 'Escalated', value: selected.escalatedAt ? `${dateTime(selected.escalatedAt)} — ${selected.escalationNote ?? ''}` : 'No' }, { label: 'Received', value: dateTime(selected.createdAt) }, { label: 'Closed', value: dateTime(selected.closedAt) }]} />
            <div>
              <h3 className="text-xs font-semibold uppercase text-grey-500">Operator offers</h3>
              {selected.assignments.length === 0 ? <p className="text-sm text-grey-500">No operators were offered this request.</p> : (
                <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-grey-500"><tr><th className="py-1">Operator</th><th>Status</th><th>Vehicle</th><th>ETA</th><th>Offered</th><th /></tr></thead>
                  <tbody>{selected.assignments.map((a) => <tr key={a.id} className="border-t border-grey-200"><td className="py-1">{a.operator.displayName}</td><td><Badge>{a.status}</Badge></td><td className="font-mono text-xs">{a.vehicle?.registrationNumber ?? '—'}</td><td className="tnum text-xs">{a.etaMinutes ?? '—'}</td><td className="text-xs">{dateTime(a.offeredAt)}</td><td className="text-right">{can('dispatch.manage') && a.status === 'OFFERED' && <Button size="sm" variant="ghost" onClick={() => setPhone({ assignmentId: a.id })}>Record phone acceptance</Button>}</td></tr>)}</tbody></table>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-grey-500">Timeline</h3>
              <ul className="mt-1 divide-y divide-grey-200 text-xs">{selected.events.map((e, i) => <li key={i} className="flex justify-between gap-2 py-1"><span>{e.fromStatus ? `${title(e.fromStatus)} → ` : ''}{title(e.toStatus)} ({e.actorKind.toLowerCase()}){e.note ? ` — ${e.note}` : ''}</span><span className="shrink-0 text-grey-500">{dateTime(e.createdAt)}</span></li>)}</ul>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!action} onClose={() => setAction(null)} onConfirm={() => act.mutate()} title={action === 'escalate' ? 'Escalate request' : 'Cancel request'} message={action === 'escalate' ? 'Record the hand-over to the 108/112 control room or another operator.' : 'Open offers are withdrawn and the request is closed.'} confirmLabel={title(action ?? '')} loading={act.isPending} danger={action === 'cancel'}>
        <Field label="Note" required className="mt-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
      <Dialog open={!!phone} onClose={() => setPhone(null)} title="Record operator acceptance by phone" footer={<><Button variant="ghost" onClick={() => setPhone(null)}>Cancel</Button><Button onClick={() => confirmPhone.mutate()} loading={confirmPhone.isPending} disabled={!phoneForm.vehicleId || !phoneForm.confirmedWith}>Record</Button></>}>
        <p className="mb-3 text-grey-600">Use only when the operator verbally confirmed a specific vehicle. Your identity and the person you spoke to are recorded.</p>
        <div className="space-y-3">
          <Field label="Vehicle id" required><Input value={phoneForm.vehicleId} onChange={(e) => setPhoneForm({ ...phoneForm, vehicleId: e.target.value.trim() })} /></Field>
          <Field label="ETA (minutes)" required><Input type="number" min={1} max={240} value={phoneForm.etaMinutes} onChange={(e) => setPhoneForm({ ...phoneForm, etaMinutes: e.target.value })} /></Field>
          <Field label="Confirmed with (name)" required><Input value={phoneForm.confirmedWith} onChange={(e) => setPhoneForm({ ...phoneForm, confirmedWith: e.target.value })} /></Field>
        </div>
      </Dialog>
    </RequirePermission>
  );
}
