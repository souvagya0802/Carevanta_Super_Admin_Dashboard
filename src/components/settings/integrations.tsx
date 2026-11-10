'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Image as ImageIcon, Mail, MailCheck, Send, ServerCog, Trash2, Type, Upload, XCircle } from 'lucide-react';
import { api, API_BASE, ApiError, session } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { Logo, useBranding, type Branding } from '@/lib/branding';
import { Badge, Button, Checkbox, ConfirmDialog, Field, FormSection, Input, PasswordInput, Skeleton, cx } from '@/components/ui/primitives';

/* Forms are remounted (via `key`) whenever the server value changes, so their
   local state is initialised once from props — no effects that set state. */

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX = 2 * 1024 * 1024;

export function BrandingSettings() {
  const { branding } = useBranding();
  return <BrandingForm key={`${branding.name}|${branding.tagline}|${branding.logoUrl ?? ''}`} branding={branding} />;
}

function BrandingForm({ branding }: { branding: Branding }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: branding.name, tagline: branding.tagline });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['branding'] });
  const save = useAction(() => api.put('/admin/branding', { name: f.name.trim(), tagline: f.tagline.trim() }), { success: 'Branding saved', onSuccess: refresh });
  const uploadLogo = useAction(async () => {
    if (!file) throw new Error('Choose an image');
    const res = await fetch(`${API_BASE}/api/v1/admin/branding/logo`, { method: 'PUT', headers: { 'content-type': file.type, authorization: `Bearer ${session.accessToken ?? ''}` }, body: file });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(j?.error?.message ?? 'Upload failed');
    }
    return res.json();
  }, { success: 'Logo updated everywhere', onSuccess: () => { setFile(null); refresh(); } });
  const remove = useAction(() => api.delete('/admin/branding/logo'), { success: 'Logo removed — default restored', onSuccess: () => { setRemoving(false); refresh(); } });
  const disabled = !can('settings.manage');
  const nameError = f.name.trim().length < 2 ? 'At least 2 characters' : f.name.length > 60 ? 'At most 60 characters' : undefined;
  const dirty = f.name !== branding.name || f.tagline !== branding.tagline;

  const pick = (x: File | null) => {
    setFileError(null);
    if (!x) return setFile(null);
    if (!LOGO_TYPES.includes(x.type)) { setFile(null); return setFileError('Use a PNG, JPEG or WebP image'); }
    if (x.size > LOGO_MAX) { setFile(null); return setFileError('The file is larger than 2 MB'); }
    setFile(x);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <FormSection title="Name and Tagline" icon={Type} accent="blue" hint="Shown in the sidebar, the browser title, the sign-in page and outgoing emails.">
        <div className="space-y-3">
          <Field label="Platform Name" required error={nameError} hint={`${f.name.length}/60`}><Input value={f.name} disabled={disabled} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!nameError} /></Field>
          <Field label="Tagline" hint={`${f.tagline.length}/120 · one short line under the logo on the sign-in page`}><Input value={f.tagline} disabled={disabled} maxLength={120} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></Field>
          {!disabled && <div className="flex gap-2"><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!!nameError || !dirty}>Save</Button>{dirty && <Button variant="ghost" onClick={() => setF({ name: branding.name, tagline: branding.tagline })}>Discard</Button>}</div>}
        </div>
        <div className="mt-5 rounded-xl border border-grey-200 bg-grey-50 p-4">
          <p className="mb-2 text-[11px] text-grey-500">Sign-in Page Preview</p>
          <div className="mx-auto max-w-xs rounded-2xl border border-grey-200 bg-paper p-5 text-center shadow-[var(--shadow-card)]">
            <div className="flex justify-center"><Logo size="md" /></div>
            <p className="mt-2 text-sm font-semibold">{f.name.trim() || 'Platform name'} Admin</p>
            <p className="text-xs text-grey-500">{f.tagline.trim() || 'Tagline'}</p>
          </div>
        </div>
      </FormSection>

      <FormSection title="Logo" icon={ImageIcon} accent="purple" hint="Any size or aspect ratio — it is scaled to fit the sidebar, header and sign-in page automatically.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-grey-200 p-4"><p className="mb-2 text-[11px] text-grey-500">On Light Backgrounds</p><Logo size="lg" /></div>
          <div className="rounded-xl bg-ink p-4"><p className="mb-2 text-[11px] text-grey-400">In the Black Sidebar</p><Logo size="sm" onDark /></div>
        </div>
        <p className="mt-2 text-xs text-grey-500">{branding.logoUrl ? 'A custom logo is in use.' : 'Showing the bundled default logo.'}</p>
        {!disabled && (
          <div className="mt-4 space-y-3">
            <Field label="Upload a New Logo" error={fileError ?? undefined} hint="PNG, JPEG or WebP · up to 2 MB · transparent PNG looks best on the dark sidebar">
              <Input type="file" accept={LOGO_TYPES.join(',')} onChange={(e) => pick(e.target.files?.[0] ?? null)} className="h-auto py-1.5" />
            </Field>
            {preview && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-grey-200 p-3">
                  <p className="mb-1 text-[11px] text-grey-500">Preview · Light</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img src={preview} alt="New logo preview" className="h-12 w-auto max-w-full object-contain" />
                </div>
                <div className="rounded-xl bg-ink p-3">
                  <p className="mb-1 text-[11px] text-grey-400">Preview · Dark</p>
                  <span className="inline-flex h-8 items-center rounded-lg bg-paper p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                    <img src={preview} alt="" className="h-full w-auto max-w-full object-contain" />
                  </span>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => uploadLogo.mutate()} loading={uploadLogo.isPending} disabled={!file}><Upload size={16} /> Upload Logo</Button>
              {branding.logoUrl && <Button variant="danger" onClick={() => setRemoving(true)}><Trash2 size={16} /> Remove Custom Logo</Button>}
            </div>
          </div>
        )}
        <ConfirmDialog open={removing} onClose={() => setRemoving(false)} onConfirm={() => remove.mutate()} title="Remove the Uploaded Logo?" message="The bundled default logo will be shown everywhere instead. You can upload a new one at any time." confirmLabel="Remove" loading={remove.isPending} danger />
      </FormSection>
    </div>
  );
}

