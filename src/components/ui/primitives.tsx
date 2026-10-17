'use client';

import { clsx } from 'clsx';
import { Eye, EyeOff, Loader2, X, type LucideIcon } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export const cx = clsx;

/* ─── Accent system (colour carries meaning; black is the brand) ────────── */
export type Accent = 'ink' | 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'teal';
export const ACCENT = {
  ink: { text: 'text-ink', bg: 'bg-ink', soft: 'bg-grey-100', ring: 'ring-grey-200', hex: '#0a0a0a' },
  blue: { text: 'text-blue', bg: 'bg-blue', soft: 'bg-blue-soft', ring: 'ring-blue/20', hex: '#2563eb' },
  green: { text: 'text-green', bg: 'bg-green', soft: 'bg-green-soft', ring: 'ring-green/20', hex: '#059669' },
  orange: { text: 'text-orange', bg: 'bg-orange', soft: 'bg-orange-soft', ring: 'ring-orange/20', hex: '#ea580c' },
  purple: { text: 'text-purple', bg: 'bg-purple', soft: 'bg-purple-soft', ring: 'ring-purple/20', hex: '#7c3aed' },
  red: { text: 'text-red', bg: 'bg-red', soft: 'bg-red-soft', ring: 'ring-red/20', hex: '#dc2626' },
  teal: { text: 'text-teal', bg: 'bg-teal', soft: 'bg-teal-soft', ring: 'ring-teal/20', hex: '#0d9488' },
} as const satisfies Record<Accent, { text: string; bg: string; soft: string; ring: string; hex: string }>;
export const ACCENT_ORDER: Accent[] = ['blue', 'green', 'orange', 'purple', 'red', 'teal'];

/* ─── Button ──────────────────────────────────────────────────────────────── */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
}
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-grey-800 disabled:bg-grey-300 shadow-sm',
  secondary: 'border border-grey-300 bg-paper text-ink hover:bg-grey-50 disabled:text-grey-400',
  ghost: 'text-grey-700 hover:bg-grey-100 hover:text-ink disabled:text-grey-400',
  danger: 'border border-red/30 bg-red-soft text-red hover:bg-red hover:text-paper disabled:text-grey-400',
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed', size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm', variants[variant], className)}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/* ─── Form controls ───────────────────────────────────────────────────────── */
const control = 'h-10 rounded-lg border border-grey-300 bg-paper px-3 text-sm placeholder:text-grey-400 focus:border-ink disabled:bg-grey-100 disabled:text-grey-500 aria-[invalid=true]:border-red';
/**
 * Controls fill their container by default (forms). A caller that passes its
 * own width (`w-72`, `sm:w-48`, …) gets that width instead, so filters can sit
 * side by side in one row rather than each stretching to a full line.
 */
const hasWidth = (className?: string) => !!className && /(^|\s)(\w+:)?(w|min-w|max-w|basis|flex)-/.test(className);
const controlClass = (className?: string, ...extra: string[]) => cx(control, hasWidth(className) ? 'shrink-0' : 'w-full', ...extra, className);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={controlClass(className)} {...rest} />;
});

