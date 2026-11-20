'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, EyeOff, FileWarning, ImageOff, Package, Pill, Plus, RefreshCw, Store, Stethoscope } from 'lucide-react';
import { api, qs, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useGet } from '@/lib/hooks';
import { count } from '@/lib/format';
import { ACCENT, Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, Skeleton, cx, type Accent } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { MedicineSyncPanel } from '@/components/catalogue/medicine-sync';
import { FilterChip } from './filter-chip';
import { MedicineThumb } from './medicine-thumb';
import { MedicineDialog } from './medicine-dialog';
import { AddMedicineDialog } from './add-medicine';
import { ATTRIBUTION, BULK_LABEL, hasInfo, type Medicine } from './shared';

interface Overview { total: number; stocked: number; addedByPharmaciesLast30Days: number; missingInfo: number; prescriptionRequired: number; hidden: number; withoutPhoto?: number; addedSince: string }
interface Filters { source: string; prescription: string; visibility: string; hasInfo: string; inStock: string; hasPhoto: string; addedSince: string }
const NO_FILTERS: Filters = { source: '', prescription: '', visibility: '', hasInfo: '', inStock: '', hasPhoto: '', addedSince: '' };
type BulkAction = 'hide' | 'show' | 'require_prescription' | 'no_prescription';
const PATH = '/admin/catalogue/medicines';
const PAGE_SIZE = 25;
const MAX_BULK = 200;

const BULK_EXPLAIN: Record<BulkAction, string> = {
  hide: 'Patients will no longer find these medicines in search or be able to order them. Pharmacy stock and past orders are kept, and you can show them again at any time.',
  show: 'Patients will be able to find and order these medicines again.',
  require_prescription: 'Patients will have to upload a doctor’s prescription before a pharmacy can sell these medicines.',
  no_prescription: 'Patients will be able to order these medicines without a prescription. Narcotic (Schedule X) medicines are skipped and always need one.',
};