/* ─── SMTP ─────────────────────────────────────────────────────────────── */
interface Smtp { configured: boolean; host: string | null; port: number | null; secure: boolean; username: string | null; hasPassword: boolean; fromAddress: string | null; fromName: string | null }

/** Well-known providers; picking one fills host/port/TLS and hints at the username. */
const PRESETS: { key: string; label: string; host: string; port: number; secure: boolean; usernameHint?: string; note?: string }[] = [
  { key: 'custom', label: 'Custom / Other', host: '', port: 587, secure: false },
  { key: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, secure: false, usernameHint: 'Your full Gmail address', note: 'Use an App Password, not your account password.' },
  { key: 'ses', label: 'Amazon SES (Mumbai)', host: 'email-smtp.ap-south-1.amazonaws.com', port: 587, secure: false, usernameHint: 'SMTP credential username from the SES console' },
  { key: 'sendgrid', label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, usernameHint: 'Literally “apikey”', note: 'The password is your SendGrid API key.' },
  { key: 'zoho', label: 'Zoho Mail (India)', host: 'smtp.zoho.in', port: 587, secure: false, usernameHint: 'Your Zoho address' },
  { key: 'm365', label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, secure: false, usernameHint: 'Your mailbox address' },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SmtpSettings() {
  const smtp = useGet<Smtp>('/admin/integrations/smtp');
  if (smtp.isPending || !smtp.data) return <Skeleton rows={6} />;
  return <SmtpForm key={JSON.stringify(smtp.data)} smtp={smtp.data} />;
}

function SmtpForm({ smtp }: { smtp: Smtp }) {
  const { can } = useAuth();
  const initial = { host: smtp.host ?? '', port: String(smtp.port ?? 587), secure: smtp.secure, username: smtp.username ?? '', password: '', fromAddress: smtp.fromAddress ?? '', fromName: smtp.fromName ?? '' };
  const [f, setF] = useState(initial);
  const [preset, setPreset] = useState(() => PRESETS.find((p) => p.host && p.host === smtp.host)?.key ?? 'custom');
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const save = useAction(() => api.put('/admin/integrations/smtp', { host: f.host.trim(), port: Number(f.port), secure: f.secure, username: f.username.trim() || null, password: f.password === '' ? undefined : f.password, fromAddress: f.fromAddress.trim(), fromName: f.fromName.trim() }), { success: 'SMTP settings saved', invalidate: ['/admin/integrations/smtp'] });
  const test = useAction(() => api.post<{ data: { ok: boolean; messageId: string } }>('/admin/integrations/smtp/test', { to: testTo.trim() }), {
    onSuccess: (r) => setTestResult({ ok: true, message: `Delivered to the server · message id ${r.data.messageId}` }),
    onError: (e) => setTestResult({ ok: false, message: e instanceof ApiError ? e.message : 'The test failed' }),
  });
  const disabled = !can('settings.manage');
  const portNum = Number(f.port);
  const errors = {
    host: f.host && !/^[a-z0-9.-]+$/i.test(f.host.trim()) ? 'Host name only, without http:// or a port' : undefined,
    port: !Number.isInteger(portNum) || portNum < 1 || portNum > 65535 ? 'Port must be between 1 and 65535' : undefined,
    fromAddress: f.fromAddress && !EMAIL_RE.test(f.fromAddress.trim()) ? 'Enter a valid email address' : undefined,
  };
  const tlsMismatch = (f.secure && portNum === 587) || (!f.secure && portNum === 465);
  const dirty = JSON.stringify({ ...f, password: '' }) !== JSON.stringify({ ...initial, password: '' }) || f.password !== '';
  const ready = f.host.trim() && f.fromAddress.trim() && f.fromName.trim() && !errors.host && !errors.port && !errors.fromAddress;
  const applyPreset = (key: string) => {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (p && p.host) setF((x) => ({ ...x, host: p.host, port: String(p.port), secure: p.secure }));
  };
  const chosen = PRESETS.find((p) => p.key === preset);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <FormSection title="Outbound Email (SMTP)" icon={ServerCog} accent="blue" hint="Used for invitations, password resets, provider status updates and verification messages. The password is encrypted at rest and never shown again.">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {smtp.configured ? <Badge accent="green">Configured</Badge> : <Badge accent="orange">Not Configured</Badge>}
          <span className="text-xs text-grey-600">{smtp.configured ? `Sending through ${smtp.host}:${smtp.port} as ${smtp.fromAddress}` : 'Email notifications are written to the server log only until SMTP is saved.'}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Provider" className="md:col-span-2" hint={chosen?.note}><select value={preset} disabled={disabled} onChange={(e) => applyPreset(e.target.value)} className="h-10 w-full rounded-lg border border-grey-300 bg-paper px-3 text-sm focus:border-ink disabled:bg-grey-100">{PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
          <Field label="Host" required error={errors.host}><Input placeholder="smtp.example.com" value={f.host} disabled={disabled} onChange={(e) => setF({ ...f, host: e.target.value })} aria-invalid={!!errors.host} /></Field>
          <Field label="Port" required error={errors.port} hint="587 for STARTTLS · 465 for implicit TLS"><Input type="number" min={1} max={65535} value={f.port} disabled={disabled} onChange={(e) => setF({ ...f, port: e.target.value })} aria-invalid={!!errors.port} /></Field>
          <Field label="Username" hint={chosen?.usernameHint ?? 'Leave blank for servers without authentication'}><Input autoComplete="off" value={f.username} disabled={disabled} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
          <Field label="Password" hint={smtp.hasPassword ? 'A password is stored. Leave blank to keep it.' : 'Stored encrypted; never displayed again'}><PasswordInput autoComplete="new-password" value={f.password} disabled={disabled} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="From Address" required error={errors.fromAddress} hint="Must be a sender your provider has verified"><Input type="email" placeholder="no-reply@yourdomain.in" value={f.fromAddress} disabled={disabled} onChange={(e) => setF({ ...f, fromAddress: e.target.value })} aria-invalid={!!errors.fromAddress} /></Field>
          <Field label="From Name" required><Input placeholder="Carevanta" value={f.fromName} disabled={disabled} onChange={(e) => setF({ ...f, fromName: e.target.value })} /></Field>
          <div className="md:col-span-2 space-y-1">
            <Checkbox label="Implicit TLS (usually port 465). Leave off for STARTTLS on 587." checked={f.secure} disabled={disabled} onChange={(e) => setF({ ...f, secure: e.target.checked })} />
            {tlsMismatch && <p className="text-xs text-orange">Port {portNum} is normally used {portNum === 465 ? 'with' : 'without'} implicit TLS. Double-check before saving.</p>}
          </div>
        </div>
        {!disabled && <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ready || !dirty}>Save SMTP Settings</Button>{dirty && <Button variant="ghost" onClick={() => { setF(initial); setPreset(PRESETS.find((p) => p.host && p.host === smtp.host)?.key ?? 'custom'); }}>Discard</Button>}</div>}
        {dirty && smtp.configured && <p className="mt-2 text-xs text-grey-500">Save first, then send a test — the test always uses the saved configuration.</p>}
      </FormSection>

      <FormSection title="Send a Test Email" icon={MailCheck} accent="green" hint="Verifies the connection and credentials, then sends one message.">
        <Field label="Recipient" hint="Use a mailbox you can open right now"><Input type="email" value={testTo} onChange={(e) => { setTestTo(e.target.value); setTestResult(null); }} placeholder="you@example.com" /></Field>
        <Button className="mt-3" variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={disabled || !EMAIL_RE.test(testTo.trim()) || !smtp.configured}><Send size={16} /> Send Test Email</Button>
        {!smtp.configured && <p className="mt-2 text-xs text-grey-500">Save the SMTP settings first.</p>}
        {testResult && (
          <div role="status" className={cx('mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs', testResult.ok ? 'bg-green-soft text-grey-800' : 'bg-red-soft text-grey-800')}>
            {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green" aria-hidden /> : <XCircle size={14} className="mt-0.5 shrink-0 text-red" aria-hidden />}
            <p>{testResult.message}{!testResult.ok && ' — check host, port, TLS mode and credentials, then save and try again.'}</p>
          </div>
        )}
        <div className="mt-4 rounded-xl bg-grey-50 p-3 text-xs text-grey-600">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-grey-800"><Mail size={12} aria-hidden /> Deliverability Checklist</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Verify the from-domain with your provider (SPF and DKIM records).</li>
            <li>Use a dedicated no-reply or notifications mailbox.</li>
            <li>Prefer an App Password or API key over a personal password.</li>
          </ul>
        </div>
      </FormSection>
    </div>
  );
}
