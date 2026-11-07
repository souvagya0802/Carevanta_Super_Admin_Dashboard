'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, Clock, FileText, Gavel, Percent, Plus, Scale, Search, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useFilters, useGet } from '@/lib/hooks';
import { dateTime, money, relative, title } from '@/lib/format';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DescriptionList, Dialog, EmptyState, Field, FormSection, Input, PageHeader, Select, Skeleton, Textarea, cx } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import { ProviderPicker, type ProviderRef } from '@/components/forms/provider-picker';
import { AmountRow, Kpi, Lifecycle, bpsToPct, calcCommission, describeTerms, fmtBps, fromMinor, pctToBps, shortId, toMinor, type Terms } from '@/components/finance/shared';

/* ─── Types & constants ─────────────────────────────────────────────────── */
interface Policy { id: string; code: string; version: number; name: string; description: string | null; category: string; providerType: string | null; providerId: string | null; agreementId: string | null; method: 'PERCENTAGE' | 'FLAT'; rateBps: number | null; flatMinor: number | null; minMinor: number | null; maxMinor: number | null; taxRateBps: number; currency: string; status: string; legalReviewStatus: string; legalReviewNote: string | null; highRisk: boolean; effectiveFrom: string; effectiveTo: string | null; createdById: string; approvedById: string | null; approvedAt: string | null; createdAt: string }
interface Preview { policy: Policy | null; result: { baseMinor: number; commissionMinor: number; taxMinor: number; providerNetMinor: number } | null }

