'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useFilters, useGet } from '@/lib/hooks';
import { date, dateTime, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Tabs } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import type { ProviderRow } from '../providers/[segment]/page';
import { ProviderCreateDialog } from '@/components/providers/provider-create-dialog';

interface Vehicle { id: string; operatorProviderId: string; operatorName: string; registrationNumber: string; vehicleType: string; status: string; equipment: string[]; insuranceValidUntil: string | null; fitnessValidUntil: string | null; documentsExpired: boolean; verifiedAt: string | null; lastLocationAt: string | null; createdAt: string }
const VEHICLE_TYPES = ['BLS', 'ALS', 'PATIENT_TRANSPORT', 'NEONATAL', 'MORTUARY'];

function AmbulanceInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState(sp.get('operatorProviderId') ? 'vehicles' : 'operators');
  const { filters, set } = useFilters({ operatorProviderId: sp.get('operatorProviderId') ?? '', status: '' });
  const [registering, setRegistering] = useState(false);
  const [creatingOperator, setCreatingOperator] = useState(false);
  const [v, setV] = useState({ operatorProviderId: sp.get('operatorProviderId') ?? '', registrationNumber: '', vehicleType: 'BLS', insuranceValidUntil: '', fitnessValidUntil: '', equipment: '' });
  const [crewFor, setCrewFor] = useState(sp.get('operatorProviderId') ?? '');
  const crew = useGet<{ id: string; fullName: string; role: string; licenseNumber: string | null; licenseValidUntil: string | null; isActive: boolean }[]>(crewFor && tab === 'crew' ? `/admin/ambulance/operators/${crewFor}/crew` : null);
  const [c, setC] = useState({ fullName: '', role: 'DRIVER', licenseNumber: '', licenseValidUntil: '' });
  const inv = ['/admin/ambulance'];
  const register = useAction(() => api.post('/admin/ambulance/vehicles', { ...v, equipment: v.equipment.split(',').map((s) => s.trim()).filter(Boolean), fitnessValidUntil: v.fitnessValidUntil || undefined }), { success: 'Vehicle registered (pending verification)', invalidate: inv, onSuccess: () => setRegistering(false) });
  const setStatus = useAction((x: { id: string; status: string }) => api.post(`/admin/ambulance/vehicles/${x.id}/status`, { status: x.status }), { success: 'Vehicle status updated', invalidate: inv });
  const addCrew = useAction(() => api.post(`/admin/ambulance/operators/${crewFor}/crew`, { ...c, licenseNumber: c.licenseNumber || undefined, licenseValidUntil: c.licenseValidUntil || undefined }), { success: 'Crew member added', invalidate: inv, onSuccess: () => setC({ fullName: '', role: 'DRIVER', licenseNumber: '', licenseValidUntil: '' }) });

  const operatorColumns: ColumnDef<ProviderRow, unknown>[] = [
    { header: 'Operator', cell: ({ row }) => <span className="font-medium">{row.original.displayName}</span> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Location', cell: ({ row }) => [row.original.city, row.original.district].filter(Boolean).join(', ') || '—' },
    { header: '', cell: ({ row }) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); set('operatorProviderId', row.original.id); setCrewFor(row.original.id); setTab('vehicles'); }}>Vehicles & crew</Button> },
  ];
  const vehicleColumns: ColumnDef<Vehicle, unknown>[] = [
    { header: 'Registration', cell: ({ row }) => <span className="font-mono">{row.original.registrationNumber}</span> },
    { header: 'Operator', cell: ({ row }) => <Link className="underline" href={`/providers/${row.original.operatorProviderId}`}>{row.original.operatorName}</Link> },
    { header: 'Type', cell: ({ row }) => title(row.original.vehicleType) },
    { header: 'Status', cell: ({ row }) => <span className="flex gap-1"><Badge>{row.original.status}</Badge>{row.original.documentsExpired && <Badge tone="EXPIRED">docs expired</Badge>}</span> },
    { header: 'Insurance / fitness', cell: ({ row }) => <span className="text-xs">{date(row.original.insuranceValidUntil)} / {date(row.original.fitnessValidUntil)}</span> },
    { header: 'Last location', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.lastLocationAt)}</span> },
    { header: '', cell: ({ row }) => can('ambulance.manage') && <span className="flex gap-1">{row.original.status !== 'AVAILABLE' && row.original.status !== 'ON_TRIP' && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: row.original.id, status: 'AVAILABLE' })}>Make available</Button>}{row.original.status === 'AVAILABLE' && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: row.original.id, status: 'OUT_OF_SERVICE' })}>Out of service</Button>}{row.original.status !== 'SUSPENDED' && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: row.original.id, status: 'SUSPENDED' })}>Suspend</Button>}</span> },
  ];

  return (
    <RequirePermission anyOf={['ambulance.read', 'providers.read']}>
      <PageHeader title="Ambulance operators & vehicles" description="Vehicles become AVAILABLE only when the operator is approved and insurance/fitness are current; the nightly job grounds vehicles with expired documents." actions={<>{can('providers.create') && <Button variant="secondary" onClick={() => setCreatingOperator(true)}>Register operator</Button>}{can('ambulance.manage') && <Button onClick={() => setRegistering(true)}>Register vehicle</Button>}</>} />
      <Tabs tabs={[{ key: 'operators', label: 'Operators' }, { key: 'vehicles', label: 'Vehicles' }, { key: 'crew', label: 'Crew' }]} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'operators' && <DataTable<ProviderRow> path="/admin/providers" params={{ type: 'AMBULANCE_OPERATOR' }} columns={operatorColumns} onRowClick={(p) => router.push(`/providers/${p.id}`)} emptyTitle="No ambulance operators" />}
        {tab === 'vehicles' && <DataTable<Vehicle> path="/admin/ambulance/vehicles" params={filters} columns={vehicleColumns} emptyTitle="No vehicles" toolbar={<><Input aria-label="Operator provider id" placeholder="Operator provider id" value={filters.operatorProviderId} onChange={(e) => set('operatorProviderId', e.target.value.trim())} className="w-72" /><Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-48"><option value="">All statuses</option>{['PENDING_VERIFICATION', 'AVAILABLE', 'ON_TRIP', 'OUT_OF_SERVICE', 'SUSPENDED'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></>} />}
        {tab === 'crew' && (
          <div className="space-y-4">
            <Field label="Operator provider id"><Input value={crewFor} onChange={(e) => setCrewFor(e.target.value.trim())} className="w-96" /></Field>
            {crewFor && (
              <Card title="Crew members">
                {crew.data?.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-grey-500"><tr><th className="py-1">Name</th><th>Role</th><th>Licence</th><th>Valid until</th><th>Active</th></tr></thead><tbody>{crew.data.map((m) => <tr key={m.id} className="border-t border-grey-200"><td className="py-1">{m.fullName}</td><td>{m.role}</td><td className="font-mono text-xs">{m.licenseNumber ?? '—'}</td><td className="text-xs">{date(m.licenseValidUntil)}</td><td>{m.isActive ? 'Yes' : 'No'}</td></tr>)}</tbody></table> : <p className="text-sm text-grey-500">No crew recorded.</p>}
                {can('ambulance.manage') && (
                  <div className="mt-4 grid gap-3 md:grid-cols-5">
                    <Field label="Full name"><Input value={c.fullName} onChange={(e) => setC({ ...c, fullName: e.target.value })} /></Field>
                    <Field label="Role"><Select value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })}>{['DRIVER', 'EMT', 'PARAMEDIC', 'NURSE'].map((r) => <option key={r}>{r}</option>)}</Select></Field>
                    <Field label="Licence no." hint="Required for drivers"><Input value={c.licenseNumber} onChange={(e) => setC({ ...c, licenseNumber: e.target.value })} /></Field>
                    <Field label="Licence valid until"><Input type="date" value={c.licenseValidUntil} onChange={(e) => setC({ ...c, licenseValidUntil: e.target.value })} /></Field>
                    <div className="flex items-end"><Button onClick={() => addCrew.mutate()} loading={addCrew.isPending} disabled={c.fullName.length < 2}>Add</Button></div>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
      <ProviderCreateDialog open={creatingOperator} initialType="AMBULANCE_OPERATOR" onClose={() => setCreatingOperator(false)} />
      <Dialog open={registering} onClose={() => setRegistering(false)} title="Register an ambulance vehicle" footer={<><Button variant="ghost" onClick={() => setRegistering(false)}>Cancel</Button><Button onClick={() => register.mutate()} loading={register.isPending} disabled={!v.operatorProviderId || !v.registrationNumber || !v.insuranceValidUntil}>Register</Button></>}>
        <div className="space-y-3">
          <Field label="Operator provider id" required><Input value={v.operatorProviderId} onChange={(e) => setV({ ...v, operatorProviderId: e.target.value.trim() })} /></Field>
          <Field label="Registration number" required hint="e.g. WB29AB1234"><Input value={v.registrationNumber} onChange={(e) => setV({ ...v, registrationNumber: e.target.value.toUpperCase().replace(/\s/g, '') })} /></Field>
          <Field label="Vehicle type"><Select value={v.vehicleType} onChange={(e) => setV({ ...v, vehicleType: e.target.value })}>{VEHICLE_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
          <Field label="Insurance valid until" required><Input type="date" value={v.insuranceValidUntil} onChange={(e) => setV({ ...v, insuranceValidUntil: e.target.value })} /></Field>
          <Field label="Fitness certificate valid until"><Input type="date" value={v.fitnessValidUntil} onChange={(e) => setV({ ...v, fitnessValidUntil: e.target.value })} /></Field>
          <Field label="Equipment" hint="Comma-separated"><Input value={v.equipment} onChange={(e) => setV({ ...v, equipment: e.target.value })} /></Field>
        </div>
      </Dialog>
    </RequirePermission>
  );
}

export default function AmbulancePage() {
  return <Suspense fallback={null}><AmbulanceInner /></Suspense>;
}
