'use client';

import { useState } from 'react';
import { Eye, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useGet } from '@/lib/hooks';
import { useDownload } from '@/lib/download';
import { Button, Checkbox, Field, FormSection, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import type { Setting } from './platform-settings';

/**
 * Settings → Invoices. The seller details printed on every invoice, saved through the generic
 * settings API (PUT /admin/settings/:key, audited, version-checked). Fields show even before the
 * API lists a key, using these plain labels; the API's own label wins once it does.
 */
type Kind = 'string' | 'text' | 'number' | 'boolean';
const FIELDS: { key: string; label: string; kind: Kind; hint?: string; placeholder?: string }[] = [
  { key: 'invoice.seller_legal_name', label: 'Legal Name', kind: 'string', hint: 'The registered name of the company issuing commission invoices' },
  { key: 'invoice.seller_address', label: 'Registered Address', kind: 'text' },
  { key: 'invoice.seller_gstin', label: 'GSTIN', kind: 'string', placeholder: '15 characters' },
  { key: 'invoice.seller_pan', label: 'PAN', kind: 'string', placeholder: '10 characters' },
  { key: 'invoice.seller_state_code', label: 'State Code', kind: 'string', hint: 'GST state code of the registered address, used for place of supply' },
  { key: 'invoice.number_prefix', label: 'Invoice Number Prefix', kind: 'string', hint: 'Numbers look like PREFIX-INV-2026-27-000001', placeholder: 'CV' },
  { key: 'invoice.commission_gst_percent', label: 'GST on Commission (%)', kind: 'number', placeholder: '18' },
  { key: 'invoice.footer_note', label: 'Footer Note', kind: 'text', hint: 'Printed at the bottom of every invoice' },
  { key: 'invoice.show_provider_gstin', label: 'Show Provider GSTIN on Patient Invoices', kind: 'boolean' },
];

const toText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function InvoiceSettings() {
  const q = useGet<Setting[]>('/admin/settings');
  if (q.isPending) return <Skeleton rows={8} />;
  const byKey = new Map((q.data ?? []).map((s) => [s.key, s]));
  return <Inner key={JSON.stringify(FIELDS.map((f) => byKey.get(f.key)?.version ?? 0))} byKey={byKey} />;
}

function Inner({ byKey }: { byKey: Map<string, Setting> }) {
  const { can } = useAuth();
  const editable = can('settings.manage');
  const toast = useToast();
  const qc = useQueryClient();
  const initial = Object.fromEntries(FIELDS.map((f) => [f.key, f.kind === 'boolean' ? !!byKey.get(f.key)?.value : toText(byKey.get(f.key)?.value)])) as Record<string, string | boolean>;
  const [values, setValues] = useState(initial);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { download, busy } = useDownload();
  const changed = FIELDS.filter((f) => values[f.key] !== initial[f.key]);

  const save = async () => {
    setSaving(true);
    let ok = 0;
    try {
      for (const f of changed) {
        const raw = values[f.key];
        const value = f.kind === 'boolean' ? raw : f.kind === 'number' ? Number(raw) : String(raw).trim();
        await api.put(`/admin/settings/${f.key}`, { value, expectedVersion: byKey.get(f.key)?.version, reason: reason.trim() });
        ok++;
      }
      toast.success('Invoice settings saved', `${ok} field(s) updated`);
      setReason('');
    } catch (e) {
      toast.error(e, 'Could not save the invoice settings');
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ predicate: (x) => x.queryKey[1] === '/admin/settings' });
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <FormSection title="Seller Details on Invoices" icon={FileText} accent="blue" hint="Printed on tax invoices, credit notes and commission invoices. Changes apply to documents issued after saving; issued invoices never change.">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const label = byKey.get(f.key)?.meta?.label || f.label;
            if (f.kind === 'boolean') return <div key={f.key} className="sm:col-span-2"><Checkbox label={label} checked={!!values[f.key]} disabled={!editable} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} /></div>;
            return (
              <Field key={f.key} label={label} hint={f.hint ?? byKey.get(f.key)?.meta?.help ?? undefined} className={f.kind === 'text' ? 'sm:col-span-2' : undefined}>
                {f.kind === 'text'
                  ? <Textarea value={String(values[f.key])} disabled={!editable} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className="min-h-20" />
                  : <Input value={String(values[f.key])} type={f.kind === 'number' ? 'number' : 'text'} placeholder={f.placeholder} disabled={!editable} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
              </Field>
            );
          })}
        </div>
        {editable && (
          <div className="mt-4 space-y-3">
            <Field label="Reason for the Change" required hint="At least 5 characters; recorded in the audit log"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button onClick={() => void save()} loading={saving} disabled={changed.length === 0 || reason.trim().length < 5}>Save Changes</Button>
          </div>
        )}
      </FormSection>
      <FormSection title="Preview" icon={Eye} accent="green" hint="A sample invoice with the saved settings and the platform logo. Save first to see your changes.">
        <Button variant="secondary" loading={busy === '/admin/finance/invoices/sample.pdf'} onClick={() => void download('/admin/finance/invoices/sample.pdf', { fallbackName: 'sample-invoice.pdf' })}><Eye size={16} aria-hidden /> Preview Sample Invoice</Button>
      </FormSection>
    </div>
  );
}
