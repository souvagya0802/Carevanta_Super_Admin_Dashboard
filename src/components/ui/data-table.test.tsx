import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './data-table';
import { session } from '@/lib/api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
type Row = { id: string; name: string };
const columns = [{ header: 'Name', accessorKey: 'name' as const }];

describe('DataTable', () => {
  beforeEach(() => {
    session.set({ accessToken: 'at', refreshToken: 'rt' });
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders rows and pages forward and back with cursors', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockImplementation((url: string) => {
      if (url.includes('cursor=c1')) return Promise.resolve(json({ data: [{ id: '2', name: 'Second' }], page: { limit: 1, nextCursor: null, hasMore: false } }));
      return Promise.resolve(json({ data: [{ id: '1', name: 'First' }], page: { limit: 1, nextCursor: 'c1', hasMore: true } }));
    });
    wrap(<DataTable<Row> path="/admin/users" columns={columns} pageSize={1} />);
    expect(await screen.findByText('First')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /prev/i }));
    expect(await screen.findByText('First')).toBeInTheDocument();
  });

  it('shows an empty state and an error state', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(json({ data: [], page: { limit: 25, nextCursor: null, hasMore: false } }));
    wrap(<DataTable<Row> path="/a" columns={columns} emptyTitle="Nothing found" />);
    expect(await screen.findByText('Nothing found')).toBeInTheDocument();
    f.mockResolvedValueOnce(json({ error: { code: 'FORBIDDEN', message: 'No access' } }, 403));
    wrap(<DataTable<Row> path="/b" columns={columns} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No access'));
  });
});