/** Password field with a show/hide toggle. The toggle never submits the form. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput({ className, ...rest }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={visible ? 'text' : 'password'} className={controlClass(className, 'pr-10')} {...rest} />
      <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-grey-500 hover:text-ink">
        {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={controlClass(className, 'pr-8')} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={controlClass(className, 'h-auto min-h-24 py-2')} {...rest} />;
});

export function Field({ label, error, hint, required, children, className }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block text-sm', className)}>
      <span className="mb-1 block font-medium text-grey-800">
        {label}
        {required && <span aria-hidden className="text-red"> *</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-red">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-grey-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 rounded accent-black" {...rest} />
      {label}
    </label>
  );
}

/* ─── Status badge ────────────────────────────────────────────────────────── */
const GREEN = ['ACTIVE', 'APPROVED', 'COMPLETED', 'PAID', 'PUBLISHED', 'SENT', 'MATCHED', 'RESOLVED', 'SUCCEEDED', 'CAPTURED', 'AVAILABLE', 'VERIFIED', 'CONFIRMED', 'DELIVERED', 'LIVE', 'PASSED', 'OPEN_SLOT'];
const ORANGE = ['PENDING', 'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'PENDING_MODERATION', 'PENDING_REVIEW', 'REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'IN_REVIEW', 'IN_PROGRESS', 'PROCESSING', 'QUEUED', 'OFFERED', 'SEARCHING', 'AWAITING_PROVIDER', 'AWAITING_REPORTER', 'CHANGES_REQUESTED', 'PILOT', 'MEDIUM', 'HIGH', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'SAMPLE_COLLECTED', 'REPORT_READY', 'INVITED', 'UPLOADED', 'RECEIVED', 'PARTIALLY_REFUNDED', 'PARTIALLY_FAILED', 'STATUS_MISMATCH', 'MISSING_INTERNAL', 'MISSING_AT_GATEWAY', 'RUNNING', 'CONTAINED'];
const RED = ['SUSPENDED', 'REJECTED', 'FAILED', 'CANCELLED', 'DEACTIVATED', 'EXPIRED', 'NO_SHOW', 'ESCALATED', 'DENIED', 'URGENT', 'CRITICAL', 'NO_PROVIDER_AVAILABLE', 'AMOUNT_MISMATCH', 'DISABLED', 'OUT_OF_SERVICE', 'REFUNDED', 'RETURNED', 'ANONYMISED', 'WITHDRAWN', 'BREACHED'];
const BLUE = ['CHECKED_IN', 'EN_ROUTE', 'ARRIVED', 'ACCEPTED', 'PATIENT_ONBOARD', 'AT_DESTINATION', 'ON_TRIP', 'TEST', 'DEVELOPMENT', 'STAGING', 'PRIMARY', 'LOW', 'INFO', 'PLATFORM', 'AUTHORIZED', 'CREATED'];
export function badgeAccent(status: string): Accent {
  const k = status.toUpperCase();
  if (GREEN.includes(k)) return 'green';
  if (RED.includes(k) || k.startsWith('CANCELLED')) return 'red';
  if (ORANGE.includes(k)) return 'orange';
  if (BLUE.includes(k)) return 'blue';
  return 'ink';
}
export function Badge({ children, tone, accent }: { children: ReactNode; tone?: string; accent?: Accent }) {
  const key = typeof children === 'string' ? children : (tone ?? '');
  const a = accent ?? badgeAccent(key);
  const cls = a === 'ink' ? 'bg-grey-100 text-grey-700' : `${ACCENT[a].soft} ${ACCENT[a].text}`;
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', cls)}>{typeof children === 'string' ? children.replace(/_/g, ' ') : children}</span>;
}

/* ─── Surfaces ────────────────────────────────────────────────────────────── */
export function Card({ title, description, actions, children, className, padded = true }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-2xl border border-grey-200 bg-paper shadow-[var(--shadow-card)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-grey-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && (title || actions ? 'px-5 pb-5' : 'p-5'))}>{children}</div>
    </section>
  );
}

/** Icon in a soft, coloured rounded tile. */
export function IconTile({ icon: Icon, accent = 'ink', size = 'md', className }: { icon: LucideIcon; accent?: Accent; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dim = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-xl', dim, ACCENT[accent].soft, ACCENT[accent].text, className)}>
      <Icon size={size === 'sm' ? 16 : size === 'lg' ? 22 : 18} aria-hidden />
    </span>
  );
}

