'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Download, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { money } from '@/lib/format';
import { Button, IconTile, cx, type Accent } from '@/components/ui/primitives';

/* ─── Money / basis-point helpers (mirror the API's integer arithmetic) ──── */
export const toMinor = (rupees: string | number): number | null => {
  const n = typeof rupees === 'number' ? rupees : Number(String(rupees).replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};
export const fromMinor = (minor: number | null | undefined) => (minor == null ? '' : (minor / 100).toFixed(2));
export const bpsToPct = (bps: number | null | undefined) => (bps == null ? '' : String(bps / 100));
export const pctToBps = (pct: string): number | null => {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};
export const fmtBps = (bps: number) => `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

/** Half-up basis-point multiplication on integers, identical to the server's applyBps. */
const applyBps = (amount: bigint, bps: number) => {
  const product = amount * BigInt(bps);
  const q = product / 10_000n;
  const r = product % 10_000n;
  return r * 2n >= 10_000n ? q + 1n : q;
};

export interface Terms { method: 'PERCENTAGE' | 'FLAT'; rateBps?: number | null; flatMinor?: number | null; minMinor?: number | null; maxMinor?: number | null; taxRateBps: number }

/** Same algorithm as the API's calculateCommission, for instant previews. */
export function calcCommission(t: Terms, baseMinor: number) {
  const base = BigInt(Math.max(0, Math.round(baseMinor)));
  let c = t.method === 'PERCENTAGE' ? applyBps(base, t.rateBps ?? 0) : BigInt(t.flatMinor ?? 0);
  if (t.minMinor != null && c < BigInt(t.minMinor)) c = BigInt(t.minMinor);
  if (t.maxMinor != null && c > BigInt(t.maxMinor)) c = BigInt(t.maxMinor);
  if (c > base) c = base;
  let tax = applyBps(c, t.taxRateBps);
  if (c + tax > base) {
    c = (base * 10_000n) / (10_000n + BigInt(t.taxRateBps));
    tax = applyBps(c, t.taxRateBps);
    while (c > 0n && c + tax > base) { c -= 1n; tax = applyBps(c, t.taxRateBps); }
  }
  return { baseMinor: Number(base), commissionMinor: Number(c), taxMinor: Number(tax), providerNetMinor: Number(base - c - tax) };
}

export const describeTerms = (t: Terms) => {
  const core = t.method === 'PERCENTAGE' ? `${fmtBps(t.rateBps ?? 0)} of the service value` : `${money(t.flatMinor ?? 0)} flat`;
  const bounds = [t.minMinor != null ? `min ${money(t.minMinor)}` : null, t.maxMinor != null ? `max ${money(t.maxMinor)}` : null].filter(Boolean).join(', ');
  const tax = t.taxRateBps ? ` + ${fmtBps(t.taxRateBps)} tax` : '';
  return `${core}${bounds ? ` (${bounds})` : ''}${tax}`;
};

/* ─── Finance KPIs from the analytics overview ───────────────────────────── */
export interface FinanceOverview {
  range: { from: string; to: string };
  finance: { grossTransactionValueMinor: number; commissionRevenueMinor: number; commissionTaxMinor: number; completedTransactions: number; refundsMinor: number; refundsCount: number; failedPayments: number; providerPayablesMinor: number; providersWithPayables: number; settlementBatchesByStatus: Record<string, number> };
}
export function useFinanceOverview(days = 30) {
  const { can } = useAuth();
  // Computed once per mount so the query key is stable and no clock is read during render.
  const [from] = useState(() => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10));
  return useGet<FinanceOverview>(can('analytics.read') ? `/admin/analytics/overview?from=${from}T00:00:00.000Z` : null);
}

export function Kpi({ icon, accent, label, value, sub, loading, href }: { icon: LucideIcon; accent: Accent; label: string; value: ReactNode; sub?: ReactNode; loading?: boolean; href?: string }) {
  const body = (
    <div className={cx('flex items-start gap-3 rounded-2xl border border-grey-200 bg-paper px-4 py-3 shadow-[var(--shadow-card)]', href && 'transition-colors hover:bg-grey-50')}>
      <IconTile icon={icon} accent={accent} size="sm" />
      <div className="min-w-0">
        {loading ? <div className="h-6 w-20 animate-pulse rounded bg-grey-100" /> : <p className="tnum truncate text-lg font-bold leading-tight">{value}</p>}
        <p className="truncate text-[11px] text-grey-500">{label}</p>
        {sub && <p className="truncate text-[11px] text-grey-600">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/* ─── Lifecycle strip ───────────────────────────────────────────────────── */
export function Lifecycle({ steps, current, terminal }: { steps: readonly string[]; current: string; terminal?: { status: string; label?: string; accent?: Accent } }) {
  const idx = steps.indexOf(current);
  const isTerminal = terminal && current === terminal.status;
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Lifecycle">
      {steps.map((s, n) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cx('rounded-full px-2.5 py-1 font-medium', !isTerminal && n < idx ? 'bg-green-soft text-green' : !isTerminal && n === idx ? 'bg-ink text-paper' : 'bg-grey-100 text-grey-500')}>{s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>
          {n < steps.length - 1 && <span className={cx('h-px w-4', !isTerminal && n < idx ? 'bg-green' : 'bg-grey-300')} />}
        </li>
      ))}
      {isTerminal && <li><span className={cx('rounded-full px-2.5 py-1 font-medium', terminal.accent === 'green' ? 'bg-green-soft text-green' : 'bg-red-soft text-red')}>{terminal.label ?? terminal.status.replace(/_/g, ' ').toLowerCase()}</span></li>}
    </ol>
  );
}

/* ─── CSV export button (background job, downloaded from Reports) ───────── */
export function ExportButton({ type, filters, label = 'Export CSV' }: { type: 'transactions' | 'settlements' | 'appointments' | 'providers' | 'users' | 'audit_events'; filters?: Record<string, string | undefined>; label?: string }) {
  const { can } = useAuth();
  const [done, setDone] = useState(false);
  const run = useAction(() => api.post<{ data: { id: string } }>('/admin/exports', { exportType: type, filters: Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v)) }), { success: 'Export queued — download it from Reports & Exports when it finishes', onSuccess: () => setDone(true) });
  if (!can('exports.create')) return null;
  return done ? <Link href="/reports"><Button size="sm" variant="secondary"><Download size={14} /> Open exports</Button></Link> : <Button size="sm" variant="secondary" onClick={() => run.mutate()} loading={run.isPending}><Download size={14} /> {label}</Button>;
}

/** Two-column amount row used in breakdowns. */
export function AmountRow({ label, minor, strong, negative, hint }: { label: ReactNode; minor: number; strong?: boolean; negative?: boolean; hint?: string }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3 py-1 text-sm', strong && 'border-t border-grey-200 pt-2 font-semibold')}>
      <span className="min-w-0"><span>{label}</span>{hint && <span className="ml-2 text-xs font-normal text-grey-500">{hint}</span>}</span>
      <span className={cx('tnum shrink-0', negative && 'text-red')}>{negative ? '−' : ''}{money(Math.abs(minor))}</span>
    </div>
  );
}

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');

/* ─── "Where does the money come from?" explainer ───────────────────────── */
const FLOW_STEPS: { title: string; body: string; accent: Accent }[] = [
  { title: '1 · Patient pays', body: 'Online through the gateway (captured only after the signed webhook) or at the provider’s counter.', accent: 'blue' },
  { title: '2 · Service completed', body: 'The appointment, order or trip is marked completed. Only completed, platform-attributed transactions earn commission.', accent: 'teal' },
  { title: '3 · Commission frozen', body: 'The active policy is resolved and a snapshot is stored — later policy changes never alter it.', accent: 'purple' },
  { title: '4 · Ledger posted', body: '+ service earning, − commission, − tax are appended to the provider’s ledger. That sum is the payable balance.', accent: 'green' },
  { title: '5 · Hold period', body: 'Entries wait the configured number of days so refunds and disputes can claw back before money moves.', accent: 'orange' },
  { title: '6 · Batch & payout', body: 'One user prepares a batch, another approves it, and each bank transfer is recorded with its UTR.', accent: 'ink' },
];

/** Compact pipeline strip explaining how a payable balance arises; shows the live hold period when readable. */
export function MoneyFlow({ className }: { className?: string }) {
  const { can } = useAuth();
  const settings = useGet<{ key: string; value: unknown }[]>(can('settings.read') ? '/admin/settings' : null);
  const hold = settings.data?.find((s) => s.key === 'finance.settlement_hold_days')?.value;
  const [open, setOpen] = useState(true);
  return (
    <section className={cx('rounded-2xl border border-grey-200 bg-paper shadow-[var(--shadow-card)]', className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left">
        <span className="text-sm font-semibold">How a payable balance is created</span>
        <span className="text-xs text-grey-500">{typeof hold === 'number' ? `Hold period: ${hold} day${hold === 1 ? '' : 's'} · ` : ''}{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ol className="grid gap-2 border-t border-grey-100 p-4 sm:grid-cols-2 xl:grid-cols-6">
          {FLOW_STEPS.map((s) => (
            <li key={s.title} className={cx('rounded-xl p-3', { ink: 'bg-grey-100', blue: 'bg-blue-soft', green: 'bg-green-soft', orange: 'bg-orange-soft', purple: 'bg-purple-soft', red: 'bg-red-soft', teal: 'bg-teal-soft' }[s.accent])}>
              <p className="text-xs font-semibold">{s.title}</p>
              <p className="mt-1 text-[11px] leading-snug text-grey-700">{s.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
