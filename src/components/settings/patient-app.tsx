'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, LayoutTemplate, Megaphone, Palette, Plus, Smartphone, Sparkles, Trash2, Upload, Search } from 'lucide-react';
import { api, API_BASE, ApiError, session } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { Badge, Button, Checkbox, Dialog, ErrorState, Field, FormSection, Input, Select, Skeleton, Textarea, cx } from '@/components/ui/primitives';

/**
 * Settings → Patient App. What patients see on the home screen and the public
 * landing page: hero copy and image, highlight tiles, category shortcuts, an
 * announcement, support contacts and the two theme colours. Blank fields fall
 * back to the app's own wording, shown as placeholders.
 */
type Icon = 'stethoscope' | 'flask' | 'pill' | 'ambulance' | 'hospital' | 'heart' | 'shield' | 'clock' | 'map' | 'star' | 'phone' | 'file' | 'home' | 'baby' | 'eye' | 'tooth' | 'bone' | 'brain';
const ICONS: Icon[] = ['stethoscope', 'flask', 'pill', 'ambulance', 'hospital', 'heart', 'shield', 'clock', 'map', 'star', 'phone', 'file', 'home', 'baby', 'eye', 'tooth', 'bone', 'brain'];
interface Hero { badge?: string; title?: string; subtitle?: string; ctaLabel?: string; ctaHref?: string; secondaryLabel?: string; secondaryHref?: string }
interface Highlight { icon: Icon; title: string; text: string }
interface Category { key: string; label: string; icon: Icon; href: string; colour?: string; enabled: boolean }
interface Landing { headline?: string; subheadline?: string; points?: string[]; stats?: { label: string; value: string }[]; footerNote?: string }
interface Value { hero?: Hero; highlights?: Highlight[]; categories?: Category[]; landing?: Landing; announcement?: { text: string; tone: string; until?: string; link?: string } | null; support?: { phone?: string; whatsapp?: string; email?: string; hours?: string }; theme?: { primary?: string; accent?: string }; popularSearches?: string[] }
interface View { value: Value; version: number; defaults: Required<Pick<Value, 'hero' | 'highlights' | 'categories' | 'landing' | 'theme'>> & { popularSearches?: string[] }; effective: Value & { heroImageUrl: string | null; emergencyNumber: string } }

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function PatientAppSettings() {
  const q = useGet<View>('/admin/patient-ui');
  if (q.isPending) return <Skeleton rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return <Editor key={q.data.version + (q.data.effective.heroImageUrl ?? '')} view={q.data} />;
}

