'use client';

import { useState } from 'react';
import { CheckCircle2, CreditCard, KeyRound, Link2, ShieldCheck, Wallet, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { Badge, Button, Checkbox, Dialog, Field, FormSection, Input, PasswordInput, Select, Skeleton, Textarea, cx } from '@/components/ui/primitives';

/**
 * Settings → Payments. Razorpay and Stripe can both be configured and tested
 * before any patient pays; exactly one is "live" for checkout. Secrets are
 * write-only: the API only ever says whether one is stored and its last four
 * characters. Webhook URLs are shown so they can be pasted into each gateway's
 * dashboard; without the webhook secret no payment is ever marked paid.
 */
interface GatewayState { enabled: boolean; mode: 'test' | 'live'; publicKey: string | null; hasSecretKey: boolean; secretKeyHint: string | null; hasWebhookSecret: boolean }
interface Payments { activeGateway: 'NONE' | 'RAZORPAY' | 'STRIPE'; razorpay: GatewayState; stripe: GatewayState; webhookUrls: { razorpay: string; stripe: string } }

const GATEWAYS = {
  razorpay: { name: 'Razorpay', publicLabel: 'Key ID', publicPlaceholder: 'rzp_test_xxxxxxxxxxxxxx', secretLabel: 'Key Secret', webhookLabel: 'Webhook Secret', webhookHint: 'Set the same secret when you create the webhook in Razorpay Dashboard → Settings → Webhooks. Subscribe to payment.captured, payment.failed, refund.processed, refund.failed.', docs: 'https://dashboard.razorpay.com/app/keys', note: 'Indian cards, UPI, net banking and wallets. Settles in INR.' },
  stripe: { name: 'Stripe', publicLabel: 'Publishable Key', publicPlaceholder: 'pk_test_xxxxxxxxxxxxxxxx', secretLabel: 'Secret Key', webhookLabel: 'Webhook Signing Secret (whsec_…)', webhookHint: 'From Stripe Dashboard → Developers → Webhooks after adding the endpoint. Listen to payment_intent.succeeded, payment_intent.payment_failed, charge.refunded, refund.updated.', docs: 'https://dashboard.stripe.com/apikeys', note: 'International cards and UPI via Stripe India. Requires an activated Stripe India account for INR.' },
} as const;

export function PaymentsSettings() {
  const q = useGet<Payments>('/admin/integrations/payments');
  if (q.isPending || !q.data) return <Skeleton rows={8} />;
  return <PaymentsInner key={JSON.stringify(q.data)} p={q.data} />;
}

function PaymentsInner({ p }: { p: Payments }) {
  const { can } = useAuth();
  const editable = can('settings.manage');
  const [choosing, setChoosing] = useState<Payments['activeGateway'] | null>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const activate = useAction(() => api.put('/admin/integrations/payments/active', { gateway: choosing, reason: reason.trim() }), { success: 'Checkout gateway updated', invalidate: ['/admin/integrations/payments', '/public/payments'], onSuccess: () => { setChoosing(null); setReason(''); }, onError: (e) => setProblem(e instanceof ApiError ? e.message : 'Could not change the gateway') });
  const ready = (g: GatewayState) => g.enabled && !!g.publicKey && g.hasSecretKey && g.hasWebhookSecret;

  return (
    <div className="space-y-4">
      <FormSection title="Checkout Gateway" icon={Wallet} accent="green" hint="The gateway patients pay through. Switching takes effect for new payments immediately; payments already in progress finish on the gateway they started on.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge accent={p.activeGateway === 'NONE' ? 'orange' : 'green'}>{p.activeGateway === 'NONE' ? 'Online payments off' : `${GATEWAYS[p.activeGateway.toLowerCase() as 'razorpay' | 'stripe'].name} · ${p[p.activeGateway.toLowerCase() as 'razorpay' | 'stripe'].mode}`}</Badge>
          <span className="text-xs text-grey-600">{p.activeGateway === 'NONE' ? 'Patients can only choose pay-at-counter until a gateway is switched on.' : p[p.activeGateway.toLowerCase() as 'razorpay' | 'stripe'].mode === 'test' ? 'Test mode: no real money moves. Switch the keys to live before launch.' : 'Live mode: real money moves.'}</span>
          {editable && (
            <div className="ml-auto flex flex-wrap gap-2">
              {(['RAZORPAY', 'STRIPE'] as const).filter((g) => g !== p.activeGateway).map((g) => <Button key={g} size="sm" variant="secondary" disabled={!ready(p[g.toLowerCase() as 'razorpay' | 'stripe'])} title={ready(p[g.toLowerCase() as 'razorpay' | 'stripe']) ? undefined : 'Enable it with both keys and the webhook secret first'} onClick={() => setChoosing(g)}>Use {GATEWAYS[g.toLowerCase() as 'razorpay' | 'stripe'].name}</Button>)}
              {p.activeGateway !== 'NONE' && <Button size="sm" variant="danger" onClick={() => setChoosing('NONE')}>Turn Online Payments Off</Button>}
            </div>
          )}
        </div>
      </FormSection>
      <div className="grid gap-4 xl:grid-cols-2">
        <GatewayForm id="razorpay" state={p.razorpay} webhookUrl={p.webhookUrls.razorpay} editable={editable} active={p.activeGateway === 'RAZORPAY'} />
        <GatewayForm id="stripe" state={p.stripe} webhookUrl={p.webhookUrls.stripe} editable={editable} active={p.activeGateway === 'STRIPE'} />
      </div>
      <div className="rounded-lg bg-grey-50 p-3 text-xs text-grey-600">
        <p className="mb-1 flex items-center gap-1.5 font-medium text-grey-800"><ShieldCheck size={12} aria-hidden /> How Payments Stay Safe</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Secrets are encrypted at rest with the platform data key and never sent back to a browser.</li>
          <li>A payment is marked paid only from a signature-verified webhook, never from the patient&apos;s device.</li>
          <li>Keys are checked against the gateway&apos;s format and the chosen mode, so a live key cannot be saved under &quot;test&quot;.</li>
          <li>Every change here is written to the audit log with your name.</li>
        </ul>
      </div>
      {choosing && (
        <Dialog open onClose={() => setChoosing(null)} title={choosing === 'NONE' ? 'Turn Online Payments Off' : `Use ${GATEWAYS[choosing.toLowerCase() as 'razorpay' | 'stripe'].name} for Checkout`} icon={Wallet} footer={<><Button variant="ghost" onClick={() => setChoosing(null)} disabled={activate.isPending}>Cancel</Button><Button variant={choosing === 'NONE' ? 'danger' : 'primary'} onClick={() => activate.mutate()} loading={activate.isPending} disabled={reason.trim().length < 5}>Confirm</Button></>}>
          <Field label="Reason" required hint="Recorded in the audit log"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          {problem && <p role="alert" className="mt-2 text-sm text-red">{problem}</p>}
        </Dialog>
      )}
    </div>
  );
}

function GatewayForm({ id, state, webhookUrl, editable, active }: { id: 'razorpay' | 'stripe'; state: GatewayState; webhookUrl: string; editable: boolean; active: boolean }) {
  const g = GATEWAYS[id];
  const [f, setF] = useState({ enabled: state.enabled, mode: state.mode, publicKey: state.publicKey ?? '', secretKey: '', webhookSecret: '' });
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const save = useAction(() => api.put(`/admin/integrations/payments/${id}`, { enabled: f.enabled, mode: f.mode, publicKey: f.publicKey.trim() || null, secretKey: f.secretKey === '' ? undefined : f.secretKey.trim(), webhookSecret: f.webhookSecret === '' ? undefined : f.webhookSecret.trim() }), { success: `${g.name} settings saved`, invalidate: ['/admin/integrations/payments', '/public/payments'] });
  const test = useAction(() => api.post<{ data: { detail: string } }>(`/admin/integrations/payments/${id}/test`), { onSuccess: (r) => setTestResult({ ok: true, message: r.data.detail }), onError: (e) => setTestResult({ ok: false, message: e instanceof ApiError ? e.message : 'Test failed' }) });
  const dirty = f.enabled !== state.enabled || f.mode !== state.mode || f.publicKey !== (state.publicKey ?? '') || f.secretKey !== '' || f.webhookSecret !== '';
  const keyMode = /_live_/.test(f.publicKey) ? 'live' : /_test_/.test(f.publicKey) ? 'test' : null;
  const modeMismatch = keyMode !== null && keyMode !== f.mode;
  const willHaveSecret = f.secretKey ? true : state.hasSecretKey;
  const canEnable = !!f.publicKey.trim() && willHaveSecret;
  return (
    <FormSection title={g.name} icon={CreditCard} accent={id === 'razorpay' ? 'blue' : 'purple'} hint={g.note}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {active && <Badge accent="green">live for checkout</Badge>}
        {state.enabled ? <Badge accent="blue">enabled · {state.mode}</Badge> : <Badge>not enabled</Badge>}
        {state.hasSecretKey ? <Badge accent="green">secret stored {state.secretKeyHint}</Badge> : <Badge accent="orange">no secret</Badge>}
        {state.hasWebhookSecret ? <Badge accent="green">webhook secret stored</Badge> : <Badge accent="orange">no webhook secret</Badge>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Mode" required hint="Test keys never move real money"><Select value={f.mode} disabled={!editable} onChange={(e) => setF({ ...f, mode: e.target.value as 'test' | 'live' })}><option value="test">Test / Sandbox</option><option value="live">Live</option></Select></Field>
        <Field label={g.publicLabel} required error={modeMismatch ? `This is a ${keyMode} key; change the mode or the key` : undefined} hint="Safe to show in browsers"><Input value={f.publicKey} placeholder={g.publicPlaceholder} disabled={!editable} autoComplete="off" onChange={(e) => setF({ ...f, publicKey: e.target.value })} className="font-mono" /></Field>
        <Field label={g.secretLabel} required hint={state.hasSecretKey ? `Stored (${state.secretKeyHint}). Leave blank to keep it.` : 'Stored encrypted; never shown again'}><PasswordInput value={f.secretKey} disabled={!editable} autoComplete="new-password" onChange={(e) => setF({ ...f, secretKey: e.target.value })} /></Field>
        <Field label={g.webhookLabel} hint={state.hasWebhookSecret ? 'Stored. Leave blank to keep it.' : 'Required before this gateway can go live for checkout'}><PasswordInput value={f.webhookSecret} disabled={!editable} autoComplete="new-password" onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} /></Field>
        <div className="md:col-span-2">
          <Checkbox label={`Accept payments through ${g.name}`} checked={f.enabled} disabled={!editable || !canEnable} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          {!canEnable && <p className="text-xs text-grey-500">Enter both keys to enable.</p>}
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-grey-200 bg-grey-50 p-3 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-grey-800"><Link2 size={12} aria-hidden /> Webhook endpoint for {g.name}</p>
        <code className="mt-1 block break-all font-mono text-[11px] text-grey-700">{webhookUrl || '(set PUBLIC_API_URL on the API to show the full URL)'}</code>
        <p className="mt-1 text-grey-600">{g.webhookHint}</p>
        <a href={g.docs} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-grey-800 underline-offset-2 hover:underline"><KeyRound size={12} aria-hidden /> Open {g.name} keys page</a>
      </div>
      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || modeMismatch || (f.enabled && !canEnable)}>Save {g.name}</Button>
          <Button variant="secondary" onClick={() => { setTestResult(null); test.mutate(); }} loading={test.isPending} disabled={!state.publicKey || !state.hasSecretKey || dirty} title={dirty ? 'Save first; the test uses saved keys' : undefined}>Test Connection</Button>
          {dirty && <Button variant="ghost" onClick={() => setF({ enabled: state.enabled, mode: state.mode, publicKey: state.publicKey ?? '', secretKey: '', webhookSecret: '' })}>Discard</Button>}
        </div>
      )}
      {testResult && (
        <div role="status" className={cx('mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs', testResult.ok ? 'bg-green-soft text-grey-800' : 'bg-red-soft text-grey-800')}>
          {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green" aria-hidden /> : <XCircle size={14} className="mt-0.5 shrink-0 text-red" aria-hidden />}
          <p>{testResult.message}</p>
        </div>
      )}
    </FormSection>
  );
}
