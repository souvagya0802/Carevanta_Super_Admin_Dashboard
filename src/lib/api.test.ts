import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, qs, session } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  beforeEach(() => {
    session.clear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('unwraps success and attaches the bearer token', async () => {
    session.set({ accessToken: 'at', refreshToken: 'rt' });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(json(200, { data: { ok: true } }));
    const res = await api.get<{ data: { ok: boolean } }>('/x');
    expect(res.data.ok).toBe(true);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/x$/);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer at');
  });

  it('refreshes once on 401 and retries the request', async () => {
    session.set({ accessToken: 'expired', refreshToken: 'rt1' });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_INVALID', message: 'expired' } }));
    f.mockResolvedValueOnce(json(200, { data: { accessToken: 'fresh', refreshToken: 'rt2' } }));
    f.mockResolvedValueOnce(json(200, { data: 'retried' }));
    const res = await api.get<{ data: string }>('/me');
    expect(res.data).toBe('retried');
    expect(f).toHaveBeenCalledTimes(3);
    expect(session.accessToken).toBe('fresh');
    expect(localStorage.getItem('carevanta.refreshToken')).toBe('rt2');
  });

  it('clears the session when refresh fails', async () => {
    session.set({ accessToken: 'expired', refreshToken: 'rt1' });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_INVALID', message: 'expired' } }));
    f.mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_INVALID', message: 'reuse' } }));
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(session.accessToken).toBeNull();
    expect(session.hasRefreshToken()).toBe(false);
  });

  it('maps validation issues to field errors', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      json(400, { error: { code: 'VALIDATION_FAILED', message: 'Invalid request body', details: { issues: [{ path: 'body.email', message: 'Invalid email', code: 'x' }] } } }),
    );
    try {
      await api.post('/admin/users', { email: 'bad' });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).fieldErrors).toEqual({ email: 'Invalid email' });
      expect((e as ApiError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('sends the idempotency key header', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(json(201, { data: 1 }));
    await api.post('/x', {}, 'key-12345678');
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe('key-12345678');
  });

  it('builds query strings without empty values', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: 'x y', e: false })).toBe('?a=1&d=x+y&e=false');
    expect(qs({})).toBe('');
  });
});
