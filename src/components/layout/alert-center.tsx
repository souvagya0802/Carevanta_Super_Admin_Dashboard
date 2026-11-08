'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Ambulance, BadgeCheck, BellRing, CalendarCheck, CalendarClock, CalendarX, Check, FileCheck2, FlaskConical, Handshake, LifeBuoy, Pill, ReceiptText, Siren, Star, Volume2, VolumeX, X, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { liveAlerts, soundedElsewhere, type LiveAlert } from '@/lib/live-alerts';
import { relative } from '@/lib/format';
import { ACCENT, Button, cx, type Accent } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface Look { icon: LucideIcon; label: string; tone: Accent }

/** Colour, icon and heading per kind of alert, so people recognise it before they read it. */
function lookOf(a: LiveAlert): Look {
  const k = a.templateKey;
  const kind = a.meta?.kind ?? '';
  if (k === 'portal.dispatch_offer' || kind === 'dispatch') return { icon: Siren, label: 'Emergency Request', tone: 'red' };
  if (k.includes('rescheduled')) return { icon: CalendarClock, label: 'Appointment Moved', tone: 'orange' };
  if (/cancel|reject/.test(k)) return { icon: CalendarX, label: /diagnostic|pharmacy/.test(k) ? 'Order Cancelled' : 'Booking Cancelled', tone: 'red' };
  if (k.includes('appointment') || kind === 'appointment') return { icon: CalendarCheck, label: 'New Appointment', tone: 'blue' };
  if (k.includes('diagnostic') || kind === 'diagnostic_order') return { icon: FlaskConical, label: 'New Test Order', tone: 'purple' };
  if (k.includes('pharmacy') || kind === 'pharmacy_order' || kind === 'prescription') return { icon: Pill, label: 'New Medicine Order', tone: 'orange' };
  if (k.includes('affiliation') || kind === 'affiliation') return { icon: Handshake, label: 'Doctor Network', tone: 'teal' };
  if (k.includes('report')) return { icon: FileCheck2, label: 'Report', tone: 'green' };
  if (k.includes('ambulance')) return { icon: Ambulance, label: 'Ambulance', tone: 'red' };
  // Platform team alerts (super admin).
  if (kind === 'application' || kind === 'verification') return { icon: BadgeCheck, label: 'Verification', tone: 'blue' };
  if (kind === 'refund' || (kind === 'support_case' && /refund/i.test(a.title))) return { icon: ReceiptText, label: 'Refund Request', tone: 'orange' };
  if (kind === 'support_case') return { icon: LifeBuoy, label: 'Support Case', tone: 'purple' };
  if (kind === 'review') return { icon: Star, label: 'Review To Moderate', tone: 'teal' };
  return { icon: BellRing, label: 'Notification', tone: 'ink' };
}

/** "Pooja Patra · Dr. X · 10 Nov, 7:00 am" reads better as separate lines. */
const detailLines = (body: string) => body.split(' · ').map((s) => s.trim()).filter(Boolean);

/**
 * Pop-up alerts for the platform team (same design as the provider portal). Critical alerts (emergency requests) take over
 * the screen with a repeating sound until someone acts; important ones slide
 * open as a card in the centre of the screen until answered; light ones are a
 * corner banner that fades. The bell keeps the
 * full history either way.
 */
