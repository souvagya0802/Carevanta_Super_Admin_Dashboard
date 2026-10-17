import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';
import { AppProviders } from '@/lib/providers';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => '/login' }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const BRANDING = { data: { name: 'Carevanta', tagline: 'Trusted care, connected.', logoUrl: null, logoMimeType: null } };

/** Route the fetch mock by URL so the branding request never consumes a queued login response. */
function mockFetch(routes: Record<string, () => Response>) {
  const f = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return Promise.resolve(hit ? routes[hit]!() : json({ error: { code: 'NOT_FOUND', message: `unmocked ${url}` } }, 404));
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const calls = (f: ReturnType<typeof vi.fn>, path: string) => f.mock.calls.filter((c) => String(c[0]).includes(path)).length;

describe('login page', () => {
  beforeEach(() => replace.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('validates required fields before calling the API', async () => {
    const f = mockFetch({ '/public/branding': () => json(BRANDING) });
    render(<AppProviders><LoginPage /></AppProviders>);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument();
    expect(calls(f, '/auth/login')).toBe(0);
  });

  it('shows the branding and a lockout message from the API', async () => {
    mockFetch({ '/public/branding': () => json(BRANDING), '/auth/login': () => json({ error: { code: 'ACCOUNT_LOCKED', message: 'locked' } }, 423) });
    render(<AppProviders><LoginPage /></AppProviders>);
    expect(await screen.findByRole('img', { name: /carevanta logo/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email or mobile/i), 'owner@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many failed attempts/i);
  });

  it('signs in and redirects', async () => {
    mockFetch({
      '/public/branding': () => json(BRANDING),
      '/auth/login': () => json({ data: { accessToken: 'a', refreshToken: 'r' } }),
      '/auth/me': () => json({ data: { id: 'u1', fullName: 'Owner', email: 'o@x', phone: null, status: 'ACTIVE', mustChangePassword: false, roles: ['SUPER_ADMIN'], permissions: ['analytics.read'] } }),
    });
    render(<AppProviders><LoginPage /></AppProviders>);
    await userEvent.type(screen.getByLabelText(/email or mobile/i), 'owner@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Correct-Horse-Battery-9');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });
});
