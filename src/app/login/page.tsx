'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Field, Input, PasswordInput } from '@/components/ui/primitives';
import { Logo, useBranding } from '@/lib/branding';

const Schema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or mobile number'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof Schema>;

export default function LoginPage() {
  const { me, loading, login } = useAuth();
  const { branding } = useBranding();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(Schema), defaultValues: { identifier: '', password: '' } });

  useEffect(() => {
    if (!loading && me) router.replace('/');
  }, [loading, me, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await login(values.identifier, values.password);
      router.replace(user.mustChangePassword ? '/account/password' : '/');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ACCOUNT_LOCKED') setError('Too many failed attempts. Try again later or reset your password.');
        else if (err.code === 'ACCOUNT_INACTIVE') setError('This account is not active. Contact a platform administrator.');
        else if (err.status === 429) setError('Too many attempts. Please wait a minute.');
        else setError('Invalid email/mobile or password.');
      } else setError('Could not reach the API. Check your connection.');
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-grey-50 px-4">
      <div className="w-full max-w-sm border border-ink bg-paper p-8">
        <Logo size="lg" className="mx-auto mb-4" />
        <h1 className="text-center text-lg font-semibold">{branding.name} Admin</h1>
        <p className="mt-1 text-center text-sm text-grey-600">{branding.tagline || 'Sign in with your platform account.'}</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <Field label="Email or mobile" error={form.formState.errors.identifier?.message} required>
            <Input autoComplete="username" autoFocus aria-invalid={!!form.formState.errors.identifier} {...form.register('identifier')} />
          </Field>
          <Field label="Password" error={form.formState.errors.password?.message} required>
            <PasswordInput autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register('password')} />
          </Field>
          {error && (
            <p role="alert" className="border border-ink px-3 py-2 text-sm">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-xs text-grey-500">Access is limited to authorised {branding.name} staff. All actions are logged.</p>
      </div>
    </main>
  );
}
