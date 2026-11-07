'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertOctagon, BellRing, CreditCard, Gavel, Globe2, Landmark, LayoutTemplate, Mail, MapPinned, Palette, Plus, Settings2, ShieldAlert, Smartphone, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { dateTime, relative, short, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, ConfirmDialog, DescriptionList, Dialog, EmptyState, ErrorState, Field, FormSection, Input, PageHeader, Select, Skeleton, Tabs, Textarea, cx } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import { BrandingSettings, SmtpSettings } from '@/components/settings/integrations';
import { RegistrySettings } from '@/components/settings/registries';
import { PortalConfig } from '@/components/settings/portal-config';
import { PaymentsSettings } from '@/components/settings/payments';
import { PushSettings } from '@/components/settings/push';
import { PatientAppSettings } from '@/components/settings/patient-app';
import { PlatformSettings } from '@/components/settings/platform-settings';
import { LocationFields, EMPTY_ADDRESS, type AddressValue } from '@/components/forms/location-fields';
import { HOME_COUNTRY } from '@/lib/geo';

interface Region { id: string; code: string; name: string; district: string; state: string; status: string; launchedAt: string | null; providerCount: number }
interface Hold { id: string; entityType: string; entityId: string; reason: string; placedById: string; placedAt: string; releasedAt: string | null; releasedById: string | null }
interface Incident { id: string; reference: string; severity: string; status: string; title: string; summary: string; detectedAt: string; containedAt: string | null; resolvedAt: string | null; personalDataAffected: boolean; regulatorNotifiedAt: string | null; createdById: string; createdAt: string; updatedAt: string }

const TABS: { key: string; label: string; icon: LucideIcon; permission?: string }[] = [
  { key: 'settings', label: 'Settings', icon: Settings2 },
  { key: 'branding', label: 'Branding', icon: Palette },
  { key: 'email', label: 'Email (SMTP)', icon: Mail },
  { key: 'registries', label: 'Registries', icon: Landmark },
  { key: 'portal', label: 'Provider Portal', icon: LayoutTemplate },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'push', label: 'Push', icon: BellRing },
  { key: 'patient', label: 'Patient App', icon: Smartphone },
  { key: 'regions', label: 'Service Regions', icon: MapPinned },
  { key: 'holds', label: 'Legal Holds', icon: Gavel, permission: 'compliance.manage' },
  { key: 'incidents', label: 'Incidents', icon: ShieldAlert, permission: 'compliance.manage' },
];

export default function SettingsPage() {
  return <Suspense fallback={<Skeleton rows={8} />}><SettingsInner /></Suspense>;
}

function SettingsInner() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs = TABS.filter((t) => !t.permission || can(t.permission));
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'settings';
  const setTab = (k: string) => router.replace(k === 'settings' ? pathname : `${pathname}?tab=${k}`, { scroll: false });
  return (
    <RequirePermission anyOf={['settings.read']}>
      <PageHeader title="Platform Settings" description="Operational defaults, branding, outbound email, registry connectors, launch regions and compliance records. Every change here is versioned and written to the audit log with a reason." />
      <nav aria-label="Settings Sections" className="relative mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-grey-200 bg-paper p-1 shadow-[var(--shadow-card)]">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cx('inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition-colors', tab === t.key ? 'bg-ink font-medium text-paper shadow-sm' : 'text-grey-600 hover:bg-grey-100 hover:text-ink')}>
            <t.icon size={15} aria-hidden /> {t.label}
          </button>
        ))}
      </nav>
      {tab === 'settings' && <PlatformSettings />}
      {tab === 'branding' && <BrandingSettings />}
      {tab === 'email' && <SmtpSettings />}
      {tab === 'registries' && <RegistrySettings />}
      {tab === 'portal' && <PortalConfig />}
      {tab === 'payments' && <PaymentsSettings />}
      {tab === 'push' && <PushSettings />}
      {tab === 'patient' && <PatientAppSettings />}
      {tab === 'regions' && <Regions />}
      {tab === 'holds' && <Holds />}
      {tab === 'incidents' && <Incidents />}
    </RequirePermission>
  );
}

