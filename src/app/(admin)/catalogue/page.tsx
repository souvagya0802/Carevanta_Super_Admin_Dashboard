'use client';

import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useGet } from '@/lib/hooks';
import { title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, Checkbox, Dialog, ErrorState, Field, Input, PageHeader, Select, Skeleton, Tabs, Textarea } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import { SearchTester, SearchWordsDialog, WordsSummary } from '@/components/catalogue/search-words';

const TABS = [{ key: 'specialities', label: 'Specialities' }, { key: 'conditions', label: 'Conditions & Mappings' }, { key: 'departments', label: 'Departments' }, { key: 'amenities', label: 'Amenities' }, { key: 'services', label: 'Services & Tests' }, { key: 'medicines', label: 'Medicines' }, { key: 'search', label: 'Search Tester' }];

export default function CataloguePage() {
  const [tab, setTab] = useState('specialities');
  return (
    <RequirePermission anyOf={['catalogue.read']}>
      <PageHeader title="Departments, Specialities & Services" description="The controlled taxonomy providers map their offerings onto. Condition→speciality mappings are routing hints reviewed by a clinician — never diagnoses." />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'specialities' && <Specialities />}
        {tab === 'conditions' && <Conditions />}
        {tab === 'departments' && <Departments />}
        {tab === 'amenities' && <Amenities />}
        {tab === 'services' && <Services />}
        {tab === 'medicines' && <Medicines />}
        {tab === 'search' && <SearchTester />}
      </div>
    </RequirePermission>
  );
}

function CodeNameForm({ onSubmit, loading, extra }: { onSubmit: (v: { code: string; name: string; parentCode?: string; category?: string; specialityCode?: string }) => void; loading: boolean; extra?: 'parent' | 'category' | 'speciality' }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [other, setOther] = useState('');
  return (
    <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); onSubmit({ code, name, ...(extra === 'parent' ? { parentCode: other || undefined } : extra === 'category' ? { category: other } : extra === 'speciality' ? { specialityCode: other || undefined } : {}) }); setCode(''); setName(''); setOther(''); }}>
      <Field label="Code" required hint="UPPER_SNAKE_CASE"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} pattern="[A-Z][A-Z0-9_]{1,63}" required /></Field>
      <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      {extra && <Field label={extra === 'parent' ? 'Parent code' : extra === 'category' ? 'Category' : 'Speciality code'} required={extra === 'category'}><Input value={other} onChange={(e) => setOther(extra === 'category' ? e.target.value : e.target.value.toUpperCase())} /></Field>}
      <div className="flex items-end"><Button type="submit" loading={loading}>Add</Button></div>
    </form>
  );
}

function Specialities() {
  const { can } = useAuth();
  const list = useGet<{ id: string; code: string; name: string; parentCode: string | null; synonyms: string[]; isActive: boolean; doctorCount: number }[]>('/admin/catalogue/specialities');
  const [words, setWords] = useState<{ id: string; name: string; synonyms: string[] } | null>(null);
  const create = useAction((v: { code: string; name: string; parentCode?: string }) => api.post('/admin/catalogue/specialities', v), { success: 'Speciality added', invalidate: ['/admin/catalogue/specialities'] });
  const toggle = useAction((s: { id: string; isActive: boolean }) => api.patch(`/admin/catalogue/specialities/${s.id}`, { isActive: !s.isActive }), { success: 'Updated', invalidate: ['/admin/catalogue/specialities'] });
  return (
    <div className="space-y-4">
      {can('catalogue.manage') && <Card title="Add a Speciality"><CodeNameForm onSubmit={(v) => create.mutate(v)} loading={create.isPending} extra="parent" /></Card>}
      <Card title="Specialities">
        {list.isPending ? <Skeleton /> : list.isError ? <ErrorState error={list.error} /> : (
          <table className="w-full text-sm"><thead className="text-left text-xs text-grey-500"><tr><th className="py-1">Name</th><th>Code</th><th>Everyday Words</th><th>Doctors</th><th>Active</th><th /></tr></thead>
            <tbody>{list.data.map((s) => <tr key={s.id} className="border-t border-grey-200"><td className="py-1.5">{s.name}</td><td className="font-mono text-xs">{s.code}</td><td className="max-w-xs"><WordsSummary words={s.synonyms} /></td><td className="tnum">{s.doctorCount}</td><td>{s.isActive ? 'Yes' : 'No'}</td><td className="text-right whitespace-nowrap">{can('catalogue.manage') && <><Button size="sm" variant="ghost" onClick={() => setWords(s)}>Edit Words</Button><Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>{s.isActive ? 'Deactivate' : 'Activate'}</Button></>}</td></tr>)}</tbody></table>
        )}
      </Card>
      {words && <SearchWordsDialog key={words.id} open onClose={() => setWords(null)} title={words.name} words={words.synonyms} path={`/admin/catalogue/specialities/${words.id}`} invalidate={['/admin/catalogue/specialities']} />}
    </div>
  );
}

