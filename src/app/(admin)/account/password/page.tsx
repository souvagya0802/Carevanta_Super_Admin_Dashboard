'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { Button, Card, Field, PageHeader, PasswordInput } from '@/components/ui/primitives';

export default function PasswordPage() {
  const { me, reload } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const change = useAction(() => api.post('/auth/password/change', { currentPassword: f.currentPassword, newPassword: f.newPassword }), {
    success: 'Password changed. Other sessions were signed out.',
    onSuccess: () => { void reload(); router.replace('/'); },
    onError: (e) => setError(e instanceof ApiError ? (e.fieldErrors.newPassword ?? e.message) : 'Could not change password'),
  });
  const mismatch = f.confirm && f.confirm !== f.newPassword;
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Change password" description={me?.mustChangePassword ? 'You must set a new password before continuing.' : 'Choose a passphrase of at least 12 characters.'} />
      <Card>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); change.mutate(); }} noValidate>
          <Field label="Current password" required><PasswordInput autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
          <Field label="New password" required hint="12–128 characters; avoid common passwords"><PasswordInput autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
          <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match' : undefined}><PasswordInput autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} aria-invalid={!!mismatch} /></Field>
          {error && <p role="alert" className="border border-ink px-3 py-2 text-sm">{error}</p>}
          <Button type="submit" loading={change.isPending} disabled={!f.currentPassword || f.newPassword.length < 12 || !!mismatch || f.confirm !== f.newPassword}>Change password</Button>
        </form>
      </Card>
    </div>
  );
}
