'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, LayoutTemplate, Megaphone, LifeBuoy, ShieldCheck, Undo2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { title } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Dialog, ErrorState, Field, FormSection, Input, Select, Skeleton, Tabs, Textarea, cx } from '@/components/ui/primitives';

/**
 * Settings → Provider Portal. Everything a super-admin can change about what
 * provider staff see, without a release:
 *   - announcement banner and support contacts (all providers)
 *   - per provider type: organisation words, section names, hidden pages,
 *     page titles and subtitles
 *   - which capabilities each staff role carries
 * Saved as two platform settings (portal.ui, portal.member_capabilities), so
 * every change is versioned, audited and reversible like any other setting.
 */
interface Page { href: string; label: string; group: string; types: string[]; capabilities: string[] }
interface TypeConfig { words?: Record<string, string>; nav?: Record<string, { label?: string; hidden?: boolean }>; pages?: Record<string, { title?: string; description?: string }> }
interface Config {
  announcement: { text: string; tone: string; until?: string; link?: string } | null;
  support: { email?: string; phone?: string; helpUrl?: string; hours?: string };
  types: Record<string, TypeConfig>;
  emergencyNumber: string;
  catalogue: { types: string[]; pages: Page[]; words: Record<string, Record<string, string>> };
  roles: Record<string, string[]>;
}
interface Setting { key: string; value: unknown; version: number }

const CAPABILITY_HELP: Record<string, string> = {
  manage_profile: 'Edit profile, locations, services, documents',
  manage_staff: 'Invite and remove staff',
  manage_affiliations: 'Invite doctors / join facilities',
  manage_schedules: 'Set doctor timings and slots',
  manage_bookings: 'Confirm, check in, complete and cancel',
  manage_inventory: 'Add and adjust stock batches',
  view_finance: 'See earnings, ledger and payouts',
  review_prescriptions: 'Approve or reject prescriptions',
  publish_reports: 'Publish lab and imaging reports',
  manage_dispatch: 'Accept and run ambulance trips',
};
const ROLE_HELP: Record<string, string> = { OWNER: 'Always Everything (Fixed)', ADMIN: 'Day-to-Day Manager', STAFF: 'Front Desk / Reception', PHARMACIST: 'Registered Pharmacist', LAB_TECHNICIAN: 'Lab Staff', DISPATCHER: 'Ambulance Control Room' };

export function PortalConfig() {
  const config = useGet<Config>('/portal/config');
  const settings = useGet<Setting[]>('/admin/settings');
  if (config.isPending || settings.isPending) return <Skeleton rows={8} />;
  if (config.isError) return <ErrorState error={config.error} retry={() => config.refetch()} />;
  if (settings.isError) return <ErrorState error={settings.error} retry={() => settings.refetch()} />;
  const ui = settings.data.find((s) => s.key === 'portal.ui');
  const roles = settings.data.find((s) => s.key === 'portal.member_capabilities');
  if (!ui || !roles) return <ErrorState error={new Error('The portal settings rows are missing. Run the reference seed (npm run db:seed) on the API and reload.')} />;
  // Remount the editor whenever the saved version changes, so local state always starts from the server value.
  return <Editor key={`${ui.version}-${roles.version}`} config={config.data} ui={ui} roleSetting={roles} />;
}