interface Mapping { id: string; condition: string; speciality: string; relevance: string; reviewStatus: string; rationale: string | null; proposedById: string | null; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null }
interface Condition { id: string; name: string; slug: string; kind: string; synonyms: string[]; isRedFlag: boolean; isActive: boolean; mappings: { id: string; specialityCode: string; specialityName: string; relevance: string; reviewStatus: string }[] }

function Conditions() {
  const { can, me } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [reviewStatus, setReviewStatus] = useState('PENDING_REVIEW');
  const mappings = useGet<Mapping[]>(`/admin/catalogue/mappings?reviewStatus=${reviewStatus}`);
  const [review, setReview] = useState<{ m: Mapping; decision: 'APPROVED' | 'RETIRED' } | null>(null);
  const [note, setNote] = useState('');
  const [propose, setPropose] = useState<Condition | null>(null);
  const [proposal, setProposal] = useState({ specialityCode: '', relevance: 'PRIMARY', rationale: '' });
  const [creating, setCreating] = useState(false);
  const [words, setWords] = useState<Condition | null>(null);
  const [cond, setCond] = useState({ name: '', kind: 'CONDITION', synonyms: '', isRedFlag: false });
  const inv = ['/admin/catalogue/mappings', '/admin/catalogue/conditions'];
  const decide = useAction(() => api.post(`/admin/catalogue/mappings/${review!.m.id}/review`, { decision: review!.decision, note }), { success: 'Mapping reviewed', invalidate: inv, onSuccess: () => { setReview(null); setNote(''); } });
  const submitProposal = useAction(() => api.post('/admin/catalogue/mappings', { conditionId: propose!.id, ...proposal }), { success: 'Mapping proposed for clinical review', invalidate: inv, onSuccess: () => setPropose(null) });
  const createCondition = useAction(() => api.post('/admin/catalogue/conditions', { name: cond.name, kind: cond.kind, synonyms: cond.synonyms.split(',').map((s) => s.trim()).filter(Boolean), isRedFlag: cond.isRedFlag }), { success: 'Condition added', invalidate: inv, onSuccess: () => setCreating(false) });
  const columns: ColumnDef<Condition, unknown>[] = [
    { header: 'Term', cell: ({ row }) => <div><p className="font-medium">{row.original.name} {row.original.isRedFlag && <Badge tone="URGENT">red flag</Badge>}</p><p className="text-xs text-grey-500">{row.original.kind.toLowerCase()} · {row.original.synonyms.join(', ')}</p></div> },
    { header: 'Mappings', cell: ({ row }) => <ul className="text-xs">{row.original.mappings.map((m) => <li key={m.id}>{m.specialityName} <span className="text-grey-500">({m.relevance.toLowerCase()})</span> <Badge>{m.reviewStatus}</Badge></li>)}{!row.original.mappings.length && <li className="text-grey-500">none</li>}</ul> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => can('catalogue.manage') && <span className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setWords(row.original)}>Edit Words</Button><Button size="sm" variant="ghost" onClick={() => setPropose(row.original)}>Propose Mapping</Button></span> },
  ];
  return (
    <div className="space-y-4">
      <Card title="Mapping Review Queue" actions={<Select aria-label="Review Status" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} className="w-44 h-8 text-xs">{['PENDING_REVIEW', 'APPROVED', 'RETIRED', 'DRAFT'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select>}>
        {mappings.isPending ? <Skeleton rows={3} /> : mappings.isError ? <ErrorState error={mappings.error} /> : mappings.data.length === 0 ? <p className="text-sm text-grey-500">Nothing {title(reviewStatus).toLowerCase()}.</p> : (
          <table className="w-full text-sm"><thead className="text-left text-xs text-grey-500"><tr><th className="py-1">Condition</th><th>Speciality</th><th>Relevance</th><th>Rationale</th><th /></tr></thead>
            <tbody>{mappings.data.map((m) => <tr key={m.id} className="border-t border-grey-200 align-top"><td className="py-1.5">{m.condition}</td><td>{m.speciality}</td><td>{title(m.relevance)}</td><td className="text-xs text-grey-600">{m.rationale}{m.reviewNote && <p className="mt-1">Review: {m.reviewNote}</p>}</td><td className="text-right whitespace-nowrap">{can('catalogue.mappings.review') && m.reviewStatus !== 'RETIRED' && (m.proposedById === me?.id ? <span className="text-xs text-grey-500">you proposed this</span> : <>{m.reviewStatus !== 'APPROVED' && <Button size="sm" variant="ghost" onClick={() => setReview({ m, decision: 'APPROVED' })}>Approve</Button>}<Button size="sm" variant="ghost" onClick={() => setReview({ m, decision: 'RETIRED' })}>Retire</Button></>)}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Card title="Conditions & Symptoms" actions={can('catalogue.manage') && <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>Add Term</Button>}>
        <DataTable<Condition> path="/admin/catalogue/conditions" params={{ q: dq }} columns={columns} toolbar={<Input aria-label="Search Conditions" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />} />
      </Card>
      <Dialog open={!!review} onClose={() => setReview(null)} title={`${review?.decision === 'APPROVED' ? 'Approve' : 'Retire'} Mapping`} footer={<><Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button><Button onClick={() => decide.mutate()} loading={decide.isPending} disabled={note.length < 5}>{review?.decision === 'APPROVED' ? 'Approve' : 'Retire'}</Button></>}>
        <p>{review?.m.condition} → {review?.m.speciality} ({review?.m.relevance.toLowerCase()})</p>
        <Field label="Clinical Review Note" required className="mt-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Dialog>
      <Dialog open={!!propose} onClose={() => setPropose(null)} title={`Propose a Mapping for "${propose?.name}"`} footer={<><Button variant="ghost" onClick={() => setPropose(null)}>Cancel</Button><Button onClick={() => submitProposal.mutate()} loading={submitProposal.isPending} disabled={!proposal.specialityCode || proposal.rationale.length < 10}>Propose</Button></>}>
        <div className="space-y-3">
          <Field label="Speciality Code" required><Input value={proposal.specialityCode} onChange={(e) => setProposal({ ...proposal, specialityCode: e.target.value.toUpperCase() })} /></Field>
          <Field label="Relevance"><Select value={proposal.relevance} onChange={(e) => setProposal({ ...proposal, relevance: e.target.value })}><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option></Select></Field>
          <Field label="Rationale" required hint="A clinician other than you must approve before search uses it"><Textarea value={proposal.rationale} onChange={(e) => setProposal({ ...proposal, rationale: e.target.value })} /></Field>
        </div>
      </Dialog>
      {words && <SearchWordsDialog key={words.id} open onClose={() => setWords(null)} title={words.name} words={words.synonyms} path={`/admin/catalogue/conditions/${words.id}`} invalidate={['/admin/catalogue/conditions']} />}
      <Dialog open={creating} onClose={() => setCreating(false)} title="Add a Condition or Symptom" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={() => createCondition.mutate()} loading={createCondition.isPending} disabled={cond.name.length < 2}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="Name" required><Input value={cond.name} onChange={(e) => setCond({ ...cond, name: e.target.value })} /></Field>
          <Field label="Kind"><Select value={cond.kind} onChange={(e) => setCond({ ...cond, kind: e.target.value })}><option value="CONDITION">Condition</option><option value="SYMPTOM">Symptom</option></Select></Field>
          <Field label="Synonyms" hint="Comma-separated, including local-language transliterations"><Input value={cond.synonyms} onChange={(e) => setCond({ ...cond, synonyms: e.target.value })} /></Field>
          <Checkbox label="Red Flag: Show Emergency Guidance (112) Before Any Results" checked={cond.isRedFlag} onChange={(e) => setCond({ ...cond, isRedFlag: e.target.checked })} />
        </div>
      </Dialog>
    </div>
  );
}

function Departments() {
  const { can } = useAuth();
  const list = useGet<{ id: string; code: string; name: string; specialityCode: string | null; isActive: boolean }[]>('/admin/catalogue/departments');
  const create = useAction((v: { code: string; name: string; specialityCode?: string }) => api.post('/admin/catalogue/departments', v), { success: 'Department added', invalidate: ['/admin/catalogue/departments'] });
  return (
    <div className="space-y-4">
      {can('catalogue.manage') && <Card title="Add a Department"><CodeNameForm onSubmit={(v) => create.mutate(v)} loading={create.isPending} extra="speciality" /></Card>}
      <Card title="Departments">{list.isPending ? <Skeleton /> : list.isError ? <ErrorState error={list.error} /> : <table className="w-full text-sm"><thead className="text-left text-xs text-grey-500"><tr><th className="py-1">Name</th><th>Code</th><th>Speciality</th><th>Active</th></tr></thead><tbody>{list.data.map((d) => <tr key={d.id} className="border-t border-grey-200"><td className="py-1.5">{d.name}</td><td className="font-mono text-xs">{d.code}</td><td className="text-xs">{d.specialityCode ?? '—'}</td><td>{d.isActive ? 'Yes' : 'No'}</td></tr>)}</tbody></table>}</Card>
    </div>
  );
}

function Amenities() {
  const { can } = useAuth();
  const list = useGet<{ id: string; code: string; name: string; category: string }[]>('/admin/catalogue/amenities');
  const create = useAction((v: { code: string; name: string; category?: string }) => api.post('/admin/catalogue/amenities', { ...v, category: v.category ?? 'OTHER' }), { success: 'Amenity added', invalidate: ['/admin/catalogue/amenities'] });
  return (
    <div className="space-y-4">
      {can('catalogue.manage') && <Card title="Add an Amenity"><CodeNameForm onSubmit={(v) => create.mutate(v)} loading={create.isPending} extra="category" /></Card>}
      <Card title="Amenities">{list.isPending ? <Skeleton /> : list.isError ? <ErrorState error={list.error} /> : <table className="w-full text-sm"><thead className="text-left text-xs text-grey-500"><tr><th className="py-1">Name</th><th>Code</th><th>Category</th></tr></thead><tbody>{list.data.map((a) => <tr key={a.id} className="border-t border-grey-200"><td className="py-1.5">{a.name}</td><td className="font-mono text-xs">{a.code}</td><td>{title(a.category)}</td></tr>)}</tbody></table>}</Card>
    </div>
  );
}

interface Service { id: string; code: string; name: string; category: string; specialityCode: string | null; requiresPrescription: boolean; sampleType: string | null; fastingRequired: boolean | null; preparationInstructions: string | null; synonyms: string[]; isActive: boolean; createdAt: string }
const CATEGORIES = ['CONSULTATION', 'DIAGNOSTIC_TEST', 'IMAGING', 'PROCEDURE', 'SURGERY', 'PHARMACY', 'AMBULANCE', 'HOME_CARE', 'OTHER'];

function Services() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const dq = useDebounced(q);
  const [creating, setCreating] = useState(false);
  const [words, setWords] = useState<Service | null>(null);
  const [f, setF] = useState({ code: '', name: '', category: 'DIAGNOSTIC_TEST', specialityCode: '', requiresPrescription: false, sampleType: '', fastingRequired: false, preparationInstructions: '' });
  const create = useAction(() => api.post('/admin/catalogue/services', { ...f, specialityCode: f.specialityCode || undefined, sampleType: f.sampleType || undefined, preparationInstructions: f.preparationInstructions || undefined }), { success: 'Service added', invalidate: ['/admin/catalogue/services'], onSuccess: () => setCreating(false) });
  const toggle = useAction((s: Service) => api.patch(`/admin/catalogue/services/${s.id}`, { isActive: !s.isActive }), { success: 'Updated', invalidate: ['/admin/catalogue/services'] });
  const columns: ColumnDef<Service, unknown>[] = [
    { header: 'Service', cell: ({ row }) => <div><p className="font-medium">{row.original.name}</p><p className="font-mono text-xs text-grey-500">{row.original.code}</p><WordsSummary words={row.original.synonyms ?? []} /></div> },
    { header: 'Category', cell: ({ row }) => title(row.original.category) },
    { header: 'Rules', cell: ({ row }) => <span className="text-xs">{row.original.requiresPrescription && <Badge>prescription</Badge>} {row.original.fastingRequired && <Badge>fasting</Badge>} {row.original.sampleType ?? ''}</span> },
    { header: 'Active', cell: ({ row }) => (row.original.isActive ? 'Yes' : 'No') },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => can('catalogue.manage') && <span className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setWords(row.original)}>Edit Words</Button><Button size="sm" variant="ghost" onClick={() => toggle.mutate(row.original)}>{row.original.isActive ? 'Deactivate' : 'Activate'}</Button></span> },
  ];
  return (
    <Card title="Catalogue Services" actions={can('catalogue.manage') && <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>Add Service</Button>}>
      <DataTable<Service> path="/admin/catalogue/services" params={{ q: dq, category }} columns={columns} toolbar={<><Input aria-label="Search Services" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" /><Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-48"><option value="">All Categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></>} />
      <Dialog open={creating} onClose={() => setCreating(false)} title="Add a Catalogue Service" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!f.code || f.name.length < 2}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="Code" required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{title(c)}</option>)}</Select></Field>
          <Field label="Speciality Code"><Input value={f.specialityCode} onChange={(e) => setF({ ...f, specialityCode: e.target.value.toUpperCase() })} /></Field>
          <Field label="Sample Type"><Input value={f.sampleType} onChange={(e) => setF({ ...f, sampleType: e.target.value.toUpperCase() })} /></Field>
          <Field label="Preparation Instructions"><Textarea value={f.preparationInstructions} onChange={(e) => setF({ ...f, preparationInstructions: e.target.value })} /></Field>
          <Checkbox label="Requires a Prescription / Referral" checked={f.requiresPrescription} onChange={(e) => setF({ ...f, requiresPrescription: e.target.checked })} />
          <Checkbox label="Fasting Required" checked={f.fastingRequired} onChange={(e) => setF({ ...f, fastingRequired: e.target.checked })} />
        </div>
      </Dialog>
      {words && <SearchWordsDialog key={words.id} open onClose={() => setWords(null)} title={words.name} words={words.synonyms ?? []} path={`/admin/catalogue/services/${words.id}`} invalidate={['/admin/catalogue/services']} />}
    </Card>
  );
}

