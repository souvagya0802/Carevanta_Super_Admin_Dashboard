'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { Crosshair, Loader2, Search } from 'lucide-react';
import { Button, Input, cx } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export interface GeoPoint { lat: number; lng: number }
/** Address parts as the geocoder understood them — editable by the user afterwards. */
export interface GeocodedAddress { addressLine1: string; locality: string; city: string; district: string; state: string; pincode: string; label: string }

interface Props {
  value: GeoPoint | null;
  /** Fired on click, drag, search pick or "use my location"; `address` is null when reverse geocoding failed. */
  onChange: (point: GeoPoint, address: GeocodedAddress | null) => void;
  /** Where to open when there is no value yet (defaults to a whole-India view). */
  defaultCenter?: GeoPoint;
  defaultZoom?: number;
  className?: string;
}

const INDIA: GeoPoint = { lat: 22.9734, lng: 78.6569 };
/** Map tiles: OpenStreetMap unless NEXT_PUBLIC_MAP_TILE_URL points at another (keyed) tile server. */
const TILES = {
  url: process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

/** A place as our API returns it (/public/geo/search and /public/geo/reverse). */
interface GeoPlace { label: string; latitude: number; longitude: number; address: { addressLine1: string | null; locality: string | null; city: string | null; district: string | null; state: string | null; pincode: string | null } }

/** The API's address in the editable shape the location form uses. */
function toAddress(p: GeoPlace): GeocodedAddress {
  const a = p.address;
  return {
    addressLine1: a.addressLine1 || p.label.split(',').slice(0, 2).join(',').trim(),
    locality: a.locality ?? '',
    city: a.city ?? '',
    district: a.district ?? '',
    state: a.state ?? '',
    pincode: a.pincode ?? '',
    label: p.label,
  };
}

/**
 * Lookups go through our API, which picks the geocoder (free OpenStreetMap
 * Nominatim by default, or a keyed provider set in the API's .env) and caches
 * answers, so no key ever reaches the browser.
 */
async function reverseGeocode(p: GeoPoint): Promise<GeocodedAddress | null> {
  try {
    const { data } = await api.get<{ data: GeoPlace | null }>(`/public/geo/reverse?lat=${p.lat}&lng=${p.lng}`);
    return data ? toAddress(data) : null;
  } catch {
    return null;
  }
}

async function searchPlaces(q: string, near: GeoPoint | null): Promise<GeoPlace[]> {
  const bias = near ? `&lat=${near.lat}&lng=${near.lng}` : '';
  try {
    const { data } = await api.get<{ data: GeoPlace[] }>(`/public/geo/search?q=${encodeURIComponent(q)}&limit=6${bias}`);
    return data;
  } catch {
    throw new Error('Place search is unavailable right now. Click the spot on the map instead.');
  }
}

/**
 * Click-to-place map (OpenStreetMap tiles, Leaflet). Dropping or dragging the
 * pin reverse-geocodes the spot so the address fields fill in; the search box
 * finds a place by name or address. Lookups go through our API (see
 * reverseGeocode) and happen only on explicit user actions.
 */
export function MapPicker({ value, onChange, defaultCenter = INDIA, defaultZoom = 5, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const leaflet = useRef<typeof import('leaflet') | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'reverse' | 'search' | 'locate' | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create the map once; Leaflet touches `window`, so it is imported lazily on the client.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (disposed || !host.current || map.current) return;
      leaflet.current = L;
      const m = L.map(host.current, { zoomControl: true, attributionControl: true });
      L.tileLayer(TILES.url, { maxZoom: 19, attribution: TILES.attribution }).addTo(m);
      if (value) m.setView([value.lat, value.lng], 16);
      else m.setView([defaultCenter.lat, defaultCenter.lng], defaultZoom);
      m.on('click', (e) => void place({ lat: e.latlng.lat, lng: e.latlng.lng }, true));
      map.current = m;
      if (value) putMarker(value);
      setReady(true);
      // The dialog animates open; make sure tiles lay out once the box has its final size.
      setTimeout(() => m.invalidateSize(), 50);
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; later value changes are applied below
  }, []);

  // Keep the pin in sync when the parent changes the value (e.g. switching between saved locations).
  useEffect(() => {
    if (!map.current) return;
    if (!value) { marker.current?.remove(); marker.current = null; return; }
    const cur = marker.current?.getLatLng();
    if (cur && Math.abs(cur.lat - value.lat) < 1e-7 && Math.abs(cur.lng - value.lng) < 1e-7) return;
    putMarker(value);
    map.current.setView([value.lat, value.lng], Math.max(map.current.getZoom(), 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- putMarker is stable (refs only)
  }, [value?.lat, value?.lng]);

  function putMarker(p: GeoPoint) {
    const L = leaflet.current;
    const m = map.current;
    if (!L || !m) return;
    if (!marker.current) {
      const icon = L.divIcon({ className: '', iconSize: [28, 36], iconAnchor: [14, 36], html: '<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 0C6.3 0 0 6.2 0 13.8 0 23.5 14 36 14 36s14-12.5 14-22.2C28 6.2 21.7 0 14 0z" fill="#0a0a0a"/><circle cx="14" cy="14" r="5.5" fill="#fff"/></svg>' });
      marker.current = L.marker([p.lat, p.lng], { draggable: true, icon, keyboard: true }).addTo(m);
      marker.current.on('dragend', () => {
        const ll = marker.current!.getLatLng();
        void place({ lat: ll.lat, lng: ll.lng }, false);
      });
    } else {
      marker.current.setLatLng([p.lat, p.lng]);
    }
  }

  async function place(p: GeoPoint, pan: boolean) {
    const point = { lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) };
    putMarker(point);
    if (pan) map.current?.panTo([point.lat, point.lng]);
    setBusy('reverse');
    setError(null);
    const address = await reverseGeocode(point);
    setBusy(null);
    if (!address) setError('Pin placed. The address could not be looked up — fill it in by hand.');
    latest.current(point, address);
  }

  async function search() {
    const term = q.trim();
    if (!term) return;
    setBusy('search');
    setError(null);
    try {
      const found = await searchPlaces(term, value);
      setResults(found);
      if (!found.length) setError('No places found. Try a landmark, locality or PIN code.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(null);
    }
  }

  function pick(r: GeoPlace) {
    const point = { lat: Number(r.latitude.toFixed(6)), lng: Number(r.longitude.toFixed(6)) };
    setResults([]);
    setQ('');
    putMarker(point);
    map.current?.setView([point.lat, point.lng], 17);
    latest.current(point, toAddress(r));
  }

  function locate() {
    if (!navigator.geolocation) { setError('This browser cannot share your location'); return; }
    setBusy('locate');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setBusy(null); map.current?.setView([pos.coords.latitude, pos.coords.longitude], 17); void place({ lat: pos.coords.latitude, lng: pos.coords.longitude }, true); },
      () => { setBusy(null); setError('Location permission was denied'); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className={cx('space-y-2', className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
          <Input aria-label="Search a Place or Address" placeholder="Search hospital, clinic, landmark, locality or PIN…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} className="pl-9" />
          {results.length > 0 && (
            <ul role="listbox" className="absolute inset-x-0 top-full z-[1000] mt-1 max-h-56 overflow-y-auto rounded-lg border border-grey-200 bg-paper py-1 text-sm shadow-[var(--shadow-float)]">
              {results.map((r, i) => (
                <li key={`${r.latitude}-${r.longitude}-${i}`}>
                  <button type="button" role="option" aria-selected={false} onClick={() => pick(r)} className="block w-full px-3 py-2 text-left hover:bg-grey-50">{r.label}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="button" variant="secondary" onClick={() => void search()} loading={busy === 'search'} aria-label="Search">Search</Button>
        <Button type="button" variant="secondary" onClick={locate} loading={busy === 'locate'} aria-label="Use My Location" title="Use My Location" className="px-3"><Crosshair size={16} /></Button>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-grey-200">
        <div ref={host} className="h-72 w-full bg-grey-100" role="application" aria-label="Map. Click to place the pin, drag to adjust." />
        {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-grey-500">Loading map…</div>}
        {busy === 'reverse' && <div className="absolute top-2 right-2 z-[1000] flex items-center gap-1.5 rounded-lg bg-paper/95 px-2 py-1 text-xs shadow"><Loader2 size={12} className="animate-spin" aria-hidden /> Looking up address…</div>}
      </div>
      <p className="text-xs text-grey-500">
        {value ? <>Pin at <span className="tnum font-medium text-ink">{value.lat.toFixed(6)}, {value.lng.toFixed(6)}</span> · drag the pin or click elsewhere to adjust.</> : 'Click the spot on the map, or search and pick a result. Coordinates and address fill in automatically.'}
        {error && <span className="block text-orange">{error}</span>}
      </p>
    </div>
  );
}
