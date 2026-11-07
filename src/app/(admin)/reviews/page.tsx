'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, EyeOff, Star, XCircle } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';
import { dateTime, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Dialog, EmptyState, Field, PageHeader, Tabs, Textarea, cx } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

type ReviewStatus = 'PENDING_MODERATION' | 'PUBLISHED' | 'REJECTED' | 'HIDDEN';
type Decision = Exclude<ReviewStatus, 'PENDING_MODERATION'>;

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  status: ReviewStatus;
  createdAt: string;
  moderatedAt: string | null;
  provider: { id: string; displayName: string; type: string } | null;
  doctor?: { id: string; displayName: string } | null;
  /** The API sends a display name; tolerate an object in case the contract grows. */
  author: string | { fullName?: string | null; displayName?: string | null } | null;
  appointmentReference: string | null;
}

const STATUS_TABS: { key: ReviewStatus; label: string }[] = [
  { key: 'PENDING_MODERATION', label: 'Pending Moderation' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'HIDDEN', label: 'Hidden' },
];

const ACTIONS: Record<Decision, { label: string; icon: typeof Star; variant: 'primary' | 'secondary' | 'danger'; needsNote: boolean; done: string }> = {
  PUBLISHED: { label: 'Publish', icon: CheckCircle2, variant: 'primary', needsNote: false, done: 'Review published' },
  REJECTED: { label: 'Reject', icon: XCircle, variant: 'danger', needsNote: true, done: 'Review rejected' },
  HIDDEN: { label: 'Hide', icon: EyeOff, variant: 'secondary', needsNote: true, done: 'Review hidden' },
};

const authorName = (a: Review['author']) => (typeof a === 'string' ? a : a?.fullName || a?.displayName) || 'Patient';

function Stars({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${v} out of 5 stars`} title={`${v} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={14} aria-hidden className={i < v ? 'fill-orange text-orange' : 'text-grey-300'} />
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canModerate = can('reviews.moderate');
  const [status, setStatus] = useState<ReviewStatus>('PENDING_MODERATION');
  const [pending, setPending] = useState<{ review: Review; decision: Decision } | null>(null);
  const [note, setNote] = useState('');

  const close = () => {
    setPending(null);
    setNote('');
  };
  const moderate = useAction(
    (v: { review: Review; decision: Decision; note?: string }) => api.post<{ data: Review }>(`/admin/reviews/${v.review.id}/moderate`, { decision: v.decision, ...(v.note ? { note: v.note } : {}) }),
    { invalidate: ['/admin/reviews', '/admin/providers'], onSuccess: (_data, v) => { toast.success(ACTIONS[v.decision].done); close(); } },
  );
  const start = (review: Review, decision: Decision) => {
    if (ACTIONS[decision].needsNote) setPending({ review, decision });
    else moderate.mutate({ review, decision });
  };

  const columns: ColumnDef<Review, unknown>[] = [
    {
      id: 'provider',
      header: 'Provider',
      cell: ({ row }) => {
        const p = row.original.provider;
        return p ? (
          <div className="min-w-40">
            <Link href={`/providers/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.displayName}</Link>
            <p className="text-xs text-grey-500">{title(p.type)}{row.original.doctor && row.original.doctor.id !== p.id ? ` · ${row.original.doctor.displayName}` : ''}</p>
          </div>
        ) : <span className="text-grey-500">—</span>;
      },
    },
    { id: 'rating', header: 'Rating', cell: ({ row }) => <Stars value={row.original.rating} /> },
    {
      id: 'comment',
      header: 'Comment',
      cell: ({ row }) => (row.original.comment ? <p className="min-w-48 max-w-md whitespace-pre-line break-words text-sm">{row.original.comment}</p> : <span className="text-xs text-grey-500">No Comment</span>),
    },
    { id: 'author', header: 'Author', cell: ({ row }) => <span className="text-sm">{authorName(row.original.author)}</span> },
    { id: 'appointment', header: 'Appointment', cell: ({ row }) => <span className="font-mono text-xs">{row.original.appointmentReference ?? '—'}</span> },
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <div className="text-xs text-grey-600">
          <p>{dateTime(row.original.createdAt)}</p>
          {row.original.moderatedAt && <p className="text-grey-500">Moderated {dateTime(row.original.moderatedAt)}</p>}
        </div>
      ),
    },
    { id: 'status', header: 'Status', cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        canModerate ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {(Object.keys(ACTIONS) as Decision[])
              .filter((d) => d !== row.original.status)
              .map((d) => {
                const a = ACTIONS[d];
                const busy = moderate.isPending && moderate.variables?.review.id === row.original.id && moderate.variables.decision === d;
                return (
                  <Button key={d} size="sm" variant={a.variant} loading={busy} disabled={moderate.isPending} onClick={() => start(row.original, d)} aria-label={`${a.label} Review by ${authorName(row.original.author)}`}>
                    {!busy && <a.icon size={14} aria-hidden />} {a.label}
                  </Button>
                );
              })}
          </div>
        ) : null,
    },
  ];

  const renderError = (err: unknown) =>
    err instanceof ApiError && err.status === 404 ? (
      <EmptyState title="Review Moderation Is Not Available Yet" description="The API on this environment does not offer the reviews endpoint yet. Reviews will appear here as soon as it is deployed." />
    ) : null;

  const action = pending ? ACTIONS[pending.decision] : null;
  return (
    <RequirePermission anyOf={['reviews.read', 'reviews.moderate']}>
      <PageHeader title="Patient Reviews" description="Reviews stay private until a moderator publishes them. Publishing, rejecting or hiding a review recalculates the provider's public rating." />
      <div className="relative mb-4 max-w-full overflow-x-auto">
        <Tabs tabs={STATUS_TABS} active={status} onChange={(k) => setStatus(k as ReviewStatus)} />
      </div>
      <DataTable<Review>
        path="/admin/reviews"
        params={{ status }}
        columns={columns}
        emptyTitle={status === 'PENDING_MODERATION' ? 'Nothing Waiting for Moderation' : `No ${title(status)} Reviews`}
        emptyDescription={status === 'PENDING_MODERATION' ? 'New patient reviews appear here after a completed appointment.' : undefined}
        renderError={renderError}
      />
      <Dialog
        open={!!pending}
        onClose={close}
        icon={action?.icon}
        title={action ? `${action.label} Review` : ''}
        description={pending ? `${authorName(pending.review.author)} on ${pending.review.provider?.displayName ?? 'Provider'}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={moderate.isPending}>Cancel</Button>
            {pending && action && (
              <Button variant={action.variant === 'danger' ? 'danger' : 'primary'} loading={moderate.isPending} onClick={() => moderate.mutate({ review: pending.review, decision: pending.decision, note: note.trim() || undefined })}>
                {action.label} Review
              </Button>
            )}
          </>
        }
      >
        {pending && (
          <div className="space-y-4">
            <div className="rounded-[5px] border border-grey-200 bg-grey-50 p-3">
              <Stars value={pending.review.rating} />
              <p className={cx('mt-1 whitespace-pre-line break-words', !pending.review.comment && 'text-grey-500')}>{pending.review.comment || 'No Comment'}</p>
            </div>
            <p className="text-grey-600">{pending.decision === 'REJECTED' ? 'The review will not be shown to patients and does not count toward the rating.' : 'The review is taken off the public listing and no longer counts toward the rating.'}</p>
            <Field label="Moderation Note" hint="Optional. Kept in the audit log, never shown to the patient.">
              <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Dialog>
    </RequirePermission>
  );
}
