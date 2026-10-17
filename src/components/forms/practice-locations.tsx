'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, Field, Input, Select, cx } from '@/components/ui/primitives';
import { LocationFields, EMPTY_ADDRESS, type AddressValue } from '@/components/forms/location-fields';
import { MapPicker, type GeocodedAddress, type GeoPoint } from '@/components/forms/map-picker';
import { matchState, useStates, type GeoState } from '@/lib/geo';

export interface Region { code: string; name: string; district: string; state: string; status: string }

export interface LocationDraft {
  key: string;
  name: string;
  addressLine1: string;
  phone: string;
  address: AddressValue;
  point: GeoPoint | null;
  regionCode: string;
  isPrimary: boolean;
}

export type LocationErrors = Partial<Record<'name' | 'addressLine1' | 'point' | keyof AddressValue, string>>;

export function newLocation(isPrimary: boolean): LocationDraft {
  return { key: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()), name: '', addressLine1: '', phone: '', address: { ...EMPTY_ADDRESS }, point: null, regionCode: '', isPrimary };
}

/** Validation shared with the dialog so errors appear next to the right location. */
export function validateLocation(l: LocationDraft): LocationErrors {
  const e: LocationErrors = {};
  if (l.name.trim().length < 2) e.name = 'Give this place a name (e.g. "Tamluk Chamber")';
  if (l.addressLine1.trim().length < 3) e.addressLine1 = 'Address is required';
  if (!l.point) e.point = 'Place the pin on the map';
  if (!/^[1-9][0-9]{5}$/.test(l.address.pincode)) e.pincode = '6-digit PIN';
  if (!l.address.state) e.state = 'Required';
  if (l.address.district.trim().length < 2) e.district = 'Required';
  if (l.address.city.trim().length < 2) e.city = 'Required';
  return e;
}

export function toLocationPayload(l: LocationDraft) {
  return {
    name: l.name.trim(),
    addressLine1: l.addressLine1.trim(),
    locality: l.address.locality.trim() || undefined,
    city: l.address.city.trim(),
    district: l.address.district.trim(),
    state: l.address.state.trim(),
    pincode: l.address.pincode,
    latitude: l.point?.lat,
    longitude: l.point?.lng,
    phone: l.phone.trim() || undefined,
    regionCode: l.regionCode || undefined,
    isPrimary: l.isPrimary,
  };
}

/** The service region whose district and state match the address, if any. */
export function matchRegion(regions: Region[] | undefined, address: AddressValue): Region | undefined {
  if (!regions?.length || !address.district) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const d = norm(address.district);
  const s = norm(address.state);
  const byDistrict = regions.filter((r) => norm(r.district) === d);
  return byDistrict.find((r) => !s || norm(r.state) === s) ?? byDistrict[0];
}

function applyGeocode(l: LocationDraft, point: GeoPoint, g: GeocodedAddress | null, states: GeoState[] | undefined, regions: Region[] | undefined): LocationDraft {
  if (!g) return { ...l, point };
  const st = matchState(states, g.state);
  const address: AddressValue = {
    pincode: g.pincode || l.address.pincode,
    stateCode: st?.code ?? l.address.stateCode,
    state: st?.name ?? g.state ?? l.address.state,
    district: g.district || l.address.district,
    city: g.city || l.address.city,
    locality: g.locality || l.address.locality,
  };
  const region = matchRegion(regions, address);
  return { ...l, point, address, addressLine1: l.addressLine1 || g.addressLine1, regionCode: l.regionCode || region?.code || '' };
}

interface Props {
  value: LocationDraft[];
  onChange: (next: LocationDraft[]) => void;
  regions: Region[] | undefined;
  regionsLoading?: boolean;
  errors?: Record<string, LocationErrors>;
  /** Copy for the "add" button and empty state. */
  noun?: string;
}

/**
 * Multiple places for one provider (a doctor's chambers, a hospital's branches).
 * One location is edited at a time: pick the spot on the map, the address
 * fills in, then adjust any field. Exactly one location is primary.
 */
