'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { KeyRound, LogOut, Unlock } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { dateTime, title } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, DescriptionList, Dialog, ErrorState, Field, IconTile, PageHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import type { UserRow } from '../page';

interface UserDetail extends UserRow {
  mustChangePassword: boolean;
  statusReason: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  preferredLanguage: string;
  updatedAt: string;
  roleHistory: { roleKey: string; roleName: string; grantedAt: string; grantedById: string | null; revokedAt: string | null; revokedById: string | null }[];
  providerMemberships: { providerId: string; providerName: string; providerType: string; memberRole: string; status: string }[];
  patientProfileCount: number;
  doctorProviderId: string | null;
}
interface Activity {
  auditEvents: { id: string; occurredAt: string; action: string; entityType: string; entityId: string | null; outcome: string; actorUserId: string | null }[];
  loginAttempts: { id: string; createdAt: string; success: boolean; reason: string; ipAddress: string | null }[];
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const toast = useToast();
  const user = useGet<UserDetail>(`/admin/users/${id}`);
  const activity = useGet<Activity>(can('audit.read') ? `/admin/users/${id}/activity?limit=30` : null);
  const [statusDialog, setStatusDialog] = useState<null | 'SUSPENDED' | 'ACTIVE' | 'DEACTIVATED'>(null);
  const [reason, setReason] = useState('');
  const [grantRole, setGrantRole] = useState(false);
  const [roleKey, setRoleKey] = useState('');
  const [anonymise, setAnonymise] = useState(false);
  const roles = useGet<{ key: string; name: string }[]>(grantRole ? '/admin/roles' : null);
  const inv = [`/admin/users/${id}`, '/admin/users'];

  const changeStatus = useAction((s: string) => api.post(`/admin/users/${id}/status`, { status: s, reason }), { success: 'Status updated', invalidate: inv, onSuccess: () => { setStatusDialog(null); setReason(''); } });
  const unlock = useAction(() => api.post(`/admin/users/${id}/unlock`), { success: 'Lockout cleared', invalidate: inv });
  const revokeSessions = useAction(() => api.post(`/admin/users/${id}/sessions/revoke`), { success: 'All sessions revoked', invalidate: inv });
  const grant = useAction(() => api.post(`/admin/users/${id}/roles`, { roleKey }), { success: 'Role granted', invalidate: inv, onSuccess: () => setGrantRole(false) });
  const revoke = useAction((key: string) => api.delete(`/admin/users/${id}/roles/${key}`), { success: 'Role revoked', invalidate: inv });
  const doAnonymise = useAction(() => api.post(`/admin/users/${id}/anonymise`, { reason, confirm: 'ANONYMISE' }), { success: 'Account anonymised', invalidate: inv, onSuccess: () => setAnonymise(false) });
  const [resetDialog, setResetDialog] = useState(false);
  const sendReset = useAction(
    () => api.post<{ data: { channel: 'EMAIL' | 'SMS'; recipient: string; expiresInMinutes: number } }>(`/admin/users/${id}/password-reset`),
    { invalidate: inv, onSuccess: (r) => { setResetDialog(false); toast.success(`Reset link sent by ${r.data.channel === 'EMAIL' ? 'email' : 'SMS'} to ${r.data.recipient} · valid ${r.data.expiresInMinutes} minutes`); } },
  );

  if (user.isPending) return <Skeleton rows={8} />;
  if (user.isError) return <ErrorState error={user.error} retry={() => user.refetch()} />;
  const u = user.data;
  const self = me?.id === u.id;
  const canManage = can('users.status') && !self;
  const resettable = can('users.update') && (u.status === 'ACTIVE' || u.status === 'PENDING_VERIFICATION') && !!(u.email || u.phone);