function Editor({ config, ui, roleSetting }: { config: Config; ui: Setting; roleSetting: Setting }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can('settings.manage');
  const [tab, setTab] = useState<'banner' | 'structure' | 'roles'>('banner');
  const [draft, setDraft] = useState<{ announcement: Config['announcement']; support: Config['support']; types: Record<string, TypeConfig> }>({ announcement: config.announcement, support: config.support, types: config.types });
  const [matrix, setMatrix] = useState<Record<string, string[]>>(() => Object.fromEntries(Object.entries(config.roles).filter(([r]) => r !== 'OWNER')));
  const [saving, setSaving] = useState<'ui' | 'roles' | null>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['get', '/portal/config'] }), qc.invalidateQueries({ queryKey: ['get', '/admin/settings'] })]);

  const cleanUi = useMemo(() => {
    // Drop empty strings and empty objects so the stored setting stays small and "as shipped" stays {}.
    const types: Record<string, TypeConfig> = {};
    for (const [t, c] of Object.entries(draft.types)) {
      const words = Object.fromEntries(Object.entries(c.words ?? {}).filter(([, v]) => v?.trim()));
      const nav = Object.fromEntries(Object.entries(c.nav ?? {}).map(([h, v]) => [h, { ...(v.label?.trim() ? { label: v.label.trim() } : {}), ...(v.hidden ? { hidden: true } : {}) }]).filter(([, v]) => Object.keys(v as object).length));
      const pages = Object.fromEntries(Object.entries(c.pages ?? {}).map(([h, v]) => [h, { ...(v.title?.trim() ? { title: v.title.trim() } : {}), ...(v.description?.trim() ? { description: v.description.trim() } : {}) }]).filter(([, v]) => Object.keys(v as object).length));
      const out: TypeConfig = { ...(Object.keys(words).length ? { words } : {}), ...(Object.keys(nav).length ? { nav } : {}), ...(Object.keys(pages).length ? { pages } : {}) };
      if (Object.keys(out).length) types[t] = out;
    }
    const support = Object.fromEntries(Object.entries(draft.support).filter(([, v]) => v?.trim()));
    const announcement = draft.announcement?.text?.trim() ? { text: draft.announcement.text.trim(), tone: draft.announcement.tone || 'info', ...(draft.announcement.until ? { until: draft.announcement.until } : {}), ...(draft.announcement.link?.trim() ? { link: draft.announcement.link.trim() } : {}) } : null;
    return { ...(announcement ? { announcement } : {}), ...(Object.keys(support).length ? { support } : {}), ...(Object.keys(types).length ? { types } : {}) };
  }, [draft]);
  const uiChanged = JSON.stringify(cleanUi) !== JSON.stringify(ui.value);
  const rolesChanged = JSON.stringify(matrix) !== JSON.stringify(Object.fromEntries(Object.entries(config.roles).filter(([r]) => r !== 'OWNER')));

  const save = useAction(async (which: 'ui' | 'roles') => {
    if (which === 'ui') await api.put(`/admin/settings/portal.ui`, { value: cleanUi, expectedVersion: ui.version, reason });
    else await api.put(`/admin/settings/portal.member_capabilities`, { value: matrix, expectedVersion: roleSetting.version, reason });
  }, { success: 'Saved — provider staff see it on their next page load', onSuccess: () => { setSaving(null); setReason(''); setProblem(null); void refresh(); }, onError: (e) => setProblem(e instanceof ApiError ? e.message : 'Could not save') });

  const setType = (t: string, patch: (c: TypeConfig) => TypeConfig) => setDraft((d) => ({ ...d, types: { ...d.types, [t]: patch(d.types[t] ?? {}) } }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={[{ key: 'banner', label: 'Banner & Support' }, { key: 'structure', label: 'Structure & Copy' }, { key: 'roles', label: 'Staff Roles' }]} active={tab} onChange={(k) => setTab(k as typeof tab)} />
        {editable && tab !== 'roles' && <Button onClick={() => setSaving('ui')} disabled={!uiChanged}>Save Portal Changes</Button>}
        {editable && tab === 'roles' && <Button onClick={() => setSaving('roles')} disabled={!rolesChanged}>Save Role Matrix</Button>}
      </div>
      {!editable && <p className="text-xs text-grey-500">You can view this configuration; changing it needs the settings.manage permission.</p>}

      {tab === 'banner' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <FormSection title="Announcement Banner" hint="Shown at the top of every portal page and on the sign-in screen until the date you set." icon={Megaphone} accent="orange">
            <Field label="Message" hint="Leave empty for no banner. Max 300 characters."><Textarea value={draft.announcement?.text ?? ''} maxLength={300} onChange={(e) => setDraft({ ...draft, announcement: { text: e.target.value, tone: draft.announcement?.tone ?? 'info', until: draft.announcement?.until, link: draft.announcement?.link } })} disabled={!editable} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tone"><Select value={draft.announcement?.tone ?? 'info'} onChange={(e) => setDraft({ ...draft, announcement: { ...(draft.announcement ?? { text: '' }), tone: e.target.value } })} disabled={!editable}><option value="info">Information</option><option value="warning">Warning</option><option value="success">Good News</option></Select></Field>
              <Field label="Show Until" hint="Blank = until removed"><Input type="date" value={draft.announcement?.until ?? ''} onChange={(e) => setDraft({ ...draft, announcement: { ...(draft.announcement ?? { text: '', tone: 'info' }), until: e.target.value || undefined } })} disabled={!editable} /></Field>
            </div>
            <Field label="Link" hint="Optional 'Read more' URL"><Input type="url" value={draft.announcement?.link ?? ''} onChange={(e) => setDraft({ ...draft, announcement: { ...(draft.announcement ?? { text: '', tone: 'info' }), link: e.target.value || undefined } })} disabled={!editable} /></Field>
            {draft.announcement?.text?.trim() && <div className={cx('rounded-lg border p-3 text-sm', draft.announcement.tone === 'warning' ? 'border-orange/30 bg-orange-soft' : draft.announcement.tone === 'success' ? 'border-green/30 bg-green-soft' : 'border-blue/30 bg-blue-soft')}><p className="text-[11px] font-semibold text-grey-500">Preview</p><p className="mt-1">{draft.announcement.text}</p></div>}
          </FormSection>
          <FormSection title="Support Contacts" hint="Shown in the portal sidebar, on the 'no organisation' screen and in error states." icon={LifeBuoy} accent="blue">
            <Field label="Support Email"><Input type="email" value={draft.support.email ?? ''} onChange={(e) => setDraft({ ...draft, support: { ...draft.support, email: e.target.value } })} disabled={!editable} /></Field>
            <Field label="Support Phone"><Input value={draft.support.phone ?? ''} placeholder="+91 98000 00000" onChange={(e) => setDraft({ ...draft, support: { ...draft.support, phone: e.target.value } })} disabled={!editable} /></Field>
            <Field label="Help Centre URL"><Input type="url" value={draft.support.helpUrl ?? ''} onChange={(e) => setDraft({ ...draft, support: { ...draft.support, helpUrl: e.target.value } })} disabled={!editable} /></Field>
            <Field label="Support Hours" hint="e.g. Mon–Sat 9:00–18:00 IST"><Input value={draft.support.hours ?? ''} maxLength={80} onChange={(e) => setDraft({ ...draft, support: { ...draft.support, hours: e.target.value } })} disabled={!editable} /></Field>
            <p className="text-xs text-grey-500">The emergency number shown to patients ({config.emergencyNumber}) is set under Settings → Emergency.</p>
          </FormSection>
        </div>
      )}

      {tab === 'structure' && <StructureEditor config={config} draft={draft.types} setType={setType} editable={editable} />}

      {tab === 'roles' && (
        <Card title="Staff Role Permissions" description="Tick what each provider staff role may do. Owners always hold everything. Changes apply to every provider within 30 seconds; the API enforces them, the portal hides what a role cannot do.">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-grey-600"><tr><th className="py-2 pr-3">Capability</th>{['OWNER', ...Object.keys(matrix)].map((r) => <th key={r} className="px-2 py-2 text-center"><span className="block">{title(r)}</span><span className="block text-[10px] font-normal normal-case text-grey-500">{ROLE_HELP[r]}</span></th>)}</tr></thead>
              <tbody>
                {(config.roles.OWNER ?? []).map((cap) => (
                  <tr key={cap} className="border-t border-grey-100">
                    <td className="py-2 pr-3"><p className="font-medium">{title(cap)}</p><p className="text-xs text-grey-500">{CAPABILITY_HELP[cap]}</p></td>
                    <td className="px-2 py-2 text-center"><ShieldCheck size={16} className="inline text-green" aria-label="Always" /></td>
                    {Object.keys(matrix).map((r) => (
                      <td key={r} className="px-2 py-2 text-center">
                        <input type="checkbox" aria-label={`${title(r)}: ${title(cap)}`} className="h-4 w-4 accent-ink" checked={matrix[r]!.includes(cap)} disabled={!editable} onChange={(e) => setMatrix({ ...matrix, [r]: e.target.checked ? [...matrix[r]!, cap] : matrix[r]!.filter((c) => c !== cap) })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && <Button variant="ghost" size="sm" className="mt-3" onClick={() => setMatrix(Object.fromEntries(Object.entries(config.roles).filter(([r]) => r !== 'OWNER')))} disabled={!rolesChanged}><Undo2 size={14} /> Discard Changes</Button>}
        </Card>
      )}

      {saving && (
        <Dialog open onClose={() => setSaving(null)} title={saving === 'ui' ? 'Save Portal Changes' : 'Save Role Matrix'} description="Recorded in the audit log with your name and reason." icon={saving === 'ui' ? LayoutTemplate : ShieldCheck} footer={<><Button variant="ghost" onClick={() => setSaving(null)} disabled={save.isPending}>Cancel</Button><Button onClick={() => save.mutate(saving)} loading={save.isPending} disabled={reason.trim().length < 5}>Save</Button></>}>
          {saving === 'roles' && <p className="mb-3 rounded-lg border border-orange/30 bg-orange-soft p-3 text-xs text-grey-700">High impact: this changes what thousands of provider staff can do, immediately. Removing a capability signs nobody out, but their next action in that area will be refused.</p>}
          <Field label="Reason" required hint="At least 5 characters"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          {problem && <p role="alert" className="mt-2 text-sm text-red">{problem}</p>}
        </Dialog>
      )}
    </div>
  );
}

function StructureEditor({ config, draft, setType, editable }: { config: Config; draft: Record<string, TypeConfig>; setType: (t: string, patch: (c: TypeConfig) => TypeConfig) => void; editable: boolean }) {
  const [type, setTypeKey] = useState(config.catalogue.types[0]!);
  const c = draft[type] ?? {};
  const pages = config.catalogue.pages.filter((p) => p.types.length === 0 || p.types.includes(type));
  const groups = [...new Set(pages.map((p) => p.group))];
  const defaults = config.catalogue.words[type] ?? {};
  const overrides = (draft[type] && Object.keys(draft[type]).length) ? 'customised' : 'as shipped';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Provider Type" value={type} onChange={(e) => setTypeKey(e.target.value)} className="w-56">{config.catalogue.types.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select>
        <Badge accent={overrides === 'customised' ? 'blue' : 'ink'}>{overrides}</Badge>
        {editable && overrides === 'customised' && <Button size="sm" variant="ghost" onClick={() => setType(type, () => ({}))}><Undo2 size={14} /> Reset This Type</Button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <FormSection title="Words" hint="How the portal refers to this kind of organisation." icon={LayoutTemplate}>
          {(['noun', 'locationNoun', 'locationsTitle'] as const).map((k) => (
            <Field key={k} label={k === 'noun' ? 'Organisation Word' : k === 'locationNoun' ? 'Location Word' : 'Locations Page Title'} hint={`Default: ${defaults[k] ?? ''}`}>
              <Input value={c.words?.[k] ?? ''} placeholder={defaults[k]} maxLength={60} onChange={(e) => setType(type, (x) => ({ ...x, words: { ...x.words, [k]: e.target.value } }))} disabled={!editable} />
            </Field>
          ))}
        </FormSection>
        <Card title="Sections & Pages" description="Rename a section, hide pages this provider type should not see, and override each page's title and subtitle. Blank means the app's own wording.">
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-2 text-[11px] font-semibold text-grey-500">{g}</p>
                <ul className="divide-y divide-grey-100 rounded-lg border border-grey-200">
                  {pages.filter((p) => p.group === g).map((p) => {
                    const nav = c.nav?.[p.href] ?? {};
                    const page = c.pages?.[p.href] ?? {};
                    return (
                      <li key={p.href} className={cx('grid gap-2 p-3 md:grid-cols-[200px_minmax(0,1fr)]', nav.hidden && 'bg-grey-50 opacity-70')}>
                        <div>
                          <p className="text-sm font-medium">{p.label}</p>
                          <p className="font-mono text-[11px] text-grey-500">{p.href}</p>
                          {p.capabilities.length > 0 && <p className="mt-1 text-[11px] text-grey-500">Needs {p.capabilities.map(title).join(' or ')}</p>}
                          {p.href !== '/' && editable && (
                            <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-grey-600 underline-offset-2 hover:underline" onClick={() => setType(type, (x) => ({ ...x, nav: { ...x.nav, [p.href]: { ...nav, hidden: !nav.hidden } } }))}>
                              {nav.hidden ? <><EyeOff size={12} aria-hidden /> Hidden — show</> : <><Eye size={12} aria-hidden /> Visible — hide</>}
                            </button>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Field label="Menu Label"><Input value={nav.label ?? ''} placeholder={p.label} maxLength={40} onChange={(e) => setType(type, (x) => ({ ...x, nav: { ...x.nav, [p.href]: { ...nav, label: e.target.value } } }))} disabled={!editable} /></Field>
                          <Field label="Page Title"><Input value={page.title ?? ''} placeholder="App default" maxLength={80} onChange={(e) => setType(type, (x) => ({ ...x, pages: { ...x.pages, [p.href]: { ...page, title: e.target.value } } }))} disabled={!editable} /></Field>
                          <Field label="Subtitle"><Input value={page.description ?? ''} placeholder="App default" maxLength={300} onChange={(e) => setType(type, (x) => ({ ...x, pages: { ...x.pages, [p.href]: { ...page, description: e.target.value } } }))} disabled={!editable} /></Field>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          {!editable && <p className="mt-3 text-xs text-grey-500"><Checkbox label="Read Only" checked disabled /></p>}
        </Card>
      </div>
    </div>
  );
}
