'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { count, dateTime, title } from '@/lib/format';
import { Badge, Button, ConfirmDialog, type Accent } from '@/components/ui/primitives';

interface Counts { rows: number; added: number; updated: number; unchanged: number; discontinued: number; skipped: number }
interface SyncStatus {
  running: boolean;
  enabled: boolean;
  lastRelease: { sha: string; date: string | null; appliedAt: string; counts: Counts } | null;
  lastRun: { status: string; at: string; releaseDate?: string | null; reason?: string; counts?: Counts } | null;
}

/**
 * Loads the Government of India medicine list (CDCI) into the catalogue and
 * keeps it current. On a fresh server the first click fills the empty table;
 * later clicks fetch the newest release. The work runs on the server, so this
 * panel only starts it and polls the status while it runs.
 */
export function MedicineSyncPanel() {
  const status = useGet<SyncStatus>('/admin/catalogue/medicines/sync-status', { refetchInterval: 5000 });
  const [confirm, setConfirm] = useState(false);
  const s = status.data;
  const firstLoad = !!s && !s.lastRelease;
  const start = useAction(() => api.post('/admin/catalogue/medicines/sync', { force: firstLoad }), {
    success: firstLoad ? 'Loading the medicine list. This takes a few minutes.' : 'Medicine list sync started',
    invalidate: ['/admin/catalogue/medicines/sync-status'],
    onSuccess: () => setConfirm(false),
  });
  const run = s?.lastRun;
  const c = run?.counts;
  const accent: Accent = run?.status === 'applied' || run?.status === 'unchanged' ? 'green' : run?.status === 'blocked' || run?.status === 'failed' ? 'red' : 'ink';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-grey-200 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Government Medicine List</p>
        {status.isPending ? (
          <p className="text-xs text-grey-500">Checking…</p>
        ) : s?.running ? (
          <p className="text-xs text-grey-700">Sync in progress. You can leave this page; admins get a message when it finishes.</p>
        ) : !s?.lastRelease ? (
          <p className="text-xs text-grey-700">Not loaded yet. Load it once on a new server; after that it updates itself every month.</p>
        ) : (
          <p className="text-xs text-grey-700">
            Release {s.lastRelease.date ? dateTime(s.lastRelease.date) : s.lastRelease.sha.slice(0, 7)} applied {dateTime(s.lastRelease.appliedAt)} · {count(s.lastRelease.counts.rows)} medicines
          </p>
        )}
        {run && !s?.running && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-grey-500">
            <span>Last run {dateTime(run.at)}</span>
            <Badge accent={accent}>{title(run.status)}</Badge>
            {c && <span>{count(c.added)} added · {count(c.updated)} updated · {count(c.discontinued)} discontinued</span>}
            {run.reason && <span className="text-grey-700">{run.reason}</span>}
          </p>
        )}
        {s && !s.enabled && <p className="mt-1 text-xs text-orange">Monthly sync is turned off in Settings.</p>}
      </div>
      <Button size="sm" onClick={() => setConfirm(true)} loading={s?.running || start.isPending} disabled={!s || s.running || !s.enabled}>
        <RefreshCw size={14} aria-hidden /> {firstLoad ? 'Load Medicine List' : 'Sync Now'}
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => start.mutate()}
        loading={start.isPending}
        title={firstLoad ? 'Load the Medicine List' : 'Sync the Medicine List'}
        confirmLabel={firstLoad ? 'Load Now' : 'Sync Now'}
        message={firstLoad
          ? 'The server downloads the Government of India medicine list (about 93,000 medicines) and adds it to the catalogue. It takes several minutes and runs in the background.'
          : 'The server checks for a newer government release and applies it. Admin edits and pharmacy-added medicines are kept. Nothing is deleted.'}
      />
    </div>
  );
}