/* ─── Service regions ──────────────────────────────────────────────────── */
const REGION_STATUSES = ['PLANNED', 'PILOT', 'LIVE', 'PAUSED'] as const;
const REGION_HELP: Record<string, string> = { PLANNED: 'Being prepared; not shown to patients.', PILOT: 'Live for invited users and partners only.', LIVE: 'Open to every patient in the area.', PAUSED: 'Temporarily withdrawn; existing bookings continue.' };

function Regions() {
  const { can } = useAuth();
  const regions = useGet<Region[]>('/admin/regions');
  const [adding, setAdding] = useState(false);
  const [statusChange, setStatusChange] = useState<{ region: Region; status: string } | null>(null);
  const setStatus = useAction((x: { id: string; status: string }) => api.post(`/admin/regions/${x.id}/status`, { status: x.status }), { success: 'Region status updated', invalidate: ['/admin/regions'], onSuccess: () => setStatusChange(null) });
  const manage = can('regions.manage');
  const byStatus = useMemo(() => Object.fromEntries(REGION_STATUSES.map((s) => [s, (regions.data ?? []).filter((r) => r.status === s).length])), [regions.data]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {REGION_STATUSES.map((s) => <div key={s} className="rounded-2xl border border-grey-200 bg-paper px-4 py-3 shadow-[var(--shadow-card)]"><p className="tnum text-lg font-bold leading-tight">{regions.data ? byStatus[s] : '—'}</p><p className="text-[11px] text-grey-500">{title(s)}</p></div>)}
      </div>
      <Card title="Service Regions" description="Launch areas (a town, block or district) that providers, dispatch and reporting are grouped by. The pilot starts with Moyna and Tamluk; add any Indian area the same way." actions={manage && <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add Region</Button>} padded={false}>
        {regions.isPending ? <div className="p-5"><Skeleton /></div> : regions.isError ? <div className="p-5"><ErrorState error={regions.error} retry={() => regions.refetch()} /></div> : regions.data.length === 0 ? <div className="p-5"><EmptyState title="No Service Regions Yet" description="Add the first launch area to start grouping providers." action={manage ? <Button onClick={() => setAdding(true)}>Add Region</Button> : undefined} /></div> : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-grey-500"><tr className="border-b border-grey-100"><th className="px-5 py-2.5 font-medium">Region</th><th className="py-2.5 font-medium">District / State</th><th className="py-2.5 font-medium">Status</th><th className="py-2.5 font-medium">Providers</th><th className="py-2.5 font-medium">Launched</th>{manage && <th className="px-5 py-2.5 text-right font-medium">Change Status</th>}</tr></thead>
              <tbody>
                {regions.data.map((r) => (
                  <tr key={r.id} className="border-b border-grey-100 last:border-0 hover:bg-grey-50">
                    <td className="px-5 py-3"><p className="font-medium">{r.name}</p><p className="font-mono text-[11px] text-grey-500">{r.code}</p></td>
                    <td className="py-3 text-grey-700">{r.district}, {r.state}</td>
                    <td className="py-3"><Badge>{r.status}</Badge></td>
                    <td className="tnum py-3">{r.providerCount}</td>
                    <td className="py-3 text-xs text-grey-600">{r.launchedAt ? dateTime(r.launchedAt) : '—'}</td>
                    {manage && <td className="px-5 py-3 text-right"><Select aria-label={`Status of ${r.name}`} value={r.status} onChange={(e) => setStatusChange({ region: r, status: e.target.value })} className="h-8 w-32 text-xs">{REGION_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adding && <AddRegionDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!statusChange} onClose={() => setStatusChange(null)} onConfirm={() => statusChange && setStatus.mutate({ id: statusChange.region.id, status: statusChange.status })} loading={setStatus.isPending} danger={statusChange?.status === 'PAUSED'} title={statusChange ? `Set ${statusChange.region.name} to ${title(statusChange.status)}?` : ''} confirmLabel="Change Status" message={statusChange ? `${REGION_HELP[statusChange.status]}${statusChange.status === 'LIVE' && statusChange.region.providerCount === 0 ? ' This region has no providers yet, so patients would see an empty area.' : ''}` : ''} />
    </div>
  );
}

function AddRegionDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ code: '', name: '', codeTouched: false });
  const [addr, setAddr] = useState<AddressValue>(EMPTY_ADDRESS);
  const regions = useGet<Region[]>('/admin/regions');
  const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const suggestedCode = [HOME_COUNTRY, addr.stateCode, slug(f.name || addr.city)].filter(Boolean).join('-');
  const code = f.codeTouched ? f.code : suggestedCode;
  const name = f.name || addr.city;
  const codeError = code && !/^[A-Z0-9-]{3,64}$/.test(code) ? 'Uppercase letters, digits and hyphens, 3–64 characters' : regions.data?.some((r) => r.code === code) ? 'This code is already used' : undefined;
  const nameDupe = regions.data?.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase() && r.district.toLowerCase() === addr.district.trim().toLowerCase());
  const create = useAction(() => api.post('/admin/regions', { code, name: name.trim(), district: addr.district.trim(), state: addr.state }), { success: 'Region added as PLANNED', invalidate: ['/admin/regions'], onSuccess: onClose });
  const ready = code.length >= 3 && !codeError && name.trim().length >= 2 && addr.district.trim().length >= 2 && addr.state;
  const dirty = !!(f.name || f.code || addr.pincode || addr.stateCode || addr.district || addr.city);
  const close = () => { if (dirty && !window.confirm('Discard this region?')) return; onClose(); };
  return (
    <Dialog open onClose={close} size="lg" icon={Globe2} title="Add a Service Region" description="New regions start as PLANNED and are not visible to patients until you set them to PILOT or LIVE." footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ready}>Add Region</Button></>}>
      <div className="space-y-4">
        <p className="text-grey-600">Enter the PIN code first; state and district fill automatically from the postal directory and you can adjust them.</p>
        <LocationFields value={addr} onChange={(p) => setAddr((a) => ({ ...a, ...p }))} show={{ pincode: true, city: true, locality: false }} required />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Region Name" required hint={nameDupe ? 'A region with this name already exists in that district' : 'Defaults to the city / town'}><Input value={f.name} placeholder={addr.city || 'e.g. Tamluk'} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></Field>
          <Field label="Code" required error={codeError} hint="Permanent identifier used in exports and integrations; suggested from country, state and name"><Input value={code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase(), codeTouched: true })} className="font-mono" maxLength={64} /></Field>
        </div>
      </div>
    </Dialog>
  );
}

