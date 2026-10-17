'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Ban, CheckCircle2, History, Loader2, Mail, MessageSquareText, Play, Plus, RefreshCw, RotateCcw, Send, Smartphone } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useFilters, useGet } from '@/lib/hooks';
import { count, dateTime, relative, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, FormSection, Input, PageHeader, Select, Skeleton, Tabs, Textarea, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { RequirePermission } from '@/components/layout/shell';

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface Notification { id: string; userId: string | null; channel: string; templateKey: string; recipient: string; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string }
interface Stats { byStatus: Record<string, number>; last24h: Record<string, number>; byChannel24h: Record<string, number>; oldestQueuedAt: string | null; drivers: Record<string, 'smtp' | 'log'>; processing: 'inline' | 'background' }
interface Template { id: string; key: string; channel: string; locale: string; version: number; subject: string | null; body: string; isActive: boolean }
interface Catalogue { keys: { key: string; description: string; variables: Record<string, string>; channels: string[]; sample: Record<string, string> }[]; channels: string[]; locales: string[]; missing: { key: string; channel: string; locale: string }[] }
interface Preview { errors: string[]; warnings: string[]; placeholders: string[]; rendered: { subject: string | null; body: string }; sms: { encoding: string; length: number; segments: number } | null }

const STATUSES = ['QUEUED', 'SENT', 'FAILED', 'CANCELLED'];
const LOCALE_NAMES: Record<string, string> = { en: 'English', bn: 'Bengali', hi: 'Hindi' };
const CHANNEL_ICON: Record<string, typeof Mail> = { EMAIL: Mail, SMS: Smartphone, PUSH: Send, IN_APP: MessageSquareText };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Clock read lives outside components for the React Compiler's purity rule. */
const nowMs = () => Date.now();

/* ─── Page shell ──────────────────────────────────────────────────────────── */
export default function NotificationsPage() {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <NotificationsInner />
    </Suspense>
  );
}

function NotificationsInner() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get('tab') === 'templates' ? 'templates' : 'outbox';
  const setTab = (next: string) => router.replace(`${pathname}?tab=${next}`, { scroll: false });
  const stats = useGet<Stats>('/admin/notifications/stats');
  const catalogue = useGet<Catalogue>('/admin/notification-templates/catalogue');
  const manage = can('notifications.manage');

  return (
    <RequirePermission anyOf={['notifications.read']}>
      <PageHeader title="Notifications" description="Transactional outbox and message templates. Recipients are masked and payloads (which may carry one-time codes) are never shown." />
      <DeliveryBanner stats={stats.data} missing={catalogue.data?.missing.length ?? 0} onFixTemplates={() => setTab('templates')} />
      <Tabs tabs={[{ key: 'outbox', label: 'Outbox', count: stats.data?.byStatus.QUEUED }, { key: 'templates', label: 'Templates', count: catalogue.data?.missing.length || undefined }]} active={tab} onChange={setTab} />
      <div className="mt-4 space-y-4">
        {tab === 'outbox' && <OutboxTab stats={stats} catalogue={catalogue.data} manage={manage} />}
        {tab === 'templates' && <TemplatesTab catalogue={catalogue} manage={manage} smtp={stats.data?.drivers.EMAIL === 'smtp'} />}
      </div>
    </RequirePermission>
  );
}

