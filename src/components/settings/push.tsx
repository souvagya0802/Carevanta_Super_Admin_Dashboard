'use client';

import { useState } from 'react';
import { BellRing, CheckCircle2, KeyRound, Smartphone, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { Badge, Button, ConfirmDialog, Field, FormSection, Input, Skeleton, cx } from '@/components/ui/primitives';

/**
 * Settings → Push. Web Push needs one VAPID key pair for the whole platform.
 * Generating it is a one-off; regenerating it silently breaks every existing
 * subscription, so that path asks twice.
 */
interface Push { configured: boolean; publicKey: string | null; subject: string | null; subscriptions: number; subscribedUsers: number }

export function PushSettings() {
  const q = useGet<Push>('/admin/integrations/push');
  if (q.isPending || !q.data) return <Skeleton rows={6} />;
  return <PushInner key={JSON.stringify(q.data)} p={q.data} />;
}

function PushInner({ p }: { p: Push }) {
  const { can } = useAuth();
  const editable = can('settings.manage');
  const [subject, setSubject] = useState(p.subject ?? 'mailto:support@carevanta.in');
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const inv = ['/admin/integrations/push', '/admin/notifications/stats'];
  const generate = useAction(() => api.post('/admin/integrations/push/generate', { subject: subject.trim(), confirm: true }), { success: p.configured ? 'New keys generated — every device must enable push again' : 'Push notifications enabled', invalidate: inv, onSuccess: () => setConfirmRegen(false) });
  const saveSubject = useAction(() => api.put('/admin/integrations/push', { subject: subject.trim() }), { success: 'Contact saved', invalidate: inv });
  const test = useAction(() => api.post<{ data: { devices: number } }>('/admin/integrations/push/test'), { onSuccess: (r) => setTestResult({ ok: true, message: `Sent to ${r.data.devices} device(s) you have subscribed.` }), onError: (e) => setTestResult({ ok: false, message: e instanceof ApiError ? e.message : 'Test failed' }) });
  const subjectOk = /^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(subject.trim());

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <FormSection title="Web Push (VAPID)" icon={BellRing} accent="orange" hint="Lets the provider portal and the patient app show system notifications on phones and desktops — new bookings, orders, dispatch offers, published reports — even when the app is closed. Works on Android, desktop browsers and installed iOS web apps (iOS 16.4+).">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {p.configured ? <Badge accent="green">enabled</Badge> : <Badge accent="orange">not enabled</Badge>}
          <span className="text-xs text-grey-600">{p.configured ? `${p.subscriptions} device(s) across ${p.subscribedUsers} user(s) subscribed.` : 'Push rows are written to the log only until keys exist.'}</span>
        </div>
        <Field label="Contact (VAPID Subject)" required error={subject && !subjectOk ? 'Use mailto:you@domain or an https:// URL' : undefined} hint="Push services may use this to contact the operator about abuse or outages"><Input value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} placeholder="mailto:support@carevanta.in" /></Field>
        {p.configured && (
          <div className="mt-3 rounded-lg border border-grey-200 bg-grey-50 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-grey-800"><KeyRound size={12} aria-hidden /> Public Key</p>
            <code className="mt-1 block break-all font-mono text-[11px] text-grey-700">{p.publicKey}</code>
            <p className="mt-1 text-grey-600">The private key is stored encrypted and never shown.</p>
          </div>
        )}
        {editable && (
          <div className="mt-4 flex flex-wrap gap-2">
            {p.configured ? (
              <>
                <Button onClick={() => saveSubject.mutate()} loading={saveSubject.isPending} disabled={!subjectOk || subject.trim() === p.subject}>Save Contact</Button>
                <Button variant="danger" onClick={() => setConfirmRegen(true)}>Regenerate Keys</Button>
              </>
            ) : (
              <Button onClick={() => generate.mutate()} loading={generate.isPending} disabled={!subjectOk}><BellRing size={16} /> Enable Push Notifications</Button>
            )}
          </div>
        )}
      </FormSection>
      <FormSection title="Test on Your Devices" icon={Smartphone} accent="green" hint="Enable push on this browser from the bell in the provider portal or the patient app, then send a test.">
        <Button variant="secondary" onClick={() => { setTestResult(null); test.mutate(); }} loading={test.isPending} disabled={!editable || !p.configured}>Send Test Push</Button>
        {testResult && (
          <div role="status" className={cx('mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs', testResult.ok ? 'bg-green-soft text-grey-800' : 'bg-red-soft text-grey-800')}>
            {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green" aria-hidden /> : <XCircle size={14} className="mt-0.5 shrink-0 text-red" aria-hidden />}
            <p>{testResult.message}</p>
          </div>
        )}
        <div className="mt-4 rounded-lg bg-grey-50 p-3 text-xs text-grey-600">
          <p className="mb-1 font-medium text-grey-800">What Gets Pushed</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Front desk: new appointment requests and walk-ins.</li>
            <li>Labs and pharmacies: new orders and prescriptions to review.</li>
            <li>Ambulance dispatchers: emergency offers (high urgency).</li>
            <li>Doctors and facilities: affiliation invitations and requests.</li>
            <li>Patients: published reports.</li>
          </ul>
        </div>
      </FormSection>
      <ConfirmDialog open={confirmRegen} onClose={() => setConfirmRegen(false)} onConfirm={() => generate.mutate()} title="Regenerate VAPID Keys?" message={`Every one of the ${p.subscriptions} subscribed device(s) will stop receiving pushes until the person enables them again. Do this only if the private key may have leaked.`} confirmLabel="Regenerate" loading={generate.isPending} danger />
    </div>
  );
}
