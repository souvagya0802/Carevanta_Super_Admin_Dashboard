'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileText, Landmark, Loader2, Search, ShieldAlert, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { date, dateTime, relative, title } from '@/lib/format';
import { CHECK_METHODS } from '@/lib/providers-meta';
import { Badge, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, FormSection, Input, PageHeader, Select, Skeleton, Textarea, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { RequirePermission } from '@/components/layout/shell';

interface Check { id: string; checkType: string; status: string; method: string; isRequired: boolean; sourceReference: string | null; evidenceDocumentId: string | null; checkedById: string | null; checkedByName: string | null; checkedAt: string | null; notes: string | null; validUntil: string | null; expired: boolean }
interface CaseDetail { id: string; status: string; kind: string; provider: { id: string; displayName: string; legalName: string; type: string; status: string; createdById: string | null }; registrarName: string | null; assignedToId: string | null; assignedToName: string | null; openedByName: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string; updatedAt: string; ageHours: number; slaHours: number; overdue: boolean; checks: Check[] }
interface Doc { id: string; documentType: string; status: string; fileName: string; documentNumber: string | null; expiresAt: string | null; expired: boolean; uploadedById: string | null; reviewNote: string | null }
interface Guidance { caseId: string; checks: { checkType: string; registries: { key: string; name: string; mode: 'api' | 'portal' | 'none'; portalUrl: string | null; lookupAvailable: boolean; connector: string | null; guidance: string }[]; identifiers: { label: string; value: string }[]; warnings: string[]; evidence: { documentType: string; status: 'ACCEPTED' | 'UPLOADED' | 'REJECTED' | 'EXPIRED' | 'MISSING'; documentId: string | null; expiresAt: string | null }[] }[]; connectors: Record<string, string> }
interface Lookup { registry: string; outcome: 'MATCH' | 'NO_MATCH' | 'UNAVAILABLE'; reference: string | null; summary: string; raw: Record<string, unknown> | null }

const OPEN = ['OPEN', 'IN_REVIEW', 'AWAITING_PROVIDER'];
const STATUS_HELP: Record<string, string> = { PASSED: 'Evidence confirmed the credential.', FAILED: 'The credential could not be confirmed or is invalid; the provider must fix it.', WAIVED: 'Not applicable or accepted on documented justification (min 10 characters).' };

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const toast = useToast();
  const c = useGet<CaseDetail>(`/admin/verification-cases/${id}`);
  const guidance = useGet<Guidance>(`/admin/verification-cases/${id}/guidance`);
  const docs = useGet<Doc[]>(c.data ? `/admin/providers/${c.data.provider.id}/documents` : null);
  const [check, setCheck] = useState<Check | null>(null);
  const [form, setForm] = useState({ status: 'PASSED', method: 'MANUAL_DOCUMENT_REVIEW', sourceReference: '', evidenceDocumentId: '', notes: '', validUntil: '' });
  const [lookup, setLookup] = useState<Record<string, Lookup>>({});
  const [decision, setDecision] = useState<null | 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'>(null);
  const [note, setNote] = useState('');
  const [docReview, setDocReview] = useState<{ doc: Doc; decision: 'ACCEPTED' | 'REJECTED' } | null>(null);
  const [docNote, setDocNote] = useState('');
  const inv = [`/admin/verification-cases/${id}`, '/admin/verification-cases', '/admin/providers'];

  const assignMe = useAction(() => api.post(`/admin/verification-cases/${id}/assign`, { assigneeId: me!.id }), { success: 'Assigned to you', invalidate: inv });
  const record = useAction(() => api.post(`/admin/verification-cases/${id}/checks/${check!.checkType}`, { status: form.status, method: form.method, sourceReference: form.sourceReference.trim() || undefined, evidenceDocumentId: form.evidenceDocumentId || undefined, notes: form.notes.trim() || undefined, validUntil: form.validUntil || undefined }), { success: 'Check recorded', invalidate: inv, onSuccess: () => { setCheck(null); void guidance.refetch(); } });
  const runLookup = useAction((checkType: string) => api.post<{ data: Lookup }>(`/admin/verification-cases/${id}/checks/${checkType}/lookup`), { onSuccess: (r, checkType) => { setLookup((m) => ({ ...m, [checkType]: r.data })); toast.success(r.data.outcome === 'MATCH' ? 'Registry returned a matching record' : r.data.outcome === 'NO_MATCH' ? 'Registry returned no match' : 'Registry unavailable', r.data.summary); }, onError: (e) => { if (e instanceof ApiError) toast.error(e); } });
  const decide = useAction(() => api.post(`/admin/verification-cases/${id}/decision`, { decision, note: note.trim() }), { success: 'Decision recorded', invalidate: inv, onSuccess: () => { setDecision(null); setNote(''); } });
  const reviewDoc = useAction(() => api.post(`/admin/providers/${c.data!.provider.id}/documents/${docReview!.doc.id}/review`, { decision: docReview!.decision, note: docNote.trim() || undefined }), { success: 'Document reviewed', invalidate: [...inv, `/admin/providers/${c.data?.provider.id}/documents`], onSuccess: () => { setDocReview(null); setDocNote(''); void guidance.refetch(); } });

  if (c.isPending) return <Skeleton rows={8} />;
  if (c.isError) return <ErrorState error={c.error} retry={() => c.refetch()} />;
  const d = c.data;
  const open = OPEN.includes(d.status);
  const isRegistrar = d.provider.createdById === me?.id;
  const blocking = d.checks.filter((k) => k.isRequired && k.status !== 'PASSED' && k.status !== 'WAIVED');
  const failed = d.checks.filter((k) => k.status === 'FAILED');
  const canWork = can('providers.verify') && open && !isRegistrar;
  const g = (t: string) => guidance.data?.checks.find((x) => x.checkType === t);
  const acceptedDocs = docs.data?.filter((x) => x.status === 'ACCEPTED') ?? [];
  const openRecord = (k: Check, prefill?: Partial<typeof form>) => {
    const gi = g(k.checkType);
    const suggestedDoc = gi?.evidence.find((e) => e.status === 'ACCEPTED')?.documentId ?? '';
    setForm({ status: 'PASSED', method: k.method === 'MANUAL_DOCUMENT_REVIEW' && gi?.registries.some((r) => r.mode === 'portal') ? 'OFFICIAL_REGISTRY_LOOKUP' : k.method, sourceReference: k.sourceReference ?? '', evidenceDocumentId: k.evidenceDocumentId ?? suggestedDoc, notes: k.notes ?? '', validUntil: k.validUntil ?? '', ...prefill });
    setCheck(k);
  };

  return (
    <RequirePermission anyOf={['providers.read']}>
      <nav className="mb-2 text-xs text-grey-500"><Link href="/applications" className="inline-flex items-center gap-1 underline-offset-2 hover:underline"><ArrowLeft size={12} aria-hidden /> Applications</Link> / {d.provider.displayName}</nav>
      <PageHeader
        title={`${d.provider.displayName} — ${d.kind === 'CHANGE_REQUEST' ? 'Change Request' : 'Onboarding'} Verification`}
        description={`${title(d.provider.type)} · ${d.provider.legalName} · opened ${relative(d.createdAt)}${d.openedByName ? ` by ${d.openedByName}` : ''}`}
        actions={
          <>
            <Badge>{d.status}</Badge>
            {d.overdue && <Badge accent="red">Overdue</Badge>}
            <Link href={`/providers/${d.provider.id}`}><Button variant="secondary">Provider Record</Button></Link>
            {can('providers.verify') && open && !d.assignedToId && <Button variant="secondary" onClick={() => assignMe.mutate()} loading={assignMe.isPending}><UserCheck size={16} /> Assign to Me</Button>}
            {can('providers.approve') && open && (
              <>
                <Button onClick={() => setDecision('APPROVE')} disabled={blocking.length > 0 || isRegistrar} title={blocking.length ? `${blocking.length} required check(s) outstanding` : isRegistrar ? 'You registered this provider' : undefined}><CheckCircle2 size={16} /> Approve</Button>
                <Button variant="secondary" onClick={() => setDecision('REQUEST_CHANGES')} disabled={isRegistrar}>Request Changes</Button>
                <Button variant="danger" onClick={() => setDecision('REJECT')} disabled={isRegistrar}><XCircle size={16} /> Reject</Button>
              </>
            )}
          </>
        }
      />

      {isRegistrar && open && <Notice tone="warn" icon={ShieldAlert} title="Separation of Duties">You registered this provider{d.registrarName ? '' : ''}, so you cannot record checks or decide this case. Another verifier must.</Notice>}
      {!open && <Notice tone="info" icon={ShieldCheck} title={`Case ${title(d.status)}`}>{d.decidedByName ? `Decided by ${d.decidedByName} ${relative(d.decidedAt)}` : 'Closed'}{d.decisionNote ? ` — ${d.decisionNote}` : ''}</Notice>}
      {open && blocking.length > 0 && <Notice tone={failed.length ? 'bad' : 'info'} icon={failed.length ? XCircle : FileText} title={`${blocking.length} Required Check${blocking.length > 1 ? 's' : ''} Outstanding`}>{blocking.map((b) => title(b.checkType)).join(', ')}.{failed.length ? ` ${failed.length} failed — the provider must fix those before approval.` : ''}</Notice>}
      {open && blocking.length === 0 && <Notice tone="ok" icon={CheckCircle2} title="Ready for a Decision">Every required check has passed or been waived. An approver other than the registrar can approve.</Notice>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {d.checks.map((k) => {
            const gi = g(k.checkType);
            const lk = lookup[k.checkType];
            const tone = k.status === 'PASSED' ? 'green' : k.status === 'FAILED' ? 'red' : k.status === 'WAIVED' ? 'blue' : 'orange';
            return (
              <FormSection key={k.id} title={`${title(k.checkType)}${k.isRequired ? '' : ' (Optional)'}`} icon={k.status === 'PASSED' ? CheckCircle2 : k.status === 'FAILED' ? XCircle : Landmark} accent={tone}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge accent={tone}>{k.status}</Badge>
                  {k.expired && <Badge accent="red">Validity Ended</Badge>}
                  {k.status !== 'PENDING' && <span className="text-xs text-grey-600">{title(k.method)} · {k.checkedByName ?? 'unknown'} · {dateTime(k.checkedAt)}{k.validUntil ? ` · valid until ${date(k.validUntil)}` : ''}</span>}
                  {canWork && <span className="ml-auto flex gap-1">{gi?.registries.some((r) => r.lookupAvailable) && <Button size="sm" variant="secondary" onClick={() => runLookup.mutate(k.checkType)} loading={runLookup.isPending && runLookup.variables === k.checkType}><Search size={14} /> Run Lookup</Button>}<Button size="sm" onClick={() => openRecord(k)}>{k.status === 'PENDING' ? 'Record Outcome' : 'Re-record'}</Button></span>}
                </div>
                {(k.sourceReference || k.notes) && <p className="mt-2 text-xs text-grey-700">{k.sourceReference && <span className="font-mono">{k.sourceReference}</span>}{k.sourceReference && k.notes ? ' · ' : ''}{k.notes}</p>}

                {guidance.isPending ? <div className="mt-3 h-10 animate-pulse rounded-lg bg-grey-100" /> : gi && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">On File</p>
                      {gi.identifiers.length ? <dl className="mt-1 space-y-1 text-sm">{gi.identifiers.map((i) => <div key={i.label + i.value} className="flex justify-between gap-3"><dt className="text-grey-500">{i.label}</dt><dd className="text-right font-medium break-all">{i.value}</dd></div>)}</dl> : <p className="mt-1 text-sm text-grey-500">Nothing on file for this check.</p>}
                      {gi.evidence.length > 0 && (
                        <>
                          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-grey-500">Evidence Documents</p>
                          <ul className="mt-1 space-y-1 text-sm">{gi.evidence.map((e) => <li key={e.documentType} className="flex items-center justify-between gap-2"><span>{title(e.documentType)}</span><span className="flex items-center gap-1"><Badge accent={e.status === 'ACCEPTED' ? 'green' : e.status === 'UPLOADED' ? 'orange' : e.status === 'MISSING' ? 'ink' : 'red'}>{e.status === 'UPLOADED' ? 'Awaiting Review' : title(e.status)}</Badge>{e.status === 'UPLOADED' && can('providers.documents.review') && docs.data && <Button size="sm" variant="ghost" onClick={() => { const doc = docs.data!.find((x) => x.id === e.documentId); if (doc) setDocReview({ doc, decision: 'ACCEPTED' }); }}>Review</Button>}</span></li>)}</ul>
                        </>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">Verify Against</p>
                      <ul className="mt-1 space-y-2">
                        {gi.registries.map((r) => (
                          <li key={r.key} className="rounded-lg border border-grey-200 p-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{r.name}</span>{r.mode === 'api' ? <Badge accent={r.lookupAvailable ? 'green' : 'orange'}>{r.lookupAvailable ? 'API' : 'API Not Configured'}</Badge> : r.mode === 'portal' ? <Badge accent="blue">Portal</Badge> : <Badge>Issuer</Badge>}</div>
                            <p className="mt-1 text-grey-600">{r.guidance}</p>
                            <div className="mt-1.5 flex flex-wrap gap-2">
                              {r.portalUrl && <a href={r.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">Open Registry <ExternalLink size={11} aria-hidden /></a>}
                              {r.mode === 'api' && !r.lookupAvailable && can('settings.manage') && <Link href="/settings?tab=registries" className="underline-offset-2 hover:underline">Configure in Settings</Link>}
                            </div>
                          </li>
                        ))}
                      </ul>
                      {lk && (
                        <div className={cx('mt-2 rounded-lg border p-2.5 text-xs', lk.outcome === 'MATCH' ? 'border-green/30 bg-green-soft' : lk.outcome === 'NO_MATCH' ? 'border-red/30 bg-red-soft' : 'border-orange/30 bg-orange-soft')}>
                          <p className="font-medium">Lookup: {title(lk.outcome)}</p>
                          <p className="mt-0.5 text-grey-700">{lk.summary}</p>
                          {lk.raw && <details className="mt-1"><summary className="cursor-pointer text-grey-500">Registry response</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(lk.raw, null, 2)}</pre></details>}
                          {canWork && lk.outcome !== 'UNAVAILABLE' && <Button size="sm" variant="secondary" className="mt-2" onClick={() => openRecord(k, { status: lk.outcome === 'MATCH' ? 'PASSED' : 'FAILED', method: 'AUTHORISED_THIRD_PARTY_API', sourceReference: lk.reference ?? '', notes: lk.summary })}>Record This Result</Button>}
                        </div>
                      )}
                    </div>
                    {gi.warnings.length > 0 && <ul className="md:col-span-2 space-y-1">{gi.warnings.map((w) => <li key={w} className="flex items-start gap-1.5 text-xs text-orange"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{w}</li>)}</ul>}
                  </div>
                )}
              </FormSection>
            );
          })}
        </div>

        <div className="space-y-4">
          <Card title="Case">
            <dl className="space-y-1.5 text-sm">
              <Row k="Assigned To" v={d.assignedToId ? (d.assignedToId === me?.id ? 'You' : (d.assignedToName ?? d.assignedToId.slice(0, 8))) : 'Unassigned'} />
              <Row k="Registered By" v={d.registrarName ?? '—'} />
              <Row k="Age" v={`${d.ageHours < 48 ? `${d.ageHours} h` : `${Math.round(d.ageHours / 24)} d`} of ${d.slaHours} h target`} tone={d.overdue ? 'red' : undefined} />
              <Row k="Provider Status" v={<Badge>{d.provider.status}</Badge>} />
              <Row k="Last Update" v={relative(d.updatedAt)} />
              {d.decidedAt && <Row k="Decided" v={`${dateTime(d.decidedAt)} · ${d.decidedByName ?? ''}`} />}
            </dl>
            {d.decisionNote && <p className="mt-3 rounded-lg bg-grey-50 p-2 text-xs text-grey-700">{d.decisionNote}</p>}
          </Card>
          <Card title="Documents" description="Only accepted documents count as evidence" actions={<Link className="text-xs underline underline-offset-2" href={`/providers/${d.provider.id}`}>Upload</Link>}>
            {docs.isPending ? <Skeleton rows={3} /> : docs.data?.length ? (
              <ul className="space-y-2 text-sm">
                {docs.data.map((x) => (
                  <li key={x.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-medium">{title(x.documentType)}</p><p className="truncate text-xs text-grey-500">{x.fileName}{x.documentNumber ? ` · ${x.documentNumber}` : ''}{x.expiresAt ? ` · expires ${date(x.expiresAt)}` : ''}</p>{x.reviewNote && <p className="text-xs text-grey-500">{x.reviewNote}</p>}</div>
                    <span className="flex shrink-0 items-center gap-1"><Badge accent={x.status === 'ACCEPTED' ? 'green' : x.status === 'UPLOADED' ? 'orange' : x.status === 'REJECTED' ? 'red' : 'ink'}>{x.status}</Badge>{x.expired && <Badge accent="red">Expired</Badge>}{x.status === 'UPLOADED' && can('providers.documents.review') && x.uploadedById !== me?.id && <Button size="sm" variant="ghost" onClick={() => setDocReview({ doc: x, decision: 'ACCEPTED' })}>Review</Button>}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-grey-500">No documents uploaded yet. Request changes to ask the provider for them.</p>}
          </Card>
        </div>
      </div>

      <Dialog open={!!check} onClose={() => setCheck(null)} title={`Record Outcome — ${title(check?.checkType)}`} description={check ? `${title(d.provider.type)} · ${d.provider.displayName}` : undefined} icon={Landmark} size="lg" footer={<><Button variant="ghost" onClick={() => setCheck(null)} disabled={record.isPending}>Cancel</Button><Button onClick={() => record.mutate()} loading={record.isPending} disabled={(form.status === 'PASSED' && !form.evidenceDocumentId && !form.sourceReference.trim()) || (form.status === 'WAIVED' && form.notes.trim().length < 10)}>Save Outcome</Button></>}>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Outcome" required hint={STATUS_HELP[form.status]}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="PASSED">Passed</option><option value="FAILED">Failed</option><option value="WAIVED">Waived</option></Select></Field>
            <Field label="How It Was Verified" required><Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{CHECK_METHODS.map((m) => <option key={m} value={m}>{title(m)}</option>)}</Select></Field>
          </div>
          <Field label="Evidence Document" hint={acceptedDocs.length ? 'Accepted documents only' : 'No accepted documents yet — a passed check then needs a source reference'}><Select value={form.evidenceDocumentId} onChange={(e) => setForm({ ...form, evidenceDocumentId: e.target.value })}><option value="">None</option>{acceptedDocs.map((x) => <option key={x.id} value={x.id}>{title(x.documentType)} — {x.fileName}</option>)}</Select></Field>
          <Field label="Source Reference" required={form.status === 'PASSED' && !form.evidenceDocumentId} hint="Registry search URL, NMR ID, certificate number or confirmation reference"><Input value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} maxLength={500} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Valid Until" hint="Licence or registration expiry; the check is flagged when it passes"><Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></Field>
          </div>
          <Field label="Notes" required={form.status === 'WAIVED'} hint={form.status === 'WAIVED' ? 'Justification, at least 10 characters' : 'What was compared and any discrepancies'}><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-24" maxLength={2000} /></Field>
        </div>
      </Dialog>

      <ConfirmDialog open={!!decision} onClose={() => setDecision(null)} onConfirm={() => decide.mutate()} title={decision === 'APPROVE' ? 'Approve Provider' : decision === 'REJECT' ? 'Reject Application' : 'Request Changes'} message={decision === 'APPROVE' ? 'The provider becomes APPROVED and is listed to patients as soon as it has an active location. This is audited under your name.' : decision === 'REJECT' ? 'The provider is rejected and told why; it may fix the issues and resubmit.' : 'The provider is asked for more information. The case stays open and the clock keeps running.'} confirmLabel={decision === 'APPROVE' ? 'Approve' : decision === 'REJECT' ? 'Reject' : 'Request Changes'} loading={decide.isPending} danger={decision === 'REJECT'}>
        <Field label="Note" required hint="Recorded on the provider and sent to them" className="mt-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} minLength={5} className="min-h-24" /></Field>
      </ConfirmDialog>

      <ConfirmDialog open={!!docReview} onClose={() => { setDocReview(null); setDocNote(''); }} onConfirm={() => reviewDoc.mutate()} title={`Review ${title(docReview?.doc.documentType)}`} message={`${docReview?.doc.fileName ?? ''}. Accepting makes it usable as evidence; rejecting asks the provider for a better copy. You cannot review a document you uploaded.`} confirmLabel={docReview?.decision === 'ACCEPTED' ? 'Accept' : 'Reject'} loading={reviewDoc.isPending} danger={docReview?.decision === 'REJECTED'}>
        <div className="mt-3 space-y-3">
          <Field label="Decision"><Select value={docReview?.decision ?? 'ACCEPTED'} onChange={(e) => docReview && setDocReview({ ...docReview, decision: e.target.value as 'ACCEPTED' | 'REJECTED' })}><option value="ACCEPTED">Accept</option><option value="REJECTED">Reject</option></Select></Field>
          <Field label={docReview?.decision === 'REJECTED' ? 'Reason' : 'Note'} required={docReview?.decision === 'REJECTED'}><Textarea value={docNote} onChange={(e) => setDocNote(e.target.value)} /></Field>
        </div>
      </ConfirmDialog>
      {runLookup.isPending && <p className="sr-only" role="status"><Loader2 className="animate-spin" /> Looking up</p>}
    </RequirePermission>
  );
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'red' }) {
  return <div className="flex justify-between gap-3"><dt className="text-grey-500">{k}</dt><dd className={cx('text-right', tone === 'red' && 'font-medium text-red')}>{v}</dd></div>;
}

function Notice({ tone, icon: Icon, title: t, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; icon: typeof FileText; title: string; children: React.ReactNode }) {
  const cls = tone === 'ok' ? 'border-green/30 bg-green-soft text-green' : tone === 'warn' ? 'border-orange/30 bg-orange-soft text-orange' : tone === 'bad' ? 'border-red/30 bg-red-soft text-red' : 'border-grey-200 bg-grey-50 text-grey-700';
  return (
    <div className={cx('mb-4 flex items-start gap-3 rounded-lg border p-3 text-sm', cls)}>
      <Icon size={18} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0"><p className="font-semibold">{t}</p><p className="mt-0.5 text-xs text-grey-700">{children}</p></div>
    </div>
  );
}