function Editor({ view }: { view: View }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can('settings.manage');
  const d = view.defaults;
  const [v, setV] = useState<Value>(() => structuredClone(view.value));
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['get', '/admin/patient-ui'] }), qc.invalidateQueries({ queryKey: ['get', '/public/patient-ui'] })]);

  // Strip blanks so the stored override stays small and "as shipped" stays {}.
  const clean = useMemo((): Value => {
    const str = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    const obj = <T extends object>(o: T): T | undefined => (Object.values(o).some((x) => x !== undefined && !(Array.isArray(x) && !x.length)) ? o : undefined);
    const hero = v.hero ? obj({ badge: str(v.hero.badge), title: str(v.hero.title), subtitle: str(v.hero.subtitle), ctaLabel: str(v.hero.ctaLabel), ctaHref: str(v.hero.ctaHref), secondaryLabel: str(v.hero.secondaryLabel), secondaryHref: str(v.hero.secondaryHref) }) : undefined;
    const highlights = v.highlights?.filter((h) => h.title.trim() && h.text.trim()).map((h) => ({ icon: h.icon, title: h.title.trim(), text: h.text.trim() }));
    const categories = v.categories?.filter((c) => c.key.trim() && c.label.trim() && c.href.trim()).map((c) => ({ key: c.key.trim(), label: c.label.trim(), icon: c.icon, href: c.href.trim(), ...(c.colour ? { colour: c.colour } : {}), enabled: c.enabled !== false }));
    const landing = v.landing ? obj({ headline: str(v.landing.headline), subheadline: str(v.landing.subheadline), points: v.landing.points?.map((p) => p.trim()).filter(Boolean), stats: v.landing.stats?.filter((s) => s.label.trim() && s.value.trim()).map((s) => ({ label: s.label.trim(), value: s.value.trim() })), footerNote: str(v.landing.footerNote) }) : undefined;
    const announcement = v.announcement?.text?.trim() ? { text: v.announcement.text.trim(), tone: v.announcement.tone || 'info', ...(v.announcement.until ? { until: v.announcement.until } : {}), ...(str(v.announcement.link) ? { link: v.announcement.link!.trim() } : {}) } : v.announcement === null ? null : undefined;
    const support = v.support ? obj({ phone: str(v.support.phone), whatsapp: str(v.support.whatsapp), email: str(v.support.email), hours: str(v.support.hours) }) : undefined;
    const theme = v.theme ? obj({ primary: str(v.theme.primary), accent: str(v.theme.accent) }) : undefined;
    const popularSearches = v.popularSearches?.map((x) => x.trim()).filter(Boolean).slice(0, 12);
    const out: Value = {};
    if (hero) out.hero = hero;
    if (highlights?.length) out.highlights = highlights;
    if (categories?.length) out.categories = categories;
    if (landing) out.landing = landing;
    if (announcement !== undefined) out.announcement = announcement;
    if (support) out.support = support;
    if (theme) out.theme = theme;
    if (popularSearches?.length) out.popularSearches = popularSearches;
    return out;
  }, [v]);
  const dirty = JSON.stringify(clean) !== JSON.stringify(view.value);

  const save = useAction(() => api.put('/admin/patient-ui', { value: clean, expectedVersion: view.version, reason }), { success: 'Patient app content saved', onSuccess: () => { setSaving(false); setReason(''); void refresh(); }, onError: (e) => setProblem(e instanceof ApiError ? e.message : 'Could not save') });
  const upload = useAction(async () => {
    if (!file) throw new Error('Choose an image');
    const res = await fetch(`${API_BASE}/api/v1/admin/patient-ui/hero`, { method: 'POST', headers: { 'content-type': file.type, authorization: `Bearer ${session.accessToken ?? ''}` }, body: file });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? 'Upload failed');
  }, { success: 'Hero image updated', onSuccess: () => { setFile(null); void refresh(); } });
  const removeImage = useAction(() => api.delete('/admin/patient-ui/hero'), { success: 'Hero image removed', onSuccess: () => void refresh() });

  const hero = v.hero ?? {};
  const setHero = (patch: Partial<Hero>) => setV({ ...v, hero: { ...hero, ...patch } });
  const landing = v.landing ?? {};
  const setLanding = (patch: Partial<Landing>) => setV({ ...v, landing: { ...landing, ...patch } });
  const highlights = v.highlights ?? [];
  const categories = v.categories ?? [];
  const theme = { primary: v.theme?.primary ?? d.theme.primary, accent: v.theme?.accent ?? d.theme.accent };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-grey-600">Blank fields use the app&apos;s own wording (shown as placeholders). Everything saves together; changes are live within a minute.</p>
        {editable && <div className="flex gap-2">{dirty && <Button variant="ghost" onClick={() => setV(structuredClone(view.value))}>Discard</Button>}<Button onClick={() => setSaving(true)} disabled={!dirty}>Save Patient App</Button></div>}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FormSection title="Home Hero" icon={Sparkles} accent="blue" hint="The first thing a patient sees. Keep the title under ten words; the subtitle is one sentence.">
          <Field label="Small Badge" hint={`Default: ${d.hero.badge}`}><Input value={hero.badge ?? ''} placeholder={d.hero.badge} maxLength={40} disabled={!editable} onChange={(e) => setHero({ badge: e.target.value })} /></Field>
          <Field label="Title" hint={`Default: ${d.hero.title}`}><Input value={hero.title ?? ''} placeholder={d.hero.title} maxLength={90} disabled={!editable} onChange={(e) => setHero({ title: e.target.value })} /></Field>
          <Field label="Subtitle"><Textarea value={hero.subtitle ?? ''} placeholder={d.hero.subtitle} maxLength={200} disabled={!editable} onChange={(e) => setHero({ subtitle: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Primary Button"><Input value={hero.ctaLabel ?? ''} placeholder={d.hero.ctaLabel} maxLength={30} disabled={!editable} onChange={(e) => setHero({ ctaLabel: e.target.value })} /></Field>
            <Field label="Primary Button Link" hint="A path inside the app, e.g. /search?type=doctors"><Input value={hero.ctaHref ?? ''} placeholder={d.hero.ctaHref} disabled={!editable} onChange={(e) => setHero({ ctaHref: e.target.value })} className="font-mono" /></Field>
            <Field label="Secondary Button"><Input value={hero.secondaryLabel ?? ''} placeholder={d.hero.secondaryLabel} maxLength={30} disabled={!editable} onChange={(e) => setHero({ secondaryLabel: e.target.value })} /></Field>
            <Field label="Secondary Button Link"><Input value={hero.secondaryHref ?? ''} placeholder={d.hero.secondaryHref} disabled={!editable} onChange={(e) => setHero({ secondaryHref: e.target.value })} className="font-mono" /></Field>
          </div>
        </FormSection>

        <FormSection title="Hero Image" icon={ImageIcon} accent="purple" hint="A friendly doctor or family photo with a transparent or plain background works best. PNG, JPEG or WebP up to 3 MB; shown about 4:3 on phones.">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex h-36 w-48 items-center justify-center overflow-hidden rounded-lg border border-grey-200 bg-grey-50">
              {preview ? <img src={preview} alt="Preview" className="h-full w-full object-cover" /> : view.effective.heroImageUrl ? <img src={`${API_BASE}${view.effective.heroImageUrl}`} alt="Current hero" className="h-full w-full object-cover" /> : <span className="text-xs text-grey-500">No image — the app shows its illustration</span>}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Input type="file" accept={IMAGE_TYPES.join(',')} disabled={!editable} onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f && IMAGE_TYPES.includes(f.type) && f.size <= 3 * 1024 * 1024 ? f : null); }} className="h-auto py-1.5" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => upload.mutate()} loading={upload.isPending} disabled={!file || !editable}><Upload size={14} /> Upload</Button>
                {view.effective.heroImageUrl && <Button size="sm" variant="ghost" className="text-red" onClick={() => removeImage.mutate()} loading={removeImage.isPending} disabled={!editable}><Trash2 size={14} /> Remove</Button>}
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection title="Highlight Tiles" icon={LayoutTemplate} accent="green" hint="Up to six short promises under the hero. Leave empty to show the defaults." className="xl:col-span-2">
          <ListEditor<Highlight> items={highlights} defaults={d.highlights} max={6} editable={editable} blank={{ icon: 'shield', title: '', text: '' }} onChange={(items) => setV({ ...v, highlights: items })}
            render={(h, set) => <div className="grid gap-2 sm:grid-cols-[140px_1fr_2fr]"><Select value={h.icon} disabled={!editable} onChange={(e) => set({ ...h, icon: e.target.value as Icon })}>{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</Select><Input value={h.title} placeholder="Title" maxLength={40} disabled={!editable} onChange={(e) => set({ ...h, title: e.target.value })} /><Input value={h.text} placeholder="One short sentence" maxLength={120} disabled={!editable} onChange={(e) => set({ ...h, text: e.target.value })} /></div>} />
        </FormSection>

        <FormSection title="Category Shortcuts" icon={Smartphone} accent="orange" hint="The coloured tiles on the home screen. Links are paths inside the app. Up to twelve." className="xl:col-span-2">
          <ListEditor<Category> items={categories} defaults={d.categories} max={12} editable={editable} blank={{ key: '', label: '', icon: 'heart', href: '/', colour: '#1E6CFF', enabled: true }} onChange={(items) => setV({ ...v, categories: items })}
            render={(c, set) => <div className="grid gap-2 sm:grid-cols-[110px_1fr_130px_1fr_90px_auto]"><Input value={c.key} placeholder="key" maxLength={40} disabled={!editable} onChange={(e) => set({ ...c, key: e.target.value })} className="font-mono" /><Input value={c.label} placeholder="Label" maxLength={30} disabled={!editable} onChange={(e) => set({ ...c, label: e.target.value })} /><Select value={c.icon} disabled={!editable} onChange={(e) => set({ ...c, icon: e.target.value as Icon })}>{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</Select><Input value={c.href} placeholder="/search?type=doctors" disabled={!editable} onChange={(e) => set({ ...c, href: e.target.value })} className="font-mono" /><Input type="color" value={c.colour ?? '#1E6CFF'} disabled={!editable} onChange={(e) => set({ ...c, colour: e.target.value })} className="h-10 p-1" /><Checkbox label="Show" checked={c.enabled !== false} disabled={!editable} onChange={(e) => set({ ...c, enabled: e.target.checked })} /></div>} />
        </FormSection>

        <FormSection title="Landing Page" icon={LayoutTemplate} accent="teal" hint="Shown to people who are not signed in: what Carevanta is and why to trust it.">
          <Field label="Headline"><Input value={landing.headline ?? ''} placeholder={d.landing.headline} maxLength={90} disabled={!editable} onChange={(e) => setLanding({ headline: e.target.value })} /></Field>
          <Field label="Sub-Headline"><Textarea value={landing.subheadline ?? ''} placeholder={d.landing.subheadline} maxLength={240} disabled={!editable} onChange={(e) => setLanding({ subheadline: e.target.value })} /></Field>
          <Field label="Bullet Points" hint="One per line, up to eight"><Textarea value={(landing.points ?? []).join('\n')} placeholder={(d.landing.points ?? []).join('\n')} disabled={!editable} onChange={(e) => setLanding({ points: e.target.value.split('\n').slice(0, 8) })} className="min-h-28" /></Field>
          <Field label="Stats" hint="Up to four, as value | label per line, e.g. 30+ | Verified doctors"><Textarea value={(landing.stats ?? []).map((s) => `${s.value} | ${s.label}`).join('\n')} placeholder={(d.landing.stats ?? []).map((s) => `${s.value} | ${s.label}`).join('\n')} disabled={!editable} onChange={(e) => setLanding({ stats: e.target.value.split('\n').slice(0, 4).map((l) => { const [value = '', label = ''] = l.split('|'); return { value: value.trim(), label: label.trim() }; }) })} /></Field>
          <Field label="Footer Note" hint="Legal line shown small at the bottom"><Textarea value={landing.footerNote ?? ''} placeholder={d.landing.footerNote} maxLength={240} disabled={!editable} onChange={(e) => setLanding({ footerNote: e.target.value })} /></Field>
        </FormSection>

        <div className="space-y-4">
          <FormSection title="Announcement & Support" icon={Megaphone} accent="red" hint="A banner at the top of the home screen, and the contacts under Help.">
            <Field label="Banner Text" hint="Blank = no banner"><Textarea value={v.announcement?.text ?? ''} maxLength={240} disabled={!editable} onChange={(e) => setV({ ...v, announcement: e.target.value.trim() ? { text: e.target.value, tone: v.announcement?.tone ?? 'info', until: v.announcement?.until, link: v.announcement?.link } : null })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tone"><Select value={v.announcement?.tone ?? 'info'} disabled={!editable || !v.announcement} onChange={(e) => setV({ ...v, announcement: { ...(v.announcement ?? { text: '' }), tone: e.target.value } })}><option value="info">Information</option><option value="warning">Warning</option><option value="success">Good News</option></Select></Field>
              <Field label="Show Until"><Input type="date" value={v.announcement?.until ?? ''} disabled={!editable || !v.announcement} onChange={(e) => setV({ ...v, announcement: { ...(v.announcement ?? { text: '', tone: 'info' }), until: e.target.value || undefined } })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Support Phone"><Input value={v.support?.phone ?? ''} placeholder="+91 98000 00000" disabled={!editable} onChange={(e) => setV({ ...v, support: { ...v.support, phone: e.target.value } })} /></Field>
              <Field label="WhatsApp Number" hint="Digits only, e.g. 919800000000"><Input value={v.support?.whatsapp ?? ''} placeholder="919800000000" disabled={!editable} onChange={(e) => setV({ ...v, support: { ...v.support, whatsapp: e.target.value } })} /></Field>
              <Field label="Support Email"><Input type="email" value={v.support?.email ?? ''} disabled={!editable} onChange={(e) => setV({ ...v, support: { ...v.support, email: e.target.value } })} /></Field>
              <Field label="Support Hours"><Input value={v.support?.hours ?? ''} placeholder="Mon–Sat 9:00–18:00 IST" maxLength={80} disabled={!editable} onChange={(e) => setV({ ...v, support: { ...v.support, hours: e.target.value } })} /></Field>
            </div>
            <p className="text-xs text-grey-500">The emergency number ({view.effective.emergencyNumber}) comes from Settings → Emergency.</p>
          </FormSection>
          <FormSection title="Popular Searches" icon={Search} accent="green" hint="Quick chips under the patient search box. Use the words patients use, not medical terms. One per line, up to twelve. Manage what each word means in Catalogue → Everyday Words.">
            <Textarea value={(v.popularSearches ?? []).join('\n')} placeholder={(d.popularSearches ?? []).join('\n')} disabled={!editable} onChange={(e) => setV({ ...v, popularSearches: e.target.value.split('\n').slice(0, 12) })} className="min-h-28" aria-label="Popular Searches" />
          </FormSection>
          <FormSection title="Theme Colours" icon={Palette} accent="blue" hint="Primary colours buttons, links and the hero gradient; accent is the second gradient stop and highlights.">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Primary"><div className="flex items-center gap-2"><Input type="color" value={theme.primary} disabled={!editable} onChange={(e) => setV({ ...v, theme: { ...v.theme, primary: e.target.value.toUpperCase() } })} className="h-10 w-14 p-1" /><Input value={theme.primary} disabled={!editable} onChange={(e) => setV({ ...v, theme: { ...v.theme, primary: e.target.value } })} className="w-28 font-mono" /></div></Field>
              <Field label="Accent"><div className="flex items-center gap-2"><Input type="color" value={theme.accent} disabled={!editable} onChange={(e) => setV({ ...v, theme: { ...v.theme, accent: e.target.value.toUpperCase() } })} className="h-10 w-14 p-1" /><Input value={theme.accent} disabled={!editable} onChange={(e) => setV({ ...v, theme: { ...v.theme, accent: e.target.value } })} className="w-28 font-mono" /></div></Field>
              <div className="h-16 flex-1 rounded-xl" style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.accent})` }} aria-label="Gradient Preview" />
              {editable && (v.theme?.primary || v.theme?.accent) && <Button size="sm" variant="ghost" onClick={() => setV({ ...v, theme: undefined })}>Reset Colours</Button>}
            </div>
          </FormSection>
        </div>
      </div>

      {saving && (
        <Dialog open onClose={() => setSaving(false)} title="Save Patient App Content" description="Live for every patient within a minute; recorded in the audit log." icon={Sparkles} footer={<><Button variant="ghost" onClick={() => setSaving(false)} disabled={save.isPending}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={reason.trim().length < 5}>Save</Button></>}>
          <Field label="Reason" required hint="At least 5 characters"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          {problem && <p role="alert" className="mt-2 text-sm text-red">{problem}</p>}
        </Dialog>
      )}
    </div>
  );
}

function ListEditor<T>({ items, defaults, max, editable, blank, onChange, render }: { items: T[]; defaults: T[]; max: number; editable: boolean; blank: T; onChange: (items: T[]) => void; render: (item: T, set: (next: T) => void) => React.ReactNode }) {
  const usingDefaults = items.length === 0;
  return (
    <div className="space-y-2">
      {usingDefaults && <div className="rounded-lg border border-dashed border-grey-300 p-3 text-xs text-grey-600"><Badge>as shipped</Badge> <span className="ml-1">{defaults.length} default item(s) are shown in the app.</span>{editable && <Button size="sm" variant="ghost" className="ml-2" onClick={() => onChange(structuredClone(defaults))}>Edit a Copy</Button>}</div>}
      {items.map((item, i) => (
        <div key={i} className={cx('flex items-start gap-2 rounded-lg border border-grey-200 p-2')}>
          <div className="min-w-0 flex-1">{render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}</div>
          {editable && <Button size="sm" variant="ghost" aria-label="Remove" className="text-red" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>}
        </div>
      ))}
      {editable && !usingDefaults && items.length < max && <Button size="sm" variant="secondary" onClick={() => onChange([...items, structuredClone(blank)])}><Plus size={14} /> Add</Button>}
      {editable && !usingDefaults && <Button size="sm" variant="ghost" onClick={() => onChange([])}>Back to Defaults</Button>}
    </div>
  );
}
