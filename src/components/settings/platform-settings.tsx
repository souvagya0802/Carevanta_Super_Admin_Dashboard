'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, History, RotateCcw, Search, Settings2, ShieldAlert, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { dateTime, relative } from '@/lib/format';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, IconTile, Input, Select, Skeleton, Tabs, Textarea, cx, type Accent } from '@/components/ui/primitives';

export interface SettingMeta { label: string; group: string; groupLabel: string; groupDescription: string | null; type: 'integer' | 'number' | 'boolean' | 'string' | 'json'; unit: string | null; min: number | null; max: number | null; step: number | null; pattern: string | null; patternHint: string | null; options: string[] | null; risk: 'low' | 'medium' | 'high'; help: string | null; default: unknown; isDefault: boolean }
export interface Setting { key: string; value: unknown; description: string | null; isSensitive: boolean; version: number; updatedById: string | null; updatedBy: { id: string; fullName: string } | null; updatedAt: string; meta: SettingMeta }

const RISK: Record<SettingMeta['risk'], { accent: Accent; label: string }> = { low: { accent: 'green', label: 'Low impact' }, medium: { accent: 'orange', label: 'Medium impact' }, high: { accent: 'red', label: 'High impact' } };
const fmtValue = (s: Setting) => (s.isSensitive ? '••••••' : s.meta.type === 'boolean' ? (s.value ? 'On' : 'Off') : s.meta.type === 'json' ? JSON.stringify(s.value) : `${String(s.value)}${s.meta.unit ? ` ${s.meta.unit}` : ''}`);