export function AlertCenter() {
  const { alerts, muted, soundBlocked } = useSyncExternalStore(liveAlerts.subscribe, liveAlerts.get, liveAlerts.getServer);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const played = useRef(new Set<string>());

  // Listen while this shell is mounted (it only renders for a signed-in member).
  useEffect(() => liveAlerts.start(), []);
  // Keep the bell and the notifications page in step with what arrives.
  useEffect(() => liveAlerts.onNew(() => { void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).startsWith('/portal/notifications') }); }), [qc]);

  // Sound once per new alert; critical repeats every 4 s until handled.
  useEffect(() => {
    for (const a of alerts) {
      if (played.current.has(a.id)) continue;
      played.current.add(a.id);
      setTimeout(() => { if (!soundedElsewhere.has(a.id)) liveAlerts.sound(a); }, 150);
    }
    const critical = alerts.find((a) => a.level === 'critical');
    if (!critical) return;
    const t = setInterval(() => liveAlerts.sound(critical), 4_000);
    return () => clearInterval(t);
  }, [alerts]);

  // While the tab is in the background, flash its title so the alert is seen in the tab bar.
  const top = alerts.find((a) => a.level !== 'light');
  useEffect(() => {
    if (!top) return;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') { document.title = original; return; }
      on = !on;
      document.title = on ? `🔔 ${top.title}` : original;
    }, 1_200);
    return () => { clearInterval(t); document.title = original; };
  }, [top]);

  const open = (a: LiveAlert) => { void liveAlerts.dismiss(a.id); if (a.link) router.push(a.link); };
  async function confirmBooking(a: LiveAlert) {
    if (!a.meta?.providerId) return;
    setBusy(a.id);
    try {
      await api.post(`/portal/providers/${a.meta.providerId}/appointments/${a.meta.id}/actions`, { action: 'CONFIRM' });
      toast.success('Appointment confirmed', 'The patient has been told.');
      void liveAlerts.dismiss(a.id);
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).includes('/appointments') });
    } catch (e) {
      toast.error(e, 'Could not confirm the appointment. Open it and try again.');
    } finally {
      setBusy(null);
    }
  }

  const critical = alerts.find((a) => a.level === 'critical');
  const important = alerts.filter((a) => a.level === 'important');
  const light = alerts.filter((a) => a.level === 'light');
  const card = !critical ? important[0] : undefined;
  const banner = !critical && !card ? light[0] : undefined;
  const iconButton = (label: string, onClick: () => void, children: ReactNode) => (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-grey-400 transition-colors hover:bg-grey-100 hover:text-ink">{children}</button>
  );
  const enableSound = soundBlocked && !muted && (
    <button type="button" onClick={() => liveAlerts.enableSound()} className="flex w-full items-center justify-center gap-2 border-t border-orange/20 bg-orange-soft px-4 py-2.5 text-xs font-semibold text-orange hover:bg-orange/15">
      <Volume2 size={14} aria-hidden /> Enable Sound For Alerts
    </button>
  );

  return (
    <>
      {critical && <CriticalAlert a={critical} look={lookOf(critical)} onOpen={() => open(critical)} onAck={() => void liveAlerts.dismiss(critical.id)} muted={muted} more={alerts.filter((a) => a.level === 'critical').length - 1} footer={enableSound} />}

      {/* Important: a card in the centre of the screen until someone answers it. */}
      {card && (() => {
        const look = lookOf(card);
        const tone = ACCENT[look.tone];
        const Icon = look.icon;
        const lines = detailLines(card.body);
        const canConfirm = card.meta?.kind === 'appointment' && card.meta.status === 'REQUESTED' && !!card.meta.providerId;
        return (
          <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby={`alert-${card.id}`} aria-describedby={`alert-${card.id}-body`}>
            <button type="button" aria-label="Remind Me Later" onClick={() => liveAlerts.snooze(card.id)} className="animate-fade-in absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px]" />
            <article key={card.id} className="animate-alert-in relative w-full max-w-[420px] overflow-hidden rounded-lg bg-paper shadow-[0_30px_80px_-20px_rgba(15,23,42,0.55)] ring-1 ring-grey-200">
              <div aria-hidden className={cx('h-1.5', tone.bg)} />
              <div className="flex items-start gap-1 pt-3 pr-2 pl-5">
                <p className={cx('min-w-0 flex-1 pt-2.5 text-[11px] font-bold uppercase tracking-wider', tone.text)}>
                  {look.label}<span className="ml-1.5 font-medium normal-case tracking-normal text-grey-400">· {relative(card.createdAt)}{important.length > 1 ? ` · 1 of ${important.length}` : ''}</span>
                </p>
                {iconButton(muted ? 'Turn Alert Sound On' : 'Turn Alert Sound Off', () => liveAlerts.setMuted(!muted), muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />)}
                {iconButton('Remind Me Later', () => liveAlerts.snooze(card.id), <X size={17} aria-hidden />)}
              </div>
              <div className="flex gap-4 px-5 pt-1 pb-5">
                <span className={cx('alert-glow flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-paper', tone.bg)} style={{ ['--glow' as string]: tone.hex }}><Icon size={22} aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h2 id={`alert-${card.id}`} className="text-lg font-semibold leading-snug text-ink">{card.title}</h2>
                  <div id={`alert-${card.id}-body`} className="mt-1.5 space-y-0.5 text-sm text-grey-600">
                    {lines.map((l, n) => <p key={n} className={cx(n === 0 && lines.length > 1 && 'font-medium text-grey-800')}>{l}</p>)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-grey-100 bg-grey-50 px-5 py-3">
                <Button size="sm" variant="ghost" onClick={() => void liveAlerts.dismiss(card.id)} className="mr-auto">Mark Seen</Button>
                {card.link && <Button size="sm" variant={canConfirm ? 'secondary' : 'primary'} onClick={() => open(card)}>View Details</Button>}
                {canConfirm && <Button size="sm" onClick={() => void confirmBooking(card)} loading={busy === card.id}><Check size={14} aria-hidden /> Confirm Booking</Button>}
              </div>
              {enableSound}
            </article>
          </div>
        );
      })()}

      {/* Small updates: a compact banner in the corner that fades by itself. */}
      {banner && (() => {
        const look = lookOf(banner);
        const tone = ACCENT[look.tone];
        const Icon = look.icon;
        return (
          <div className="pointer-events-none fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-[60] flex justify-end sm:inset-x-auto sm:right-5 lg:bottom-auto lg:top-20">
            <button type="button" role="status" onClick={() => open(banner)} className="animate-alert-in pointer-events-auto flex w-full items-center gap-3 rounded-lg bg-paper p-3 text-left shadow-[0_18px_48px_-12px_rgba(15,23,42,0.35)] ring-1 ring-grey-200 sm:w-[360px]">
              <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-paper', tone.bg)}><Icon size={16} aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{banner.title}</span><span className="block truncate text-xs text-grey-500">{banner.body}</span></span>
            </button>
          </div>
        );
      })()}
    </>
  );
}