/* ─── Legal holds ──────────────────────────────────────────────────────── */
const HOLD_ENTITIES = ['user', 'provider', 'transaction', 'appointment'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entityHref = (type: string, id: string) => (type === 'user' ? `/users/${id}` : type === 'provider' ? `/providers/${id}` : type === 'appointment' ? `/appointments?q=${id}` : `/payments?q=${id}`);

function Holds() {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [placing, setPlacing] = useState(false);
  const [releasing, setReleasing] = useState<Hold | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const release = useAction(() => api.post(`/admin/compliance/legal-holds/${releasing!.id}/release`, { reason: releaseReason.trim() }), { success: 'Hold released', invalidate: ['/admin/compliance'], onSuccess: () => { setReleasing(null); setReleaseReason(''); } });
  const columns: ColumnDef<Hold, unknown>[] = [
    { header: 'Entity', cell: ({ row }) => <div className="flex items-center gap-2"><Badge accent="blue">{row.original.entityType}</Badge><Link href={entityHref(row.original.entityType, row.original.entityId)} className="font-mono text-xs underline-offset-2 hover:underline">{row.original.entityId}</Link></div> },
    { header: 'Reason', cell: ({ row }) => <span className="block max-w-md text-xs">{row.original.reason}</span> },
    { header: 'Placed', cell: ({ row }) => <span className="text-xs text-grey-600" title={dateTime(row.original.placedAt)}>{relative(row.original.placedAt)} · by {short(row.original.placedById)}</span> },
    { header: 'Status', cell: ({ row }) => (row.original.releasedAt ? <span className="text-xs text-grey-600">Released {relative(row.original.releasedAt)}</span> : <Badge accent="orange">active</Badge>) },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => !row.original.releasedAt && <Button size="sm" variant="secondary" onClick={() => setReleasing(row.original)}>Release</Button> },
  ];
  return (
    <div className="space-y-4">
      <Card title="Legal Holds" description="A hold freezes an entity for litigation, regulator requests or disputes: it blocks anonymisation and deletion until released. Placing and releasing are both audited with a reason." actions={<><Tabs active={scope} onChange={(k) => setScope(k as typeof scope)} tabs={[{ key: 'active', label: 'Active' }, { key: 'all', label: 'All' }]} /><Button size="sm" onClick={() => setPlacing(true)}><Plus size={14} /> Place Hold</Button></>} padded={false}>
        <div className="p-5 pt-2"><DataTable<Hold> path="/admin/compliance/legal-holds" params={{ activeOnly: scope === 'active' ? 'true' : 'false' }} columns={columns} emptyTitle={scope === 'active' ? 'No active legal holds' : 'No legal holds have been placed'} emptyDescription="Place a hold when a regulator, court or dispute requires records to be preserved." /></div>
      </Card>
      {placing && <PlaceHoldDialog onClose={() => setPlacing(false)} />}
      <Dialog open={!!releasing} onClose={() => { setReleasing(null); setReleaseReason(''); }} icon={Gavel} title="Release Legal Hold" description={releasing ? `${releasing.entityType} ${releasing.entityId}` : ''} footer={<><Button variant="ghost" onClick={() => setReleasing(null)}>Cancel</Button><Button variant="danger" onClick={() => release.mutate()} loading={release.isPending} disabled={releaseReason.trim().length < 5}>Release Hold</Button></>}>
        <div className="space-y-3">
          <p className="text-grey-700">Once released, retention jobs may anonymise or delete this record again. Make sure the legal matter is closed.</p>
          {releasing && <p className="rounded-xl bg-grey-50 px-3 py-2 text-xs text-grey-700"><span className="font-medium">Original reason:</span> {releasing.reason}</p>}
          <Field label="Reason for Release" required hint="At least 5 characters · recorded in the audit log"><Textarea value={releaseReason} onChange={(e) => setReleaseReason(e.target.value.slice(0, 1000))} className="min-h-16" placeholder="e.g. Case 12/2026 closed; counsel confirmed on 17 Oct" /></Field>
        </div>
      </Dialog>
    </div>
  );
}

function PlaceHoldDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ entityType: 'user' as (typeof HOLD_ENTITIES)[number], entityId: '', reason: '' });
  const idError = f.entityId && !UUID_RE.test(f.entityId) ? 'Paste the full id (UUID) from the record’s page' : undefined;
  const create = useAction(() => api.post('/admin/compliance/legal-holds', { entityType: f.entityType, entityId: f.entityId.trim(), reason: f.reason.trim() }), { success: 'Legal hold placed', invalidate: ['/admin/compliance'], onSuccess: onClose });
  const ready = UUID_RE.test(f.entityId) && f.reason.trim().length >= 5;
  const dirty = !!(f.entityId || f.reason);
  const close = () => { if (dirty && !window.confirm('Discard this hold?')) return; onClose(); };
  return (
    <Dialog open onClose={close} icon={Gavel} title="Place a Legal Hold" description="Blocks anonymisation and deletion of one record until released." footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ready}>Place Hold</Button></>}>
      <div className="space-y-3">
        <Field label="Record Type" required><Select value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value as typeof f.entityType })}>{HOLD_ENTITIES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
        <Field label="Record ID" required error={idError} hint="Copy it from the record’s page URL or details panel"><Input value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value.trim() })} className="font-mono" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" aria-invalid={!!idError} /></Field>
        <Field label="Reason" required hint="Case reference, requesting authority and expected duration · at least 5 characters"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value.slice(0, 1000) })} className="min-h-20" /></Field>
      </div>
    </Dialog>
  );
}

/* ─── Incidents ────────────────────────────────────────────────────────── */
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const INCIDENT_FLOW = ['OPEN', 'CONTAINED', 'RESOLVED', 'CLOSED'] as const;
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