export function PracticeLocations({ value, onChange, regions, regionsLoading, errors = {}, noun = 'location' }: Props) {
  const states = useStates();
  const [openKey, setOpenKey] = useState<string | null>(value[0]?.key ?? null);

  const update = (key: string, patch: Partial<LocationDraft>) => onChange(value.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => {
    const l = newLocation(value.length === 0);
    onChange([...value, l]);
    setOpenKey(l.key);
  };
  const remove = (key: string) => {
    const next = value.filter((l) => l.key !== key);
    if (next.length && !next.some((l) => l.isPrimary)) next[0] = { ...next[0]!, isPrimary: true };
    onChange(next);
    if (openKey === key) setOpenKey(next[0]?.key ?? null);
  };
  const makePrimary = (key: string) => onChange(value.map((l) => ({ ...l, isPrimary: l.key === key })));

  if (value.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed border-grey-300 px-4 py-8 text-center">
        <MapPin size={22} className="text-grey-400" aria-hidden />
        <p className="mt-2 text-sm font-medium">No {noun} added yet</p>
        <p className="mt-0.5 max-w-md text-xs text-grey-500">Optional now, but required before verification. Pick the spot on a map and the address fills in automatically.</p>
        <Button type="button" variant="secondary" className="mt-4" onClick={add}><Plus size={16} aria-hidden /> Add {noun}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {value.map((l, i) => {
          const open = openKey === l.key;
          const errs = errors[l.key] ?? {};
          const hasErrors = Object.keys(errs).length > 0;
          const summary = [l.addressLine1, l.address.locality, l.address.city, l.address.district, l.address.pincode].filter(Boolean).join(', ');
          return (
            <li key={l.key} className={cx('rounded-lg border bg-paper', hasErrors ? 'border-red/40' : open ? 'border-ink' : 'border-grey-200')}>
              <div className="flex items-center gap-3 px-4 py-3">
                <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold', l.isPrimary ? 'bg-ink text-paper' : 'bg-grey-100 text-grey-700')}>{i + 1}</span>
                <button type="button" onClick={() => setOpenKey(open ? null : l.key)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{l.name || `Untitled ${noun}`}</span>
                    {l.isPrimary && <Badge accent="ink">Primary</Badge>}
                    {l.point ? <Badge accent="green">Pinned</Badge> : <Badge accent="orange">No Pin</Badge>}
                    {hasErrors && <Badge accent="red">Incomplete</Badge>}
                  </span>
                  <span className="block truncate text-xs text-grey-500">{summary || 'No address yet'}</span>
                </button>
                {!l.isPrimary && <Button type="button" size="sm" variant="ghost" onClick={() => makePrimary(l.key)} title="Make primary"><Star size={14} aria-hidden /> Make Primary</Button>}
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(l.key)} aria-label={`Remove ${l.name || noun}`} className="text-red"><Trash2 size={14} aria-hidden /></Button>
              </div>
              {open && (
                <div className="grid gap-4 border-t border-grey-100 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-grey-500">Pick on Map</p>
                    <MapPicker value={l.point} onChange={(point, g) => onChange(value.map((x) => (x.key === l.key ? applyGeocode(x, point, g, states.data, regions) : x)))} />
                    {errs.point && <p role="alert" className="mt-1 text-xs text-red">{errs.point}</p>}
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">Address Details</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Place Name" required error={errs.name} hint="How patients will see it"><Input placeholder={noun === 'chamber' ? 'e.g. Tamluk Chamber' : 'e.g. Main Campus'} value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} /></Field>
                      <Field label="Phone" hint="Front desk, optional"><Input inputMode="tel" value={l.phone} onChange={(e) => update(l.key, { phone: e.target.value })} /></Field>
                      <Field label="Address Line" required error={errs.addressLine1} className="md:col-span-2"><Input placeholder="Building, street, landmark" value={l.addressLine1} onChange={(e) => update(l.key, { addressLine1: e.target.value })} /></Field>
                    </div>
                    <LocationFields value={l.address} onChange={(patch) => { const address = { ...l.address, ...patch }; update(l.key, { address, regionCode: l.regionCode || matchRegion(regions, address)?.code || '' }); }} errors={errs} required className="md:grid-cols-2 xl:grid-cols-2" />
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Service Region" hint={regionsLoading ? 'Loading regions…' : regions?.length ? (matchRegion(regions, l.address)?.code === l.regionCode && l.regionCode ? 'Matched from the district' : 'Operational grouping; managed in Settings') : undefined}>
                        <Select value={l.regionCode} onChange={(e) => update(l.key, { regionCode: e.target.value })} disabled={regionsLoading}>
                          <option value="">{regionsLoading ? 'Loading…' : regions?.length ? 'None' : 'No regions defined yet'}</option>
                          {regions?.map((x) => <option key={x.code} value={x.code}>{x.name} · {x.district}, {x.state}{x.status !== 'LIVE' ? ` (${x.status.toLowerCase()})` : ''}</option>)}
                        </Select>
                        {!regionsLoading && !regions?.length && <Link href="/settings?tab=regions" className="mt-1 block text-xs underline underline-offset-2">Create service regions in Settings</Link>}
                      </Field>
                      <div className="self-end pb-2"><Checkbox label="Primary location" checked={l.isPrimary} onChange={() => makePrimary(l.key)} /></div>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="secondary" onClick={add}><Plus size={16} aria-hidden /> Add Another {noun.charAt(0).toUpperCase() + noun.slice(1)}</Button>
    </div>
  );
}
