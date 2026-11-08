'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { relative } from '@/lib/format';
import { Button, cx } from '@/components/ui/primitives';

interface Note { id: string; title: string | null; body: string | null; link: string | null; readAt: string | null; createdAt: string }

/**
 * The admin's own notifications (new applications, support cases, refund
 * requests, emergencies with no ambulance). Live pop-ups come from the alert
 * centre; this keeps the history. The footer still leads to the platform's
 * delivery log, flagged when deliveries failed.
 */
export function NotificationBell({ failedDeliveries }: { failedDeliveries: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const count = useGet<{ unread: number; latestAt: string | null }>('/portal/notifications/unread-count', { refetchInterval: 30_000 });
  const latest = useGet<{ items: Note[] } | Note[]>('/portal/notifications?channel=IN_APP&limit=8');
  const unread = count.data?.unread ?? 0;
  const items = Array.isArray(latest.data) ? latest.data : latest.data?.items ?? [];
  const invalidate = () => { void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).startsWith('/portal/notifications') }); };
  const readAll = useAction(() => api.post('/portal/notifications/read', {}), { onSuccess: invalidate });
  const open = useAction((n: Note) => (n.readAt ? Promise.resolve() : api.post('/portal/notifications/read', { ids: [n.id] })), { onSuccess: (_r, n) => { invalidate(); if (n.link) router.push(n.link); } });

  return (
    <details className="relative">
      <summary aria-label={unread ? `${unread} unread notifications` : 'Notifications'} className="relative flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-grey-600 hover:bg-grey-100 [&::-webkit-details-marker]:hidden">
        <Bell size={18} className={cx(unread > 0 && 'animate-pop')} aria-hidden />
        {unread > 0 ? (
          <span className="tnum absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold text-paper">{unread > 99 ? '99+' : unread}</span>
        ) : failedDeliveries > 0 ? <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-orange ring-2 ring-paper" aria-hidden /> : null}
      </summary>
      {/* Phones: pinned under the header across the screen. Larger screens: under the bell. */}
      <div className="animate-scale-in fixed inset-x-3 top-[76px] z-30 max-h-[70vh] overflow-y-auto rounded-lg border border-grey-200 bg-paper p-2 text-sm shadow-[var(--shadow-float)] sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[360px]">
        <div className="flex items-center justify-between px-2 py-1">
          <p className="font-semibold">My Notifications</p>
          {unread > 0 && <Button size="sm" variant="ghost" onClick={() => readAll.mutate()} loading={readAll.isPending}><CheckCheck size={14} /> Mark All Read</Button>}
        </div>
        {items.length === 0 ? <p className="px-2 py-6 text-center text-xs text-grey-500">Nothing yet. New applications, support cases and emergencies will appear here.</p> : (
          <ul className="max-h-80 divide-y divide-grey-100 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => open.mutate(n)} className={cx('flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-grey-50', !n.readAt && 'bg-blue-soft/60')}>
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-blue')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate', !n.readAt && 'font-semibold')}>{n.title ?? 'Notification'}</span>
                    {n.body && <span className="block truncate text-xs text-grey-600">{n.body}</span>}
                    <span className="block text-[11px] text-grey-500">{relative(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Link href="/notifications" className="mt-1 flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-center text-xs font-medium text-grey-700 hover:bg-grey-100">
          Delivery Log{failedDeliveries > 0 && <span className="rounded-full bg-orange-soft px-1.5 text-orange">{failedDeliveries} Failed</span>}
        </Link>
      </div>
    </details>
  );
}