export function Progress({ value, accent = 'ink', className }: { value: number | null | undefined; accent?: Accent; className?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-grey-100', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width]', ACCENT[accent].bg)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** KPI card: coloured icon tile, value, label, optional trend and progress. */
export function Stat({ label, value, hint, loading, icon, accent = 'ink', trend, trendUp, progress, progressLabel, footer }: {
  label: string; value: ReactNode; hint?: string; loading?: boolean; icon?: LucideIcon; accent?: Accent; trend?: string; trendUp?: boolean; progress?: number | null; progressLabel?: string; footer?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-grey-200 bg-paper p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <IconTile icon={icon} accent={accent} />}
          {loading ? <div className="h-8 w-28 animate-pulse rounded bg-grey-100" /> : <p className="tnum truncate text-2xl font-bold tracking-tight">{value}</p>}
        </div>
        {trend && <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', trendUp === false ? 'bg-red-soft text-red' : 'bg-green-soft text-green')}>{trend}</span>}
      </div>
      <p className="mt-3 text-sm font-medium text-grey-800">{label}</p>
      {hint && <p className="text-xs text-grey-500">{hint}</p>}
      {progress != null && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-grey-500"><span>{progressLabel ?? 'Progress'}</span><span className="tnum font-medium text-grey-800">{Math.round(progress)}%</span></div>
          <Progress value={progress} accent={accent} />
        </div>
      )}
      {footer && <div className="mt-3 border-t border-grey-100 pt-3 text-xs text-grey-500">{footer}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-grey-100" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-grey-300 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-sm text-grey-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className="rounded-2xl border border-red/30 bg-red-soft px-6 py-8 text-center">
      <p className="font-medium text-red">Could not load this view</p>
      <p className="mt-1 text-sm text-grey-700">{message}</p>
      {retry && <Button variant="secondary" size="sm" className="mt-4" onClick={retry}>Try again</Button>}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-grey-500">{i.label}</dt>
          <dd className="mt-0.5 break-words">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ─── Dialog (native <dialog>) ───────────────────────────────────────────── */
export type DialogSize = 'md' | 'lg' | 'full';
const dialogSize: Record<DialogSize, string> = {
  md: 'w-[95vw] max-w-lg',
  lg: 'w-[95vw] max-w-3xl',
  full: 'w-[95vw] max-w-[95vw] lg:w-[90vw] lg:max-w-[90vw] h-[92vh] lg:h-[90vh]',
};

/**
 * Modal with a black brand header (title, optional subtitle and icon, close
 * button), a scrolling body and a sticky footer. Full-size dialogs get a grey
 * body so form sections read as cards.
 */
export function Dialog({ open, onClose, title, description, icon: Icon, children, footer, wide, size }: { open: boolean; onClose: () => void; title: string; description?: string; icon?: LucideIcon; children: ReactNode; footer?: ReactNode; wide?: boolean; size?: DialogSize }) {
  const sz: DialogSize = size ?? (wide ? 'lg' : 'md');
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby={`${id}-title`} className={cx('m-auto overflow-hidden rounded-2xl border border-grey-200 bg-paper p-0 text-ink shadow-[var(--shadow-float)]', dialogSize[sz])}>
      {open && (
        <div className={cx('flex flex-col', sz === 'full' ? 'h-full' : 'max-h-[85vh]')}>
          <header className="flex shrink-0 items-start justify-between gap-4 bg-ink px-6 py-4 text-paper">
            <div className="flex min-w-0 items-center gap-3">
              {Icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10"><Icon size={18} aria-hidden /></span>}
              <div className="min-w-0">
                <h2 id={`${id}-title`} className="truncate text-base font-semibold leading-tight">{title}</h2>
                {description && <p className="mt-0.5 truncate text-xs text-grey-400">{description}</p>}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-grey-400 hover:bg-white/10 hover:text-paper"><X size={16} aria-hidden /></button>
          </header>
          <div className={cx('flex-1 overflow-y-auto px-6 py-5 text-sm', sz === 'full' && 'bg-canvas')}>{children}</div>
          {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-grey-200 bg-paper px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Titled card used to group fields inside a full-size dialog. */
export function FormSection({ title, hint, icon: Icon, accent = 'ink', children, className }: { title: string; hint?: string; icon?: LucideIcon; accent?: Accent; children: ReactNode; className?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-2xl border border-grey-200 bg-paper shadow-[var(--shadow-card)]', className)}>
      <header className="flex items-center gap-3 border-b border-grey-100 px-5 py-3">
        {Icon && <IconTile icon={Icon} accent={accent} size="sm" />}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <p className="text-xs text-grey-500">{hint}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Numbered progress for multi-step dialogs. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs" aria-label="Progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = current > n ? 'done' : current === n ? 'active' : 'todo';
        return (
          <li key={label} className="flex items-center gap-2">
            <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold', state === 'done' ? 'bg-green text-paper' : state === 'active' ? 'bg-ink text-paper' : 'border border-grey-300 bg-paper text-grey-500')} aria-current={state === 'active' ? 'step' : undefined}>{state === 'done' ? '✓' : n}</span>
            <span className={state === 'active' ? 'font-semibold' : 'text-grey-500'}>{label}</span>
            {i < steps.length - 1 && <span className={cx('mx-1 h-px w-8 sm:w-12', state === 'done' ? 'bg-green' : 'bg-grey-300')} />}
          </li>
        );
      })}
    </ol>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', loading, danger, children }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; loading?: boolean; danger?: boolean; children?: ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      <p>{message}</p>
      {children}
    </Dialog>
  );
}

/* ─── Navigation helpers ─────────────────────────────────────────────────── */
export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-grey-100 p-1">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => onChange(t.key)} className={cx('rounded-lg px-3 py-1.5 text-sm transition-colors', active === t.key ? 'bg-paper font-medium shadow-sm' : 'text-grey-600 hover:text-ink')}>
          {t.label}
          {t.count != null && <span className="ml-1 text-xs text-grey-500">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-grey-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Filters laid out in one wrapping row; each control keeps its own width. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-row flex-wrap items-center gap-2', className)}>{children}</div>;
}