/** Full-screen alert for emergencies: cannot be missed or closed by accident. */
function CriticalAlert({ a, look, onOpen, onAck, muted, more, footer }: { a: LiveAlert; look: Look; onOpen: () => void; onAck: () => void; muted: boolean; more: number; footer?: ReactNode }) {
  const Icon = look.icon;
  const tone = ACCENT[look.tone];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button[data-primary]')?.focus(); }, [a.id]);
  const lines = detailLines(a.body);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby={`alert-${a.id}`} aria-describedby={`alert-${a.id}-body`}>
      <div className="critical-backdrop absolute inset-0" />
      <div ref={ref} className="animate-scale-in relative w-full max-w-md overflow-hidden rounded-lg bg-paper shadow-2xl">
        <header className="flex items-center gap-2 bg-ink py-2 pr-2 pl-4 text-paper">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inset-0 animate-ping rounded-full bg-red" /><span className="relative h-2.5 w-2.5 rounded-full bg-red" /></span>
          <p className="flex-1 text-xs font-semibold uppercase tracking-wider">{look.label}{more > 0 ? ` · ${more} More Waiting` : ''}</p>
          <button type="button" onClick={() => liveAlerts.setMuted(!muted)} aria-label={muted ? 'Turn Alert Sound On' : 'Turn Alert Sound Off'} className="flex h-10 w-10 items-center justify-center rounded-lg text-grey-400 hover:bg-white/10 hover:text-paper">{muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}</button>
        </header>
        <div className="flex flex-col items-center px-6 pt-7 pb-6 text-center">
          <span className={cx('critical-pulse flex h-20 w-20 items-center justify-center rounded-full text-paper', tone.bg)}><Icon size={36} aria-hidden /></span>
          <h2 id={`alert-${a.id}`} className="mt-5 text-xl font-bold leading-tight">{a.title}</h2>
          <div id={`alert-${a.id}-body`} className="mt-2 space-y-0.5 text-sm text-grey-600">{lines.map((l, n) => <p key={n} className={n === 0 ? 'font-medium text-grey-800' : ''}>{l}</p>)}</div>
          <p className="mt-2 text-xs text-grey-500">{relative(a.createdAt)}</p>
          <div className="mt-6 grid w-full gap-2">
            {a.link && <Button data-primary onClick={onOpen} className="h-12 bg-red text-base hover:bg-red/90"><Siren size={18} aria-hidden /> Open Now</Button>}
            <Button variant="secondary" onClick={onAck} data-primary={a.link ? undefined : true}>Acknowledge</Button>
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}
