import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AppProviders } from '@/lib/providers';
import { EMPTY_ADDRESS, LocationFields, type AddressValue } from './location-fields';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const STATES = { data: [{ code: 'MH', name: 'Maharashtra', latitude: null, longitude: null }, { code: 'WB', name: 'West Bengal', latitude: null, longitude: null }] };
const WB_CITIES = { data: [{ name: 'Haldia', latitude: null, longitude: null }, { name: 'Tamluk', latitude: null, longitude: null }] };
const PIN = { data: { pincode: '721629', country: 'India', state: 'West Bengal', district: 'East Midnapore', block: 'Moyna', division: 'Tamluk', offices: [{ name: 'Moyna', branchType: 'Sub Post Office' }, { name: 'Changra', branchType: 'Branch Post Office' }] } };

function mockFetch(routes: Record<string, () => Response>) {
  const f = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return Promise.resolve(hit ? routes[hit]!() : json({ error: { code: 'NOT_FOUND', message: `unmocked ${url}` } }, 404));
  });
  vi.stubGlobal('fetch', f);
  return f;
}

function Harness({ onValue }: { onValue: (v: AddressValue) => void }) {
  const [v, setV] = useState<AddressValue>(EMPTY_ADDRESS);
  return <LocationFields value={v} onChange={(p) => setV((a) => { const next = { ...a, ...p }; onValue(next); return next; })} />;
}

describe('LocationFields', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads states from the API (not a hardcoded list) and fills state, district and city from the PIN directory', async () => {
    mockFetch({ '/public/geo/states': () => json(STATES), '/public/geo/cities': () => json(WB_CITIES), '/public/geo/pincode/721629': () => json(PIN) });
    const seen = vi.fn();
    render(<AppProviders><Harness onValue={seen} /></AppProviders>);
    const state = (await screen.findByLabelText(/state \/ ut/i)) as HTMLSelectElement;
    await waitFor(() => expect(state.options.length).toBe(3));
    expect(Array.from(state.options).map((o) => o.text)).toEqual(['Select State', 'Maharashtra', 'West Bengal']);

    await userEvent.type(screen.getByLabelText(/pin code/i), '721629');
    await waitFor(() => expect((screen.getByLabelText(/district/i) as HTMLInputElement).value).toBe('East Midnapore'));
    expect(state.value).toBe('WB');
    expect((screen.getByLabelText(/city \/ town/i) as HTMLInputElement).value).toBe('Moyna');
    expect(await screen.findByText(/2 post offices serve this pin/i)).toBeInTheDocument();
    const last = seen.mock.calls.at(-1)![0] as AddressValue;
    expect(last).toMatchObject({ pincode: '721629', stateCode: 'WB', state: 'West Bengal', district: 'East Midnapore', city: 'Moyna' });
  });

  it('tells the user to fill manually when the PIN is unknown and clears dependants when the state changes', async () => {
    mockFetch({ '/public/geo/states': () => json(STATES), '/public/geo/pincode/': () => json({ error: { code: 'NOT_FOUND', message: 'PIN code not found' } }, 404) });
    render(<AppProviders><Harness onValue={() => {}} /></AppProviders>);
    const state = (await screen.findByLabelText(/state \/ ut/i)) as HTMLSelectElement;
    await waitFor(() => expect(state.options.length).toBe(3));
    await userEvent.type(screen.getByLabelText(/pin code/i), '999999');
    expect(await screen.findByText(/not in the pin directory/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/district/i), 'Pune');
    await userEvent.selectOptions(state, 'MH');
    expect((screen.getByLabelText(/district/i) as HTMLInputElement).value).toBe('');
    expect(state.value).toBe('MH');
  });
});
