'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Eye, Mail, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, useFilters, useGet } from '@/lib/hooks';
import { dateTime, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Dialog, Field, FormSection, Input, PageHeader, Select } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

export interface UserRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: string[];
}

const columns: ColumnDef<UserRow, unknown>[] = [
  { header: 'Name', accessorKey: 'fullName', cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span> },
  { header: 'Contact', cell: ({ row }) => <span className="text-grey-700">{row.original.email ?? row.original.phone ?? '—'}</span> },
  { header: 'Status', cell: ({ row }) => <span className="flex gap-1"><Badge>{row.original.status}</Badge>{row.original.locked && <Badge tone="SUSPENDED">locked</Badge>}</span> },
  { header: 'Roles', cell: ({ row }) => <span className="text-xs">{row.original.roles.join(', ') || '—'}</span> },
  { header: 'Last Login', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.lastLoginAt)}</span> },
  { header: 'Created', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.createdAt)}</span> },
  {
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <Link href={`/users/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex" aria-label={`View ${row.original.fullName}`}>
        <Button size="sm" variant="secondary" tabIndex={-1}><Eye size={14} aria-hidden /> View</Button>
      </Link>
    ),
  },
];

/** Where the invitation will go, and whether it can actually be delivered. */
function InviteDelivery({ email, phone }: { email: string; phone: string }) {
  const { can } = useAuth();
  const smtp = useGet<{ configured: boolean; host: string | null; fromAddress: string | null }>(can('settings.read') ? '/admin/integrations/smtp' : null);
  if (!email && phone) {
    return (
      <Notice tone="warn" icon={AlertTriangle} title="Mobile-Only Invitations Are Not Delivered Yet">
        No SMS gateway is connected, so the invitation is recorded but not sent. Add an email address so the user actually receives the link.
      </Notice>
    );
  }
  if (!can('settings.read')) {
    return <Notice tone="info" icon={Mail} title="Sent by Email">The invitation goes out through the platform&apos;s SMTP settings (Settings → Email).</Notice>;
  }
  if (smtp.isPending) return <div className="h-14 animate-pulse rounded-lg bg-grey-100" />;
  if (smtp.data?.configured) {
    return (
      <Notice tone="ok" icon={CheckCircle2} title="SMTP Connected">
        Delivered from <span className="font-medium text-ink">{smtp.data.fromAddress}</span> via <span className="font-medium text-ink">{smtp.data.host}</span>.
      </Notice>
    );
  }
  return (
    <Notice tone="warn" icon={AlertTriangle} title="SMTP Is Not Configured">
      The invitation will be queued but only written to the server log. <Link href="/settings?tab=email" className="font-medium underline underline-offset-2">Configure SMTP in Settings → Email</Link> so emails go out.
    </Notice>
  );
}

function Notice({ tone, icon: Icon, title, children }: { tone: 'ok' | 'warn' | 'info'; icon: typeof Mail; title: string; children: React.ReactNode }) {
  const cls = tone === 'ok' ? 'border-green/30 bg-green-soft text-green' : tone === 'warn' ? 'border-orange/30 bg-orange-soft text-orange' : 'border-grey-200 bg-grey-50 text-grey-700';
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${cls}`}>
      <Icon size={18} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-grey-700">{children}</p>
      </div>
    </div>
  );
}

const CreateSchema = z
  .object({
    fullName: z.string().trim().min(2, 'At least 2 characters').max(160),
    email: z.string().trim().email('Invalid email').max(254).or(z.literal('')),
    phone: z.string().trim().regex(/^(\+[1-9]\d{7,14}|[6-9]\d{9})?$/, 'Use +91… or a 10-digit mobile'),
    role: z.string(),
  })
  .refine((v) => v.email || v.phone, { message: 'Provide an email or a mobile number', path: ['email'] });
type CreateValues = z.infer<typeof CreateSchema>;