function Incidents() {
  const [status, setStatus] = useState('');
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<Incident | null>(null);
  const columns: ColumnDef<Incident, unknown>[] = [
    { header: 'Incident', cell: ({ row }) => <div><p className="font-medium">{row.original.title}</p><p className="font-mono text-xs text-grey-500">{row.original.reference}</p></div> },
    { header: 'Severity', cell: ({ row }) => <Badge>{row.original.severity}</Badge> },
    { header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { header: 'Personal Data', cell: ({ row }) => (row.original.personalDataAffected ? <Badge accent="red">affected</Badge> : <span className="text-xs text-grey-500">No</span>) },
    { header: 'Detected', cell: ({ row }) => <span className="text-xs text-grey-600" title={dateTime(row.original.detectedAt)}>{relative(row.original.detectedAt)}</span> },
    { header: 'Regulator', cell: ({ row }) => (row.original.regulatorNotifiedAt ? <span className="text-xs text-grey-600">Notified {relative(row.original.regulatorNotifiedAt)}</span> : row.original.personalDataAffected && row.original.status !== 'CLOSED' ? <span className="text-xs font-medium text-orange">Not Yet Notified</span> : <span className="text-xs text-grey-400">—</span>) },
  ];
  return (
    <div className="space-y-4">
      <Card title="Security & Privacy Incidents" description="Record every suspected breach, misuse or outage affecting personal data. Under the DPDP Act, breaches must be reported to the Data Protection Board and affected individuals; track the notification here." actions={<><Select aria-label="Filter by Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-40 text-xs"><option value="">All Statuses</option>{INCIDENT_FLOW.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select><Button size="sm" onClick={() => setRecording(true)}><Plus size={14} /> Record Incident</Button></>} padded={false}>
        <div className="p-5 pt-2"><DataTable<Incident> path="/admin/compliance/incidents" params={{ status }} columns={columns} onRowClick={setSelected} emptyTitle={status ? `No ${title(status).toLowerCase()} incidents` : 'No incidents recorded'} emptyDescription="That is good news — but record even near-misses so the register shows due diligence." /></div>
      </Card>
      {recording && <RecordIncidentDialog onClose={() => setRecording(false)} />}
      {selected && <IncidentDialog incident={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RecordIncidentDialog({ onClose }: { onClose: () => void }) {
  // Captured once when the dialog opens: the React Compiler forbids reading the clock during render.
  const [openedAt] = useState(() => ({ local: nowLocal(), ms: Date.now() }));
  const [f, setF] = useState({ severity: 'MEDIUM' as (typeof SEVERITIES)[number], title: '', summary: '', detectedAt: openedAt.local, personalDataAffected: false });
  const detectedError = f.detectedAt && new Date(f.detectedAt).getTime() > openedAt.ms + 60_000 ? 'Detection time cannot be in the future' : undefined;
  const create = useAction(() => api.post('/admin/compliance/incidents', { severity: f.severity, title: f.title.trim(), summary: f.summary.trim(), detectedAt: new Date(f.detectedAt).toISOString(), personalDataAffected: f.personalDataAffected }), { success: 'Incident recorded', invalidate: ['/admin/compliance'], onSuccess: onClose });
  const ready = f.title.trim().length >= 3 && f.summary.trim().length >= 10 && !!f.detectedAt && !detectedError;
  const dirty = !!(f.title || f.summary);
  const close = () => { if (dirty && !window.confirm('Discard this incident record?')) return; onClose(); };
  return (
    <Dialog open onClose={close} size="lg" icon={AlertOctagon} title="Record an Incident" description="Creates an OPEN incident with a reference number; you can update status and regulator notification afterwards." footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ready}>Record Incident</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Title" required className="md:col-span-2" hint={`${f.title.length}/200`}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value.slice(0, 200) })} placeholder="e.g. Diagnostic report opened by an unauthorised staff account" /></Field>
        <Field label="Severity" required hint="Critical: confirmed exposure of health or payment data"><Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as typeof f.severity })}>{SEVERITIES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
        <Field label="Detected At" required error={detectedError}><Input type="datetime-local" value={f.detectedAt} max={openedAt.local} onChange={(e) => setF({ ...f, detectedAt: e.target.value })} /></Field>
        <Field label="What Happened" required className="md:col-span-2" hint={`${f.summary.trim().length}/5000 · at least 10 characters · what, who, which data, how it was found`}><Textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value.slice(0, 5000) })} className="min-h-28" /></Field>
        <label className={cx('flex items-start gap-2 rounded-xl border px-3 py-2 text-sm md:col-span-2', f.personalDataAffected ? 'border-red/30 bg-red-soft' : 'border-grey-200')}>
          <input type="checkbox" className="mt-0.5 accent-black" checked={f.personalDataAffected} onChange={(e) => setF({ ...f, personalDataAffected: e.target.checked })} />
          <span><span className="font-medium">Personal Data Affected</span><span className="block text-xs text-grey-600">Starts the DPDP notification duty: inform the Data Protection Board and affected individuals, and record the time here once done.</span></span>
        </label>
      </div>
    </Dialog>
  );
}

