'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useDebounced, useFilters } from '@/lib/hooks';
import { dateTime, title } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Input, PageHeader, Select, Tabs } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

interface AuditEvent { id: string; occurredAt: string; actorUserId: string | null; actorType: string; action: string; entityType: string; entityId: string | null; outcome: string; requestId: string | null; ipAddress: string | null; metadata: Record<string, unknown> | null }
interface Access { id: string; actorUserId: string | null; resourceType: string; resourceId: string; purpose: string; granted: boolean; requestId: string | null; accessedAt: string }

export default function AuditPage() {
  const [tab, setTab] = useState('events');
  const { filters, set } = useFilters({ action: '', entityType: '', entityId: '', actorUserId: '', outcome: '', from: '', to: '' });
  const action = useDebounced(filters.action);
  const entityId = useDebounced(filters.entityId);
  const actorUserId = useDebounced(filters.actorUserId);
  const [access, setAccess] = useFiltersAccess();
  const columns: ColumnDef<AuditEvent, unknown>[] = [
    { header: 'When', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{dateTime(row.original.occurredAt)}</span> },
    { header: 'Action', cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span> },
    { header: 'Entity', cell: ({ row }) => <span className="font-mono text-xs">{title(row.original.entityType)}{row.original.entityId ? ` ${row.original.entityId.slice(0, 8)}` : ''}</span> },
    { header: 'Actor', cell: ({ row }) => <span className="text-xs">{row.original.actorUserId ? <Link className="underline" href={`/users/${row.original.actorUserId}`}>{row.original.actorUserId.slice(0, 8)}</Link> : row.original.actorType.toLowerCase()}</span> },
    { header: 'Outcome', cell: ({ row }) => <Badge>{row.original.outcome}</Badge> },
    { header: 'Details', cell: ({ row }) => <details className="text-xs"><summary className="cursor-pointer text-grey-600">{row.original.requestId?.slice(0, 8) ?? 'metadata'}</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap bg-grey-50 p-2">{JSON.stringify({ ip: row.original.ipAddress, ...row.original.metadata }, null, 1)}</pre></details> },
  ];
  const accessColumns: ColumnDef<Access, unknown>[] = [
    { header: 'When', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{dateTime(row.original.accessedAt)}</span> },
    { header: 'Resource', cell: ({ row }) => <span className="font-mono text-xs">{title(row.original.resourceType)} {row.original.resourceId.slice(0, 8)}</span> },
    { header: 'Actor', cell: ({ row }) => <span className="text-xs">{row.original.actorUserId ? <Link className="underline" href={`/users/${row.original.actorUserId}`}>{row.original.actorUserId.slice(0, 8)}</Link> : '—'}</span> },
    { header: 'Purpose', cell: ({ row }) => <span className="text-xs">{row.original.purpose}</span> },
    { header: 'Granted', cell: ({ row }) => <Badge tone={row.original.granted ? 'ACTIVE' : 'DENIED'}>{row.original.granted ? 'granted' : 'denied'}</Badge> },
  ];
  return (
    <RequirePermission anyOf={['audit.read']}>
      <PageHeader title="Audit Logs" description="Append-only record of every privileged action, written in the same transaction as the change. Sensitive reads (reports, documents, exports) are logged separately with the stated purpose." />
      <Tabs tabs={[{ key: 'events', label: 'Audit Events' }, { key: 'access', label: 'Sensitive Access' }]} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'events' && (
          <DataTable<AuditEvent> path="/admin/audit-events" params={{ action, entityType: filters.entityType, entityId, actorUserId, outcome: filters.outcome, from: filters.from ? new Date(filters.from).toISOString() : '', to: filters.to ? new Date(filters.to).toISOString() : '' }} columns={columns} emptyTitle="No Events Match" toolbar={<>
            <Input aria-label="Action" placeholder="Action (prefix with *: provider.*)" value={filters.action} onChange={(e) => set('action', e.target.value)} className="w-64" />
            <Input aria-label="Entity Type" placeholder="Entity Type" value={filters.entityType} onChange={(e) => set('entityType', e.target.value)} className="w-40" />
            <Input aria-label="Entity ID" placeholder="Entity ID" value={filters.entityId} onChange={(e) => set('entityId', e.target.value.trim())} className="w-64" />
            <Input aria-label="Actor User ID" placeholder="Actor User ID" value={filters.actorUserId} onChange={(e) => set('actorUserId', e.target.value.trim())} className="w-64" />
            <Select aria-label="Outcome" value={filters.outcome} onChange={(e) => set('outcome', e.target.value)} className="w-36"><option value="">Any Outcome</option><option value="SUCCESS">Success</option><option value="DENIED">Denied</option><option value="FAILURE">Failure</option></Select>
            <Input type="date" aria-label="From" value={filters.from} onChange={(e) => set('from', e.target.value)} className="w-40" />
            <Input type="date" aria-label="To" value={filters.to} onChange={(e) => set('to', e.target.value)} className="w-40" />
          </>} />
        )}
        {tab === 'access' && (
          <DataTable<Access> path="/admin/audit-events/sensitive-access" params={access} columns={accessColumns} emptyTitle="No Sensitive Access Recorded" toolbar={<>
            <Select aria-label="Resource Type" value={access.resourceType} onChange={(e) => setAccess('resourceType', e.target.value)} className="w-56"><option value="">All Resources</option>{['PROVIDER_DOCUMENT', 'DIAGNOSTIC_REPORT', 'EXPORT'].map((r) => <option key={r} value={r}>{title(r)}</option>)}</Select>
            <Input aria-label="Actor User ID" placeholder="Actor User ID" value={access.actorUserId} onChange={(e) => setAccess('actorUserId', e.target.value.trim())} className="w-64" />
          </>} />
        )}
      </div>
    </RequirePermission>
  );
}

function useFiltersAccess() {
  const { filters, set } = useFilters({ resourceType: '', actorUserId: '' });
  return [filters, set] as const;
}
