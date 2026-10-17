'use client';

import { useId, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Field, Input, Select, cx } from '@/components/ui/primitives';
import { HOME_COUNTRY, isPincode, lookupPincode, matchState, useCities, useStates, type PincodeInfo } from '@/lib/geo';

export interface AddressValue {
  pincode: string;
  stateCode: string;
  state: string;
  district: string;
  city: string;
  locality: string;
}
export const EMPTY_ADDRESS: AddressValue = { pincode: '', stateCode: '', state: '', district: '', city: '', locality: '' };

interface Props {
  value: AddressValue;
  onChange: (patch: Partial<AddressValue>) => void;
  errors?: Partial<Record<keyof AddressValue, string | undefined>>;
  /** Which optional fields to render (state and district are always shown). */
  show?: { pincode?: boolean; city?: boolean; locality?: boolean };
  required?: boolean;
  country?: string;
  className?: string;
}

/**
 * Address fields driven entirely by reference data: states and cities from the
 * API's ISO dataset, and PIN-code auto-fill from the India Post directory.
 * City and locality accept free text with suggestions, because small towns and
 * villages are often missing from any dataset.
 */
export function LocationFields({ value, onChange, errors = {}, show = { pincode: true, city: true, locality: true }, required, country = HOME_COUNTRY, className }: Props) {
  const states = useStates(country);
  const cities = useCities(value.stateCode || undefined, country);
  const [pin, setPin] = useState<{ status: 'idle' | 'loading' | 'found' | 'unknown'; info?: PincodeInfo }>({ status: 'idle' });
  const seq = useRef(0);
  const id = useId();

  const onPincode = async (raw: string) => {
    const p = raw.replace(/\D/g, '').slice(0, 6);
    onChange({ pincode: p });
    if (!isPincode(p)) { setPin({ status: 'idle' }); return; }
    const my = ++seq.current;
    setPin({ status: 'loading' });
    const info = await lookupPincode(p);
    if (my !== seq.current) return;
    if (!info) { setPin({ status: 'unknown' }); return; }
    const st = matchState(states.data, info.state);
    const patch: Partial<AddressValue> = { district: info.district, state: st?.name ?? info.state, stateCode: st?.code ?? value.stateCode };
    if (!value.city && info.block) patch.city = info.block;
    onChange(patch);
    setPin({ status: 'found', info });
  };

  const onState = (code: string) => {
    const st = states.data?.find((s) => s.code === code);
    onChange({ stateCode: code, state: st?.name ?? '', city: '', district: '' });
  };

  return (
    <div className={cx('grid gap-3 md:grid-cols-2 xl:grid-cols-4', className)}>
      {show.pincode !== false && (
        <Field label="PIN code" required={required} error={errors.pincode} hint={pin.status === 'loading' ? 'Looking up…' : pin.status === 'found' ? `${pin.info!.district}, ${pin.info!.state}` : pin.status === 'unknown' ? 'Not in the PIN directory — fill the fields manually' : 'Auto-fills state and district'}>
          <div className="relative">
            <Input inputMode="numeric" autoComplete="postal-code" value={value.pincode} onChange={(e) => void onPincode(e.target.value)} className="pr-9" />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-grey-400">{pin.status === 'loading' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <MapPin size={14} aria-hidden />}</span>
          </div>
        </Field>
      )}
      <Field label="State / UT" required={required} error={errors.state}>
        <Select value={value.stateCode} onChange={(e) => onState(e.target.value)} disabled={states.isPending}>
          <option value="">{states.isPending ? 'Loading…' : 'Select state'}</option>
          {states.data?.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="District" required={required} error={errors.district} hint={show.pincode === false ? undefined : 'From the PIN directory, editable'}>
        <Input value={value.district} onChange={(e) => onChange({ district: e.target.value })} />
      </Field>
      {show.city !== false && (
        <Field label="City / town" required={required} error={errors.city} hint={value.stateCode && cities.data ? `${cities.data.length} known towns in ${value.state}; type to search or enter your own` : undefined}>
          <Input list={`${id}-cities`} value={value.city} onChange={(e) => onChange({ city: e.target.value })} autoComplete="address-level2" />
          <datalist id={`${id}-cities`}>
            {pin.info?.block && <option value={pin.info.block} />}
            {cities.data?.map((c) => <option key={c.name} value={c.name} />)}
          </datalist>
        </Field>
      )}
      {show.locality !== false && (
        <Field label="Locality / area" error={errors.locality} hint={pin.info ? `${pin.info.offices.length} post offices serve this PIN` : undefined}>
          <Input list={`${id}-localities`} value={value.locality} onChange={(e) => onChange({ locality: e.target.value })} />
          <datalist id={`${id}-localities`}>{pin.info?.offices.map((o) => <option key={o.name} value={o.name}>{o.branchType}</option>)}</datalist>
        </Field>
      )}
    </div>
  );
}
