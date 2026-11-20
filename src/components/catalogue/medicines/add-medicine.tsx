'use client';

import { useState } from 'react';
import { Pill } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAction, useDebounced, useGet } from '@/lib/hooks';
import { Button, Dialog, Field, Input, Stepper, cx } from '@/components/ui/primitives';
import { applyWhoCanBuy, WHO_CAN_BUY, whoCanBuyOf, type Medicine, type WhoCanBuy } from './shared';

interface Duplicate { id: string; name: string; strength: string | null; dosageForm: string | null; manufacturer: string | null; composition: string | null; isActive: boolean; exact: boolean }
const PATH = '/admin/catalogue/medicines';

/** Guided "Add Medicine": what it is (with a duplicate check), then who can buy it and the pack details. */
export function AddMedicineDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: '', composition: '', strength: '', dosageForm: '', packSize: '', manufacturer: '', genericName: '', schedule: 'OTC', requiresPrescription: false });
  const who = whoCanBuyOf(f.schedule, f.requiresPrescription);
  const name = useDebounced(f.name.trim(), 400);
  const strength = useDebounced(f.strength.trim(), 400);
  const form = useDebounced(f.dosageForm.trim(), 400);
  const dups = useGet<Duplicate[]>(name.length >= 2 ? `${PATH}/duplicates${qs({ name, strength, dosageForm: form })}` : null);
  const create = useAction(
    () => api.post<{ data: Medicine }>(PATH, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || undefined : v]))),
    { success: 'Medicine added', invalidate: [PATH], onSuccess: (res) => onOpen(res.data.id) },
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const exact = dups.data?.find((d) => d.exact);
  const footer =
    step === 1 ? (
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => setStep(2)} disabled={f.name.trim().length < 2}>{exact ? 'Add Anyway' : 'Next'}</Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setStep(1)} disabled={create.isPending}>Back</Button>
        <Button onClick={() => create.mutate()} loading={create.isPending}>Add Medicine</Button>
      </>
    );
  return (
    <Dialog open onClose={onClose} title="Add Medicine" icon={Pill} wide footer={footer}>
      <Stepper steps={['What Is It', 'Who Can Buy It']} current={step} />
      {step === 1 ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Brand Name" required><Input value={f.name} onChange={set('name')} placeholder="e.g. Dolo 650" autoFocus /></Field>
            <Field label="Salt / Composition" hint="Separate several with “and”."><Input value={f.composition} onChange={set('composition')} placeholder="e.g. Paracetamol" /></Field>
            <Field label="Strength"><Input value={f.strength} onChange={set('strength')} placeholder="e.g. 650 mg" /></Field>
            <Field label="Form"><Input value={f.dosageForm} onChange={set('dosageForm')} placeholder="e.g. Tablet" /></Field>
          </div>
          {!!dups.data?.length && (
            <div role="status" className="rounded-[5px] border border-orange/30 bg-orange-soft p-3 text-sm">
              <p className="font-medium text-orange">{exact ? 'Looks like this already exists:' : 'Similar medicines already in the catalogue:'}</p>
              <ul className="mt-2 space-y-1">
                {dups.data.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className={cx(d.exact && 'font-medium')}>{[d.name, d.strength, d.dosageForm].filter(Boolean).join(' ')}{d.manufacturer ? ` (${d.manufacturer})` : ''}{d.isActive ? '' : ' · Hidden'}</span>
                    <Button size="sm" variant="secondary" onClick={() => onOpen(d.id)}>Open It</Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-grey-700">If it is the same medicine, open it instead of adding a copy.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">Who Can Buy It</legend>
            <div className="mt-2 space-y-2">
              {WHO_CAN_BUY.map((o) => (
                <label key={o.value} className={cx('flex cursor-pointer gap-3 rounded-[5px] border p-3', who === o.value ? 'border-ink bg-grey-50' : 'border-grey-200')}>
                  <input type="radio" name="add-who" className="mt-1 h-4 w-4 accent-black" checked={who === o.value} onChange={() => setF({ ...f, ...applyWhoCanBuy(o.value as WhoCanBuy, f.schedule) })} />
                  <span>
                    <span className="block text-sm font-medium">{o.label}</span>
                    <span className="block text-xs text-grey-600">{o.help}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-grey-500">You can set the exact legal schedule later on the medicine’s Basic Details.</p>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Manufacturer"><Input value={f.manufacturer} onChange={set('manufacturer')} placeholder="e.g. Micro Labs" /></Field>
            <Field label="Pack Size"><Input value={f.packSize} onChange={set('packSize')} placeholder="e.g. Strip of 15 Tablets" /></Field>
            <Field label="Generic Name" hint="Optional" className="sm:col-span-2"><Input value={f.genericName} onChange={set('genericName')} placeholder="e.g. Paracetamol 650 mg oral tablet" /></Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}
