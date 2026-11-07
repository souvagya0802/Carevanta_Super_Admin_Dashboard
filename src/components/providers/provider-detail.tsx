'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { date, dateTime, money, minutes, rating, title } from '@/lib/format';
import { DOCUMENT_TYPES, slugForType } from '@/lib/providers-meta';
import { Badge, Button, Card, ConfirmDialog, DescriptionList, Dialog, ErrorState, Field, Input, PageHeader, Select, Skeleton, Tabs, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { RequirePermission } from '@/components/layout/shell';

export interface ProviderFull {
  id: string; type: string; status: string; version: number; legalName: string; displayName: string; slug: string; description: string | null;
  contactEmail: string | null; contactPhone: string | null; gstin: string | null; registrationNumber: string | null; isListed: boolean; statusReason: string | null;
  submittedAt: string | null; approvedAt: string | null; suspendedAt: string | null; ratingAverage: number | null; ratingCount: number; createdAt: string; updatedAt: string;
  doctor: null | { user: { id: string; fullName: string; email: string | null; phone: string | null }; gender: string | null; yearsOfExperience: number | null; languages: string[]; defaultFeeMinor: number | null; bio: string | null; specialities: { code: string; name: string; isPrimary: boolean; verified: boolean }[]; qualifications: { id: string; degree: string; institution: string; yearAwarded: number | null; verified: boolean }[]; registrations: { id: string; council: string; registrationNumber: string; registrationYear: number | null; validUntil: string | null; verifiedAt: string | null }[] };
  facility: null | { ownershipType: string; bedCount: number | null; icuBedCount: number | null; hasEmergency: boolean; isOpen24x7: boolean; establishmentRegistrationNo: string | null; establishmentRegistrationAuth: string | null; accreditations: string[] };
  diagnostic: null | { offersPathology: boolean; offersImaging: boolean; homeCollectionAvailable: boolean; establishmentRegistrationNo: string | null; nablCertificateNo: string | null; nablScope: string | null; aerbLicenseNo: string | null; pcpndtRegistrationNo: string | null; typicalTurnaroundHours: number | null };
  pharmacy: null | { retailDrugLicenseNo: string | null; wholesaleDrugLicenseNo: string | null; drugLicenseValidUntil: string | null; pharmacistName: string | null; pharmacistRegistrationNo: string | null; homeDeliveryAvailable: boolean };
  ambulance: null | { dispatchPhone: string | null; isOpen24x7: boolean; fleetSize: number | null };
  locations: { id: string; name: string; addressLine1: string; addressLine2: string | null; locality: string | null; city: string; district: string; state: string; pincode: string; latitude: number | null; longitude: number | null; phone: string | null; isPrimary: boolean; isActive: boolean; region: { code: string; name: string } | null; operatingHours: { dayOfWeek: number; opensAtMin: number; closesAtMin: number; isClosed: boolean }[] }[];
  members: { id: string; userId: string; fullName: string; email: string | null; phone: string | null; memberRole: string; status: string; joinedAt: string | null }[];
  latestVerificationCase: null | { id: string; status: string; kind: string; checks: { checkType: string; status: string; isRequired: boolean }[] };
  statusHistory: { fromStatus: string | null; toStatus: string; changedById: string | null; reason: string | null; createdAt: string }[];
  departments: { code: string; name: string; isActive: boolean; verified: boolean }[];
  amenities: { code: string; name: string; verified: boolean }[];
  counts: { documents: number; affiliationsAsFacility: number; affiliationsAsDoctor: number };
}
interface Doc { id: string; documentType: string; status: string; fileName: string; mimeType: string; sizeBytes: number; documentNumber: string | null; issuedAt: string | null; expiresAt: string | null; expired: boolean; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; uploadedById: string | null; createdAt: string }
interface Payout { id: string; accountHolderName: string; accountNumberMasked: string; ifsc: string; status: string; verifiedAt: string | null; createdAt: string }
interface Offering { id: string; serviceCode: string; serviceName: string; category: string; locationId: string | null; priceMinor: number; homeServiceAvailable: boolean; turnaroundHours: number | null; isActive: boolean }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ProviderDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const p = useGet<ProviderFull>(`/admin/providers/${id}`);
  const [tab, setTab] = useState('overview');
  const [statusAction, setStatusAction] = useState<null | 'SUSPEND' | 'REACTIVATE' | 'DEACTIVATE'>(null);
  const [reason, setReason] = useState('');
  const inv = [`/admin/providers/${id}`, '/admin/providers', '/admin/verification-cases'];
  const submit = useAction(() => api.post(`/admin/providers/${id}/submit`), { success: 'Submitted for verification', invalidate: inv });
  const status = useAction((a: string) => api.post(`/admin/providers/${id}/status`, { action: a, reason }), { success: 'Provider status updated', invalidate: inv, onSuccess: () => { setStatusAction(null); setReason(''); } });

  if (p.isPending) return <Skeleton rows={10} />;
  if (p.isError) return <ErrorState error={p.error} retry={() => p.refetch()} />;
  const d = p.data;
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'locations', label: 'Locations & Hours', count: d.locations.length },
    { key: 'members', label: 'Staff', count: d.members.length },
    { key: 'documents', label: 'Documents', count: d.counts.documents },
    { key: 'services', label: 'Services & Pricing' },
    ...(d.facility ? [{ key: 'departments', label: 'Departments & Amenities' }] : []),
    { key: 'payout', label: 'Payout Accounts' },
    { key: 'history', label: 'History', count: d.statusHistory.length },
  ];

  return (
    <RequirePermission anyOf={['providers.read']}>
      <nav className="mb-2 text-xs text-grey-500"><Link href={`/providers/${slugForType(d.type)}`} className="underline">{title(d.type)}s</Link> / {d.displayName}</nav>
      <PageHeader
        title={d.displayName}
        description={`${title(d.type)} · ${d.legalName}`}
        actions={
          <>
            <Badge>{d.status}</Badge>
            {d.isListed && <Badge tone="ACTIVE">listed</Badge>}
            {can('providers.update') && ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(d.status) && <Button onClick={() => submit.mutate()} loading={submit.isPending}>Submit for Verification</Button>}
            {d.latestVerificationCase && ['SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(d.status) && <Link href={`/applications/${d.latestVerificationCase.id}`}><Button variant="secondary">Open Verification Case</Button></Link>}
            {can('providers.suspend') && d.status === 'APPROVED' && <Button variant="danger" onClick={() => setStatusAction('SUSPEND')}>Suspend</Button>}
            {can('providers.suspend') && d.status === 'SUSPENDED' && <Button onClick={() => setStatusAction('REACTIVATE')}>Reactivate</Button>}
            {can('providers.suspend') && d.status !== 'DEACTIVATED' && <Button variant="secondary" onClick={() => setStatusAction('DEACTIVATE')}>Deactivate</Button>}
            {d.type === 'DOCTOR' && <Link href={`/affiliations?doctorProviderId=${d.id}`}><Button variant="secondary">Affiliations ({d.counts.affiliationsAsDoctor})</Button></Link>}
            {(d.type === 'HOSPITAL' || d.type === 'CLINIC') && <Link href={`/affiliations?facilityProviderId=${d.id}`}><Button variant="secondary">Affiliated Doctors ({d.counts.affiliationsAsFacility})</Button></Link>}
          </>
        }
      />
      {d.statusReason && <p className="mb-4 border border-grey-300 px-3 py-2 text-sm"><span className="font-medium">Status Note:</span> {d.statusReason}</p>}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'overview' && <Overview d={d} />}
        {tab === 'locations' && <Locations d={d} />}
        {tab === 'members' && <Members d={d} />}
        {tab === 'documents' && <Documents d={d} />}
        {tab === 'services' && <Services d={d} />}
        {tab === 'departments' && <Departments d={d} />}
        {tab === 'payout' && <Payouts d={d} />}
        {tab === 'history' && (
          <Card title="Status History">
            <ul className="divide-y divide-grey-200 text-sm">
              {d.statusHistory.map((h, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span>{h.fromStatus ? `${title(h.fromStatus)} → ` : ''}<Badge>{h.toStatus}</Badge> <span className="text-grey-600">{h.reason}</span></span><span className="text-xs text-grey-500">{dateTime(h.createdAt)}</span></li>)}
            </ul>
          </Card>
        )}
      </div>
      <ConfirmDialog open={!!statusAction} onClose={() => setStatusAction(null)} onConfirm={() => statusAction && status.mutate(statusAction)} title={`${title(statusAction ?? '')} Provider`} message={statusAction === 'SUSPEND' ? 'Suspension removes the provider from search and blocks all future open slots immediately.' : statusAction === 'DEACTIVATE' ? 'Deactivation is permanent for this record.' : 'The provider will be listed again and blocked slots reopened.'} confirmLabel={title(statusAction ?? '')} loading={status.isPending} danger={statusAction !== 'REACTIVATE'}>
        <Field label="Reason" required className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </RequirePermission>
  );
}

function Overview({ d }: { d: ProviderFull }) {
  const generic = [
    { label: 'Contact Email', value: d.contactEmail }, { label: 'Contact Phone', value: d.contactPhone }, { label: 'GSTIN', value: d.gstin }, { label: 'Registration No.', value: d.registrationNumber },
    { label: 'Submitted', value: dateTime(d.submittedAt) }, { label: 'Approved', value: dateTime(d.approvedAt) }, { label: 'Rating', value: d.ratingAverage != null ? `${rating(d.ratingAverage)} (${d.ratingCount})` : 'No reviews yet' }, { label: 'Record Version', value: d.version },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Organisation">
        <DescriptionList items={generic} />
        {d.description && <p className="mt-4 text-sm text-grey-700">{d.description}</p>}
      </Card>
      {d.doctor && (
        <Card title="Doctor">
          <DescriptionList items={[
            { label: 'Login Account', value: <Link className="underline" href={`/users/${d.doctor.user.id}`}>{d.doctor.user.fullName}</Link> },
            { label: 'Gender', value: title(d.doctor.gender) }, { label: 'Experience', value: d.doctor.yearsOfExperience != null ? `${d.doctor.yearsOfExperience} years` : null },
            { label: 'Languages', value: d.doctor.languages.join(', ') }, { label: 'Default Fee', value: money(d.doctor.defaultFeeMinor) },
            { label: 'Specialities', value: d.doctor.specialities.map((s) => `${s.name}${s.isPrimary ? ' (primary)' : ''}${s.verified ? ' ✓' : ''}`).join(', ') || '—' },
          ]} />
          <h3 className="mt-4 text-xs font-semibold text-grey-500">Council Registrations</h3>
          <ul className="mt-1 text-sm">{d.doctor.registrations.map((r) => <li key={r.id} className="flex justify-between border-t border-grey-200 py-1"><span>{r.council} · {r.registrationNumber}{r.validUntil ? ` · valid to ${date(r.validUntil)}` : ''}</span>{r.verifiedAt ? <Badge tone="VERIFIED">verified</Badge> : <Badge>unverified</Badge>}</li>)}</ul>
          <h3 className="mt-4 text-xs font-semibold text-grey-500">Qualifications</h3>
          <ul className="mt-1 text-sm">{d.doctor.qualifications.map((q) => <li key={q.id} className="border-t border-grey-200 py-1">{q.degree}, {q.institution}{q.yearAwarded ? ` (${q.yearAwarded})` : ''} {q.verified && <Badge tone="VERIFIED">verified</Badge>}</li>)}</ul>
          {d.doctor.bio && <p className="mt-3 text-sm text-grey-700">{d.doctor.bio}</p>}
        </Card>
      )}
      {d.facility && <Card title="Facility"><DescriptionList items={[{ label: 'Ownership', value: title(d.facility.ownershipType) }, { label: 'Beds', value: d.facility.bedCount }, { label: 'ICU Beds', value: d.facility.icuBedCount }, { label: 'Emergency', value: d.facility.hasEmergency ? 'Yes' : 'No' }, { label: 'Open 24×7', value: d.facility.isOpen24x7 ? 'Yes' : 'No' }, { label: 'Establishment Reg. No.', value: d.facility.establishmentRegistrationNo }, { label: 'Registration Authority', value: d.facility.establishmentRegistrationAuth }, { label: 'Accreditations', value: d.facility.accreditations.join(', ') }]} /></Card>}
      {d.diagnostic && <Card title="Diagnostics"><DescriptionList items={[{ label: 'Pathology', value: d.diagnostic.offersPathology ? 'Yes' : 'No' }, { label: 'Imaging', value: d.diagnostic.offersImaging ? 'Yes' : 'No' }, { label: 'Home Collection', value: d.diagnostic.homeCollectionAvailable ? 'Yes' : 'No' }, { label: 'Establishment Reg. No.', value: d.diagnostic.establishmentRegistrationNo }, { label: 'NABL Certificate', value: d.diagnostic.nablCertificateNo }, { label: 'NABL Scope', value: d.diagnostic.nablScope }, { label: 'AERB Licence', value: d.diagnostic.aerbLicenseNo }, { label: 'PC-PNDT Registration', value: d.diagnostic.pcpndtRegistrationNo }, { label: 'Typical Turnaround', value: d.diagnostic.typicalTurnaroundHours != null ? `${d.diagnostic.typicalTurnaroundHours} h` : null }]} /></Card>}
      {d.pharmacy && <Card title="Pharmacy"><DescriptionList items={[{ label: 'Retail Drug Licence', value: d.pharmacy.retailDrugLicenseNo }, { label: 'Wholesale Drug Licence', value: d.pharmacy.wholesaleDrugLicenseNo }, { label: 'Licence Valid Until', value: date(d.pharmacy.drugLicenseValidUntil) }, { label: 'Pharmacist', value: d.pharmacy.pharmacistName }, { label: 'Pharmacist Reg. No.', value: d.pharmacy.pharmacistRegistrationNo }, { label: 'Home Delivery', value: d.pharmacy.homeDeliveryAvailable ? 'Yes' : 'No' }]} /></Card>}
      {d.ambulance && <Card title="Ambulance Operator" actions={<Link className="text-xs underline" href={`/ambulance?operatorProviderId=${d.id}`}>Vehicles & Crew</Link>}><DescriptionList items={[{ label: 'Dispatch Phone', value: d.ambulance.dispatchPhone }, { label: 'Open 24×7', value: d.ambulance.isOpen24x7 ? 'Yes' : 'No' }, { label: 'Fleet Size', value: d.ambulance.fleetSize }]} /></Card>}
      {d.latestVerificationCase && (
        <Card title="Latest Verification Case" actions={<Link className="text-xs underline" href={`/applications/${d.latestVerificationCase.id}`}>Open</Link>}>
          <p className="text-sm"><Badge>{d.latestVerificationCase.status}</Badge> <span className="ml-2 text-grey-600">{title(d.latestVerificationCase.kind)}</span></p>
          <ul className="mt-3 space-y-1 text-sm">{d.latestVerificationCase.checks.map((c) => <li key={c.checkType} className="flex justify-between"><span>{title(c.checkType)}{c.isRequired ? '' : ' (Optional)'}</span><Badge>{c.status}</Badge></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function Locations({ d }: { d: ProviderFull }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState<ProviderFull['locations'][number] | null>(null);
  const toggle = useAction((l: { id: string; isActive: boolean }) => api.patch(`/admin/providers/${d.id}/locations/${l.id}`, { isActive: !l.isActive }), { success: 'Location updated', invalidate: [`/admin/providers/${d.id}`] });
  return (
    <div className="space-y-4">
      {d.locations.map((l) => (
        <Card key={l.id} title={`${l.name}${l.isPrimary ? ' · Primary' : ''}`} actions={can('providers.update') && <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(l)}>Opening Hours</Button><Button size="sm" variant="ghost" onClick={() => toggle.mutate(l)}>{l.isActive ? 'Deactivate' : 'Activate'}</Button></div>}>
          <DescriptionList items={[{ label: 'Address', value: [l.addressLine1, l.addressLine2, l.locality, l.city, l.district, l.state, l.pincode].filter(Boolean).join(', ') }, { label: 'Phone', value: l.phone }, { label: 'Coordinates', value: l.latitude != null ? `${l.latitude}, ${l.longitude}` : 'Not set — provider will not appear in distance search' }, { label: 'Region', value: l.region?.name }, { label: 'Active', value: l.isActive ? 'Yes' : 'No' }]} />
          <h3 className="mt-3 text-xs font-semibold text-grey-500">Opening Hours</h3>
          {l.operatingHours.length === 0 ? <p className="text-sm text-grey-500">Not Set</p> : <ul className="mt-1 grid gap-x-6 text-sm sm:grid-cols-2">{l.operatingHours.map((h, i) => <li key={i}>{DAYS[h.dayOfWeek]}: {h.isClosed ? 'Closed' : `${minutes(h.opensAtMin)}–${minutes(h.closesAtMin)}`}</li>)}</ul>}
        </Card>
      ))}
      {d.locations.length === 0 && <p className="text-sm text-grey-500">No locations. A provider needs an active location before it can be submitted or listed.</p>}
      {editing && <HoursDialog providerId={d.id} location={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HoursDialog({ providerId, location, onClose }: { providerId: string; location: ProviderFull['locations'][number]; onClose: () => void }) {
  const [rows, setRows] = useState(() => DAYS.map((_, dow) => {
    const h = location.operatingHours.find((x) => x.dayOfWeek === dow);
    return { dow, open: h ? !h.isClosed : dow !== 0, opens: h ? minutes(h.opensAtMin) : '09:00', closes: h ? minutes(h.closesAtMin) : '18:00' };
  }));
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const save = useAction(() => api.put(`/admin/providers/${providerId}/locations/${location.id}/hours`, { hours: rows.filter((r) => r.open).map((r) => ({ dayOfWeek: r.dow, opensAtMin: toMin(r.opens), closesAtMin: toMin(r.closes) })) }), { success: 'Opening hours saved', invalidate: [`/admin/providers/${providerId}`], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={`Opening Hours — ${location.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button></>}>
      <table className="w-full text-sm"><tbody>
        {rows.map((r, i) => (
          <tr key={r.dow} className="border-t border-grey-200">
            <td className="py-1.5 pr-2"><label className="flex items-center gap-2"><input type="checkbox" className="accent-black" checked={r.open} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, open: e.target.checked } : y)))} />{DAYS[r.dow]}</label></td>
            <td className="py-1.5 pr-2"><Input type="time" aria-label={`${DAYS[r.dow]} opens`} value={r.opens} disabled={!r.open} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, opens: e.target.value } : y)))} /></td>
            <td className="py-1.5"><Input type="time" aria-label={`${DAYS[r.dow]} closes`} value={r.closes} disabled={!r.open} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, closes: e.target.value } : y)))} /></td>
          </tr>
        ))}
      </tbody></table>
    </Dialog>
  );
}

function Members({ d }: { d: ProviderFull }) {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('STAFF');
  const add = useAction(() => api.post(`/admin/providers/${d.id}/members`, { userId, memberRole: role }), { success: 'Member added', invalidate: [`/admin/providers/${d.id}`], onSuccess: () => { setAdding(false); setUserId(''); } });
  const remove = useAction((memberId: string) => api.delete(`/admin/providers/${d.id}/members/${memberId}`), { success: 'Member removed', invalidate: [`/admin/providers/${d.id}`] });
  return (
    <Card title="Authorised Users" actions={can('providers.members.manage') && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add Member</Button>}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-grey-500"><tr><th className="py-1">User</th><th>Contact</th><th>Role</th><th>Status</th><th /></tr></thead>
        <tbody>
          {d.members.map((m) => (
            <tr key={m.id} className="border-t border-grey-200">
              <td className="py-1.5"><Link className="underline" href={`/users/${m.userId}`}>{m.fullName}</Link></td><td>{m.email ?? m.phone}</td><td>{m.memberRole}</td><td><Badge>{m.status}</Badge></td>
              <td className="text-right">{can('providers.members.manage') && m.status !== 'REMOVED' && <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.id)}>Remove</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a Member" footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={() => add.mutate()} loading={add.isPending} disabled={!userId}>Add</Button></>}>
        <Field label="User ID" hint="Find the user under Users and copy their id"><Input value={userId} onChange={(e) => setUserId(e.target.value.trim())} /></Field>
        <Field label="Role" className="mt-3"><Select value={role} onChange={(e) => setRole(e.target.value)}>{['OWNER', 'ADMIN', 'STAFF', 'PHARMACIST', 'LAB_TECHNICIAN', 'DISPATCHER'].map((r) => <option key={r} value={r}>{title(r)}</option>)}</Select></Field>
      </Dialog>
    </Card>
  );
}

function Documents({ d }: { d: ProviderFull }) {
  const { can } = useAuth();
  const toast = useToast();
  const docs = useGet<Doc[]>(`/admin/providers/${d.id}/documents`);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>('OTHER');
  const [docNo, setDocNo] = useState('');
  const [expires, setExpires] = useState('');
  const [review, setReview] = useState<{ doc: Doc; decision: 'ACCEPTED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const inv = [`/admin/providers/${d.id}`];
  const upload = useAction(async () => {
    if (!file) throw new Error('Choose a file');
    const q = new URLSearchParams({ documentType: docType, fileName: file.name, ...(docNo ? { documentNumber: docNo } : {}), ...(expires ? { expiresAt: expires } : {}) });
    return api.upload(`/admin/providers/${d.id}/documents?${q}`, file, file.type || 'application/pdf');
  }, { success: 'Document uploaded', invalidate: inv, onSuccess: () => { setFile(null); setDocNo(''); setExpires(''); } });
  const decide = useAction(() => api.post(`/admin/providers/${d.id}/documents/${review!.doc.id}/review`, { decision: review!.decision, note: note || undefined }), { success: 'Document reviewed', invalidate: inv, onSuccess: () => { setReview(null); setNote(''); } });
  const open = async (doc: Doc) => {
    const purpose = window.prompt('State the purpose of opening this credential document (logged):');
    if (!purpose || purpose.trim().length < 5) return;
    try {
      const { blob, filename } = await api.blob(`/admin/providers/${d.id}/documents/${doc.id}/file?purpose=${encodeURIComponent(purpose.trim())}`);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="space-y-4">
      {can('providers.update') && (
        <Card title="Upload a Credential Document">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Type"><Select value={docType} onChange={(e) => setDocType(e.target.value)}>{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
            <Field label="Document Number"><Input value={docNo} onChange={(e) => setDocNo(e.target.value)} /></Field>
            <Field label="Expires On"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
            <Field label="File" hint="PDF, JPEG or PNG · max 10 MB"><Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-1.5" /></Field>
          </div>
          <Button className="mt-3" onClick={() => upload.mutate()} loading={upload.isPending} disabled={!file}>Upload</Button>
        </Card>
      )}
      <Card title="Documents">
        {docs.isPending ? <Skeleton /> : docs.isError ? <ErrorState error={docs.error} /> : docs.data.length === 0 ? <p className="text-sm text-grey-500">No documents uploaded.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-grey-500"><tr><th className="py-1">Type</th><th>File</th><th>Number</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody>
              {docs.data.map((doc) => (
                <tr key={doc.id} className="border-t border-grey-200 align-top">
                  <td className="py-1.5">{title(doc.documentType)}</td>
                  <td>{doc.fileName} <span className="text-xs text-grey-500">({Math.round(doc.sizeBytes / 1024)} kB)</span></td>
                  <td>{doc.documentNumber ?? '—'}</td>
                  <td>{date(doc.expiresAt)}{doc.expired && <Badge tone="EXPIRED">expired</Badge>}</td>
                  <td><Badge>{doc.status}</Badge>{doc.reviewNote && <p className="text-xs text-grey-500">{doc.reviewNote}</p>}</td>
                  <td className="text-right whitespace-nowrap">
                    {can('providers.documents.read') && <Button size="sm" variant="ghost" onClick={() => open(doc)}>Open</Button>}
                    {can('providers.documents.review') && doc.status === 'UPLOADED' && <><Button size="sm" variant="ghost" onClick={() => setReview({ doc, decision: 'ACCEPTED' })}>Accept</Button><Button size="sm" variant="ghost" onClick={() => setReview({ doc, decision: 'REJECTED' })}>Reject</Button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <ConfirmDialog open={!!review} onClose={() => setReview(null)} onConfirm={() => decide.mutate()} title={`${review?.decision === 'ACCEPTED' ? 'Accept' : 'Reject'} Document`} message={`${review?.doc.fileName} — ${title(review?.doc.documentType)}. You cannot review documents you uploaded yourself.`} confirmLabel={review?.decision === 'ACCEPTED' ? 'Accept' : 'Reject'} loading={decide.isPending} danger={review?.decision === 'REJECTED'}>
        <Field label={review?.decision === 'REJECTED' ? 'Reason (required)' : 'Note'} className="mt-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

function Services({ d }: { d: ProviderFull }) {
  const { can } = useAuth();
  const offerings = useGet<Offering[]>(`/admin/providers/${d.id}/services`);
  const services = useGet<{ code: string; name: string; category: string }[]>(can('providers.update') ? '/admin/catalogue/services?limit=100' : null);
  const [code, setCode] = useState('');
  const [price, setPrice] = useState('');
  const [home, setHome] = useState(false);
  const save = useAction(() => api.put(`/admin/providers/${d.id}/services/${code}`, { priceMinor: Math.round(Number(price) * 100), homeServiceAvailable: home, locationId: null }), { success: 'Offering saved', invalidate: [`/admin/providers/${d.id}/services`], onSuccess: () => setPrice('') });
  return (
    <div className="space-y-4">
      {can('providers.update') && (
        <Card title="Add or Update a Priced Service">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Service"><Select value={code} onChange={(e) => setCode(e.target.value)}><option value="">Choose…</option>{services.data?.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></Field>
            <Field label="Price (₹)"><Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-black" checked={home} onChange={(e) => setHome(e.target.checked)} /> Home Service Available</label>
            <Button className="mt-5" onClick={() => save.mutate()} loading={save.isPending} disabled={!code || !price}>Save</Button>
          </div>
        </Card>
      )}
      <Card title="Offered Services">
        {offerings.isPending ? <Skeleton /> : offerings.isError ? <ErrorState error={offerings.error} /> : offerings.data.length === 0 ? <p className="text-sm text-grey-500">No services configured.</p> : (
          <table className="w-full text-sm"><thead className="text-left text-xs text-grey-500"><tr><th className="py-1">Service</th><th>Category</th><th>Price</th><th>Home</th><th>Active</th></tr></thead>
            <tbody>{offerings.data.map((o) => <tr key={o.id} className="border-t border-grey-200"><td className="py-1.5">{o.serviceName} <span className="text-xs text-grey-500">{o.serviceCode}</span></td><td>{title(o.category)}</td><td className="tnum">{money(o.priceMinor)}</td><td>{o.homeServiceAvailable ? 'Yes' : 'No'}</td><td>{o.isActive ? 'Yes' : 'No'}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}

function Departments({ d }: { d: ProviderFull }) {
  const { can } = useAuth();
  const departments = useGet<{ code: string; name: string }[]>('/admin/catalogue/departments');
  const amenities = useGet<{ code: string; name: string; category: string }[]>('/admin/catalogue/amenities');
  const [deptCodes, setDeptCodes] = useState<string[]>(d.departments.filter((x) => x.isActive).map((x) => x.code));
  const [amenCodes, setAmenCodes] = useState<string[]>(d.amenities.map((x) => x.code));
  const inv = [`/admin/providers/${d.id}`];
  const saveDepts = useAction(() => api.put(`/admin/providers/${d.id}/departments`, { departmentCodes: deptCodes }), { success: 'Departments saved', invalidate: inv });
  const saveAmen = useAction(() => api.put(`/admin/providers/${d.id}/amenities`, { amenityCodes: amenCodes }), { success: 'Amenities saved', invalidate: inv });
  const verify = useAction((v: { kind: 'DEPARTMENT' | 'AMENITY'; code: string; verified: boolean }) => api.post(`/admin/providers/${d.id}/claims/verify`, v), { success: 'Claim updated', invalidate: inv });
  const toggle = (list: string[], set: (v: string[]) => void, code: string) => set(list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Departments" actions={can('providers.update') && <Button size="sm" onClick={() => saveDepts.mutate()} loading={saveDepts.isPending}>Save</Button>}>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {departments.data?.map((dep) => { const claim = d.departments.find((x) => x.code === dep.code); return (
            <li key={dep.code} className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-black" disabled={!can('providers.update')} checked={deptCodes.includes(dep.code)} onChange={() => toggle(deptCodes, setDeptCodes, dep.code)} />{dep.name}</label>
              {claim?.isActive && (claim.verified ? <Badge tone="VERIFIED">verified</Badge> : can('providers.verify') ? <Button size="sm" variant="ghost" onClick={() => verify.mutate({ kind: 'DEPARTMENT', code: dep.code, verified: true })}>Verify</Button> : <Badge>unverified</Badge>)}
            </li>); })}
        </ul>
      </Card>
      <Card title="Amenities & Capabilities" actions={can('providers.update') && <Button size="sm" onClick={() => saveAmen.mutate()} loading={saveAmen.isPending}>Save</Button>}>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {amenities.data?.map((a) => { const claim = d.amenities.find((x) => x.code === a.code); return (
            <li key={a.code} className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-black" disabled={!can('providers.update')} checked={amenCodes.includes(a.code)} onChange={() => toggle(amenCodes, setAmenCodes, a.code)} />{a.name}</label>
              {claim && (claim.verified ? <Badge tone="VERIFIED">verified</Badge> : can('providers.verify') ? <Button size="sm" variant="ghost" onClick={() => verify.mutate({ kind: 'AMENITY', code: a.code, verified: true })}>Verify</Button> : <Badge>unverified</Badge>)}
            </li>); })}
        </ul>
      </Card>
    </div>
  );
}

function Payouts({ d }: { d: ProviderFull }) {
  const { can } = useAuth();
  const accounts = useGet<Payout[]>(can('providers.payout.read') ? `/admin/providers/${d.id}/payout-accounts` : null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ accountHolderName: '', accountNumber: '', ifsc: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inv = [`/admin/providers/${d.id}/payout-accounts`];
  const add = useAction(() => api.post(`/admin/providers/${d.id}/payout-accounts`, form), { success: 'Payout account added (encrypted)', invalidate: inv, onSuccess: () => { setAdding(false); setForm({ accountHolderName: '', accountNumber: '', ifsc: '' }); }, onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors); } });
  const verify = useAction((id: string) => api.post(`/admin/providers/${d.id}/payout-accounts/${id}/verify`, { method: 'PENNY_DROP' }), { success: 'Account verified', invalidate: inv });
  const disable = useAction((id: string) => api.post(`/admin/providers/${d.id}/payout-accounts/${id}/disable`, { reason: 'Disabled from the admin console' }), { success: 'Account disabled', invalidate: inv });
  if (!can('providers.payout.read')) return <p className="text-sm text-grey-500">You do not have permission to view payout accounts.</p>;
  return (
    <Card title="Payout Bank Accounts" actions={can('providers.payout.manage') && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add Account</Button>}>
      {accounts.isPending ? <Skeleton /> : accounts.isError ? <ErrorState error={accounts.error} /> : accounts.data.length === 0 ? <p className="text-sm text-grey-500">No payout account. Settlements need one VERIFIED account.</p> : (
        <table className="w-full text-sm"><thead className="text-left text-xs text-grey-500"><tr><th className="py-1">Holder</th><th>Account</th><th>IFSC</th><th>Status</th><th /></tr></thead>
          <tbody>{accounts.data.map((a) => <tr key={a.id} className="border-t border-grey-200"><td className="py-1.5">{a.accountHolderName}</td><td className="font-mono">{a.accountNumberMasked}</td><td className="font-mono">{a.ifsc}</td><td><Badge>{a.status}</Badge></td><td className="text-right whitespace-nowrap">{can('providers.payout.verify') && a.status === 'PENDING_VERIFICATION' && <Button size="sm" variant="ghost" onClick={() => verify.mutate(a.id)}>Verify (penny drop)</Button>}{can('providers.payout.manage') && a.status !== 'DISABLED' && <Button size="sm" variant="ghost" onClick={() => disable.mutate(a.id)}>Disable</Button>}</td></tr>)}</tbody></table>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add Payout Account" footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={() => add.mutate()} loading={add.isPending}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="Account Holder Name" required error={errors.accountHolderName}><Input value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} /></Field>
          <Field label="Account Number" required error={errors.accountNumber} hint="Stored encrypted; only the last 4 digits are shown afterwards"><Input inputMode="numeric" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="IFSC" required error={errors.ifsc}><Input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} /></Field>
          <p className="text-xs text-grey-500">Verification must be done by a different user than the one adding the account.</p>
        </div>
      </Dialog>
    </Card>
  );
}