const CATEGORIES = ['CONSULTATION', 'DIAGNOSTIC', 'PHARMACY', 'PROCEDURE', 'SURGERY', 'AMBULANCE', 'OTHER'] as const;
const HIGH_RISK = ['PROCEDURE', 'SURGERY'];
const PROVIDER_TYPES = ['DOCTOR', 'HOSPITAL', 'CLINIC', 'DIAGNOSTIC_LAB', 'IMAGING_CENTRE', 'PHARMACY', 'AMBULANCE_OPERATOR'] as const;
const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED'] as const;
const FLOW = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE'] as const;
const SAMPLE_AMOUNTS = [50_000, 200_000, 1_000_000]; // ₹500, ₹2,000, ₹10,000
const scopeOf = (p: Pick<Policy, 'providerId' | 'providerType'>) => (p.providerId ? 'Provider-specific' : p.providerType ? `${title(p.providerType)} default` : 'Category Default');
const KEY_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const normaliseCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^[^A-Z]+/, '').slice(0, 64);
const toLocalInput = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function CommissionRulesPage() {
  const { can } = useAuth();
  const { filters, set } = useFilters({ status: '', category: '' });
  const [q, setQ] = useState('');
  const [latestOnly, setLatestOnly] = useState(true);
  const [selected, setSelected] = useState<Policy | null>(null);
  const [creating, setCreating] = useState<null | { from?: Policy }>(null);
  const all = useGet<{ items?: Policy[] } | Policy[]>('/admin/finance/commission-policies?limit=100');
  const list = useMemo<Policy[]>(() => (Array.isArray(all.data) ? all.data : (all.data as { items?: Policy[] } | undefined)?.items ?? []), [all.data]);
  const stats = useMemo(() => ({ active: list.filter((p) => p.status === 'ACTIVE').length, pending: list.filter((p) => p.status === 'PENDING_APPROVAL').length, legal: list.filter((p) => p.status !== 'RETIRED' && p.highRisk && p.legalReviewStatus !== 'APPROVED').length, drafts: list.filter((p) => p.status === 'DRAFT').length }), [list]);
  const latestVersion = useMemo(() => { const m = new Map<string, number>(); for (const p of list) m.set(p.code, Math.max(m.get(p.code) ?? 0, p.version)); return m; }, [list]);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => list.filter((p) => (!filters.status || p.status === filters.status) && (!filters.category || p.category === filters.category) && (!latestOnly || latestVersion.get(p.code) === p.version) && (!needle || p.code.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle))), [list, filters, latestOnly, latestVersion, needle]);

  return (
    <RequirePermission anyOf={['finance.read']}>
      <PageHeader title="Commission Rules" description="Effective-dated policies resolved from the most specific match: provider-specific → provider type → category default. Drafted by one person, activated by another; procedure and surgery policies also need recorded legal approval under NMC referral-commission rules." actions={can('finance.policies.manage') && <Button onClick={() => setCreating({})}><Plus size={16} /> New Policy</Button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={CheckCircle2} accent="green" label="Active Policies" value={stats.active} loading={all.isPending} />
        <Kpi icon={Clock} accent="orange" label="Awaiting Approval" value={stats.pending} loading={all.isPending} sub={stats.pending ? 'Needs a different approver than the author' : undefined} />
        <Kpi icon={Scale} accent="red" label="High-Risk Without Legal Approval" value={stats.legal} loading={all.isPending} sub="Procedure / Surgery" />
        <Kpi icon={FileText} accent="blue" label="Drafts" value={stats.drafts} loading={all.isPending} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-grey-100 px-5 py-3">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
              <Input aria-label="Search Policies" placeholder="Search code or name…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-44"><option value="">All Statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>
            <Select aria-label="Category" value={filters.category} onChange={(e) => set('category', e.target.value)} className="w-44"><option value="">All Categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select>
            <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" className="accent-black" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} /> Latest Version Only</label>
          </div>
          {all.isPending ? <div className="p-5"><Skeleton rows={6} /></div> : visible.length === 0 ? (
            <div className="p-5"><EmptyState title={list.length === 0 ? 'No Commission Policies Yet' : 'No Policies Match'} description={list.length === 0 ? 'Start with a category default (e.g. 10% on consultations), then add provider-type or provider-specific overrides.' : 'Try another filter.'} action={list.length === 0 && can('finance.policies.manage') ? <Button onClick={() => setCreating({})}>Create the First Policy</Button> : undefined} /></div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-grey-500"><tr className="border-b border-grey-100"><th className="px-5 py-2.5 font-medium">Policy</th><th className="py-2.5 font-medium">Scope</th><th className="py-2.5 font-medium">Terms</th><th className="py-2.5 font-medium">Effective</th><th className="py-2.5 font-medium">Status</th></tr></thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} onClick={() => setSelected(p)} className="cursor-pointer border-b border-grey-100 last:border-0 hover:bg-grey-50">
                      <td className="px-5 py-3"><p className="font-medium">{p.name}</p><p className="font-mono text-[11px] text-grey-500">{p.code} · v{p.version}{latestVersion.get(p.code) !== p.version && <span className="ml-1 text-grey-400">(superseded)</span>}</p></td>
                      <td className="py-3"><p className="text-xs">{scopeOf(p)}</p><p className="flex items-center gap-1 text-xs text-grey-500">{title(p.category)}{p.highRisk && <AlertTriangle size={11} className="text-red" aria-label="High Risk" />}</p></td>
                      <td className="py-3 text-xs">{describeTerms(p)}</td>
                      <td className="py-3 text-xs text-grey-600">{dateTime(p.effectiveFrom)}<br />{p.effectiveTo ? `to ${dateTime(p.effectiveTo)}` : 'open-ended'}</td>
                      <td className="py-3"><Badge>{p.status}</Badge>{p.highRisk && <p className="mt-1"><Badge accent={p.legalReviewStatus === 'APPROVED' ? 'green' : p.legalReviewStatus === 'REJECTED' ? 'red' : 'orange'}>legal: {title(p.legalReviewStatus)}</Badge></p>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <PreviewCalculator />
      </div>

      {selected && <PolicyDialog policy={selected} versions={list.filter((p) => p.code === selected.code)} onClose={() => setSelected(null)} onChanged={() => { void all.refetch(); setSelected(null); }} onNewVersion={() => { setCreating({ from: selected }); setSelected(null); }} />}
      {creating && <PolicyEditor from={creating.from} existing={list} onClose={() => setCreating(null)} onCreated={() => { setCreating(null); void all.refetch(); }} />}
    </RequirePermission>
  );
}

/* ─── Detail dialog ─────────────────────────────────────────────────────── */
function PolicyDialog({ policy: p, versions, onClose, onChanged, onNewVersion }: { policy: Policy; versions: Policy[]; onClose: () => void; onChanged: () => void; onNewVersion: () => void }) {
  const { can, me } = useAuth();
  const [action, setAction] = useState<null | 'submit' | 'activate' | 'retire' | 'legal'>(null);
  const [reason, setReason] = useState('');
  const [supersede, setSupersede] = useState(false);
  const [legal, setLegal] = useState<'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'>('APPROVED');
  const [serverError, setServerError] = useState<string | null>(null);
  const base = `/admin/finance/commission-policies/${p.id}`;
  const onErr = (e: unknown) => { if (e instanceof ApiError) setServerError(e.message); };
  const submit = useAction(() => api.post(`${base}/submit`), { success: 'Submitted for approval', onSuccess: onChanged, onError: onErr });
  const activate = useAction(() => api.post(`${base}/activate`, { supersede }), { success: 'Policy activated', onSuccess: onChanged, onError: onErr });
  const retire = useAction(() => api.post(`${base}/retire`, { reason }), { success: 'Policy retired', onSuccess: onChanged, onError: onErr });
  const review = useAction(() => api.post(`${base}/legal-review`, { status: legal, note: reason }), { success: 'Legal review recorded', onSuccess: onChanged, onError: onErr });

  const isAuthor = p.createdById === me?.id;
  const blockers: string[] = [];
  if (p.status === 'PENDING_APPROVAL') {
    if (isAuthor) blockers.push('You drafted this policy, so someone else must activate it.');
    if (p.highRisk && p.legalReviewStatus !== 'APPROVED') blockers.push('Procedure/surgery policies need a recorded legal approval first.');
    if (p.legalReviewStatus === 'REJECTED') blockers.push('Legal review rejected this policy; draft a new version.');
  }
  const canActivate = can('finance.policies.approve') && p.status === 'PENDING_APPROVAL' && blockers.length === 0;
  const overlapping = versions.filter((v) => v.id !== p.id && v.status === 'ACTIVE');
  const samples = SAMPLE_AMOUNTS.map((a) => ({ a, r: calcCommission(p, a) }));

  return (
    <Dialog open onClose={onClose} size="lg" icon={p.highRisk ? ShieldAlert : Percent} title={p.name} description={`${p.code} · version ${p.version} · ${scopeOf(p)} · ${title(p.category)}`}
      footer={<>
        {can('finance.policies.manage') && p.status === 'DRAFT' && <Button onClick={() => setAction('submit')}>Submit for Approval</Button>}
        {can('finance.policies.legal_review') && p.status !== 'RETIRED' && <Button variant="secondary" onClick={() => { setLegal('APPROVED'); setReason(''); setAction('legal'); }}><Gavel size={14} /> Record Legal Review</Button>}
        {can('finance.policies.approve') && p.status === 'PENDING_APPROVAL' && <Button onClick={() => setAction('activate')} disabled={!canActivate} title={blockers.join(' ')}>Activate</Button>}
        {can('finance.policies.approve') && p.status === 'ACTIVE' && <Button variant="danger" onClick={() => { setReason(''); setAction('retire'); }}>Retire</Button>}
        {can('finance.policies.manage') && p.status !== 'DRAFT' && <Button variant="secondary" onClick={onNewVersion}>New Version</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      <div className="space-y-4">
        <Lifecycle steps={FLOW} current={p.status} terminal={{ status: 'RETIRED', label: 'Retired' }} />
        {p.description && <p className="text-grey-700">{p.description}</p>}
        {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
        {blockers.length > 0 && <div className="space-y-1 rounded-xl bg-orange-soft px-3 py-2 text-xs text-grey-800">{blockers.map((b) => <p key={b} className="flex items-start gap-2"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-orange" aria-hidden />{b}</p>)}</div>}
        <DescriptionList items={[
          { label: 'Terms', value: describeTerms(p) },
          { label: 'Tax on Commission', value: fmtBps(p.taxRateBps) },
          { label: 'Effective From', value: dateTime(p.effectiveFrom) },
          { label: 'Effective To', value: p.effectiveTo ? dateTime(p.effectiveTo) : 'Open-ended' },
          { label: 'Scope', value: p.providerId ? <span>Provider <span className="font-mono text-xs">{shortId(p.providerId)}</span>{p.agreementId ? ` · agreement ${shortId(p.agreementId)}` : ''}</span> : scopeOf(p) },
          { label: 'Legal Review', value: <span><Badge accent={p.legalReviewStatus === 'APPROVED' ? 'green' : p.legalReviewStatus === 'REJECTED' ? 'red' : p.legalReviewStatus === 'UNDER_REVIEW' ? 'orange' : 'ink'}>{title(p.legalReviewStatus)}</Badge>{p.legalReviewNote && <span className="ml-2 text-xs text-grey-600">{p.legalReviewNote}</span>}</span> },
          { label: 'Drafted', value: `${dateTime(p.createdAt)} by ${isAuthor ? 'you' : shortId(p.createdById)}` },
          { label: 'Approved', value: p.approvedAt ? `${dateTime(p.approvedAt)} by ${shortId(p.approvedById)}` : '—' },
        ]} />
        <div className="rounded-xl border border-grey-200">
          <p className="border-b border-grey-100 bg-grey-50 px-3 py-2 text-xs font-semibold text-grey-600">Worked Examples</p>
          <table className="w-full text-xs"><thead className="text-left text-grey-500"><tr><th className="px-3 py-1.5 font-medium">Service Value</th><th className="py-1.5 font-medium">Commission</th><th className="py-1.5 font-medium">Tax</th><th className="py-1.5 pr-3 font-medium">Provider Receives</th></tr></thead>
            <tbody>{samples.map(({ a, r }) => <tr key={a} className="tnum border-t border-grey-100"><td className="px-3 py-1.5">{money(a)}</td><td className="py-1.5">{money(r.commissionMinor)}</td><td className="py-1.5">{money(r.taxMinor)}</td><td className="py-1.5 pr-3 font-medium">{money(r.providerNetMinor)}</td></tr>)}</tbody></table>
        </div>
        {versions.length > 1 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-grey-500">Versions of {p.code}</p>
            <ul className="divide-y divide-grey-100 rounded-xl border border-grey-200 text-xs">{[...versions].sort((a, b) => b.version - a.version).map((v) => <li key={v.id} className={cx('flex items-center justify-between gap-2 px-3 py-2', v.id === p.id && 'bg-grey-50')}><span>v{v.version} · {describeTerms(v)}</span><span className="flex items-center gap-2 text-grey-500"><Badge>{v.status}</Badge>{relative(v.createdAt)}</span></li>)}</ul>
          </div>
        )}
      </div>

      <ConfirmDialog open={action === 'submit'} onClose={() => setAction(null)} onConfirm={() => submit.mutate()} loading={submit.isPending} title="Submit for Approval?" confirmLabel="Submit" message="The policy becomes read-only. Someone with approval rights other than you must activate it." />
      <ConfirmDialog open={action === 'activate'} onClose={() => setAction(null)} onConfirm={() => activate.mutate()} loading={activate.isPending} title="Activate This Policy?" confirmLabel="Activate" message={`From ${dateTime(p.effectiveFrom)} every new completed ${title(p.category).toLowerCase()} transaction in scope will use these terms. Commission already snapshotted on past transactions is not affected.`}>
        {overlapping.length > 0 && <div className="mt-3 space-y-2 text-xs"><p className="rounded-xl bg-orange-soft px-3 py-2 text-grey-800">Version {overlapping.map((v) => `v${v.version}`).join(', ')} of this code is ACTIVE and may overlap this period. The server rejects overlapping active policies unless you supersede.</p><Checkbox label="Supersede the overlapping version (it is retired as this one starts)" checked={supersede} onChange={(e) => setSupersede(e.target.checked)} /></div>}
      </ConfirmDialog>
      <ConfirmDialog open={action === 'retire'} onClose={() => setAction(null)} onConfirm={() => retire.mutate()} loading={retire.isPending} danger title="Retire This Policy?" confirmLabel="Retire" message="Future transactions stop using it immediately and fall back to the next most specific policy, if any. Historical commission snapshots are unchanged.">
        <Field label="Reason" required className="mt-3" hint="At least 5 characters · audited"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" /></Field>
        {reason.trim().length < 5 && <p className="mt-1 text-xs text-grey-500">Enter a reason to enable Retire.</p>}
      </ConfirmDialog>
      <Dialog open={action === 'legal'} onClose={() => setAction(null)} icon={Gavel} title="Record Legal / Compliance Review" description={`${p.code} v${p.version} · ${title(p.category)}`} footer={<><Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button><Button onClick={() => review.mutate()} loading={review.isPending} disabled={reason.trim().length < 5}>Record Outcome</Button></>}>
        <div className="space-y-3">
          {p.highRisk && <p className="rounded-xl bg-red-soft px-3 py-2 text-xs text-grey-800">Commission on procedures and surgery can be construed as a referral fee under the NMC code of conduct. Record counsel’s written opinion reference in the note.</p>}
          <Field label="Outcome" required><Select value={legal} onChange={(e) => setLegal(e.target.value as typeof legal)}><option value="UNDER_REVIEW">Under Review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></Select></Field>
          <Field label="Note" required hint="Opinion reference, reviewer and date · at least 5 characters"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" /></Field>
        </div>
      </Dialog>
    </Dialog>
  );
}

/* ─── Create / new version ─────────────────────────────────────────────── */
function PolicyEditor({ from, existing, onClose, onCreated }: { from?: Policy; existing: Policy[]; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState(() => ({
    code: from?.code ?? '', name: from?.name ?? '', description: from?.description ?? '', category: (from?.category ?? 'CONSULTATION') as (typeof CATEGORIES)[number],
    scope: (from?.providerId ? 'provider' : from?.providerType ? 'type' : 'category') as 'category' | 'type' | 'provider', providerType: from?.providerType ?? 'DOCTOR', agreementId: from?.agreementId ?? '',
    method: from?.method ?? 'PERCENTAGE', ratePct: bpsToPct(from?.rateBps ?? 1000), flat: fromMinor(from?.flatMinor), min: fromMinor(from?.minMinor), max: fromMinor(from?.maxMinor), taxPct: bpsToPct(from?.taxRateBps ?? 0),
    effectiveFrom: toLocalInput(new Date().toISOString()), effectiveTo: '',
  }));
  const [provider, setProvider] = useState<ProviderRef | null>(from?.providerId ? { id: from.providerId, displayName: `Provider ${shortId(from.providerId)}`, type: from.providerType ?? 'HOSPITAL' } : null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const codeExists = existing.some((p) => p.code === f.code);
  const nextVersion = codeExists ? Math.max(...existing.filter((p) => p.code === f.code).map((p) => p.version)) + 1 : 1;
  const rateBps = pctToBps(f.ratePct);
  const flatMinor = toMinor(f.flat);
  const minMinor = f.min ? toMinor(f.min) : null;
  const maxMinor = f.max ? toMinor(f.max) : null;
  const taxBps = pctToBps(f.taxPct);
  const e: Record<string, string | undefined> = {
    code: !f.code ? undefined : !KEY_RE.test(f.code) ? 'UPPER_SNAKE_CASE, 3–64 characters, starting with a letter' : undefined,
    name: f.name && f.name.trim().length < 3 ? 'At least 3 characters' : undefined,
    rate: f.method === 'PERCENTAGE' && (rateBps == null || rateBps > 10_000) ? 'Enter a rate between 0% and 100%' : undefined,
    flat: f.method === 'FLAT' && flatMinor == null ? 'Enter a flat amount in rupees' : undefined,
    min: f.min && minMinor == null ? 'Invalid amount' : undefined,
    max: f.max && maxMinor == null ? 'Invalid amount' : minMinor != null && maxMinor != null && maxMinor < minMinor ? 'Maximum must be at least the minimum' : undefined,
    tax: taxBps == null || taxBps > 10_000 ? 'Tax must be between 0% and 100%' : undefined,
    from: !f.effectiveFrom ? 'Required' : undefined,
    to: f.effectiveTo && f.effectiveFrom && new Date(f.effectiveTo) <= new Date(f.effectiveFrom) ? 'Must be after the start' : undefined,
    provider: f.scope === 'provider' && !provider ? 'Choose a provider' : undefined,
    agreement: f.agreementId && !/^[0-9a-f-]{36}$/i.test(f.agreementId) ? 'Paste the agreement id (UUID)' : undefined,
  };
  const invalid = Object.values(e).some(Boolean) || !f.code || !f.name.trim();
  const terms: Terms = { method: f.method, rateBps: rateBps ?? 0, flatMinor: flatMinor ?? 0, minMinor, maxMinor, taxRateBps: taxBps ?? 0 };
  const highRisk = HIGH_RISK.includes(f.category);
  const dirty = !!(f.code || f.name || f.description);
  const close = () => { if (dirty && !window.confirm('Discard this policy draft?')) return; onClose(); };

  const create = useAction(() => api.post('/admin/finance/commission-policies', {
    code: f.code, name: f.name.trim(), description: f.description.trim() || undefined, category: f.category,
    providerType: f.scope === 'type' ? f.providerType : f.scope === 'provider' ? provider?.type : undefined,
    providerId: f.scope === 'provider' ? provider?.id : undefined, agreementId: f.scope === 'provider' && f.agreementId ? f.agreementId : undefined,
    method: f.method, rateBps: f.method === 'PERCENTAGE' ? rateBps : undefined, flatMinor: f.method === 'FLAT' ? flatMinor : undefined,
    minMinor: minMinor ?? undefined, maxMinor: maxMinor ?? undefined, taxRateBps: taxBps ?? 0,
    effectiveFrom: new Date(f.effectiveFrom).toISOString(), effectiveTo: f.effectiveTo ? new Date(f.effectiveTo).toISOString() : undefined,
  }), { success: codeExists ? `Draft v${nextVersion} created` : 'Policy drafted', onSuccess: onCreated, onError: (err) => { if (err instanceof ApiError) { setServerError(err.message); setFieldErrors(err.fieldErrors ?? {}); } } });

  return (
    <Dialog open onClose={close} size="full" icon={Percent} title={from ? `New version of ${from.code}` : 'New Commission Policy'} description="Saved as a DRAFT. Submit it for approval when the terms are final; a different approver activates it."
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3"><span className="text-xs text-grey-600">{f.code ? (codeExists ? `Will be created as version ${nextVersion} of ${f.code}` : `New code ${f.code} · version 1`) : 'Enter a code'}</span><div className="flex gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={invalid}>Save Draft</Button></div></div>}>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {serverError && <p role="alert" className="rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{serverError}</p>}
          <FormSection title="Identity" icon={FileText} accent="blue" hint="The code is permanent and shared by all versions; the name is what finance staff see.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Code" required error={e.code ?? fieldErrors.code} hint={codeExists ? `Exists — this will be version ${nextVersion}` : 'e.g. CONSULT_DEFAULT, HOSP_PROCEDURE_TIER1'}><Input value={f.code} disabled={!!from} onChange={(x) => setF({ ...f, code: normaliseCode(x.target.value) })} className="font-mono" /></Field>
              <Field label="Name" required error={e.name ?? fieldErrors.name}><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value.slice(0, 160) })} /></Field>
              <Field label="Description" className="md:col-span-2" hint="Commercial rationale, contract reference"><Textarea value={f.description} onChange={(x) => setF({ ...f, description: x.target.value.slice(0, 2000) })} className="min-h-16" /></Field>
            </div>
          </FormSection>
          <FormSection title="Scope" icon={Scale} accent="purple" hint="A transaction uses the most specific ACTIVE policy for its category: provider-specific beats provider-type beats category default.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Service Category" required><Select value={f.category} onChange={(x) => setF({ ...f, category: x.target.value as typeof f.category })}>{CATEGORIES.map((c) => <option key={c} value={c}>{title(c)}{HIGH_RISK.includes(c) ? ' (high risk)' : ''}</option>)}</Select></Field>
              <Field label="Applies To" required>
                <Select value={f.scope} onChange={(x) => setF({ ...f, scope: x.target.value as typeof f.scope })}><option value="category">Every provider (category default)</option><option value="type">One Provider Type</option><option value="provider">One Specific Provider</option></Select>
              </Field>
              {f.scope === 'type' && <Field label="Provider Type" required><Select value={f.providerType} onChange={(x) => setF({ ...f, providerType: x.target.value })}>{PROVIDER_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>}
              {f.scope === 'provider' && <><Field label="Provider" required error={e.provider}><ProviderPicker value={provider} onChange={setProvider} /></Field><Field label="Agreement ID" error={e.agreement} hint="Optional · links the policy to a signed commercial agreement"><Input value={f.agreementId} onChange={(x) => setF({ ...f, agreementId: x.target.value.trim() })} className="font-mono" /></Field></>}
            </div>
            {highRisk && <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-soft px-3 py-2 text-xs text-grey-800"><ShieldAlert size={14} className="mt-0.5 shrink-0 text-red" aria-hidden />Procedure and surgery commissions are high risk under NMC rules on referral fees. This policy cannot be activated until a legal review is recorded as approved.</p>}
          </FormSection>
          <FormSection title="Terms" icon={Percent} accent="green" hint="Percentages are stored as basis points and rounded half-up; commission never exceeds the service value.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Method" required><Select value={f.method} onChange={(x) => setF({ ...f, method: x.target.value as typeof f.method })}><option value="PERCENTAGE">Percentage of Service Value</option><option value="FLAT">Flat Amount per Transaction</option></Select></Field>
              {f.method === 'PERCENTAGE' ? <Field label="Rate (%)" required error={e.rate} hint="Up to 2 decimals"><Input type="number" min={0} max={100} step="0.01" value={f.ratePct} onChange={(x) => setF({ ...f, ratePct: x.target.value })} /></Field> : <Field label="Flat Amount (₹)" required error={e.flat}><Input type="number" min={0} step="0.01" value={f.flat} onChange={(x) => setF({ ...f, flat: x.target.value })} /></Field>}
              <Field label="Tax on Commission (%)" required error={e.tax} hint="GST charged on the platform fee, if applicable"><Input type="number" min={0} max={100} step="0.01" value={f.taxPct} onChange={(x) => setF({ ...f, taxPct: x.target.value })} /></Field>
              <Field label="Minimum Commission (₹)" error={e.min} hint="Optional floor"><Input type="number" min={0} step="0.01" value={f.min} onChange={(x) => setF({ ...f, min: x.target.value })} /></Field>
              <Field label="Maximum Commission (₹)" error={e.max} hint="Optional cap"><Input type="number" min={0} step="0.01" value={f.max} onChange={(x) => setF({ ...f, max: x.target.value })} /></Field>
            </div>
          </FormSection>
          <FormSection title="Effective Period" icon={Clock} accent="orange" hint="Policies are effective-dated; overlapping ACTIVE policies in the same scope are rejected unless superseded on activation.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Effective From" required error={e.from}><Input type="datetime-local" value={f.effectiveFrom} onChange={(x) => setF({ ...f, effectiveFrom: x.target.value })} /></Field>
              <Field label="Effective To" error={e.to} hint="Leave empty for open-ended"><Input type="datetime-local" value={f.effectiveTo} min={f.effectiveFrom} onChange={(x) => setF({ ...f, effectiveTo: x.target.value })} /></Field>
            </div>
          </FormSection>
        </div>
        <FormSection title="Live Preview" icon={Calculator} accent="teal" hint="Exactly what the server will compute with these terms.">
          <p className="mb-3 text-xs text-grey-600">{invalid && !e.rate && !e.flat && !e.tax && !e.max ? 'Fill in the terms to preview.' : describeTerms(terms)}</p>
          <div className="space-y-3">
            {SAMPLE_AMOUNTS.map((a) => { const r = calcCommission(terms, a); return (
              <div key={a} className="rounded-xl border border-grey-200 p-3">
                <p className="mb-1 text-xs font-semibold text-grey-700">Service value {money(a)}</p>
                <AmountRow label="Platform Commission" minor={r.commissionMinor} negative />
                <AmountRow label="Tax on Commission" minor={r.taxMinor} negative />
                <AmountRow label="Provider Receives" minor={r.providerNetMinor} strong />
              </div>
            ); })}
          </div>
        </FormSection>
      </div>
    </Dialog>
  );
}

/* ─── Preview calculator (resolves the real policy on the server) ───────── */
function PreviewCalculator() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('CONSULTATION');
  const [provider, setProvider] = useState<ProviderRef | null>(null);
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState('');
  const minor = toMinor(amount);
  const preview = useAction(() => api.post<{ data: Preview }>('/admin/finance/commission-policies/preview', { category, providerId: provider!.id, amountMinor: minor, ...(at ? { at: new Date(at).toISOString() } : {}) }));
  const r = preview.data?.data;
  return (
    <Card title="Preview a Calculation" description="Resolves the policy that would apply to a real provider and amount.">
      <div className="space-y-3">
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>{CATEGORIES.map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field>
        <Field label="Provider" required><ProviderPicker value={provider} onChange={setProvider} /></Field>
        <Field label="Service Value (₹)" required error={amount && minor == null ? 'Enter a valid amount' : undefined}><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="As Of" hint="Defaults to now"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <Button className="w-full" onClick={() => preview.mutate()} loading={preview.isPending} disabled={!provider || minor == null || minor <= 0}><Calculator size={16} /> Preview</Button>
        {r && (r.policy && r.result ? (
          <div className="rounded-xl border border-grey-200 p-3">
            <p className="text-xs text-grey-600">Applies: <span className="font-medium text-ink">{r.policy.name}</span> <span className="font-mono">{r.policy.code} v{r.policy.version}</span> · {scopeOf(r.policy)}</p>
            <div className="mt-2">
              <AmountRow label="Service Value" minor={r.result.baseMinor} />
              <AmountRow label="Commission" minor={r.result.commissionMinor} negative hint={describeTerms(r.policy)} />
              <AmountRow label="Tax" minor={r.result.taxMinor} negative />
              <AmountRow label="Provider Receives" minor={r.result.providerNetMinor} strong />
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-orange-soft px-3 py-2 text-xs text-grey-800"><p className="font-medium text-orange">No Active Policy Applies</p><p>No commission would be charged on this transaction. Create a {title(category).toLowerCase()} default or a provider-specific policy.</p></div>
        ))}
      </div>
    </Card>
  );
}