  return (
    <RequirePermission anyOf={['users.read']}>
      <PageHeader
        title={u.fullName}
        description={`${u.email ?? ''}${u.email && u.phone ? ' · ' : ''}${u.phone ?? ''}`}
        actions={
          <>
            {canManage && u.status === 'ACTIVE' && <Button variant="danger" onClick={() => setStatusDialog('SUSPENDED')}>Suspend</Button>}
            {canManage && (u.status === 'SUSPENDED' || u.status === 'DEACTIVATED' || u.status === 'PENDING_VERIFICATION') && <Button onClick={() => setStatusDialog('ACTIVE')}>Activate</Button>}
            {canManage && u.status !== 'DEACTIVATED' && u.status !== 'ANONYMISED' && <Button variant="secondary" onClick={() => setStatusDialog('DEACTIVATED')}>Deactivate</Button>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Account" className="lg:col-span-2">
          <DescriptionList
            items={[
              { label: 'Status', value: <span className="flex gap-1"><Badge>{u.status}</Badge>{u.locked && <Badge tone="SUSPENDED">Locked Until {dateTime(u.lockedUntil)}</Badge>}</span> },
              { label: 'Status Reason', value: u.statusReason },
              { label: 'Email', value: u.email ? <>{u.email} <Badge accent={u.emailVerified ? 'green' : 'orange'}>{u.emailVerified ? 'Verified' : 'Unverified'}</Badge></> : 'None' },
              { label: 'Mobile', value: u.phone ? <>{u.phone} <Badge accent={u.phoneVerified ? 'green' : 'orange'}>{u.phoneVerified ? 'Verified' : 'Unverified'}</Badge></> : 'None' },
              { label: 'Preferred Language', value: u.preferredLanguage.toUpperCase() },
              { label: 'Last Login', value: dateTime(u.lastLoginAt) },
              { label: 'Created', value: dateTime(u.createdAt) },
              { label: 'Updated', value: dateTime(u.updatedAt) },
              { label: 'Patient Profiles', value: u.patientProfileCount },
              { label: 'Doctor Profile', value: u.doctorProviderId ? <Link className="underline" href={`/providers/${u.doctorProviderId}`}>Open Provider</Link> : 'None' },
            ]}
          />
        </Card>
        <Card title="Password & Security" description="Administrators never see or set passwords">
          <DescriptionList
            items={[
              { label: 'Must Change Password', value: u.mustChangePassword ? 'Yes' : 'No' },
              { label: 'Failed Logins', value: u.failedLoginCount },
              { label: 'Lockout', value: u.locked ? `Locked Until ${dateTime(u.lockedUntil)}` : 'None' },
            ]}
          />
          <div className="mt-4 space-y-2 border-t border-grey-100 pt-4">
            {resettable ? (
              <button type="button" onClick={() => setResetDialog(true)} className="flex w-full items-center gap-3 rounded-lg border border-grey-200 p-3 text-left hover:bg-grey-50">
                <IconTile icon={KeyRound} accent="blue" size="sm" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Send Password Reset Link</span><span className="block text-xs text-grey-500">One-time link to {u.email ?? u.phone}, valid 60 minutes</span></span>
              </button>
            ) : (
              <p className="text-xs text-grey-500">{u.status === 'ACTIVE' || u.status === 'PENDING_VERIFICATION' ? 'A reset link needs an email address or mobile number on the account.' : 'Reset links can only be sent to active accounts.'}</p>
            )}
            {canManage && u.locked && (
              <button type="button" onClick={() => unlock.mutate()} disabled={unlock.isPending} className="flex w-full items-center gap-3 rounded-lg border border-grey-200 p-3 text-left hover:bg-grey-50 disabled:opacity-60">
                <IconTile icon={Unlock} accent="orange" size="sm" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Clear Login Lockout</span><span className="block text-xs text-grey-500">Lets the user try signing in again now</span></span>
              </button>
            )}
            {can('users.sessions.revoke') && !self && (
              <button type="button" onClick={() => revokeSessions.mutate()} disabled={revokeSessions.isPending} className="flex w-full items-center gap-3 rounded-lg border border-grey-200 p-3 text-left hover:bg-grey-50 disabled:opacity-60">
                <IconTile icon={LogOut} accent="red" size="sm" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">Revoke All Sessions</span><span className="block text-xs text-grey-500">Signs the user out on every device</span></span>
              </button>
            )}
          </div>
        </Card>
        <Card title="Platform Roles" className="lg:col-span-3" actions={can('roles.assign') && !self && u.status !== 'ANONYMISED' && <Button size="sm" variant="secondary" onClick={() => setGrantRole(true)}>Grant Role</Button>}>
          {u.roles.length === 0 ? <p className="text-sm text-grey-500">No platform roles.</p> : (
            <ul className="space-y-2 text-sm">
              {u.roles.map((r) => (
                <li key={r} className="flex items-center justify-between">
                  <span className="font-medium">{r}</span>
                  {can('roles.assign') && !self && <Button size="sm" variant="ghost" onClick={() => revoke.mutate(r)} loading={revoke.isPending}>Revoke</Button>}
                </li>
              ))}
            </ul>
          )}
          {u.roleHistory.some((h) => h.revokedAt) && (
            <details className="mt-3 text-xs text-grey-600">
              <summary className="cursor-pointer">Role History</summary>
              <ul className="mt-1 space-y-1">
                {u.roleHistory.map((h, i) => <li key={i}>{h.roleKey}: granted {dateTime(h.grantedAt)}{h.revokedAt ? `, revoked ${dateTime(h.revokedAt)}` : ''}</li>)}
              </ul>
            </details>
          )}
        </Card>
        <Card title="Provider Memberships" className="lg:col-span-3">
          {u.providerMemberships.length === 0 ? <p className="text-sm text-grey-500">Not a member of any provider organisation.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-grey-500"><tr><th className="py-1">Provider</th><th>Type</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>
                {u.providerMemberships.map((m) => (
                  <tr key={m.providerId} className="border-t border-grey-200">
                    <td className="py-1.5"><Link className="underline" href={`/providers/${m.providerId}`}>{m.providerName}</Link></td>
                    <td>{title(m.providerType)}</td><td>{m.memberRole}</td><td><Badge>{m.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {can('audit.read') && (
          <Card title="Recent Activity" className="lg:col-span-3">
            {activity.isPending ? <Skeleton rows={4} /> : activity.isError ? <ErrorState error={activity.error} /> : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-grey-500">Audit Events</h3>
                  <ul className="divide-y divide-grey-200 text-xs">
                    {activity.data.auditEvents.map((e) => <li key={e.id} className="flex justify-between gap-2 py-1"><span>{e.action} <span className="text-grey-500">{e.entityType}{e.entityId ? ` ${e.entityId.slice(0, 8)}` : ''}</span></span><span className="shrink-0 text-grey-500">{dateTime(e.occurredAt)}</span></li>)}
                    {!activity.data.auditEvents.length && <li className="py-1 text-grey-500">None</li>}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-grey-500">Login Attempts</h3>
                  <ul className="divide-y divide-grey-200 text-xs">
                    {activity.data.loginAttempts.map((a) => <li key={a.id} className="flex justify-between gap-2 py-1"><span>{a.success ? 'Success' : `Failed (${a.reason})`} <span className="text-grey-500">{a.ipAddress ?? ''}</span></span><span className="shrink-0 text-grey-500">{dateTime(a.createdAt)}</span></li>)}
                    {!activity.data.loginAttempts.length && <li className="py-1 text-grey-500">None</li>}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
      {can('users.anonymise') && !self && u.status !== 'ANONYMISED' && (
        <div className="mt-6 border border-grey-300 p-4 text-sm">
          <p className="font-medium">Anonymise Account</p>
          <p className="mt-1 text-grey-600">Irreversibly removes personal details under the retention policy. Blocked by legal holds, doctor profiles and provider ownership.</p>
          <Button variant="danger" size="sm" className="mt-3" onClick={() => setAnonymise(true)}>Anonymise…</Button>
        </div>
      )}

      <ConfirmDialog open={!!statusDialog} onClose={() => setStatusDialog(null)} onConfirm={() => statusDialog && changeStatus.mutate(statusDialog)} title={`Set Status to ${title(statusDialog)}`} message="Non-active statuses sign the user out everywhere immediately." confirmLabel="Change Status" loading={changeStatus.isPending} danger={statusDialog !== 'ACTIVE'}>
        <Field label="Reason" required className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={resetDialog} onClose={() => setResetDialog(false)} onConfirm={() => sendReset.mutate()} title="Send Password Reset Link?" message={`A one-time link will be sent to ${u.email ?? u.phone}. It expires in 60 minutes, and the user's current password keeps working until they use it.`} confirmLabel="Send Link" loading={sendReset.isPending} />
      <ConfirmDialog open={anonymise} onClose={() => setAnonymise(false)} onConfirm={() => doAnonymise.mutate()} title="Anonymise This Account?" message="This cannot be undone. Type a reason to continue." confirmLabel="Anonymise" loading={doAnonymise.isPending} danger>
        <Field label="Reason" required className="mt-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <Dialog open={grantRole} onClose={() => setGrantRole(false)} title="Grant a Platform Role" footer={<><Button variant="ghost" onClick={() => setGrantRole(false)}>Cancel</Button><Button onClick={() => grant.mutate()} loading={grant.isPending} disabled={!roleKey}>Grant</Button></>}>
        <Field label="Role">
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            <option value="">Choose…</option>
            {roles.data?.filter((r) => !u.roles.includes(r.key)).map((r) => <option key={r.key} value={r.key}>{r.name} ({r.key})</option>)}
          </Select>
        </Field>
      </Dialog>
    </RequirePermission>
  );
}
