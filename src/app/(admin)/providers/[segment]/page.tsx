'use client';

import { notFound, useParams, useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useAuth } from '@/lib/auth';
import { useState } from 'react';
import { useDebounced, useFilters } from '@/lib/hooks';
import { dateTime, rating, title } from '@/lib/format';
import { PROVIDER_SLUGS, PROVIDER_STATUSES, isUuid } from '@/lib/providers-meta';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Button, Input, PageHeader, Select } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';
import { ProviderDetail } from '@/components/providers/provider-detail';
import { ProviderCreateDialog } from '@/components/providers/provider-create-dialog';

export interface ProviderRow {
  id: string;
  type: string;
  status: string;
  displayName: string;
  legalName: string;
  isListed: boolean;
  city: string | null;
  district: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  createdAt: string;
}

const columns: ColumnDef<ProviderRow, unknown>[] = [
  { header: 'Name', cell: ({ row }) => <div><p className="font-medium">{row.original.displayName}</p>{row.original.legalName && row.original.legalName !== row.original.displayName && <p className="text-xs text-grey-500">{row.original.legalName}</p>}</div> },
  { header: 'Status', cell: ({ row }) => <span className="flex gap-1"><Badge>{row.original.status}</Badge>{row.original.isListed && <Badge tone="ACTIVE">listed</Badge>}</span> },
  { header: 'Location', cell: ({ row }) => <span>{[row.original.city, row.original.district].filter(Boolean).join(', ') || '—'}</span> },
  { header: 'Rating', cell: ({ row }) => <span className="tnum text-xs">{row.original.ratingAverage != null ? `${rating(row.original.ratingAverage)} (${row.original.ratingCount})` : '—'}</span> },
  { header: 'Created', cell: ({ row }) => <span className="text-xs text-grey-600">{dateTime(row.original.createdAt)}</span> },
];

function ProviderList({ slug }: { slug: string }) {
  const meta = PROVIDER_SLUGS[slug]!;
  const router = useRouter();
  const { can } = useAuth();
  const { filters, set } = useFilters({ q: '', status: '', district: '' });
  const q = useDebounced(filters.q);
  const district = useDebounced(filters.district);
  const [creating, setCreating] = useState(false);
  return (
    <RequirePermission anyOf={['providers.read']}>
      <PageHeader title={meta.title} description={meta.description} actions={can('providers.create') && <Button onClick={() => setCreating(true)}><Plus size={16} /> Register {meta.singular}</Button>} />
      <DataTable<ProviderRow>
        path="/admin/providers"
        params={{ type: meta.type, q, status: filters.status, district }}
        columns={columns}
        onRowClick={(p) => router.push(`/providers/${p.id}`)}
        emptyTitle={`No ${meta.title} Match`}
        toolbar={
          <>
            <Input aria-label="Search" placeholder="Name, GSTIN or registration no." value={filters.q} onChange={(e) => set('q', e.target.value)} className="w-72" />
            <Select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-52">
              <option value="">All Statuses</option>
              {PROVIDER_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}
            </Select>
            <Input aria-label="District" placeholder="District" value={filters.district} onChange={(e) => set('district', e.target.value)} className="w-48" />
          </>
        }
      />
      <ProviderCreateDialog open={creating} initialType={meta.type} onClose={() => setCreating(false)} />
    </RequirePermission>
  );
}

export default function ProviderSegmentPage() {
  const { segment } = useParams<{ segment: string }>();
  if (PROVIDER_SLUGS[segment]) return <ProviderList slug={segment} />;
  if (isUuid(segment)) return <ProviderDetail id={segment} />;
  notFound();
}
