'use client';

import { useState } from 'react';
import { Eye, EyeOff, GitMerge, Pill, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useGet } from '@/lib/hooks';
import { count, date, dateTime, money } from '@/lib/format';
import { Badge, Button, DescriptionList, Dialog, EmptyState, ErrorState, Field, Input, Select, Skeleton, Tabs, Textarea, cx } from '@/components/ui/primitives';
import { MedicinePhoto } from './medicine-photo';
import { MedicineThumb } from './medicine-thumb';
import { applyWhoCanBuy, HISTORY_LABEL, BULK_LABEL, INFO_FIELDS, medicineTitle, SCHEDULE_LABEL, SCHEDULES, SOURCE_LABEL, WHO_CAN_BUY, whoCanBuyOf, type InfoKey, type Medicine, type WhoCanBuy } from './shared';

interface Detail { medicine: Medicine; stockedAt: number; infoUpdatedByName: string | null; imageAddedByPharmacy?: string | null; hasGovernmentSource: boolean; usage: { inventoryRows: number; orderItems: number } }
interface StockRow { providerId: string; providerName: string; locationId: string; locationName: string; city: string; quantity: number; reserved: number; batches: number; expiredBatches: number; nearestExpiry: string | null; minPriceMinor: number; maxPriceMinor: number; maxMrpMinor: number }
interface Substitutes { compositionKey: string | null; items: { id: string; imageUrl?: string | null; name: string; strength: string | null; dosageForm: string | null; manufacturer: string | null; isActive: boolean; requiresPrescription: boolean; source: string; stockedAt: number }[] }
interface HistoryRow { id: string; action: string; occurredAt: string; actorName: string; metadata: Record<string, unknown> | null }

const PATH = '/admin/catalogue/medicines';
const TABS = [
  { key: 'basic', label: 'Basic Details' },
  { key: 'info', label: 'Information for Patients' },
  { key: 'substitutes', label: 'Substitutes' },
  { key: 'stock', label: 'Where It Is Stocked' },
  { key: 'history', label: 'History' },
];
type QuickAction = 'hide' | 'show' | 'rx' | 'no_rx';
const QUICK: Record<QuickAction, { title: string; message: string; confirm: string }> = {
  hide: { title: 'Hide From Patients', confirm: 'Hide', message: 'Patients will no longer find this medicine in search or be able to order it. Pharmacy stock and past orders are kept, and you can show it again at any time.' },
  show: { title: 'Show To Patients', confirm: 'Show', message: 'Patients will be able to find and order this medicine again.' },
  rx: { title: 'Mark As Prescription Required', confirm: 'Mark Required', message: 'Patients will have to upload a doctor’s prescription before a pharmacy can sell this medicine.' },
  no_rx: { title: 'No Prescription Needed', confirm: 'Remove Requirement', message: 'Patients will be able to order this medicine without a prescription. Only do this for medicines sold over the counter.' },
};

