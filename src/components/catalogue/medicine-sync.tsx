'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { count, date, dateTime, title } from '@/lib/format';
import { Badge, Button, ConfirmDialog, type Accent } from '@/components/ui/primitives';

interface Counts { rows: number; added: number; updated: number; unchanged: number; discontinued: number; skipped: number }
interface SyncStatus {
  running: boolean;
  enabled: boolean;
  lastRelease: { sha: string; date: string | null; appliedAt: string; counts: Counts } | null;
  lastRun: { status: string; at: string; releaseDate?: string | null; reason?: string; counts?: Counts } | null;
}

const RUN_LABEL: Record<string, string> = { applied: 'Updated', unchanged: 'Already Up to Date', blocked: 'Stopped for Safety', failed: 'Failed', skipped: 'Skipped' };
const dm = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
/** "12 Nov" */
const shortDate = (iso: string) => dm.format(new Date(iso));

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
    <div className="flex flex-wrap items-center gap-3 rounded-[5px] border border-grey-200 bg-paper p-3 text-sm">
      <div className="min-w-0 flex-1">
        {status.isPending ? (
          <p><span className="font-medium">Government Medicine List:</span> <span className="text-grey-500">checking…</span></p>
        ) : s?.running ? (
          <p><span className="font-medium">Government Medicine List:</span> <span className="text-grey-700">updating now. You can leave this page; admins get a message when it finishes.</span></p>
        ) : !s?.lastRelease ? (
          <p><span className="font-medium">Government Medicine List:</span> <span className="text-grey-700">not loaded yet. Load it once on a new server; after that it updates itself every month.</span></p>
        ) : (
          <p>
            <span className="font-medium">Government Medicine List:</span>{' '}
            <span className="text-grey-700">last updated {shortDate(s.lastRelease.appliedAt)}, {count(s.lastRelease.counts.rows)} medicines</span>
          </p>
        )}
        {run && !s?.running && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-grey-500">
            <span>Last check {dateTime(run.at)}</span>
            <Badge accent={accent}>{RUN_LABEL[run.status] ?? title(run.status)}</Badge>
            {c && <span>{count(c.added)} new · {count(c.updated)} changed · {count(c.discontinued)} no longer sold</span>}
            {s?.lastRelease && <span>Government release {s.lastRelease.date ? date(s.lastRelease.date) : s.lastRelease.sha.slice(0, 7)}</span>}
            {run.reason && <span className="text-grey-700">{run.reason}</span>}
          </p>
        )}
        {s && !s.enabled && <p className="mt-1 text-xs text-orange">Automatic monthly updates are turned off in Settings.</p>}
      </div>
      <Button size="sm" onClick={() => setConfirm(true)} loading={s?.running || start.isPending} disabled={!s || s.running || !s.enabled}>
        <RefreshCw size={14} aria-hidden /> {firstLoad ? 'Load Medicine List' : 'Update Now'}
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => start.mutate()}
        loading={start.isPending}
        title={firstLoad ? 'Load the Medicine List' : 'Update the Medicine List'}
        confirmLabel={firstLoad ? 'Load Now' : 'Update Now'}
        message={firstLoad
          ? 'The server downloads the Government of India medicine list (about 93,000 medicines) and adds it to the catalogue. It takes several minutes and runs in the background.'
          : 'The server checks for a newer government list and applies it. Your edits, prescription rules, hidden medicines and pharmacy-added medicines are kept. Nothing is deleted.'}
      />
    </div>
  );
}