function IncidentDialog({ incident: i, onClose }: { incident: Incident; onClose: () => void }) {
  const [next, setNext] = useState<string>('');
  const [note, setNote] = useState('');
  const [notifiedAt, setNotifiedAt] = useState('');
  const [maxNow] = useState(nowLocal);
  const idx = INCIDENT_FLOW.indexOf(i.status as (typeof INCIDENT_FLOW)[number]);
  const forward = INCIDENT_FLOW.slice(idx + 1);
  const update = useAction(() => api.patch(`/admin/compliance/incidents/${i.id}`, { ...(next ? { status: next } : {}), ...(notifiedAt ? { regulatorNotifiedAt: new Date(notifiedAt).toISOString() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }), { success: 'Incident updated', invalidate: ['/admin/compliance'], onSuccess: onClose });
  const closeNeedsNotice = next === 'CLOSED' && i.personalDataAffected && !i.regulatorNotifiedAt && !notifiedAt;
  const ready = (next || notifiedAt) && !closeNeedsNotice && (!next || note.trim().length >= 5);
  return (
    <Dialog open onClose={onClose} size="lg" icon={AlertOctagon} title={i.title} description={`${i.reference} · ${title(i.severity)} · ${title(i.status)}`} footer={<><Button variant="ghost" onClick={onClose}>Close</Button>{i.status !== 'CLOSED' && <Button onClick={() => update.mutate()} loading={update.isPending} disabled={!ready}>Save Update</Button>}</>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Badge>{i.severity}</Badge><Badge>{i.status}</Badge>{i.personalDataAffected && <Badge accent="red">personal data affected</Badge>}</div>
        <p className="whitespace-pre-wrap text-grey-800">{i.summary}</p>
        <DescriptionList items={[{ label: 'Detected', value: dateTime(i.detectedAt) }, { label: 'Recorded', value: `${dateTime(i.createdAt)} by ${short(i.createdById)}` }, { label: 'Contained', value: dateTime(i.containedAt) }, { label: 'Resolved', value: dateTime(i.resolvedAt) }, { label: 'Regulator Notified', value: i.regulatorNotifiedAt ? dateTime(i.regulatorNotifiedAt) : i.personalDataAffected ? <span className="font-medium text-orange">Not Yet</span> : 'Not Required' }, { label: 'Last Updated', value: dateTime(i.updatedAt) }]} />
        <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Lifecycle">
          {INCIDENT_FLOW.map((s, n) => <li key={s} className="flex items-center gap-2"><span className={cx('rounded-full px-2.5 py-1 font-medium', n < idx ? 'bg-green-soft text-green' : n === idx ? 'bg-ink text-paper' : 'bg-grey-100 text-grey-500')}>{title(s)}</span>{n < INCIDENT_FLOW.length - 1 && <span className="h-px w-5 bg-grey-300" />}</li>)}
        </ol>
        {i.status !== 'CLOSED' && (
          <FormSection title="Update" hint="Status moves forward only. Each update is audited with your note.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Move To" hint={next ? ({ CONTAINED: 'The cause is stopped; data is no longer leaking.', RESOLVED: 'Root cause fixed and affected people handled.', CLOSED: 'Post-mortem done; no further action.' } as Record<string, string>)[next] : 'Leave unchanged to only record the regulator notice'}><Select value={next} onChange={(e) => setNext(e.target.value)}><option value="">Keep {title(i.status)}</option>{forward.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
              <Field label="Regulator Notified At" hint={i.regulatorNotifiedAt ? 'Already recorded; set again only to correct it' : i.personalDataAffected ? 'Required before closing' : 'Optional'}><Input type="datetime-local" value={notifiedAt} max={maxNow} onChange={(e) => setNotifiedAt(e.target.value)} /></Field>
              <Field label="Note" required={!!next} className="md:col-span-2" hint="What was done, by whom · at least 5 characters when changing status"><Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} className="min-h-16" /></Field>
            </div>
            {closeNeedsNotice && <p role="alert" className="mt-3 rounded-xl bg-red-soft px-3 py-2 text-xs text-red">Personal data was affected and the regulator notification has not been recorded. Record it before closing the incident.</p>}
          </FormSection>
        )}
      </div>
    </Dialog>
  );
}