/** The medicine page: plain tabs for details, patient information, substitutes, stock and history, plus actions. */
export function MedicineDialog({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const manage = can('catalogue.manage');
  const [tab, setTab] = useState('basic');
  const [quick, setQuick] = useState<QuickAction | null>(null);
  const [merging, setMerging] = useState(false);
  const detail = useGet<Detail>(`${PATH}/${id}/detail`);
  const d = detail.data;
  const m = d?.medicine;

  return (
    <Dialog open onClose={onClose} size="full" icon={Pill} title={m ? medicineTitle(m) : 'Medicine'} description={m ? [m.composition ?? m.genericName, m.manufacturer].filter(Boolean).join(' · ') : undefined}>
      {detail.isPending ? (
        <Skeleton rows={8} />
      ) : detail.isError || !d || !m ? (
        <ErrorState error={detail.error} retry={() => detail.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge accent={m.isActive ? 'green' : 'red'}>{m.isActive ? 'Shown to Patients' : 'Hidden'}</Badge>
            {m.requiresPrescription ? <Badge accent="purple">Needs Prescription</Badge> : <Badge accent="green">No Prescription Needed</Badge>}
            <Badge accent={m.source === 'PROVIDER' ? 'blue' : 'ink'}>{SOURCE_LABEL[m.source] ?? m.source}</Badge>
            <span className="text-xs text-grey-600">{d.stockedAt ? `Stocked at ${d.stockedAt} ${d.stockedAt === 1 ? 'pharmacy' : 'pharmacies'}` : 'Not in stock anywhere'}</span>
            {manage && (
              <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
                {m.isActive ? <Button size="sm" variant="secondary" onClick={() => setQuick('hide')}><EyeOff size={14} aria-hidden /> Hide From Patients</Button> : <Button size="sm" variant="secondary" onClick={() => setQuick('show')}><Eye size={14} aria-hidden /> Show To Patients</Button>}
                {m.requiresPrescription ? <Button size="sm" variant="secondary" onClick={() => setQuick('no_rx')} disabled={m.schedule === 'SCHEDULE_X'} title={m.schedule === 'SCHEDULE_X' ? 'Narcotic medicines always need a prescription' : undefined}><ShieldOff size={14} aria-hidden /> No Prescription Needed</Button> : <Button size="sm" variant="secondary" onClick={() => setQuick('rx')}><ShieldCheck size={14} aria-hidden /> Mark As Prescription Required</Button>}
                <Button size="sm" variant="secondary" onClick={() => setMerging(true)}><GitMerge size={14} aria-hidden /> Merge Duplicate</Button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto"><Tabs tabs={TABS} active={tab} onChange={setTab} /></div>
          <div className="rounded-[5px] border border-grey-200 bg-paper p-4">
            {tab === 'basic' && (
              <div className="space-y-5">
                <MedicinePhoto m={m} addedByPharmacy={d.imageAddedByPharmacy ?? null} manage={manage} />
                <BasicDetails key={m.id + m.schedule + String(m.requiresPrescription)} m={m} manage={manage} />
              </div>
            )}
            {tab === 'info' && <PatientInfo key={(m.infoUpdatedAt ?? '') + (m.infoSource ?? '')} d={d} manage={manage} />}
            {tab === 'substitutes' && <SubstitutesTab id={id} onOpen={onOpen} />}
            {tab === 'stock' && <StockTab id={id} />}
            {tab === 'history' && <HistoryTab id={id} />}
          </div>
          {quick && <QuickActionDialog m={m} action={quick} onClose={() => setQuick(null)} />}
          {merging && <MergeDialog d={d} onClose={() => setMerging(false)} onOpen={onOpen} />}
        </div>
      )}
    </Dialog>
  );
}

function QuickActionDialog({ m, action, onClose }: { m: Medicine; action: QuickAction; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const q = QUICK[action];
  const body = action === 'hide' ? { isActive: false } : action === 'show' ? { isActive: true } : action === 'rx' ? applyWhoCanBuy('prescription', m.schedule) : applyWhoCanBuy('anyone', m.schedule);
  const save = useAction(() => api.patch(`${PATH}/${m.id}`, { ...body, reason }), { success: `${q.title}: done`, invalidate: [PATH], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={q.title} description={medicineTitle(m)} footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant={action === 'hide' ? 'danger' : 'primary'} onClick={() => save.mutate()} loading={save.isPending} disabled={reason.trim().length < 3}>{q.confirm}</Button></>}>
      <p>{q.message}</p>
      <Field label="Reason" required hint="Saved in this medicine’s history" className="mt-4">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Checked with the pharmacist" autoFocus />
      </Field>
    </Dialog>
  );
}

function BasicDetails({ m, manage }: { m: Medicine; manage: boolean }) {
  const [f, setF] = useState({ name: m.name, composition: m.composition ?? '', genericName: m.genericName ?? '', strength: m.strength ?? '', dosageForm: m.dosageForm ?? '', packSize: m.packSize ?? '', manufacturer: m.manufacturer ?? '', schedule: m.schedule, requiresPrescription: m.requiresPrescription, reason: '' });
  const who = whoCanBuyOf(f.schedule, f.requiresPrescription);
  const choose = (c: WhoCanBuy) => setF({ ...f, ...applyWhoCanBuy(c, f.schedule) });
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  const save = useAction(
    () => api.patch(`${PATH}/${m.id}`, { name: f.name.trim(), composition: blank(f.composition), genericName: blank(f.genericName), strength: blank(f.strength), dosageForm: blank(f.dosageForm), packSize: blank(f.packSize), manufacturer: blank(f.manufacturer), schedule: f.schedule, requiresPrescription: f.requiresPrescription, reason: f.reason }),
    { success: 'Medicine saved', invalidate: [PATH], onSuccess: () => setF((x) => ({ ...x, reason: '' })) },
  );
  const text = (k: 'name' | 'composition' | 'genericName' | 'strength' | 'dosageForm' | 'packSize' | 'manufacturer', label: string, hint?: string, placeholder?: string) => (
    <Field label={label} hint={hint} required={k === 'name'}>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!manage} placeholder={placeholder} />
    </Field>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {text('name', 'Brand Name', undefined, 'e.g. Dolo 650')}
        {text('composition', 'Salt / Composition', 'The active ingredients. Separate several with “and”.', 'e.g. Paracetamol')}
        {text('strength', 'Strength', undefined, 'e.g. 650 mg')}
        {text('dosageForm', 'Form', undefined, 'e.g. Tablet, Syrup, Injection')}
        {text('packSize', 'Pack Size', undefined, 'e.g. Strip of 15 Tablets')}
        {text('manufacturer', 'Manufacturer', undefined, 'e.g. Micro Labs')}
        {text('genericName', 'Generic Name', 'Optional. The full generic description.')}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Who Can Buy It</legend>
        <div className="mt-2 grid gap-2 lg:grid-cols-3">
          {WHO_CAN_BUY.map((o) => (
            <label key={o.value} className={cx('flex cursor-pointer gap-3 rounded-[5px] border p-3', who === o.value ? 'border-ink bg-grey-50' : 'border-grey-200', !manage && 'cursor-default opacity-80')}>
              <input type="radio" name={`who-${m.id}`} className="mt-1 h-4 w-4 accent-black" checked={who === o.value} onChange={() => choose(o.value)} disabled={!manage} />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-grey-600">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        <details className="mt-2 text-xs text-grey-600">
          <summary className="cursor-pointer">Legal schedule code (for pharmacists): {SCHEDULE_LABEL[f.schedule] ?? f.schedule}</summary>
          <div className="mt-2 max-w-xs">
            <Select aria-label="Schedule Code" value={f.schedule} disabled={!manage} onChange={(e) => setF({ ...f, schedule: e.target.value, requiresPrescription: f.requiresPrescription || ['SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X'].includes(e.target.value) })}>
              {SCHEDULES.map((s) => <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>)}
            </Select>
            <p className="mt-1">Schedule H, H1 and X always need a prescription.</p>
          </div>
        </details>
      </fieldset>

      {manage && (
        <div className="flex flex-col gap-2 border-t border-grey-100 pt-4 sm:flex-row sm:items-end">
          <Field label="Reason for the Change" required hint="Saved in the history" className="flex-1">
            <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Corrected strength from the pack" />
          </Field>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={f.name.trim().length < 2 || f.reason.trim().length < 3}>Save Changes</Button>
        </div>
      )}

      <details className="rounded-[5px] border border-grey-200 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Codes and Technical Details</summary>
        <div className="mt-3">
          <DescriptionList
            items={[
              { label: 'Where It Came From', value: SOURCE_LABEL[m.source] ?? m.source },
              { label: 'Government Brand Code (CDCI)', value: <span className="font-mono text-xs">{m.code ?? '—'}</span> },
              { label: 'Government Generic Code (CDCI)', value: <span className="font-mono text-xs">{m.genericCode ?? '—'}</span> },
              { label: 'Route', value: m.route ?? '—' },
              { label: 'Substitute Group Key', value: <span className="font-mono text-xs">{m.compositionKey ?? '—'}</span> },
              { label: 'Added On', value: dateTime(m.createdAt) },
              { label: 'Added by Pharmacy (ID)', value: <span className="font-mono text-xs">{m.proposedByProviderId ?? '—'}</span> },
              { label: 'Catalogue ID', value: <span className="font-mono text-xs">{m.id}</span> },
            ]}
          />
        </div>
      </details>
    </div>
  );
}

function PatientInfo({ d, manage }: { d: Detail; manage: boolean }) {
  const m = d.medicine;
  const [f, setF] = useState<Record<InfoKey, string>>(() => ({ therapeuticClass: m.therapeuticClass ?? '', ...Object.fromEntries(INFO_FIELDS.map((x) => [x.key, m[x.key] ?? ''])) }) as Record<InfoKey, string>);
  const [restoring, setRestoring] = useState(false);
  const [preview, setPreview] = useState(false);
  const save = useAction(() => api.put(`${PATH}/${m.id}/info`, f), { success: 'Patient information saved', invalidate: [PATH] });
  const restore = useAction(() => api.post<{ data: { restored: 'now' | 'next_update' } }>(`${PATH}/${m.id}/info/restore`, {}), {
    invalidate: [PATH],
    onSuccess: () => setRestoring(false),
  });
  const sourceLine =
    m.infoSource === 'ADMIN'
      ? `Edited by ${d.infoUpdatedByName ?? 'an admin'} on ${date(m.infoUpdatedAt)}`
      : m.infoSource === 'CDCI'
        ? 'Filled from the government list'
        : 'No information yet';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge accent={m.infoSource === 'ADMIN' ? 'blue' : m.infoSource === 'CDCI' ? 'green' : 'orange'}>{sourceLine}</Badge>
        {restore.data?.data.restored === 'next_update' && <span className="text-xs text-grey-600">The government text will come back at the next update of the medicine list.</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>{preview ? 'Back to Editing' : 'Preview as Patient'}</Button>
          {manage && d.hasGovernmentSource && m.infoSource === 'ADMIN' && <Button size="sm" variant="secondary" onClick={() => setRestoring(true)}>Use Government Text</Button>}
        </div>
      </div>

      {preview ? (
        <PatientPreview m={m} f={f} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Medicine Type" hint="A simple group name patients understand." className="lg:col-span-2">
            <Input value={f.therapeuticClass} onChange={(e) => setF({ ...f, therapeuticClass: e.target.value })} disabled={!manage} placeholder="e.g. Pain Reliever and Fever Reducer" maxLength={120} />
          </Field>
          {INFO_FIELDS.map((x) => (
            <Field key={x.key} label={x.label} hint={x.hint}>
              <Textarea rows={3} value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} disabled={!manage} placeholder={`Example: ${x.example}`} maxLength={4000} />
            </Field>
          ))}
        </div>
      )}
      {manage && !preview && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-grey-100 pt-4">
          <p className="mr-auto text-xs text-grey-500">Saving marks this text as edited by Carevanta, so government updates will not replace it.</p>
          <Button onClick={() => save.mutate()} loading={save.isPending}>Save Information</Button>
        </div>
      )}
      <Dialog open={restoring} onClose={() => setRestoring(false)} title="Use Government Text" footer={<><Button variant="ghost" onClick={() => setRestoring(false)} disabled={restore.isPending}>Cancel</Button><Button onClick={() => restore.mutate()} loading={restore.isPending}>Use Government Text</Button></>}>
        <p>Your edited text will be replaced by the text from the government medicine list. If the government text is not available right now, the fields stay empty until the next update of the list.</p>
      </Dialog>
    </div>
  );
}

function PatientPreview({ m, f }: { m: Medicine; f: Record<InfoKey, string> }) {
  const filled = INFO_FIELDS.filter((x) => f[x.key].trim());
  return (
    <article className="mx-auto max-w-md rounded-[5px] border border-grey-200 bg-canvas p-4 text-sm" aria-label="Patient Preview">
      <p className="text-xs text-grey-500">How patients see it</p>
      <h3 className="mt-1 text-base font-semibold">{medicineTitle(m)}</h3>
      <p className="text-xs text-grey-600">{[m.composition, m.manufacturer].filter(Boolean).join(' · ')}</p>
      {f.therapeuticClass.trim() && <p className="mt-1 text-xs font-medium text-grey-700">{f.therapeuticClass}</p>}
      {m.requiresPrescription && <p className="mt-2 inline-block rounded-[5px] bg-purple-soft px-2 py-0.5 text-[11px] font-semibold text-purple">Prescription Required</p>}
      {filled.length === 0 ? (
        <p className="mt-3 text-grey-500">No information yet. Patients only see the name and salt.</p>
      ) : (
        filled.map((x) => (
          <section key={x.key} className="mt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-grey-600">{x.label}</h4>
            <p className="mt-0.5 whitespace-pre-line">{f[x.key]}</p>
          </section>
        ))
      )}
      <p className="mt-4 border-t border-grey-200 pt-2 text-[11px] text-grey-500">
        {m.infoSource === 'ADMIN' ? 'Information edited by Carevanta.' : 'Information from Common Drug Codes for India (CDCI), Government of India.'} This is general information, not medical advice. Ask your doctor or pharmacist.
      </p>
    </article>
  );
}

function SubstitutesTab({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const subs = useGet<Substitutes>(`${PATH}/${id}/substitutes`);
  if (subs.isPending) return <Skeleton rows={4} />;
  if (subs.isError || !subs.data) return <ErrorState error={subs.error} retry={() => subs.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-grey-700">Other brands with the same salt, strength and form. This is information only: Carevanta never swaps a medicine on its own.</p>
      <p className="rounded-[5px] bg-orange-soft px-3 py-2 text-xs text-orange">Ask your doctor or pharmacist before switching to a substitute.</p>
      {subs.data.items.length === 0 ? (
        <EmptyState title="No Substitutes Found" description={subs.data.compositionKey ? 'No other brand has the same salt, strength and form.' : 'Add the salt, strength and form on Basic Details to find substitutes.'} />
      ) : (
        <ul className="divide-y divide-grey-200 rounded-[5px] border border-grey-200">
          {subs.data.items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <MedicineThumb imageUrl={s.imageUrl} dosageForm={s.dosageForm} name={s.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{medicineTitle(s)}</p>
                <p className="text-xs text-grey-500">{s.manufacturer ?? 'Manufacturer not recorded'}</p>
              </div>
              {!s.isActive && <Badge accent="red">Hidden</Badge>}
              <span className="text-xs text-grey-600">{s.stockedAt ? `Stocked at ${s.stockedAt}` : 'Not in stock'}</span>
              <Button size="sm" variant="ghost" onClick={() => onOpen(s.id)}>Open</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StockTab({ id }: { id: string }) {
  const stock = useGet<StockRow[]>(`${PATH}/${id}/stock`);
  if (stock.isPending) return <Skeleton rows={4} />;
  if (stock.isError || !stock.data) return <ErrorState error={stock.error} retry={() => stock.refetch()} />;
  if (!stock.data.length) return <EmptyState title="No Pharmacy Stocks This Medicine" description="Pharmacies add stock from their portal." />;
  const price = (r: StockRow) => (r.minPriceMinor === r.maxPriceMinor ? money(r.minPriceMinor) : `${money(r.minPriceMinor)} – ${money(r.maxPriceMinor)}`);
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {stock.data.map((r) => (
        <li key={r.locationId} className="rounded-[5px] border border-grey-200 p-3 text-sm">
          <p className="font-medium">{r.providerName}</p>
          <p className="text-xs text-grey-500">{[r.locationName, r.city].filter(Boolean).join(', ')}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-grey-500">Quantity</dt><dd className="tnum">{count(r.quantity)}{r.reserved ? ` (${count(r.reserved)} held for orders)` : ''}</dd>
            <dt className="text-grey-500">Batches</dt><dd>{r.batches}{r.expiredBatches ? ` (${r.expiredBatches} expired)` : ''}</dd>
            <dt className="text-grey-500">Nearest Expiry</dt><dd>{r.nearestExpiry ? date(r.nearestExpiry) : '—'}</dd>
            <dt className="text-grey-500">Selling Price</dt><dd>{price(r)}</dd>
            <dt className="text-grey-500">Highest MRP</dt><dd>{money(r.maxMrpMinor)}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function historyDetail(h: HistoryRow): string {
  const md = h.metadata ?? {};
  const parts: string[] = [];
  if (typeof md.bulkAction === 'string') parts.push(BULK_LABEL[md.bulkAction] ?? md.bulkAction);
  if (Array.isArray(md.fields) && md.fields.length) parts.push(`Changed: ${md.fields.join(', ')}`);
  if (md.restored === 'next_update') parts.push('Text returns at the next list update');
  if (typeof md.keptName === 'string') parts.push(`Kept: ${md.keptName}`);
  if (typeof md.mergedName === 'string') parts.push(`Merged in: ${md.mergedName}`);
  if (typeof md.reason === 'string' && md.reason) parts.push(`Reason: ${md.reason}`);
  return parts.join(' · ');
}

function HistoryTab({ id }: { id: string }) {
  const hist = useGet<HistoryRow[]>(`${PATH}/${id}/history`);
  if (hist.isPending) return <Skeleton rows={4} />;
  if (hist.isError || !hist.data) return <ErrorState error={hist.error} retry={() => hist.refetch()} />;
  if (!hist.data.length) return <EmptyState title="No Changes Yet" description="Changes made here or by pharmacies appear in this list. Government list updates are not listed per medicine." />;
  return (
    <ol className="space-y-3">
      {hist.data.map((h) => (
        <li key={h.id} className="border-l-2 border-grey-200 pl-3 text-sm">
          <p className="font-medium">{HISTORY_LABEL[h.action] ?? h.action}</p>
          <p className="text-xs text-grey-500">{h.actorName} · {dateTime(h.occurredAt)}</p>
          {historyDetail(h) && <p className="mt-0.5 text-xs text-grey-700">{historyDetail(h)}</p>}
        </li>
      ))}
    </ol>
  );
}

function MergeDialog({ d, onClose, onOpen }: { d: Detail; onClose: () => void; onOpen: (id: string) => void }) {
  const m = d.medicine;
  const [q, setQ] = useState(m.name);
  const dq = useDebounced(q.trim());
  const [keep, setKeep] = useState<Medicine | null>(null);
  const [reason, setReason] = useState('');
  const blocked = d.usage.inventoryRows > 0 || d.usage.orderItems > 0;
  const results = useGet<Medicine[]>(!blocked && dq.length >= 2 ? `${PATH}${qs({ q: dq, visibility: 'shown', limit: 10 })}` : null);
  const merge = useAction(() => api.post(`${PATH}/${m.id}/merge`, { keepId: keep?.id, reason }), {
    success: 'Duplicate merged and hidden',
    invalidate: [PATH],
    onSuccess: () => {
      onClose();
      if (keep) onOpen(keep.id);
    },
  });
  const options = (results.data ?? []).filter((r) => r.id !== m.id);
  return (
    <Dialog open onClose={onClose} title="Merge Duplicate" description={`Duplicate: ${medicineTitle(m)}`} footer={<><Button variant="ghost" onClick={onClose} disabled={merge.isPending}>Cancel</Button>{!blocked && <Button onClick={() => merge.mutate()} loading={merge.isPending} disabled={!keep || reason.trim().length < 3}>Merge</Button>}</>}>
      {blocked ? (
        <div className="space-y-2">
          <p className="font-medium">This medicine cannot be merged.</p>
          <p className="text-grey-700">
            {d.usage.inventoryRows > 0 && `Pharmacies have ${d.usage.inventoryRows} stock ${d.usage.inventoryRows === 1 ? 'entry' : 'entries'} for it. `}
            {d.usage.orderItems > 0 && `${d.usage.orderItems} order ${d.usage.orderItems === 1 ? 'line uses' : 'lines use'} it. `}
            Orders always keep the medicine the patient chose, and stock belongs to the pharmacy, so neither is moved automatically.
          </p>
          <p className="text-grey-700">Instead, hide it from patients, and ask the pharmacies to add their stock under the medicine you want to keep.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p>Choose the medicine to keep. This duplicate will be hidden from patients and pharmacies, and both medicines record the merge in their history.</p>
          <Field label="Find the Medicine to Keep">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by brand or salt" />
          </Field>
          {results.isFetching && <Skeleton rows={2} />}
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {options.map((r) => (
              <li key={r.id}>
                <label className={cx('flex cursor-pointer items-start gap-2 rounded-[5px] border p-2', keep?.id === r.id ? 'border-ink bg-grey-50' : 'border-grey-200')}>
                  <input type="radio" name="keep" className="mt-1 accent-black" checked={keep?.id === r.id} onChange={() => setKeep(r)} />
                  <span>
                    <span className="block font-medium">{medicineTitle(r)}</span>
                    <span className="block text-xs text-grey-500">{[r.composition, r.manufacturer, SOURCE_LABEL[r.source]].filter(Boolean).join(' · ')}</span>
                  </span>
                </label>
              </li>
            ))}
            {!results.isFetching && dq.length >= 2 && options.length === 0 && <li className="text-xs text-grey-500">No other visible medicine matches.</li>}
          </ul>
          <Field label="Reason" required hint="Saved in both medicines’ history">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Same medicine added twice" />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
