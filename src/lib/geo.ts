'use client';

import { useQuery } from '@tanstack/react-query';
import { request } from './api';

/**
 * Reference geography from the API (ISO countries/states/cities + the India
 * Post PIN directory). Nothing region-specific lives in the dashboard: the
 * pilot districts are ordinary rows in Settings → Service regions.
 */

/** The platform operates in India; the API still serves every country so this is the only place to change. */
export const HOME_COUNTRY = 'IN';

export interface GeoCountry { code: string; name: string; phoneCode: string; flag: string }
export interface GeoState { code: string; name: string; latitude: number | null; longitude: number | null }
export interface GeoCity { name: string; latitude: number | null; longitude: number | null }
export interface PincodeInfo { pincode: string; country: string; state: string; district: string; block: string | null; division: string | null; offices: { name: string; branchType: string }[] }

const FOREVER = Number.POSITIVE_INFINITY;
const pub = <T,>(path: string) => request<{ data: T }>(path, { anonymous: true }).then((r) => r.data);

export function useCountries() {
  return useQuery({ queryKey: ['geo', 'countries'], queryFn: () => pub<GeoCountry[]>('/public/geo/countries'), staleTime: FOREVER });
}

export function useStates(country: string = HOME_COUNTRY) {
  return useQuery({ queryKey: ['geo', 'states', country], queryFn: () => pub<GeoState[]>(`/public/geo/states?country=${encodeURIComponent(country)}`), staleTime: FOREVER, enabled: !!country });
}

export function useCities(stateCode: string | undefined, country: string = HOME_COUNTRY) {
  return useQuery({ queryKey: ['geo', 'cities', country, stateCode], queryFn: () => pub<GeoCity[]>(`/public/geo/cities?country=${encodeURIComponent(country)}&state=${encodeURIComponent(stateCode!)}`), staleTime: FOREVER, enabled: !!stateCode });
}

export const isPincode = (s: string) => /^[1-9][0-9]{5}$/.test(s);

/** One-off lookup for event handlers (auto-fill on PIN entry). Resolves `null` when unknown. */
export async function lookupPincode(pin: string): Promise<PincodeInfo | null> {
  if (!isPincode(pin)) return null;
  try {
    return await pub<PincodeInfo>(`/public/geo/pincode/${pin}`);
  } catch {
    return null;
  }
}

/** Find the ISO state code whose name matches a free-text state (as India Post returns it). */
export function matchState(states: GeoState[] | undefined, name: string | null | undefined): GeoState | undefined {
  if (!states || !name) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const n = norm(name);
  return states.find((s) => norm(s.name) === n) ?? states.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name)));
}

/** Medical-council suggestions derived from the state list (state councils + the national body). */
export function councilSuggestions(states: GeoState[] | undefined): string[] {
  return ['National Medical Commission', ...(states ?? []).map((s) => `${s.name} Medical Council`)];
}