/** Grouped, searchable catalogue of platform settings with a typed change dialog. */
export function PlatformSettings() {
  const { can } = useAuth();
  const settings = useGet<Setting[]>('/admin/settings');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [editing, setEditing] = useState<Setting | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; description: string | null; items: Setting[] }>();
    for (const s of settings.data ?? []) {
      const g = m.get(s.meta.group) ?? { label: s.meta.groupLabel, description: s.meta.groupDescription, items: [] };
      g.items.push(s);
      m.set(s.meta.group, g);
    }
    return [...m.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [settings.data]);
  const needle = q.trim().toLowerCase();
  const visible = groups
    .filter(([g]) => group === 'all' || g === group)
    .map(([g, v]) => [g, { ...v, items: v.items.filter((s) => !needle || s.key.includes(needle) || s.meta.label.toLowerCase().includes(needle) || (s.description ?? '').toLowerCase().includes(needle)) }] as const)
    .filter(([, v]) => v.items.length);
  const changed = (settings.data ?? []).filter((s) => !s.meta.isDefault).length;
  const high = (settings.data ?? []).filter((s) => s.meta.risk === 'high').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={Settings2} accent="ink" label="Settings" value={settings.data?.length} />
        <Stat icon={History} accent="blue" label="Changed from default" value={changed} />
        <Stat icon={ShieldAlert} accent="red" label="High impact" value={high} />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-grey-100 px-5 py-3">
          <Tabs active={group} onChange={setGroup} tabs={[{ key: 'all', label: 'All', count: settings.data?.length }, ...groups.map(([g, v]) => ({ key: g, label: v.label, count: v.items.length }))]} />
          <div className="relative w-full sm:w-72">
            <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
            <Input aria-label="Search settings" placeholder="Search settings…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 pr-8" />
            {q && <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute top-1/2 right-2 -translate-y-1/2 text-grey-400 hover:text-ink"><X size={14} /></button>}
          </div>
        </div>
        {settings.isPending ? <div className="p-5"><Skeleton rows={6} /></div> : settings.isError ? <div className="p-5"><ErrorState error={settings.error} retry={() => settings.refetch()} /></div> : visible.length === 0 ? <div className="p-5"><EmptyState title="No settings match" description="Try another word or clear the group filter." /></div> : (
          <div className="divide-y divide-grey-100">
            {visible.map(([g, v]) => (
              <section key={g} className="px-5 py-4">
                <header className="mb-3">
                  <h3 className="text-sm font-semibold">{v.label}</h3>
                  {v.description && <p className="text-xs text-grey-500">{v.description}</p>}
                </header>
                <ul className="divide-y divide-grey-100 rounded-xl border border-grey-200">
                  {v.items.map((s) => (
                    <li key={s.key} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_200px_220px_auto] md:items-center">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{s.meta.label}{s.meta.risk === 'high' && <Badge accent="red">high impact</Badge>}{!s.meta.isDefault && s.meta.default !== null && <Badge accent="blue">changed</Badge>}{s.isSensitive && <Badge accent="orange">sensitive</Badge>}</p>
                        <p className="font-mono text-[11px] text-grey-500">{s.key}</p>
                        {s.description && <p className="mt-1 text-xs text-grey-600">{s.description}</p>}
                      </div>
                      <div><ValuePill s={s} /></div>
                      <div className="text-xs text-grey-500" title={dateTime(s.updatedAt)}>v{s.version} · {s.updatedBy ? `${s.updatedBy.fullName}, ` : s.updatedById ? 'changed ' : 'seeded '}{relative(s.updatedAt)}</div>
                      <div className="md:text-right">{can('settings.manage') ? <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Change</Button> : <span className="text-xs text-grey-400">Read-only</span>}</div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
      {editing && <ChangeDialog setting={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void settings.refetch(); }} />}
    </div>
  );
}

function Stat({ icon, accent, label, value }: { icon: typeof Settings2; accent: Accent; label: string; value: number | undefined }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-grey-200 bg-paper px-4 py-3 shadow-[var(--shadow-card)]">
      <IconTile icon={icon} accent={accent} size="sm" />
      <div>{value == null ? <div className="h-5 w-8 animate-pulse rounded bg-grey-100" /> : <p className="tnum text-lg font-bold leading-tight">{value}</p>}<p className="text-[11px] text-grey-500">{label}</p></div>
    </div>
  );
}

function ValuePill({ s }: { s: Setting }) {
  if (s.meta.type === 'boolean' && !s.isSensitive) {
    const on = !!s.value;
    return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', on ? 'bg-green-soft text-green' : 'bg-grey-100 text-grey-600')}><span className={cx('h-2 w-2 rounded-full', on ? 'bg-green' : 'bg-grey-400')} />{on ? 'On' : 'Off'}</span>;
  }
  return <span className="tnum rounded-lg bg-grey-50 px-2.5 py-1 font-mono text-xs">{fmtValue(s)}</span>;
}

/* ─── Change dialog ─────────────────────────────────────────────────────── */
function ChangeDialog({ setting: s, onClose, onSaved }: { setting: Setting; onClose: () => void; onSaved: () => void }) {
  const m = s.meta;
  const initial = s.isSensitive ? '' : m.type === 'json' ? JSON.stringify(s.value, null, 2) : String(s.value);
  const [raw, setRaw] = useState(initial);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const parsed = useMemo<{ value?: unknown; error?: string }>(() => {
    if (m.type === 'boolean') return { value: raw === 'true' };
    if (m.type === 'integer' || m.type === 'number') {
      if (raw.trim() === '') return { error: 'Enter a number' };
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: 'Enter a valid number' };
      if (m.type === 'integer' && !Number.isInteger(n)) return { error: 'Whole numbers only' };
      if (m.min != null && n < m.min) return { error: `Minimum is ${m.min}${m.unit ? ` ${m.unit}` : ''}` };
      if (m.max != null && n > m.max) return { error: `Maximum is ${m.max}${m.unit ? ` ${m.unit}` : ''}` };
      return { value: n };
    }
    if (m.type === 'json') {
      try { const v = JSON.parse(raw) as unknown; if (v === null || typeof v !== 'object' || Array.isArray(v)) return { error: 'Must be a JSON object' }; return { value: v }; } catch { return { error: 'Invalid JSON' }; }
    }
    const t = raw.trim();
    if (!t) return { error: 'A value is required' };
    if (m.options && !m.options.includes(t)) return { error: `Choose one of: ${m.options.join(', ')}` };
    if (m.pattern && !new RegExp(m.pattern).test(t)) return { error: m.patternHint ? `Expected ${m.patternHint}` : 'Wrong format' };
    return { value: t };
  }, [raw, m]);

  const unchanged = !s.isSensitive && parsed.value !== undefined && JSON.stringify(parsed.value) === JSON.stringify(s.value);
  const needsAck = m.risk === 'high';
  const canSave = !parsed.error && !unchanged && reason.trim().length >= 5 && (!needsAck || ack) && !conflict;
  const save = useAction(() => api.put(`/admin/settings/${s.key}`, { value: parsed.value, expectedVersion: s.version, reason: reason.trim() }), {
    success: `${m.label} updated`,
    onSuccess: onSaved,
    onError: (e) => { if (e instanceof ApiError && e.code === 'CONFLICT') setConflict(e.message); },
  });
  const preview = (v: unknown) => (m.type === 'boolean' ? (v ? 'On' : 'Off') : m.type === 'json' ? JSON.stringify(v) : `${String(v)}${m.unit ? ` ${m.unit}` : ''}`);
  const risk = RISK[m.risk];
  const dirty = raw !== initial || reason !== '';
  const close = () => { if (dirty && !window.confirm('Discard this change?')) return; onClose(); };

  return (
    <Dialog open onClose={close} size="lg" icon={m.risk === 'high' ? ShieldAlert : Settings2} title={`Change ${m.label}`} description={`${s.key} · version ${s.version}${s.updatedBy ? ` · last changed by ${s.updatedBy.fullName}` : ''}`}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>Save change</Button></>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <Badge accent={risk.accent}>{risk.label}</Badge>
          {m.default !== null && <span className="text-xs text-grey-500">Default: <span className="font-mono">{preview(m.default)}</span></span>}
        </div>
        {s.description && <p className="text-grey-700">{s.description}</p>}
        {m.help && <div className={cx('flex items-start gap-2 rounded-xl px-3 py-2 text-xs', m.risk === 'high' ? 'bg-red-soft text-grey-800' : 'bg-grey-50 text-grey-700')}><AlertTriangle size={14} className={cx('mt-0.5 shrink-0', m.risk === 'high' ? 'text-red' : 'text-grey-500')} aria-hidden /><p>{m.help}</p></div>}

        <Field label="New value" required error={parsed.error} hint={m.type === 'integer' || m.type === 'number' ? [m.min != null ? `min ${m.min}` : null, m.max != null ? `max ${m.max}` : null, m.unit].filter(Boolean).join(' · ') || undefined : m.patternHint ? `Format: ${m.patternHint}` : undefined}>
          {m.type === 'boolean' ? (
            <div role="radiogroup" aria-label="Value" className="inline-flex rounded-xl bg-grey-100 p-1">
              {([['true', 'On'], ['false', 'Off']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={raw === v} onClick={() => setRaw(v)} className={cx('rounded-lg px-4 py-1.5 text-sm transition-colors', raw === v ? 'bg-paper font-semibold shadow-sm' : 'text-grey-600 hover:text-ink')}>{l}</button>)}
            </div>
          ) : m.options ? (
            <Select value={raw} onChange={(e) => setRaw(e.target.value)}>{m.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
          ) : m.type === 'json' ? (
            <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} className="min-h-32 font-mono text-xs" spellCheck={false} />
          ) : (
            <div className="relative">
              <Input type={m.type === 'string' ? 'text' : 'number'} inputMode={m.type === 'string' ? undefined : 'decimal'} min={m.min ?? undefined} max={m.max ?? undefined} step={m.step ?? (m.type === 'integer' ? 1 : 'any')} value={raw} onChange={(e) => setRaw(e.target.value)} aria-invalid={!!parsed.error} className={m.unit ? 'pr-28' : undefined} autoFocus />
              {m.unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-grey-500">{m.unit}</span>}
            </div>
          )}
        </Field>
        {m.default !== null && !s.isSensitive && JSON.stringify(parsed.value) !== JSON.stringify(m.default) && (
          <button type="button" onClick={() => setRaw(m.type === 'json' ? (JSON.stringify(m.default, null, 2) ?? '') : String(m.default))} className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"><RotateCcw size={12} aria-hidden /> Reset to default ({preview(m.default)})</button>
        )}

        {!s.isSensitive && parsed.value !== undefined && (
          <div className="rounded-xl border border-grey-200 bg-grey-50 px-3 py-2 text-xs">
            <span className="text-grey-500">Change: </span><span className="font-mono">{preview(s.value)}</span><span className="mx-2 text-grey-400">→</span><span className={cx('font-mono font-semibold', unchanged ? 'text-grey-500' : 'text-ink')}>{preview(parsed.value)}</span>{unchanged && <span className="ml-2 text-grey-500">(no change)</span>}
          </div>
        )}

        <Field label="Reason for change" required hint="At least 5 characters · stored in the audit log with the old and new value" error={reason && reason.trim().length < 5 ? 'Please say a little more' : undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 1000))} className="min-h-16" placeholder="e.g. Pilot providers asked for a longer cancellation window" />
        </Field>
        {needsAck && (
          <label className="flex items-start gap-2 rounded-xl border border-red/30 bg-red-soft px-3 py-2 text-xs">
            <input type="checkbox" className="mt-0.5 accent-black" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand this is a high-impact setting. It takes effect within 30 seconds for every user, and I have confirmed the operational prerequisites above.</span>
          </label>
        )}
        {conflict && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-xl bg-orange-soft px-3 py-2 text-xs text-grey-800">
            <span><strong className="text-orange">Someone else changed this setting first.</strong> {conflict}</span>
            <Button size="sm" variant="secondary" onClick={onSaved}>Reload</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
