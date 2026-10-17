'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Building2, CheckCircle2, Eye, Link2, Search, Stethoscope } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useFilters, useGet } from '@/lib/hooks';
import { date, dateTime, money, relative, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, ConfirmDialog, Dialog, Field, FormSection, Input, PageHeader, Select, Skeleton, Textarea, cx } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

interface Aff {
  id: string; status: string; initiatedBy: string;
  doctor: { id: string; displayName: string; status: string }; facility: { id: string; displayName: string; type: string; status: string };
  location: { id: string; name: string } | null; department: { code: string; name: string } | null; roleTitle: string | null; engagementType: string;
  consultationFeeMinor: number | null; doctorConfirmedAt: string | null; facilityConfirmedAt: string | null; verifiedAt: string | null; startDate: string | null; endDate: string | null; statusReason: string | null; version: number; createdAt: string;
  events: { fromStatus: string | null; toStatus: string; actorKind: string; note: string | null; createdAt: string }[];
}
interface ProviderHit { id: string; displayName: string; type: string; status: string }

const STATUSES = ['INVITED', 'REQUESTED', 'PENDING_VERIFICATION', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ENDED', 'CANCELLED'];
const STATUS_HELP: Record<string, string> = {
  INVITED: 'The facility invited the doctor; waiting for the doctor to accept.',
  REQUESTED: 'The doctor asked to join; waiting for the facility to accept.',
  PENDING_VERIFICATION: 'Both sides agreed. The platform must verify before patients can book here.',
  ACTIVE: 'Live: the doctor is bookable at this facility.',
  SUSPENDED: 'Temporarily off; existing bookings continue.',
  ENDED: 'Finished. Future slots at this facility are blocked.',
};
const ENGAGEMENTS = ['FULL_TIME', 'PART_TIME', 'VISITING', 'CONSULTANT'];

export default function AffiliationsPage() {
  return <Suspense fallback={<Skeleton rows={8} />}><AffiliationsInner /></Suspense>;
}

function AffiliationsInner() {
  const sp = useSearchParams();
  const { can, me } = useAuth();
  const { filters, set, reset } = useFilters({ status: '', doctorProviderId: sp.get('doctorProviderId') ?? '', facilityProviderId: sp.get('facilityProviderId') ?? '' });
  const [selected, setSelected] = useState<Aff | null>(null);
  const [action, setAction] = useState<null | 'VERIFY' | 'REJECT' | 'SUSPEND' | 'REACTIVATE' | 'END'>(null);
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const inv = ['/admin/affiliations'];
  const act = useAction(() => api.post<{ data: Aff & { affectedAppointments: number } }>(`/admin/affiliations/${selected!.id}/actions`, { action, note: note.trim() || undefined, expectedVersion: selected!.version }), { success: 'Affiliation updated', invalidate: inv, onSuccess: () => { setAction(null); setSelected(null); setNote(''); } });
  const doctorName = useGet<ProviderHit>(filters.doctorProviderId ? `/admin/providers/${filters.doctorProviderId}` : null);
  const facilityName = useGet<ProviderHit>(filters.facilityProviderId ? `/admin/providers/${filters.facilityProviderId}` : null);

  const columns: ColumnDef<Aff, unknown>[] = [
    { header: 'Doctor', cell: ({ row }) => <Link className="font-medium underline-offset-2 hover:underline" href={`/providers/${row.original.doctor.id}`} onClick={(e) => e.stopPropagation()}>{row.original.doctor.displayName}</Link> },
    { header: 'Facility', cell: ({ row }) => <div><Link className="underline-offset-2 hover:underline" href={`/providers/${row.original.facility.id}`} onClick={(e) => e.stopPropagation()}>{row.original.facility.displayName}</Link><p className="text-xs text-grey-500">{title(row.original.facility.type)}{row.original.location ? ` · ${row.original.location.name}` : ''}</p></div> },
    { header: 'Department / Role', cell: ({ row }) => <span className="text-xs">{row.original.department?.name ?? '—'}{row.original.roleTitle ? ` · ${row.original.roleTitle}` : ''}<br /><span className="text-grey-500">{title(row.original.engagementType)}</span></span> },
    { header: 'Fee', cell: ({ row }) => <span className="tnum">{money(row.original.consultationFeeMinor)}</span> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Confirmations', cell: ({ row }) => <span className="flex flex-wrap gap-1 text-xs"><Badge accent={row.original.doctorConfirmedAt ? 'green' : 'orange'}>Doctor {row.original.doctorConfirmedAt ? '✓' : '…'}</Badge><Badge accent={row.original.facilityConfirmedAt ? 'green' : 'orange'}>Facility {row.original.facilityConfirmedAt ? '✓' : '…'}</Badge>{row.original.verifiedAt && <Badge accent="blue">Verified</Badge>}</span> },
    { header: 'Since', cell: ({ row }) => <span className="text-xs text-grey-600" title={dateTime(row.original.createdAt)}>{row.original.startDate ? date(row.original.startDate) : relative(row.original.createdAt)}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => <span className="flex justify-end"><Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setSelected(row.original); }}><Eye size={14} /> View</Button></span> },
  ];

  const anyFilter = Object.values(filters).some(Boolean);
  const nextActions = (a: Aff) => (a.status === 'PENDING_VERIFICATION' ? ['VERIFY', 'REJECT'] : a.status === 'ACTIVE' ? ['SUSPEND', 'END'] : a.status === 'SUSPENDED' ? ['REACTIVATE', 'END'] : []) as typeof action[];

  return (
    <RequirePermission anyOf={['affiliations.read']}>
      <PageHeader title="Doctor–Hospital Affiliations" description="A doctor keeps one identity and can practise at many facilities. Both parties confirm, then the platform verifies before patients can book." actions={can('affiliations.manage') && <Button onClick={() => setCreating(true)}><Link2 size={16} /> Create from Evidence</Button>} />
      <Card padded={false}>
        <div className="p-5">
          <DataTable<Aff>
            path="/admin/affiliations"
            params={filters}
            columns={columns}
            onRowClick={setSelected}
            emptyTitle={anyFilter ? 'No Affiliations Match' : 'No Affiliations Yet'}
            emptyDescription={anyFilter ? 'Try clearing a filter.' : 'Affiliations are created when a facility invites a doctor, a doctor requests to join, or an operator records one from signed evidence.'}
            toolbar={
              <>
                <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-52"><option value="">All Statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
                <ProviderPicker label="Doctor" type="DOCTOR" value={filters.doctorProviderId} valueName={doctorName.data?.displayName} onChange={(id) => set('doctorProviderId', id)} />
                <ProviderPicker label="Facility" type="" value={filters.facilityProviderId} valueName={facilityName.data?.displayName} onChange={(id) => set('facilityProviderId', id)} />
                {anyFilter && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
              </>
            }
          />
        </div>
      </Card>

      <Dialog open={!!selected && !action} onClose={() => setSelected(null)} title={selected ? `${selected.doctor.displayName} at ${selected.facility.displayName}` : ''} description={selected ? STATUS_HELP[selected.status] : undefined} icon={Link2} size="lg" footer={
        <>
          {can('affiliations.verify') && selected && nextActions(selected).map((a) => <Button key={a!} variant={a === 'REJECT' || a === 'END' ? 'danger' : a === 'VERIFY' || a === 'REACTIVATE' ? 'primary' : 'secondary'} onClick={() => setAction(a)}>{title(a!)}</Button>)}
          <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
        </>
      }>
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><Badge>{selected.status}</Badge><Badge accent={selected.doctorConfirmedAt ? 'green' : 'orange'}>Doctor {selected.doctorConfirmedAt ? 'Confirmed' : 'Pending'}</Badge><Badge accent={selected.facilityConfirmedAt ? 'green' : 'orange'}>Facility {selected.facilityConfirmedAt ? 'Confirmed' : 'Pending'}</Badge>{selected.verifiedAt && <Badge accent="blue">Verified {date(selected.verifiedAt)}</Badge>}</div>
            {selected.status === 'PENDING_VERIFICATION' && (selected.doctor.status !== 'APPROVED' || selected.facility.status !== 'APPROVED') && <p className="flex items-start gap-1.5 rounded-lg border border-orange/30 bg-orange-soft p-3 text-xs text-grey-700"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden /> Verification needs both providers APPROVED. {selected.doctor.status !== 'APPROVED' ? `The doctor is ${title(selected.doctor.status)}. ` : ''}{selected.facility.status !== 'APPROVED' ? `The facility is ${title(selected.facility.status)}.` : ''}</p>}
            <div className="grid gap-4 md:grid-cols-2">
              <FormSection title="Doctor" icon={Stethoscope} accent="blue"><p className="text-sm font-medium"><Link className="underline-offset-2 hover:underline" href={`/providers/${selected.doctor.id}`}>{selected.doctor.displayName}</Link></p><p className="text-xs text-grey-500">Provider status: {title(selected.doctor.status)}</p></FormSection>
              <FormSection title="Facility" icon={Building2} accent="purple"><p className="text-sm font-medium"><Link className="underline-offset-2 hover:underline" href={`/providers/${selected.facility.id}`}>{selected.facility.displayName}</Link></p><p className="text-xs text-grey-500">{title(selected.facility.type)} · {title(selected.facility.status)} · {selected.location?.name ?? 'all locations'}</p></FormSection>
            </div>
            <FormSection title="Terms" icon={CheckCircle2} accent="green">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-grey-500">Department</dt><dd>{selected.department?.name ?? '—'}</dd></div>
                <div><dt className="text-xs text-grey-500">Role</dt><dd>{selected.roleTitle ?? '—'} · {title(selected.engagementType)}</dd></div>
                <div><dt className="text-xs text-grey-500">Consultation Fee</dt><dd className="tnum">{money(selected.consultationFeeMinor)}</dd></div>
                <div><dt className="text-xs text-grey-500">Period</dt><dd>{selected.startDate ? date(selected.startDate) : 'Not started'}{selected.endDate ? ` → ${date(selected.endDate)}` : ''}</dd></div>
                <div><dt className="text-xs text-grey-500">Initiated By</dt><dd>{title(selected.initiatedBy)}</dd></div>
                {selected.statusReason && <div className="sm:col-span-2"><dt className="text-xs text-grey-500">Latest Note</dt><dd>{selected.statusReason}</dd></div>}
              </dl>
            </FormSection>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-grey-500">Timeline</h3>
              <ul className="mt-1 divide-y divide-grey-100 text-xs">{selected.events.map((e, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span>{e.fromStatus ? `${title(e.fromStatus)} → ` : ''}<span className="font-medium">{title(e.toStatus)}</span> by {e.actorKind.toLowerCase()}{e.note ? ` — ${e.note}` : ''}</span><span className="shrink-0 text-grey-500">{dateTime(e.createdAt)}</span></li>)}</ul>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog open={!!action} onClose={() => setAction(null)} onConfirm={() => act.mutate()} title={`${title(action ?? '')} Affiliation`} message={action === 'VERIFY' ? 'Requires both parties confirmed and both providers APPROVED. You cannot verify an affiliation you created.' : action === 'END' ? 'Future open slots at this facility are blocked; the response tells you how many existing bookings need manual handling.' : action === 'REJECT' ? 'The doctor and facility are told the affiliation was not verified.' : 'This change is recorded on the affiliation timeline.'} confirmLabel={title(action ?? '')} loading={act.isPending} danger={action === 'REJECT' || action === 'END'}>
        <Field label="Note" required={action === 'REJECT' || action === 'END' || action === 'SUSPEND'} className="mt-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>

      {creating && <CreateAffiliationDialog onClose={() => setCreating(false)} meId={me?.id} />}
    </RequirePermission>
  );
}

/** Search-as-you-type picker over /admin/providers; stores the id, shows the name. */
function ProviderPicker({ label, type, value, valueName, onChange, className }: { label: string; type: string; value: string; valueName?: string; onChange: (id: string, name?: string) => void; className?: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const hits = useGet<ProviderHit[]>(dq.length >= 2 ? `/admin/providers?q=${encodeURIComponent(dq)}${type && type !== 'FACILITY' ? `&type=${type}` : ''}&limit=8` : null);
  if (value) return <div className={cx('flex h-10 items-center gap-2 rounded-lg border border-grey-300 bg-grey-50 px-3 text-sm', className ?? 'w-64')}><span className="truncate">{valueName ?? `${label} ${value.slice(0, 8)}`}</span><button type="button" className="ml-auto text-xs text-grey-500 underline-offset-2 hover:underline" onClick={() => { onChange(''); setQ(''); }}>Clear</button></div>;
  return (
    <div className={cx('relative', className ?? 'w-64')}>
      <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
      <Input aria-label={label} placeholder={`${label} Name`} value={q} onChange={(e) => setQ(e.target.value)} className="w-full pl-9" />
      {dq.length >= 2 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-grey-200 bg-paper py-1 text-sm shadow-[var(--shadow-float)]">
          {hits.isPending ? <li className="px-3 py-2 text-grey-500">Searching…</li> : hits.data?.length ? hits.data.filter((p) => !type || p.type === type || (type === 'FACILITY' && p.type !== 'DOCTOR')).map((p) => <li key={p.id}><button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-grey-50" onClick={() => { onChange(p.id, p.displayName); setQ(''); }}><span className="truncate">{p.displayName}</span><span className="shrink-0 text-xs text-grey-500">{title(p.type)} · {title(p.status)}</span></button></li>) : <li className="px-3 py-2 text-grey-500">No providers match</li>}
        </ul>
      )}
    </div>
  );
}

function CreateAffiliationDialog({ onClose, meId }: { onClose: () => void; meId: string | undefined }) {
  const [form, setForm] = useState({ doctorProviderId: '', doctorName: '', facilityProviderId: '', facilityName: '', departmentCode: '', roleTitle: '', consultationFee: '', engagementType: 'VISITING', evidenceNote: '' });
  const facilityDepts = useGet<{ departments?: { code: string; name: string }[] }>(form.facilityProviderId ? `/admin/providers/${form.facilityProviderId}` : null);
  const create = useAction(() => api.post('/admin/affiliations', { doctorProviderId: form.doctorProviderId, facilityProviderId: form.facilityProviderId, departmentCode: form.departmentCode || undefined, roleTitle: form.roleTitle.trim() || undefined, consultationFeeMinor: form.consultationFee ? Math.round(Number(form.consultationFee) * 100) : undefined, engagementType: form.engagementType, evidenceNote: form.evidenceNote.trim() }), { success: 'Affiliation created — pending verification by a different user', invalidate: ['/admin/affiliations'], onSuccess: onClose });
  const valid = form.doctorProviderId && form.facilityProviderId && form.doctorProviderId !== form.facilityProviderId && form.evidenceNote.trim().length >= 5 && (!form.consultationFee || Number(form.consultationFee) >= 0);
  const depts = facilityDepts.data?.departments ?? [];
  return (
    <Dialog open onClose={onClose} title="Create Affiliation from Evidence" description="For hospital rosters submitted with the doctor's signed consent. Someone other than you must verify it." icon={Link2} size="lg" footer={<><Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!valid}>Create</Button></>}>
      <div className="space-y-4">
        <FormSection title="Who" icon={Stethoscope} accent="blue" hint="Both must already exist as providers. Only approved providers can be verified afterwards.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Doctor" required><ProviderPicker label="Doctor" type="DOCTOR" value={form.doctorProviderId} valueName={form.doctorName} onChange={(id, name) => setForm({ ...form, doctorProviderId: id, doctorName: name ?? '' })} className="w-full" /></Field>
            <Field label="Facility" required><ProviderPicker label="Facility" type="FACILITY" value={form.facilityProviderId} valueName={form.facilityName} onChange={(id, name) => setForm({ ...form, facilityProviderId: id, facilityName: name ?? '', departmentCode: '' })} className="w-full" /></Field>
          </div>
        </FormSection>
        <FormSection title="Terms" icon={CheckCircle2} accent="green">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Department" hint={form.facilityProviderId ? (depts.length ? 'From the facility\'s departments' : 'This facility has no departments configured yet') : 'Pick a facility first'}><Select value={form.departmentCode} onChange={(e) => setForm({ ...form, departmentCode: e.target.value })} disabled={!depts.length}><option value="">None</option>{depts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</Select></Field>
            <Field label="Engagement" required><Select value={form.engagementType} onChange={(e) => setForm({ ...form, engagementType: e.target.value })}>{ENGAGEMENTS.map((x) => <option key={x} value={x}>{title(x)}</option>)}</Select></Field>
            <Field label="Role Title" hint="e.g. Senior Consultant"><Input value={form.roleTitle} onChange={(e) => setForm({ ...form, roleTitle: e.target.value })} maxLength={120} /></Field>
            <Field label="Consultation Fee (₹)" hint="At this facility; blank uses the doctor's default"><Input type="number" min={0} step="1" value={form.consultationFee} onChange={(e) => setForm({ ...form, consultationFee: e.target.value })} /></Field>
          </div>
        </FormSection>
        <FormSection title="Evidence" icon={Link2} accent="orange" hint="Recorded on the timeline and in the audit log.">
          <Field label="Evidence Note" required hint="e.g. Signed roster letter dated 2026-10-01, file ref HR/2026/14"><Textarea value={form.evidenceNote} onChange={(e) => setForm({ ...form, evidenceNote: e.target.value })} className="min-h-24" /></Field>
        </FormSection>
        {meId && <p className="text-xs text-grey-500">You will not be able to verify this affiliation yourself.</p>}
      </div>
    </Dialog>
  );
}