/** Tells the operator what "SENT" actually means right now. */
function DeliveryBanner({ stats, missing, onFixTemplates }: { stats: Stats | undefined; missing: number; onFixTemplates: () => void }) {
  if (!stats) return null;
  const logOnly = Object.entries(stats.drivers).filter(([, d]) => d === 'log').map(([c]) => c);
  const emailOff = stats.drivers.EMAIL === 'log';
  return (
    <div className="mb-4 space-y-2">
      {(emailOff || logOnly.length) && (
        <div className={cx('flex items-start gap-3 rounded-lg border p-3 text-sm', emailOff ? 'border-orange/30 bg-orange-soft' : 'border-grey-200 bg-grey-50')}>
          <AlertTriangle size={18} aria-hidden className={cx('mt-0.5 shrink-0', emailOff ? 'text-orange' : 'text-grey-500')} />
          <div className="min-w-0">
            {emailOff ? <p className="font-semibold text-orange">Email Is Not Being Sent</p> : <p className="font-semibold">Email Goes Out via SMTP</p>}
            <p className="mt-0.5 text-xs text-grey-700">
              {emailOff ? <>SMTP is not configured, so email notifications are written to the server log and marked SENT without reaching anyone. <Link href="/settings?tab=email" className="font-medium underline underline-offset-2">Configure SMTP in Settings → Email</Link>. </> : null}
              {logOnly.filter((c) => c !== 'EMAIL').length > 0 && <>No gateway is connected for <strong>{logOnly.filter((c) => c !== 'EMAIL').join(', ')}</strong>: those rows are logged only, even when marked SENT.</>}
              {' '}Delivery runs {stats.processing === 'inline' ? 'immediately in the API process' : 'through the background worker every minute'}.
            </p>
          </div>
        </div>
      )}
      {missing > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red/30 bg-red-soft p-3 text-sm">
          <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-red" />
          <div><p className="font-semibold text-red">{missing} Template{missing > 1 ? 's' : ''} Missing</p><p className="mt-0.5 text-xs text-grey-700">The platform sends messages that have no active template; those deliveries fail. <button type="button" onClick={onFixTemplates} className="font-medium underline underline-offset-2">Open Templates</button> to add them.</p></div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Outbox
   ═══════════════════════════════════════════════════════════════════════════ */
function OutboxTab({ stats, catalogue, manage }: { stats: ReturnType<typeof useGet<Stats>>; catalogue: Catalogue | undefined; manage: boolean }) {
  const toast = useToast();
  const { filters, set, reset } = useFilters({ status: '', channel: '', templateKey: '', userId: '' });
  const userId = useDebounced(filters.userId.trim());
  const userIdValid = !userId || UUID.test(userId);
  const [cancelling, setCancelling] = useState<Notification | null>(null);
  const [reason, setReason] = useState('');
  const inv = ['/admin/notifications'];

  const retry = useAction((id: string) => api.post(`/admin/notifications/${id}/retry`), { success: 'Re-queued for delivery', invalidate: inv });
  const cancel = useAction((n: Notification) => api.post(`/admin/notifications/${n.id}/cancel`, { reason }), { success: 'Cancelled — the message will not be sent', invalidate: inv, onSuccess: () => { setCancelling(null); setReason(''); } });
  const retryAll = useAction(() => api.post<{ data: { requeued: number } }>('/admin/notifications/retry-failed', { templateKey: filters.templateKey || undefined }), { invalidate: inv, onSuccess: (r) => toast.success(r.data.requeued ? `${count(r.data.requeued)} re-queued` : 'Nothing to retry') });
  const deliverNow = useAction(() => api.post<{ data: { sent: number; remaining: number } }>('/admin/notifications/deliver-now'), { invalidate: inv, onSuccess: (r) => toast.success(`${count(r.data.sent)} delivered`, r.data.remaining ? `${count(r.data.remaining)} still queued — run again or wait for the worker` : 'Queue is empty') });

  const s = stats.data;
  const queued = s?.byStatus.QUEUED ?? 0;
  const failed = s?.byStatus.FAILED ?? 0;
  const driverOf = (channel: string) => s?.drivers[channel] ?? 'log';
  const keyLabel = (k: string) => catalogue?.keys.find((x) => x.key === k)?.description;

  const columns: ColumnDef<Notification, unknown>[] = [
    { header: 'Message', cell: ({ row }) => <div className="min-w-44"><p className="font-mono text-xs font-medium">{row.original.templateKey}</p>{keyLabel(row.original.templateKey) && <p className="line-clamp-1 text-xs text-grey-500" title={keyLabel(row.original.templateKey)}>{keyLabel(row.original.templateKey)}</p>}</div> },
    { header: 'Channel', cell: ({ row }) => { const Icon = CHANNEL_ICON[row.original.channel] ?? Send; return <span className="inline-flex items-center gap-1.5 text-xs"><Icon size={14} aria-hidden className="text-grey-500" />{row.original.channel.replace('_', ' ')}</span>; } },
    { header: 'Recipient', cell: ({ row }) => <div><p className="font-mono text-xs">{row.original.recipient}</p>{row.original.userId && <Link href={`/users/${row.original.userId}`} onClick={(e) => e.stopPropagation()} className="text-xs text-grey-500 underline-offset-2 hover:underline">User {row.original.userId.slice(0, 8)}</Link>}</div> },
    { header: 'Status', cell: ({ row }) => {
      const n = row.original;
      const logged = n.status === 'SENT' && driverOf(n.channel) === 'log';
      return (
        <div className="space-y-0.5">
          <span className="flex items-center gap-1.5">{n.status === 'QUEUED' && <Loader2 size={12} className="animate-spin text-grey-500" aria-hidden />}<Badge>{n.status}</Badge>{logged && <Badge accent="orange" tone="PENDING">Logged Only</Badge>}</span>
          {n.lastError && <p className="max-w-64 text-xs text-red" title={n.lastError}>{n.lastError.slice(0, 140)}</p>}
        </div>
      );
    } },
    { header: 'Attempts', cell: ({ row }) => <span className={cx('tnum', row.original.attempts >= 5 && 'text-red')}>{row.original.attempts}<span className="text-grey-400">/5</span></span> },
    { header: 'Queued', cell: ({ row }) => <span className="text-xs text-grey-600" title={dateTime(row.original.createdAt)}>{relative(row.original.createdAt)}</span> },
    { header: 'Sent', cell: ({ row }) => <span className="text-xs text-grey-600" title={dateTime(row.original.sentAt)}>{row.original.sentAt ? relative(row.original.sentAt) : '—'}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => manage && (
      <span className="flex justify-end gap-1">
        {row.original.status === 'FAILED' && <Button size="sm" variant="secondary" onClick={() => retry.mutate(row.original.id)} loading={retry.isPending}><RotateCcw size={14} /> Retry</Button>}
        {row.original.status === 'QUEUED' && <Button size="sm" variant="ghost" className="text-red" onClick={() => setCancelling(row.original)}><Ban size={14} /> Cancel</Button>}
      </span>
    ) },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Queued" value={s ? count(queued) : null} sub={s?.oldestQueuedAt ? `Oldest waiting ${relative(s.oldestQueuedAt)}` : 'Nothing waiting'} tone={queued > 0 && s?.oldestQueuedAt && Date.parse(s.oldestQueuedAt) < nowMs() - 10 * 60_000 ? 'warn' : undefined} />
        <StatTile label="Sent · Last 24 h" value={s ? count(s.last24h.SENT ?? 0) : null} sub={s ? Object.entries(s.byChannel24h).map(([c, n]) => `${c.replace('_', ' ')} ${n}`).join(' · ') || 'No traffic yet' : ''} />
        <StatTile label="Failed" value={s ? count(failed) : null} sub={failed ? 'Retry after fixing the cause' : 'No failures'} tone={failed > 0 ? 'bad' : undefined} />
        <StatTile label="Cancelled" value={s ? count(s.byStatus.CANCELLED ?? 0) : null} sub="Stopped by an administrator" />
      </div>
      {stats.isError && <ErrorState error={stats.error} retry={() => stats.refetch()} />}

      <Card
        title="Outbox"
        description="Every message the platform decided to send, newest first. Rows refresh automatically while something is queued."
        actions={manage && (
          <>
            <Button size="sm" variant="secondary" onClick={() => deliverNow.mutate()} loading={deliverNow.isPending} disabled={queued === 0} title={queued ? 'Deliver everything queued right now' : 'Nothing is queued'}><Play size={14} /> Deliver Now{queued ? ` (${count(queued)})` : ''}</Button>
            <Button size="sm" variant="secondary" onClick={() => retryAll.mutate()} loading={retryAll.isPending} disabled={failed === 0}><RotateCcw size={14} /> Retry All Failed{filters.templateKey ? ' for Key' : ''}</Button>
          </>
        )}
      >
        <DataTable<Notification>
          path="/admin/notifications"
          params={{ status: filters.status, channel: filters.channel, templateKey: filters.templateKey, userId: userIdValid ? userId : '' }}
          columns={columns}
          emptyTitle={Object.values(filters).some(Boolean) ? 'No Messages Match' : 'No Messages Yet'}
          emptyDescription={Object.values(filters).some(Boolean) ? 'Try clearing a filter.' : 'Invitations, password resets, booking confirmations and status updates appear here as soon as they are queued.'}
          refetchInterval={(rows) => (rows.some((n) => n.status === 'QUEUED') ? 5_000 : false)}
          toolbar={
            <>
              <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-40"><option value="">All Statuses</option>{STATUSES.map((x) => <option key={x} value={x}>{title(x)}</option>)}</Select>
              <Select aria-label="Channel" value={filters.channel} onChange={(e) => set('channel', e.target.value)} className="w-36"><option value="">All Channels</option>{(catalogue?.channels ?? ['EMAIL', 'SMS', 'PUSH', 'IN_APP']).map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select>
              <Select aria-label="Template" value={filters.templateKey} onChange={(e) => set('templateKey', e.target.value)} className="w-56"><option value="">All Templates</option>{catalogue?.keys.map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}</Select>
              <Input aria-label="User ID" placeholder="User ID" value={filters.userId} onChange={(e) => set('userId', e.target.value)} className={cx('w-72', !userIdValid && 'border-red')} aria-invalid={!userIdValid} />
              {Object.values(filters).some(Boolean) && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
            </>
          }
        />
        {!userIdValid && <p role="alert" className="mt-2 text-xs text-red">Paste the full user ID (UUID) from the Users page.</p>}
      </Card>

      <ConfirmDialog open={!!cancelling} onClose={() => { setCancelling(null); setReason(''); }} onConfirm={() => cancelling && cancel.mutate(cancelling)} title="Cancel This Message?" message={`The ${cancelling?.channel ?? ''} to ${cancelling?.recipient ?? ''} will never be delivered and any one-time code inside it is discarded.`} confirmLabel="Cancel Message" loading={cancel.isPending} danger>
        <Field label="Reason" required hint="Written to the audit log" className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} /></Field>
      </ConfirmDialog>
    </>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string | null; sub: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={cx('rounded-lg border p-3', tone === 'bad' ? 'border-red/30 bg-red-soft' : tone === 'warn' ? 'border-orange/30 bg-orange-soft' : 'border-grey-200 bg-grey-50')}>
      <p className="text-xs font-medium text-grey-500">{label}</p>
      {value === null ? <div className="mt-1 h-7 w-16 animate-pulse rounded bg-grey-200" /> : <p className={cx('tnum mt-1 text-xl font-bold', tone === 'bad' && 'text-red', tone === 'warn' && 'text-orange')}>{value}</p>}
      <p className="truncate text-xs text-grey-500" title={sub}>{sub}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Templates
   ═══════════════════════════════════════════════════════════════════════════ */
type Draft = { key: string; channel: string; locale: string; subject: string; body: string; customKey: boolean };

function TemplatesTab({ catalogue, manage, smtp }: { catalogue: ReturnType<typeof useGet<Catalogue>>; manage: boolean; smtp: boolean }) {
  const templates = useGet<Template[]>('/admin/notification-templates');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<{ key: string; channel: string; locale: string } | null>(null);
  const cat = catalogue.data;

  // One row per (key, channel, locale) that either exists or that the code needs.
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; channel: string; locale: string; active: Template | null; versions: Template[]; needed: boolean }>();
    const id = (k: string, c: string, l: string) => `${k}|${c}|${l}`;
    for (const k of cat?.keys ?? []) for (const c of k.channels) map.set(id(k.key, c, 'en'), { key: k.key, channel: c, locale: 'en', active: null, versions: [], needed: true });
    for (const t of templates.data ?? []) {
      const row = map.get(id(t.key, t.channel, t.locale)) ?? { key: t.key, channel: t.channel, locale: t.locale, active: null, versions: [], needed: false };
      row.versions.push(t);
      if (t.isActive) row.active = t;
      map.set(id(t.key, t.channel, t.locale), row);
    }
    return Array.from(map.values()).sort((a, b) => Number(!!a.active) - Number(!!b.active) || a.key.localeCompare(b.key) || a.channel.localeCompare(b.channel) || a.locale.localeCompare(b.locale));
  }, [cat, templates.data]);

  const startNew = () => setDraft({ key: cat?.keys[0]?.key ?? '', channel: 'EMAIL', locale: 'en', subject: '', body: '', customKey: false });
  const startFor = (key: string, channel: string, locale: string, from?: Template | null) => setDraft({ key, channel, locale, subject: from?.subject ?? '', body: from?.body ?? '', customKey: !cat?.keys.some((k) => k.key === key) });

  return (
    <>
      <Card
        title="Message Templates"
        description="One active version per key, channel and language. Publishing never edits history: the previous version is kept and can be restored."
        actions={manage && <Button size="sm" variant="secondary" onClick={startNew}><Plus size={14} /> New Template</Button>}
      >
        {templates.isPending || catalogue.isPending ? <Skeleton rows={6} /> : templates.isError ? <ErrorState error={templates.error} retry={() => templates.refetch()} /> : catalogue.isError ? <ErrorState error={catalogue.error} retry={() => catalogue.refetch()} /> : rows.length === 0 ? <p className="text-sm text-grey-500">No templates yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-grey-500"><tr><th className="py-1 pr-3">Key</th><th className="px-2 py-1">Channel</th><th className="px-2 py-1">Language</th><th className="px-2 py-1">Version</th><th className="px-2 py-1">Message</th><th className="py-1" /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const info = cat?.keys.find((k) => k.key === r.key);
                  const unused = !info || !info.channels.includes(r.channel);
                  const Icon = CHANNEL_ICON[r.channel] ?? Send;
                  return (
                    <tr key={`${r.key}|${r.channel}|${r.locale}`} className={cx('border-t border-grey-100 align-top', !r.active && r.needed && 'bg-red-soft/60')}>
                      <td className="py-2 pr-3"><p className="font-mono text-xs font-medium">{r.key}</p>{info && <p className="max-w-xs text-xs text-grey-500">{info.description}</p>}</td>
                      <td className="px-2 py-2 text-xs"><span className="inline-flex items-center gap-1.5"><Icon size={14} aria-hidden className="text-grey-500" />{r.channel.replace('_', ' ')}</span></td>
                      <td className="px-2 py-2 text-xs">{LOCALE_NAMES[r.locale] ?? r.locale}</td>
                      <td className="px-2 py-2 text-xs">
                        {r.active ? <span className="flex items-center gap-1.5"><Badge accent="green">Active</Badge><span className="tnum text-grey-600">v{r.active.version}</span></span> : r.needed ? <Badge accent="red">Missing</Badge> : <Badge>Inactive</Badge>}
                        {unused && r.active && <p className="mt-1 max-w-40 text-[11px] text-grey-500">Nothing sends this channel yet</p>}
                      </td>
                      <td className="max-w-md px-2 py-2 text-xs">{r.active ? <>{r.active.subject && <p className="font-medium">{r.active.subject}</p>}<p className="line-clamp-2 text-grey-700" title={r.active.body}>{r.active.body}</p></> : <p className="text-grey-500">Deliveries of this message fail until a template is published.</p>}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {r.versions.length > 1 && <Button size="sm" variant="ghost" onClick={() => setHistory({ key: r.key, channel: r.channel, locale: r.locale })}><History size={14} /> {r.versions.length} Versions</Button>}
                        {manage && (r.active ? <Button size="sm" variant="ghost" onClick={() => startFor(r.key, r.channel, r.locale, r.active)}>Edit</Button> : <Button size="sm" variant="secondary" onClick={() => startFor(r.key, r.channel, r.locale)}><Plus size={14} /> Create</Button>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {draft && cat && <TemplateEditor draft={draft} catalogue={cat} smtp={smtp} onClose={() => setDraft(null)} onPublished={() => { setDraft(null); void templates.refetch(); void catalogue.refetch(); }} />}

      <Dialog open={!!history} onClose={() => setHistory(null)} title="Version History" description={history ? `${history.key} · ${history.channel} · ${LOCALE_NAMES[history.locale] ?? history.locale}` : undefined} icon={History} wide footer={<Button variant="ghost" onClick={() => setHistory(null)}>Close</Button>}>
        {history && (
          <ul className="space-y-3">
            {(templates.data ?? []).filter((t) => t.key === history.key && t.channel === history.channel && t.locale === history.locale).sort((a, b) => b.version - a.version).map((t) => (
              <li key={t.id} className={cx('rounded-lg border p-3', t.isActive ? 'border-ink' : 'border-grey-200')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">v{t.version} {t.isActive && <Badge accent="green">Active</Badge>}</span>
                  {manage && !t.isActive && <Button size="sm" variant="secondary" onClick={() => { setHistory(null); startFor(t.key, t.channel, t.locale, t); }}><RotateCcw size={14} /> Restore as New Version</Button>}
                </div>
                {t.subject && <p className="mt-2 text-sm font-medium">{t.subject}</p>}
                <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-grey-700">{t.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}

/** Editor with a live, server-rendered preview using the catalogue's sample values. */
function TemplateEditor({ draft, catalogue, smtp, onClose, onPublished }: { draft: Draft; catalogue: Catalogue; smtp: boolean; onClose: () => void; onPublished: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const debounced = useDebounced(`${d.key}|${d.channel}|${d.subject}|${d.body}`, 400);
  const info = catalogue.keys.find((k) => k.key === d.key);
  const keyValid = /^[a-z0-9_.]{3,96}$/.test(d.key);
  const previewable = keyValid && d.body.trim().length > 0;

  useEffect(() => {
    if (!keyValid || !d.body.trim()) return;
    let active = true;
    api.post<{ data: Preview }>('/admin/notification-templates/preview', { key: d.key, channel: d.channel, subject: d.subject || undefined, body: d.body })
      .then((r) => { if (active) { setPreview(r.data); setPreviewError(null); } })
      .catch((e: unknown) => { if (active) setPreviewError(e instanceof Error ? e.message : 'Preview failed'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preview follows the debounced draft only
  }, [debounced]);

  const publish = useAction(() => api.post('/admin/notification-templates', { key: d.key, channel: d.channel, locale: d.locale, subject: d.channel === 'EMAIL' ? d.subject : undefined, body: d.body }), { success: 'New version published and active', invalidate: ['/admin/notification-templates', '/admin/notifications/stats'], onSuccess: onPublished, onError: (e) => { if (e instanceof ApiError) toast.error(e); } });
  const testSend = useAction(() => api.post<{ data: { messageId: string; subject: string } }>('/admin/notification-templates/test-send', { key: d.key, locale: d.locale, to: testTo }), { onSuccess: (r) => toast.success('Test email sent', r.data.subject) });

  const insert = (name: string) => setD({ ...d, body: `${d.body}${d.body && !d.body.endsWith(' ') ? ' ' : ''}{{${name}}}` });
  const shown = previewable ? preview : null;
  const blocked = !previewable || (d.channel === 'EMAIL' && !d.subject.trim()) || !shown || shown.errors.length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      icon={CHANNEL_ICON[d.channel] ?? Send}
      title="Publish Template Version"
      description="Publishing activates this version immediately for new messages; the previous version stays in history."
      footer={<><Button variant="ghost" onClick={onClose} disabled={publish.isPending}>Cancel</Button><Button onClick={() => publish.mutate()} loading={publish.isPending} disabled={blocked}><CheckCircle2 size={16} /> Publish</Button></>}
    >
      <div className="space-y-4">
        <FormSection title="What & Where" icon={Send} accent="blue" hint="The key is what the code sends; pick one from the list unless you are preparing a template for a feature that does not exist yet.">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Message Key" required error={!keyValid && d.key ? 'Lower-case letters, digits, dots and underscores (3–96)' : undefined} className="md:col-span-3 xl:col-span-1">
              {d.customKey ? <Input value={d.key} onChange={(e) => setD({ ...d, key: e.target.value.toLowerCase() })} placeholder="feature.event_name" /> : (
                <Select value={d.key} onChange={(e) => setD({ ...d, key: e.target.value })}>{catalogue.keys.map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}</Select>
              )}
              <button type="button" className="mt-1 text-xs text-grey-500 underline-offset-2 hover:underline" onClick={() => setD({ ...d, customKey: !d.customKey, key: d.customKey ? (catalogue.keys[0]?.key ?? '') : d.key })}>{d.customKey ? 'Choose a known key instead' : 'Use a custom key'}</button>
            </Field>
            <Field label="Channel" required hint={info && !info.channels.includes(d.channel) ? `Code sends ${d.key} by ${info.channels.join(' / ')} only` : undefined}><Select value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value })}>{catalogue.channels.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</Select></Field>
            <Field label="Language" required hint="English is the fallback and must exist"><Select value={d.locale} onChange={(e) => setD({ ...d, locale: e.target.value })}>{catalogue.locales.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l] ?? l}</option>)}</Select></Field>
          </div>
          {info && <p className="mt-2 text-xs text-grey-600">{info.description}</p>}
        </FormSection>

        <div className="grid gap-4 lg:grid-cols-2">
          <FormSection title="Message" icon={MessageSquareText} accent="purple" hint="Click a placeholder to insert it. Anything else in double braces renders empty and is refused.">
            {d.channel === 'EMAIL' && <Field label="Subject" required error={!d.subject.trim() && d.body ? 'Email needs a subject' : undefined} className="mb-3"><Input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} maxLength={200} /></Field>}
            <Field label="Body" required>
              <Textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} className={cx('font-mono text-xs', d.channel === 'SMS' ? 'min-h-28' : 'min-h-44')} maxLength={8000} />
            </Field>
            {info ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(info.variables).map(([name, desc]) => <button key={name} type="button" onClick={() => insert(name)} title={desc} className={cx('rounded-lg border px-2 py-0.5 font-mono text-[11px]', shown?.placeholders.includes(name) ? 'border-ink bg-ink text-paper' : 'border-grey-300 hover:bg-grey-50')}>{`{{${name}}}`}</button>)}
              </div>
            ) : <p className="mt-2 text-xs text-grey-500">Custom keys have no known variables; placeholders will be shown as &lt;name&gt; in the preview.</p>}
            {d.channel === 'SMS' && shown?.sms && <p className={cx('mt-2 text-xs', shown.sms.segments > 1 ? 'text-orange' : 'text-grey-500')}>{shown.sms.length} characters · {shown.sms.encoding} · {shown.sms.segments} SMS part{shown.sms.segments === 1 ? '' : 's'}{shown.sms.encoding === 'UCS-2' ? ' (non-Latin text halves the per-part limit)' : ''}</p>}
          </FormSection>

          <FormSection title="Preview" icon={CheckCircle2} accent="green" hint={info ? 'Rendered with sample values the platform would send.' : 'Rendered with placeholder names.'}>
            {previewError ? <ErrorState error={new Error(previewError)} /> : !shown ? <p className="text-sm text-grey-500">{previewable ? 'Rendering…' : 'Type a message to see the preview.'}</p> : (
              <>
                <div className={cx('rounded-lg border border-grey-200 p-3 text-sm', d.channel === 'SMS' ? 'max-w-xs bg-green-soft' : 'bg-grey-50')}>
                  {shown.rendered.subject && <p className="mb-1 font-medium">{shown.rendered.subject}</p>}
                  <p className="whitespace-pre-wrap">{shown.rendered.body}</p>
                </div>
                {shown.errors.map((e) => <p key={e} role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{e}</p>)}
                {shown.warnings.map((w) => <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-orange"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{w}</p>)}
                {!shown.errors.length && !shown.warnings.length && <p className="mt-2 flex items-center gap-1.5 text-xs text-green"><CheckCircle2 size={12} aria-hidden /> Ready to publish</p>}
              </>
            )}
            {d.channel === 'EMAIL' && (
              <div className="mt-4 border-t border-grey-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-grey-500">Send a Test</p>
                <p className="mt-0.5 text-xs text-grey-500">{smtp ? 'Sends the currently active version of this key, with sample values, to one address.' : 'Configure SMTP in Settings → Email to send test messages.'}</p>
                <div className="mt-2 flex gap-2">
                  <Input type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} disabled={!smtp} />
                  <Button variant="secondary" onClick={() => testSend.mutate()} loading={testSend.isPending} disabled={!smtp || !/^\S+@\S+\.\S+$/.test(testTo)}><Send size={14} /> Send</Button>
                </div>
              </div>
            )}
          </FormSection>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-grey-500"><RefreshCw size={12} aria-hidden /> Messages already queued keep the version that was active when they are delivered, not when they were queued.</p>
      </div>
    </Dialog>
  );
}