function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const roles = useGet<{ key: string; name: string; isSystem: boolean }[]>(open ? '/admin/roles' : null);
  const form = useForm<CreateValues>({ resolver: zodResolver(CreateSchema), defaultValues: { fullName: '', email: '', phone: '', role: '' } });
  const create = useAction(
    (v: CreateValues) =>
      api.post<{ data: { id: string } }>('/admin/users', { fullName: v.fullName, email: v.email || undefined, phone: v.phone || undefined, roles: v.role ? [v.role] : [], sendInvite: true }),
    {
      success: 'User created — an invitation to set a password was queued.',
      invalidate: ['/admin/users'],
      onSuccess: (r) => {
        form.reset();
        onCreated(r.data.id);
      },
      onError: (err) => {
        if (err instanceof ApiError) for (const [k, m] of Object.entries(err.fieldErrors)) form.setError(k as keyof CreateValues, { message: m });
      },
    },
  );
  const submit = form.handleSubmit((v) => create.mutate(v));
  const email = useWatch({ control: form.control, name: 'email' });
  const phone = useWatch({ control: form.control, name: 'phone' });
  const errors = form.formState.errors;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create User"
      description="Add a login identity and invite the person to set their own password"
      icon={UserRound}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} loading={create.isPending}><Mail size={16} aria-hidden /> Create and Send Invite</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormSection title="Identity" icon={UserRound} accent="blue" hint="Name and at least one contact. The invitation goes to the contact you enter.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Full Name" required error={errors.fullName?.message} className="md:col-span-2"><Input autoFocus placeholder="e.g. Priya Sen" {...form.register('fullName')} /></Field>
            <Field label="Email" error={errors.email?.message} hint="Recommended — this is where the invite is sent"><Input type="email" placeholder="name@example.com" autoComplete="off" {...form.register('email')} /></Field>
            <Field label="Mobile" error={errors.phone?.message} hint="+91… or a 10-digit Indian mobile"><Input inputMode="tel" placeholder="98300 00000" autoComplete="off" {...form.register('phone')} /></Field>
          </div>
        </FormSection>

        <FormSection title="Access" icon={ShieldCheck} accent="purple" hint="Optional. You can only grant roles whose permissions you hold; roles can be changed later from the user's page.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Platform Role">
              <Select {...form.register('role')}>
                <option value="">No Platform Role</option>
                {roles.data?.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </Select>
            </Field>
            <p className="self-end rounded-lg bg-grey-50 p-3 text-xs text-grey-600">Patients and provider staff normally need no platform role. Platform roles are for Carevanta operations, finance and support teams.</p>
          </div>
        </FormSection>

        <FormSection title="Invitation" icon={Mail} accent="green" hint="The user receives a one-time link (valid 72 hours) to choose a password. Administrators never see or set passwords.">
          <InviteDelivery email={email} phone={phone} />
        </FormSection>
      </form>
    </Dialog>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const { can } = useAuth();
  const { filters, set } = useFilters({ q: '', status: '', role: '' });
  const q = useDebounced(filters.q);
  const [creating, setCreating] = useState(false);
  return (
    <RequirePermission anyOf={['users.read']}>
      <PageHeader title="Users" description="Every login identity on the platform — patients, provider staff and administrators." actions={can('users.create') && <Button onClick={() => setCreating(true)}><Plus size={16} /> New User</Button>} />
      <DataTable<UserRow>
        path="/admin/users"
        params={{ q, status: filters.status, role: filters.role }}
        columns={columns}
        onRowClick={(u) => router.push(`/users/${u.id}`)}
        emptyTitle="No Users Match"
        emptyDescription="Try a different search, or create the first user with New User."
        toolbar={
          <>
            <Input aria-label="Search Users" placeholder="Search Name, Email or Mobile" value={filters.q} onChange={(e) => set('q', e.target.value)} className="w-72" />
            <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-48">
              <option value="">All Statuses</option>
              {['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'ANONYMISED'].map((s) => <option key={s} value={s}>{title(s)}</option>)}
            </Select>
            <Input aria-label="Role Key" placeholder="Role Key e.g. SUPER_ADMIN" value={filters.role} onChange={(e) => set('role', e.target.value.toUpperCase())} className="w-56" />
          </>
        }
      />
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); router.push(`/users/${id}`); }} />
    </RequirePermission>
  );
}