/** Medicines tab: overview tiles, plain filters, a list that becomes cards on phones, bulk actions and the medicine page. */
export function MedicinesTab() {
  const { can } = useAuth();
  const manage = can('catalogue.manage');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [reason, setReason] = useState('');
  const overview = useGet<Overview>(`${PATH}/overview`);
  const toast = useToast();

  const params = useMemo(() => ({ q: dq.length >= 2 ? dq : undefined, ...filters }), [dq, filters]);
  const paramKey = JSON.stringify(params);
  // Pages restart whenever the search or filters change.
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({ key: paramKey, cursors: [null] });
  const cursors = pager.key === paramKey ? pager.cursors : [null];
  const setCursors = (fn: (c: (string | null)[]) => (string | null)[]) => setPager({ key: paramKey, cursors: fn(cursors) });
  const cursor = cursors[cursors.length - 1] ?? null;
  const list = useQuery({
    queryKey: ['table', PATH, paramKey, cursor, PAGE_SIZE],
    queryFn: ({ signal }) => api.get<Page<Medicine>>(`${PATH}${qs({ ...params, limit: PAGE_SIZE, cursor: cursor ?? undefined })}`, signal),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.data ?? [];

  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const activeCount = Object.values(filters).filter(Boolean).length;
  const tile = (preset: Partial<Filters>) => {
    setFilters({ ...NO_FILTERS, ...preset });
    setQ('');
  };
  const isTile = (preset: Partial<Filters>) => JSON.stringify({ ...NO_FILTERS, ...preset }) === JSON.stringify(filters);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < MAX_BULK) n.add(id);
      return n;
    });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPage) rows.forEach((r) => n.delete(r.id));
      else for (const r of rows) if (n.size < MAX_BULK) n.add(r.id);
      return n;
    });

  const runBulk = useAction(
    () => api.post<{ data: { updated: number; skipped: { id: string; reason: string }[] } }>(`${PATH}/bulk`, { ids: [...selected], action: bulk, reason }),
    {
      invalidate: [PATH],
      onSuccess: (res) => {
        setBulk(null);
        setReason('');
        setSelected(new Set());
        const skipped = res.data.skipped.length;
        toast.success(`${count(res.data.updated)} ${res.data.updated === 1 ? 'medicine' : 'medicines'} updated${skipped ? `, ${skipped} skipped (narcotic or not found)` : ''}`);
      },
    },
  );

  const o = overview.data;
  const tiles: { label: string; value?: number; hint: string; icon: typeof Pill; accent: Accent; preset: Partial<Filters> }[] = [
    { label: 'Medicines in Catalogue', value: o?.total, hint: 'Everything patients and pharmacies can pick from', icon: Pill, accent: 'ink', preset: {} },
    { label: 'Stocked by at Least One Pharmacy', value: o?.stocked, hint: 'In stock and not expired', icon: Store, accent: 'green', preset: { inStock: 'yes' } },
    { label: 'Added by Pharmacies (Last 30 Days)', value: o?.addedByPharmaciesLast30Days, hint: 'Worth a quick check', icon: Package, accent: 'blue', preset: { source: 'PROVIDER', addedSince: o?.addedSince ?? '' } },
    { label: 'Missing Information', value: o?.missingInfo, hint: 'No “Uses” text for patients yet', icon: FileWarning, accent: 'orange', preset: { hasInfo: 'no' } },
    { label: 'Prescription Required', value: o?.prescriptionRequired, hint: 'Patients must upload a prescription', icon: Stethoscope, accent: 'purple', preset: { prescription: 'required' } },
    { label: 'Hidden From Patients', value: o?.hidden, hint: 'Not shown in search or ordering', icon: EyeOff, accent: 'red', preset: { visibility: 'hidden' } },
    { label: 'Medicines Without a Photo', value: o?.withoutPhoto, hint: 'Patients see a plain icon instead', icon: ImageOff, accent: 'teal', preset: { hasPhoto: 'no' } },
  ];

  return (
    <div className="space-y-4">
      <section aria-label="Overview" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        {tiles.map((t) => {
          const active = isTile(t.preset) && (t.label === 'Medicines in Catalogue' ? activeCount === 0 && !q : true);
          return (
            <button key={t.label} type="button" onClick={() => tile(t.preset)} aria-pressed={active} className={cx('min-w-0 rounded-[5px] border bg-paper p-3 text-left transition-colors hover:border-ink sm:p-4', active ? 'border-ink ring-1 ring-ink' : 'border-grey-200')}>
              <div className="flex items-center gap-2">
                <t.icon size={16} aria-hidden className={cx('shrink-0', ACCENT[t.accent].text)} />
                <span className="tnum truncate text-xl font-bold sm:text-2xl">{overview.isPending ? '…' : count(t.value)}</span>
              </div>
              <p className="mt-1 text-xs font-medium leading-snug text-grey-800 sm:text-sm">{t.label}</p>
              <p className="mt-0.5 hidden text-[11px] text-grey-500 sm:block">{t.hint}</p>
            </button>
          );
        })}
      </section>

      {manage && <MedicineSyncPanel />}

      <section className="rounded-[5px] border border-grey-200 bg-paper p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Search Medicines" type="search" placeholder="Search by brand or salt, e.g. Dolo or Paracetamol" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-96" />
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" aria-label="Refresh" onClick={() => { void list.refetch(); void overview.refetch(); }}><RefreshCw size={14} aria-hidden /></Button>
            {manage && <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} aria-hidden /> Add Medicine</Button>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilterChip label="Source" value={filters.source} onChange={(v) => setFilter('source', v)} options={[{ value: 'CDCI', label: 'Government List' }, { value: 'PROVIDER', label: 'Added by Pharmacy' }, { value: 'MANUAL', label: 'Added by Admin' }]} />
          <FilterChip label="Prescription" value={filters.prescription} onChange={(v) => setFilter('prescription', v)} options={[{ value: 'required', label: 'Needs Prescription' }, { value: 'not_required', label: 'No Prescription Needed' }]} />
          <FilterChip label="Visibility" value={filters.visibility} onChange={(v) => setFilter('visibility', v)} options={[{ value: 'shown', label: 'Shown to Patients' }, { value: 'hidden', label: 'Hidden from Patients' }]} />
          <FilterChip label="Has Information" value={filters.hasInfo} onChange={(v) => setFilter('hasInfo', v)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No, Missing' }]} />
          <FilterChip label="In Stock" value={filters.inStock} onChange={(v) => setFilter('inStock', v)} options={[{ value: 'yes', label: 'At Some Pharmacy' }, { value: 'no', label: 'Nowhere' }]} />
          <FilterChip label="Photo" value={filters.hasPhoto} onChange={(v) => setFilter('hasPhoto', v)} options={[{ value: 'yes', label: 'Has Photo' }, { value: 'no', label: 'No Photo' }]} />
          {filters.addedSince && <Badge accent="blue">Added in the Last 30 Days</Badge>}
          {(activeCount > 0 || q) && <Button variant="ghost" size="sm" onClick={() => { setFilters(NO_FILTERS); setQ(''); }}>Clear All</Button>}
        </div>

        {manage && selected.size > 0 && (
          <div role="region" aria-label="Bulk Actions" className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-[5px] bg-ink px-3 py-2 text-sm text-paper">
            <span className="font-medium">{selected.size} Selected{selected.size >= MAX_BULK ? ' (Maximum)' : ''}</span>
            <span className="flex flex-wrap gap-1">
              {(['hide', 'show', 'require_prescription', 'no_prescription'] as const).map((a) => (
                <button key={a} type="button" onClick={() => setBulk(a)} className="h-9 rounded-[5px] bg-white/10 px-2.5 text-xs hover:bg-white/20">
                  {{ hide: 'Hide From Patients', show: 'Show To Patients', require_prescription: 'Mark As Prescription Required', no_prescription: 'No Prescription Needed' }[a]}
                </button>
              ))}
            </span>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto h-9 px-2 text-xs text-grey-300 hover:text-paper">Clear Selection</button>
          </div>
        )}
        <div className="mt-3">
          {list.isPending ? (
            <Skeleton rows={6} />
          ) : list.isError ? (
            <ErrorState error={list.error} retry={() => list.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title="No Medicines Match" description={q || activeCount ? 'Try a shorter search word or clear a filter.' : 'Load the government medicine list above, or add a medicine.'} />
          ) : (
            <div className={cx('overflow-hidden rounded-[5px] border border-grey-200', list.isFetching && 'opacity-60')}>
              <div className="hidden grid-cols-[2rem_minmax(0,1fr)_12rem_9rem] items-center gap-3 bg-grey-50 px-3 py-2 text-xs font-medium text-grey-600 md:grid">
                {manage ? <input type="checkbox" aria-label="Select All on This Page" checked={allOnPage} onChange={togglePage} className="h-4 w-4 accent-black" /> : <span />}
                <span>Medicine</span>
                <span>Made By</span>
                <span>Pharmacies</span>
              </div>
              <ul>
                {rows.map((m) => (
                  <li key={m.id} className="border-t border-grey-200 first:border-t-0 md:first:border-t">
                    <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-3 py-3 hover:bg-grey-50 md:grid-cols-[2rem_minmax(0,1fr)_12rem_9rem] md:items-center">
                      {manage ? <input type="checkbox" aria-label={`Select ${m.name}`} checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="mt-1 h-4 w-4 accent-black md:mt-0" /> : <span />}
                      <button type="button" onClick={() => setOpenId(m.id)} className="flex min-w-0 items-start gap-3 text-left">
                        <MedicineThumb imageUrl={m.imageUrl} dosageForm={m.dosageForm} name={m.name} />
                        <span className="min-w-0">
                        <span className="block font-medium text-ink">
                          {m.name} {m.strength && <span className="font-normal text-grey-700">{m.strength}</span>} {m.dosageForm && <span className="font-normal text-grey-500">· {m.dosageForm}</span>}
                        </span>
                        <span className="block truncate text-xs text-grey-500">{m.composition ?? m.genericName ?? 'Salt not recorded'}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {m.requiresPrescription && <Badge accent="purple">Needs Prescription</Badge>}
                          {!m.isActive && <Badge accent="red">Hidden</Badge>}
                          {m.source === 'PROVIDER' && <Badge accent="blue">Added by Pharmacy</Badge>}
                          {m.source === 'MANUAL' && <Badge accent="ink">Added by Admin</Badge>}
                          {!hasInfo(m) && <Badge accent="orange">Info Missing</Badge>}
                        </span>
                        </span>
                      </button>
                      <span className="col-start-2 truncate text-xs text-grey-700 md:col-start-auto md:text-sm">{m.manufacturer ?? '—'}</span>
                      <span className="col-start-2 text-xs md:col-start-auto md:text-sm">
                        {m.stockedAt ? <span className="text-green">Stocked at {m.stockedAt} {m.stockedAt === 1 ? 'pharmacy' : 'pharmacies'}</span> : <span className="text-grey-500">Not in stock</span>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-grey-600">
          <span>
            {rows.length ? `${rows.length} on this page` : ''}
            {cursors.length > 1 ? ` · Page ${cursors.length}` : ''}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setCursors((c) => c.slice(0, -1))} disabled={cursors.length <= 1 || list.isFetching}><ChevronLeft size={14} aria-hidden /> Previous</Button>
            <Button variant="secondary" size="sm" onClick={() => setCursors((c) => [...c, list.data?.page.nextCursor ?? null])} disabled={!list.data?.page.hasMore || list.isFetching}>Next <ChevronRight size={14} aria-hidden /></Button>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-grey-500">
          {ATTRIBUTION} Brand names belong to their owners. The government list has no prescription rules, so its medicines start as “Needs a Prescription and Pharmacist Check”; open a medicine to relax it.
        </p>
      </section>

      {openId && <MedicineDialog key={openId} id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />}
      {adding && <AddMedicineDialog onClose={() => setAdding(false)} onOpen={(id) => { setAdding(false); setOpenId(id); }} />}
      <Dialog
        open={!!bulk}
        onClose={() => setBulk(null)}
        title={bulk ? `${BULK_LABEL[bulk]}: ${selected.size} ${selected.size === 1 ? 'Medicine' : 'Medicines'}` : 'Bulk Change'}
        footer={<><Button variant="ghost" onClick={() => setBulk(null)} disabled={runBulk.isPending}>Cancel</Button><Button variant={bulk === 'hide' ? 'danger' : 'primary'} onClick={() => runBulk.mutate()} loading={runBulk.isPending} disabled={reason.trim().length < 3}>Apply to {selected.size}</Button></>}
      >
        <p>{bulk ? BULK_EXPLAIN[bulk] : ''}</p>
        <Field label="Reason" required hint="Saved in each medicine’s history" className="mt-4">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Checked with the pharmacist" />
        </Field>
      </Dialog>
    </div>
  );
}