interface Medicine { id: string; name: string; genericName: string | null; strength: string | null; dosageForm: string | null; packSize: string | null; manufacturer: string | null; schedule: string; requiresPrescription: boolean; isActive: boolean }

function Medicines() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: '', genericName: '', strength: '', dosageForm: '', packSize: '', manufacturer: '', schedule: 'OTC', requiresPrescription: false });
  const create = useAction(() => api.post('/admin/catalogue/medicines', Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? undefined : v]))), { success: 'Medicine added', invalidate: ['/admin/catalogue/medicines'], onSuccess: () => setCreating(false) });
  const columns: ColumnDef<Medicine, unknown>[] = [
    { header: 'Medicine', cell: ({ row }) => <div><p className="font-medium">{row.original.name} {row.original.strength}</p><p className="text-xs text-grey-500">{[row.original.genericName, row.original.dosageForm, row.original.packSize, row.original.manufacturer].filter(Boolean).join(' · ')}</p></div> },
    { header: 'Schedule', cell: ({ row }) => <Badge>{row.original.schedule}</Badge> },
    { header: 'Prescription', cell: ({ row }) => (row.original.requiresPrescription ? 'Required' : 'OTC') },
  ];
  return (
    <Card title="Medicine Catalogue" actions={can('catalogue.manage') && <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>Add Medicine</Button>}>
      <DataTable<Medicine> path="/admin/catalogue/medicines" params={{ q: dq }} columns={columns} toolbar={<Input aria-label="Search Medicines" placeholder="Brand or generic name" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />} />
      <Dialog open={creating} onClose={() => setCreating(false)} title="Add a Medicine" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={f.name.length < 2}>Add</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['name', 'genericName', 'strength', 'dosageForm', 'packSize', 'manufacturer'] as const).map((k) => <Field key={k} label={title(k.replace(/([A-Z])/g, '_$1'))} required={k === 'name'}><Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          <Field label="Schedule" hint="H, H1 and X always require a prescription"><Select value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })}>{['OTC', 'SCHEDULE_G', 'SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X', 'OTHER'].map((s) => <option key={s} value={s}>{title(s)}</option>)}</Select></Field>
          <div className="flex items-end pb-2"><Checkbox label="Requires Prescription" checked={f.requiresPrescription} onChange={(e) => setF({ ...f, requiresPrescription: e.target.checked })} /></div>
        </div>
      </Dialog>
    </Card>
  );
}
