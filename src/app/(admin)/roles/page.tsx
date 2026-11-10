'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, Copy, Eye, KeyRound, Lock, Pencil, Search, Shield, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { count, dateTime, relative, title } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, FormSection, IconTile, Input, PageHeader, Skeleton, Tabs, Textarea, cx, type Accent } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/layout/shell';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Role { id: string; key: string; name: string; description: string | null; scope: string; isSystem: boolean; permissions: string[]; activeAssignments: number; totalAssignments: number; createdAt: string; updatedAt: string }
interface Permission { key: string; description: string; isSensitive: boolean }
interface Holder { id: string; fullName: string; email: string | null; phone: string | null; status: string }

/** Human labels for permission modules (first segment of the key). Unknown modules fall back to title-case. */
const MODULE_LABELS: Record<string, string> = {
  users: 'Users & Accounts', roles: 'Roles & Access', providers: 'Providers', affiliations: 'Doctor–Facility Affiliations', catalogue: 'Clinical Catalogue', schedules: 'Schedules', bookings: 'Appointments',
  diagnostics: 'Diagnostics', pharmacy: 'Pharmacy', ambulance: 'Ambulance Fleet', dispatch: 'Emergency Dispatch', finance: 'Finance', support: 'Complaints & Support', audit: 'Audit Log',
  notifications: 'Notifications', analytics: 'Analytics & Reports', exports: 'Data Exports', settings: 'Platform Settings', regions: 'Service Regions', compliance: 'Compliance',
};
const moduleOf = (key: string) => key.split('.')[0]!;
const moduleLabel = (m: string) => MODULE_LABELS[m] ?? title(m);
const KEY_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const normaliseKey = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^[^A-Z]+/, '').slice(0, 64);

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function RolesPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const roles = useGet<Role[]>('/admin/roles');
  const permissions = useGet<Permission[]>('/admin/permissions');
  const [tab, setTab] = useState<'all' | 'system' | 'custom'>('all');
  const [q, setQ] = useState('');
  const [editor, setEditor] = useState<null | { mode: 'create' | 'edit' | 'clone'; role?: Role }>(null);
  const [viewing, setViewing] = useState<Role | null>(null);
  const [holdersOf, setHoldersOf] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const inv = ['/admin/roles', '/admin/permissions', '/admin/users'];
  const remove = useAction((id: string) => api.delete(`/admin/roles/${id}`), { success: 'Role deleted', invalidate: inv, onSuccess: () => setDeleting(null) });

  const permIndex = useMemo(() => new Map((permissions.data ?? []).map((p) => [p.key, p])), [permissions.data]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (roles.data ?? []).filter((r) => (tab === 'all' || (tab === 'system') === r.isSystem) && (!needle || r.name.toLowerCase().includes(needle) || r.key.toLowerCase().includes(needle) || (r.description ?? '').toLowerCase().includes(needle) || r.permissions.some((p) => p.includes(needle))));
  }, [roles.data, tab, q]);
  const stats = useMemo(() => {
    const all = roles.data ?? [];
    return { total: all.length, system: all.filter((r) => r.isSystem).length, custom: all.filter((r) => !r.isSystem).length, holders: all.reduce((s, r) => s + r.activeAssignments, 0), permissions: permissions.data?.length ?? 0, sensitive: permissions.data?.filter((p) => p.isSensitive).length ?? 0 };
  }, [roles.data, permissions.data]);
  const manage = can('roles.manage');
  const sensitiveCount = (r: Role) => r.permissions.filter((p) => permIndex.get(p)?.isSensitive).length;

  const canDelete = (r: Role) => !r.isSystem && r.totalAssignments === 0;
  const deleteBlockedReason = (r: Role) => (r.isSystem ? 'System roles are defined in code' : r.activeAssignments > 0 ? `${r.activeAssignments} user${r.activeAssignments === 1 ? ' holds' : 's hold'} this role` : r.totalAssignments > 0 ? 'Has assignment history; kept for audit' : '');

  return (
    <RequirePermission anyOf={['roles.read']}>
      <PageHeader title="Roles & Permissions" description="A role is a named set of permissions. System roles are defined in code and synchronised on deploy; custom roles can only contain permissions you hold yourself, and nobody can grant a role to themselves." actions={manage && <Button onClick={() => setEditor({ mode: 'create' })}><Shield size={16} /> New Custom Role</Button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat icon={Shield} accent="ink" label="Roles" value={stats.total} loading={roles.isPending} />
        <MiniStat icon={Lock} accent="blue" label="System Roles" value={stats.system} loading={roles.isPending} />
        <MiniStat icon={Pencil} accent="purple" label="Custom Roles" value={stats.custom} loading={roles.isPending} />
        <MiniStat icon={Users} accent="green" label="Active Assignments" value={stats.holders} loading={roles.isPending} />
        <MiniStat icon={KeyRound} accent="teal" label="Permissions" value={stats.permissions} loading={permissions.isPending} />
        <MiniStat icon={AlertTriangle} accent="orange" label="Sensitive" value={stats.sensitive} loading={permissions.isPending} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-grey-100 px-5 py-3">
          <Tabs active={tab} onChange={(k) => setTab(k as typeof tab)} tabs={[{ key: 'all', label: 'All', count: stats.total }, { key: 'system', label: 'System', count: stats.system }, { key: 'custom', label: 'Custom', count: stats.custom }]} />
          <div className="relative w-full sm:w-72">
            <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
            <Input aria-label="Search Roles" placeholder="Search name, key or permission…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </div>
        {roles.isPending || permissions.isPending ? <div className="p-5"><Skeleton rows={6} /></div> : roles.isError ? <div className="p-5"><ErrorState error={roles.error} retry={() => roles.refetch()} /></div> : permissions.isError ? <div className="p-5"><ErrorState error={permissions.error} retry={() => permissions.refetch()} /></div> : filtered.length === 0 ? (
          <div className="p-5"><EmptyState title={q ? 'No roles match your search' : tab === 'custom' ? 'No custom roles yet' : 'No roles'} description={tab === 'custom' && !q ? 'Create a custom role when a team needs a narrower set of permissions than the system roles provide.' : undefined} action={manage && tab === 'custom' && !q ? <Button onClick={() => setEditor({ mode: 'create' })}>New Custom Role</Button> : undefined} /></div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs text-grey-500">
                <tr className="border-b border-grey-100"><th className="px-5 py-2.5 font-medium">Role</th><th className="py-2.5 font-medium">Type</th><th className="py-2.5 font-medium">Permissions</th><th className="py-2.5 font-medium">Holders</th><th className="py-2.5 font-medium">Updated</th><th className="px-5 py-2.5 text-right font-medium">Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-grey-100 last:border-0 hover:bg-grey-50">
                    <td className="px-5 py-3 align-top">
                      <button type="button" onClick={() => setViewing(r)} className="text-left">
                        <span className="block font-medium hover:underline">{r.name}</span>
                        <span className="block font-mono text-[11px] text-grey-500">{r.key}</span>
                      </button>
                      {r.description && <p className="mt-1 max-w-md text-xs text-grey-600">{r.description}</p>}
                    </td>
                    <td className="py-3 align-top"><Badge accent={r.isSystem ? 'blue' : 'purple'}>{r.isSystem ? 'system' : 'custom'}</Badge></td>
                    <td className="py-3 align-top">
                      <span className="tnum font-medium">{r.key === 'SUPER_ADMIN' ? 'All' : count(r.permissions.length)}</span>
                      {sensitiveCount(r) > 0 && <span className="ml-2 text-xs text-orange">{sensitiveCount(r)} sensitive</span>}
                      <div className="mt-1 flex max-w-sm flex-wrap gap-1">{r.permissions.slice(0, 4).map((p) => <PermChip key={p} k={p} sensitive={permIndex.get(p)?.isSensitive} />)}{r.permissions.length > 4 && <button type="button" onClick={() => setViewing(r)} className="rounded-md bg-grey-100 px-1.5 py-0.5 text-[11px] text-grey-600 hover:bg-grey-200">+{r.permissions.length - 4} More</button>}</div>
                    </td>
                    <td className="py-3 align-top">
                      <button type="button" onClick={() => setHoldersOf(r)} className="inline-flex items-center gap-1.5 rounded-full bg-grey-100 px-2.5 py-1 text-xs font-medium hover:bg-grey-200" aria-label={`Show users holding ${r.name}`}><Users size={12} aria-hidden /> {r.activeAssignments}</button>
                      {r.totalAssignments > r.activeAssignments && <p className="mt-1 text-[11px] text-grey-500">{r.totalAssignments - r.activeAssignments} revoked</p>}
                    </td>
                    <td className="py-3 align-top text-xs text-grey-600" title={dateTime(r.updatedAt)}>{relative(r.updatedAt)}</td>
                    <td className="px-5 py-3 align-top">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setViewing(r)} aria-label={`View ${r.name}`}><Eye size={14} /></Button>
                        {manage && <Button size="sm" variant="ghost" onClick={() => setEditor({ mode: 'clone', role: r })} aria-label={`Clone ${r.name}`} title="Start a custom role from this one"><Copy size={14} /></Button>}
                        {manage && !r.isSystem && <Button size="sm" variant="ghost" onClick={() => setEditor({ mode: 'edit', role: r })} aria-label={`Edit ${r.name}`}><Pencil size={14} /></Button>}
                        {manage && !r.isSystem && <Button size="sm" variant="ghost" disabled={!canDelete(r)} title={canDelete(r) ? 'Delete' : deleteBlockedReason(r)} onClick={() => setDeleting(r)} aria-label={`Delete ${r.name}`} className="text-red disabled:text-grey-300"><Trash2 size={14} /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Mobile cards */}
            <ul className="divide-y divide-grey-100 md:hidden">
              {filtered.map((r) => (
                <li key={r.id} className="space-y-2 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => setViewing(r)} className="min-w-0 text-left"><span className="block font-medium">{r.name}</span><span className="block font-mono text-[11px] text-grey-500">{r.key}</span></button>
                    <Badge accent={r.isSystem ? 'blue' : 'purple'}>{r.isSystem ? 'system' : 'custom'}</Badge>
                  </div>
                  {r.description && <p className="text-xs text-grey-600">{r.description}</p>}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-grey-600"><span><span className="tnum font-medium text-ink">{r.key === 'SUPER_ADMIN' ? 'All' : r.permissions.length}</span> Permissions</span><button type="button" onClick={() => setHoldersOf(r)} className="inline-flex min-h-10 items-center gap-1 underline-offset-2 hover:underline sm:min-h-0"><Users size={12} /> {r.activeAssignments} Holders</button><span>Updated {relative(r.updatedAt)}</span></div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setViewing(r)}><Eye size={14} /> View</Button>
                    {manage && <Button size="sm" variant="secondary" onClick={() => setEditor({ mode: 'clone', role: r })}><Copy size={14} /> Clone</Button>}
                    {manage && !r.isSystem && <Button size="sm" variant="secondary" onClick={() => setEditor({ mode: 'edit', role: r })}><Pencil size={14} /> Edit</Button>}
                    {manage && !r.isSystem && <Button size="sm" variant="danger" disabled={!canDelete(r)} title={deleteBlockedReason(r)} onClick={() => setDeleting(r)}><Trash2 size={14} /> Delete</Button>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {editor && permissions.data && roles.data && (
        <RoleEditor
          mode={editor.mode}
          role={editor.role}
          allRoles={roles.data}
          catalogue={permissions.data}
          held={new Set(me?.permissions ?? [])}
          isSuperAdmin={me?.roles.includes('SUPER_ADMIN') ?? false}
          holdsRole={!!editor.role && (me?.roles.includes(editor.role.key) ?? false)}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[1] === 'string' && inv.some((p) => (x.queryKey[1] as string).startsWith(p)) }); }}
        />
      )}
      {viewing && permissions.data && (
        <RoleView role={viewing} catalogue={permissions.data} onClose={() => setViewing(null)} onHolders={() => { setHoldersOf(viewing); setViewing(null); }} onClone={manage ? () => { setEditor({ mode: 'clone', role: viewing }); setViewing(null); } : undefined} onEdit={manage && !viewing.isSystem ? () => { setEditor({ mode: 'edit', role: viewing }); setViewing(null); } : undefined} />
      )}
      {holdersOf && <HoldersDialog role={holdersOf} onClose={() => setHoldersOf(null)} canOpenUsers={can('users.read')} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} loading={remove.isPending} danger title="Delete This Role?" confirmLabel="Delete Role" message={deleting ? `${deleting.name} (${deleting.key}) has never been granted to anyone, so deleting it leaves no gap in the audit trail. This cannot be undone.` : ''} />
    </RequirePermission>
  );
}

/* ─── Small pieces ──────────────────────────────────────────────────────── */
function MiniStat({ icon, accent, label, value, loading }: { icon: typeof Shield; accent: Accent; label: string; value: number; loading?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-grey-200 bg-paper px-4 py-3 shadow-[var(--shadow-card)]">
      <IconTile icon={icon} accent={accent} size="sm" />
      <div className="min-w-0">{loading ? <div className="h-5 w-10 animate-pulse rounded-sm bg-grey-100" /> : <p className="tnum text-lg font-bold leading-tight">{value}</p>}<p className="text-[11px] leading-tight text-grey-500">{label}</p></div>
    </div>
  );
}

function PermChip({ k, sensitive, removed, added }: { k: string; sensitive?: boolean; removed?: boolean; added?: boolean }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]', removed ? 'bg-red-soft text-red line-through' : added ? 'bg-green-soft text-green' : sensitive ? 'bg-orange-soft text-orange' : 'bg-grey-100 text-grey-700')}>{sensitive && <AlertTriangle size={10} aria-label="sensitive" />}{k}</span>;
}

function groupBy(catalogue: Permission[]) {
  const g = new Map<string, Permission[]>();
  for (const p of catalogue) g.set(moduleOf(p.key), [...(g.get(moduleOf(p.key)) ?? []), p]);
  return [...g.entries()].sort((a, b) => moduleLabel(a[0]).localeCompare(moduleLabel(b[0])));
}

/* ─── Read-only view ────────────────────────────────────────────────────── */
function RoleView({ role, catalogue, onClose, onHolders, onClone, onEdit }: { role: Role; catalogue: Permission[]; onClose: () => void; onHolders: () => void; onClone?: () => void; onEdit?: () => void }) {
  const groups = groupBy(catalogue).map(([m, ps]) => [m, ps.filter((p) => role.permissions.includes(p.key))] as const).filter(([, ps]) => ps.length);
  const sensitive = role.permissions.filter((p) => catalogue.find((c) => c.key === p)?.isSensitive).length;
  return (
    <Dialog open onClose={onClose} size="lg" icon={role.isSystem ? Lock : Shield} title={role.name} description={`${role.key} · ${role.isSystem ? 'System Role' : 'Custom Role'} · ${role.activeAssignments} active holder${role.activeAssignments === 1 ? '' : 's'}`} footer={<>{onClone && <Button variant="secondary" onClick={onClone}><Copy size={14} /> Clone as Custom Role</Button>}{onEdit && <Button variant="secondary" onClick={onEdit}><Pencil size={14} /> Edit</Button>}<Button onClick={onClose}>Close</Button></>}>
      <div className="space-y-4">
        {role.description && <p className="text-grey-700">{role.description}</p>}
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Fact label="Permissions" value={role.key === 'SUPER_ADMIN' ? 'All (implicit)' : String(role.permissions.length)} />
          <Fact label="Sensitive" value={String(sensitive)} />
          <Fact label="Created" value={dateTime(role.createdAt)} />
          <Fact label="Last Updated" value={dateTime(role.updatedAt)} />
        </div>
        {role.isSystem && <p className="rounded-xl bg-blue-soft px-3 py-2 text-xs text-blue">System roles are maintained in code and synchronised on every deploy. To adjust a team’s access, clone this role and edit the copy.</p>}
        {role.key === 'SUPER_ADMIN' && <p className="rounded-xl bg-orange-soft px-3 py-2 text-xs text-orange">Super administrators hold every permission, including future ones. Keep at least two active holders; the platform refuses to suspend or demote the last one.</p>}
        <button type="button" onClick={onHolders} className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"><Users size={14} /> View {role.activeAssignments} holder{role.activeAssignments === 1 ? '' : 's'}</button>
        {groups.length === 0 ? <p className="text-sm text-grey-500">{role.key === 'SUPER_ADMIN' ? 'Holds every permission in the catalogue.' : 'No permissions.'}</p> : groups.map(([m, ps]) => (
          <div key={m}>
            <p className="mb-1.5 text-xs font-semibold text-grey-500">{moduleLabel(m)} <span className="font-normal normal-case">· {ps.length}</span></p>
            <ul className="divide-y divide-grey-100 rounded-xl border border-grey-200">
              {ps.map((p) => <li key={p.key} className="flex items-start gap-3 px-3 py-2"><ShieldCheck size={14} className={cx('mt-0.5 shrink-0', p.isSensitive ? 'text-orange' : 'text-green')} aria-hidden /><div className="min-w-0"><p className="font-mono text-xs">{p.key}{p.isSensitive && <Badge accent="orange">sensitive</Badge>}</p><p className="text-xs text-grey-600">{p.description}</p></div></li>)}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-grey-50 px-3 py-2"><p className="text-[11px] text-grey-500">{label}</p><p className="mt-0.5 font-medium text-ink">{value}</p></div>;
}

/* ─── Holders ──────────────────────────────────────────────────────────── */
function HoldersDialog({ role, onClose, canOpenUsers }: { role: Role; onClose: () => void; canOpenUsers: boolean }) {
  const holders = useGet<Holder[]>(canOpenUsers ? `/admin/users?role=${encodeURIComponent(role.key)}&limit=100` : null);
  return (
    <Dialog open onClose={onClose} icon={Users} title={`Who Holds ${role.name}`} description={`${role.activeAssignments} active · ${role.totalAssignments - role.activeAssignments} revoked in history`} footer={<>{canOpenUsers && <Link href={`/users?role=${encodeURIComponent(role.key)}`}><Button variant="secondary">Open in Users</Button></Link>}<Button onClick={onClose}>Close</Button></>}>
      {!canOpenUsers ? <p className="text-grey-600">You need the users.read permission to see who holds this role.</p> : holders.isPending ? <Skeleton rows={4} /> : holders.isError ? <ErrorState error={holders.error} retry={() => holders.refetch()} /> : holders.data.length === 0 ? <EmptyState title="Nobody holds this role right now" description="Grant it from a user’s page (Users → user → Grant role)." /> : (
        <ul className="divide-y divide-grey-100">
          {holders.data.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0"><Link href={`/users/${u.id}`} className="block truncate font-medium hover:underline">{u.fullName}</Link><p className="truncate text-xs text-grey-500">{u.email ?? u.phone ?? u.id}</p></div>
              <Badge>{u.status}</Badge>
            </li>
          ))}
          {holders.data.length >= 100 && <li className="py-2 text-xs text-grey-500">Showing the first 100. Open in Users to see everyone.</li>}
        </ul>
      )}
    </Dialog>
  );
}

/* ─── Editor (create / edit / clone) ───────────────────────────────────── */
interface EditorProps { mode: 'create' | 'edit' | 'clone'; role?: Role; allRoles: Role[]; catalogue: Permission[]; held: Set<string>; isSuperAdmin: boolean; holdsRole: boolean; onClose: () => void; onSaved: () => void }

function RoleEditor({ mode, role, allRoles, catalogue, held, isSuperAdmin, holdsRole, onClose, onSaved }: EditorProps) {
  const editing = mode === 'edit' && role ? role : undefined;
  const holds = (k: string) => isSuperAdmin || held.has(k);
  const initialPerms = useMemo(() => {
    if (!role) return new Set<string>();
    if (mode === 'clone') return new Set(role.permissions.filter(holds));
    return new Set(role.permissions);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- computed once when the editor opens
  }, []);
  const droppedOnClone = mode === 'clone' && role ? role.permissions.filter((p) => !holds(p)) : [];
  const [key, setKey] = useState(editing ? editing.key : mode === 'clone' && role ? normaliseKey(`${role.key}_COPY`) : '');
  const [name, setName] = useState(editing ? editing.name : mode === 'clone' && role ? `${role.name} (copy)` : '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<Set<string>>(initialPerms);
  const [search, setSearch] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [conflictAt, setConflictAt] = useState<string | null>(null);

  // Permissions in the existing role that the editor does not hold: they cannot be re-submitted (403), so the matrix locks.
  const unheldInRole = editing ? editing.permissions.filter((p) => !holds(p)) : [];
  const matrixLocked = unheldInRole.length > 0;
  const permsChanged = !editing || editing.permissions.length !== selected.size || editing.permissions.some((p) => !selected.has(p));
  const added = [...selected].filter((p) => !(editing?.permissions.includes(p) ?? false)).sort();
  const removed = (editing?.permissions ?? []).filter((p) => !selected.has(p)).sort();
  const dirty = editing ? name !== editing.name || (description || '') !== (editing.description ?? '') || permsChanged : !!(key || name || description || selected.size);
  const affected = editing?.activeAssignments ?? 0;
  const reasonRequired = !!editing && affected > 0 && permsChanged;

  // Validation
  const keyTaken = !editing && allRoles.some((r) => r.key === key);
  const keyError = !key ? undefined : !KEY_RE.test(key) ? 'Use UPPER_SNAKE_CASE, 3–64 characters, starting with a letter' : keyTaken ? 'A role with this key already exists' : undefined;
  const nameDupe = allRoles.some((r) => r.id !== editing?.id && r.name.trim().toLowerCase() === name.trim().toLowerCase());
  const nameError = name && name.trim().length < 3 ? 'At least 3 characters' : name.length > 120 ? 'At most 120 characters' : undefined;
  const selfLockout = !isSuperAdmin && holdsRole && (editing?.permissions.includes('roles.manage') ?? false) && !selected.has('roles.manage');
  const removesManageFromOthers = removed.includes('roles.manage') || removed.includes('roles.assign');
  const sensitiveSelected = [...selected].filter((p) => catalogue.find((c) => c.key === p)?.isSensitive).length;
  const canSave = !!name.trim() && !nameError && (editing || (!!key && !keyError)) && selected.size > 0 && (!reasonRequired || reason.trim().length >= 5) && dirty && !(matrixLocked && permsChanged);

  const save = useAction(
    () => {
      if (editing) {
        const body: Record<string, unknown> = { expectedUpdatedAt: editing.updatedAt };
        if (name !== editing.name) body.name = name.trim();
        if ((description || '') !== (editing.description ?? '')) body.description = description.trim() || null;
        if (permsChanged) body.permissions = [...selected];
        if (reason.trim()) body.reason = reason.trim();
        return api.patch(`/admin/roles/${editing.id}`, body);
      }
      return api.post('/admin/roles', { key, name: name.trim(), description: description.trim() || undefined, permissions: [...selected], reason: reason.trim() || undefined });
    },
    { success: editing ? 'Role updated' : 'Role created', onSuccess: onSaved, onError: (e) => { if (e instanceof ApiError && e.code === 'CONFLICT' && typeof (e.details as { updatedAt?: string } | undefined)?.updatedAt === 'string') setConflictAt((e.details as { updatedAt: string }).updatedAt); } },
  );

  const close = () => { if (dirty && !window.confirm('Discard your unsaved changes to this role?')) return; onClose(); };
  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const setGroup = (ps: Permission[], on: boolean) => setSelected((s) => { const n = new Set(s); for (const p of ps) if (holds(p.key)) { if (on) n.add(p.key); else n.delete(p.key); } return n; });

  const needle = search.trim().toLowerCase();
  const groups = groupBy(catalogue).map(([m, ps]) => [m, ps.filter((p) => (!needle || p.key.includes(needle) || p.description.toLowerCase().includes(needle) || moduleLabel(m).toLowerCase().includes(needle)) && (!onlySelected || selected.has(p.key)))] as const).filter(([, ps]) => ps.length);

  return (
    <Dialog open onClose={close} size="full" icon={mode === 'clone' ? Copy : editing ? Pencil : Shield} title={editing ? `Edit ${editing.name}` : mode === 'clone' ? `Clone ${role?.name}` : 'New Custom Role'} description={editing ? `${editing.key} · changes apply immediately to ${affected} current holder${affected === 1 ? '' : 's'}` : 'Custom roles can only include permissions you hold yourself.'}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-grey-600">
            <span className="tnum font-medium text-ink">{selected.size}</span> permission{selected.size === 1 ? '' : 's'}
            {sensitiveSelected > 0 && <span className="text-orange">· {sensitiveSelected} sensitive</span>}
            {editing && (added.length > 0 || removed.length > 0) && <span>· <span className="text-green">+{added.length}</span> <span className="text-red">−{removed.length}</span></span>}
          </div>
          <div className="flex gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>{editing ? 'Save Changes' : 'Create Role'}</Button></div>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <FormSection title="Role Details" icon={Shield} accent="blue">
            <div className="space-y-3">
              <Field label="Key" required hint={editing ? 'Keys are permanent; they are referenced by audit logs and integrations' : 'UPPER_SNAKE_CASE, e.g. REGION_COORDINATOR'} error={keyError}>
                <Input value={key} disabled={!!editing} onChange={(e) => setKey(normaliseKey(e.target.value))} className="font-mono" aria-invalid={!!keyError} maxLength={64} />
              </Field>
              <Field label="Display Name" required error={nameError} hint={nameDupe ? 'Another role already uses this name — allowed, but confusing for assigners' : undefined}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-invalid={!!nameError} />
              </Field>
              <Field label="Description" hint={`${description.length}/500 · what this role is for and who should hold it`}>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 500))} className="min-h-20" />
              </Field>
              <Field label={reasonRequired ? 'Reason for change' : 'Reason (optional)'} required={reasonRequired} hint={reasonRequired ? 'Required because current holders are affected; stored in the audit log' : 'Stored in the audit log'} error={reasonRequired && reason && reason.trim().length < 5 ? 'At least 5 characters' : undefined}>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} className="min-h-16" placeholder={editing ? 'e.g. Ops leads now triage bookings' : 'e.g. New regional coordination team'} />
              </Field>
            </div>
          </FormSection>

          {(affected > 0 || matrixLocked || droppedOnClone.length > 0 || selfLockout || removesManageFromOthers || conflictAt) && (
            <div className="space-y-2">
              {conflictAt && <Notice tone="red" icon={AlertTriangle}>Someone else changed this role at {dateTime(conflictAt)} while you were editing. Close and reopen it to see the latest version before saving.</Notice>}
              {affected > 0 && <Notice tone="orange" icon={Users}>{affected} user{affected === 1 ? ' holds' : 's hold'} this role. Permission changes take effect on their very next request — no sign-out needed.</Notice>}
              {matrixLocked && <Notice tone="orange" icon={Lock}>This role contains {unheldInRole.length} permission{unheldInRole.length === 1 ? '' : 's'} you don’t hold ({unheldInRole.join(', ')}). You can rename or describe it, but only someone holding those permissions can change its permission set.</Notice>}
              {droppedOnClone.length > 0 && <Notice tone="blue" icon={Lock}>{droppedOnClone.length} permission{droppedOnClone.length === 1 ? ' was' : 's were'} left out of the clone because you don’t hold {droppedOnClone.length === 1 ? 'it' : 'them'}: {droppedOnClone.join(', ')}.</Notice>}
              {selfLockout && <Notice tone="red" icon={AlertTriangle}>You hold this role. Removing roles.manage would lock you out of role management, and the server will refuse the save unless another of your roles grants it.</Notice>}
              {!selfLockout && removesManageFromOthers && <Notice tone="orange" icon={AlertTriangle}>Removing role-management permissions from current holders. Make sure at least one other active administrator can still manage access.</Notice>}
            </div>
          )}
        </div>

        <FormSection title="Permissions" icon={KeyRound} accent="purple" hint={matrixLocked ? 'Read-only — see the notice on the left' : 'Tick what this role may do. Sensitive permissions expose personal, clinical or financial data and are logged.'}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
              <Input aria-label="Search Permissions" placeholder="Filter permissions…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear" className="absolute top-1/2 right-2 -translate-y-1/2 text-grey-400 hover:text-ink"><X size={14} /></button>}
            </div>
            <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" className="accent-black" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> Selected Only</label>
            {!matrixLocked && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear All</Button>}
          </div>
          {groups.length === 0 ? <EmptyState title="No Permissions Match" description="Try another word, or turn off ‘Selected only’." /> : (
            <div className="space-y-4">
              {groups.map(([m, ps]) => {
                const grantable = ps.filter((p) => holds(p.key));
                const picked = ps.filter((p) => selected.has(p.key)).length;
                const allOn = grantable.length > 0 && grantable.every((p) => selected.has(p.key));
                return (
                  <fieldset key={m} className="rounded-xl border border-grey-200">
                    <legend className="sr-only">{moduleLabel(m)}</legend>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grey-100 bg-grey-50 px-3 py-2">
                      <p className="text-xs font-semibold text-grey-700">{moduleLabel(m)} <span className="tnum font-normal normal-case text-grey-500">· {picked}/{ps.length}</span></p>
                      {!matrixLocked && grantable.length > 0 && <button type="button" onClick={() => setGroup(ps, !allOn)} className="text-xs font-medium underline-offset-2 hover:underline">{allOn ? 'Clear' : grantable.length === ps.length ? 'Select All' : `Select all ${grantable.length} you hold`}</button>}
                    </div>
                    <ul className="divide-y divide-grey-100">
                      {ps.map((p) => {
                        const can = holds(p.key) && !matrixLocked;
                        const on = selected.has(p.key);
                        const wasOn = editing?.permissions.includes(p.key) ?? false;
                        return (
                          <li key={p.key}>
                            <label className={cx('flex items-start gap-3 px-3 py-2', can ? 'cursor-pointer hover:bg-grey-50' : 'cursor-not-allowed opacity-70')} title={!holds(p.key) ? 'You do not hold this permission, so you cannot grant it' : undefined}>
                              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-black" checked={on} disabled={!can} onChange={() => toggle(p.key)} aria-describedby={`${p.key}-desc`} />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-xs">{p.key}</span>{p.isSensitive && <Badge accent="orange">sensitive</Badge>}{!holds(p.key) && <span className="inline-flex items-center gap-1 text-[11px] text-grey-500"><Lock size={10} aria-hidden /> not held by you</span>}{editing && on && !wasOn && <Badge accent="green">added</Badge>}{editing && !on && wasOn && <Badge accent="red">removed</Badge>}</span>
                                <span id={`${p.key}-desc`} className="block text-xs text-grey-600">{p.description}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
          )}
          {editing && (added.length > 0 || removed.length > 0) && (
            <div className="mt-4 rounded-xl border border-grey-200 bg-grey-50 p-3 text-xs">
              <p className="mb-1.5 font-semibold">Review Your Changes</p>
              <div className="flex flex-wrap gap-1">{added.map((p) => <PermChip key={p} k={p} added />)}{removed.map((p) => <PermChip key={p} k={p} removed />)}</div>
            </div>
          )}
        </FormSection>
      </div>
    </Dialog>
  );
}

function Notice({ tone, icon: Icon, children }: { tone: 'red' | 'orange' | 'blue'; icon: typeof Shield; children: React.ReactNode }) {
  const cls = tone === 'red' ? 'bg-red-soft text-red' : tone === 'orange' ? 'bg-orange-soft text-orange' : 'bg-blue-soft text-blue';
  return <div role="status" className={cx('flex items-start gap-2 rounded-xl px-3 py-2 text-xs', cls)}><Icon size={14} className="mt-0.5 shrink-0" aria-hidden /><p className="text-grey-800">{children}</p></div>;
}
