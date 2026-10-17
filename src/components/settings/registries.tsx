'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Landmark, PlugZap, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useGet } from '@/lib/hooks';
import { title } from '@/lib/format';
import { Badge, Button, Card, ErrorState, Field, FormSection, Input, PasswordInput, Select, Skeleton, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface Connectors { abdm: { environment: 'sandbox' | 'production'; clientId: string | null; hasSecret: boolean; hprLookupUrl: string | null; hfrLookupUrl: string | null }; gstin: { baseUrl: string | null; hasApiKey: boolean }; vahan: { baseUrl: string | null; hasApiKey: boolean }; status: Record<string, 'configured' | 'not_configured'> }
interface Catalogue { registries: { key: string; name: string; authority: string; checkTypes: string[]; providerTypes: string[]; mode: 'api' | 'portal' | 'none'; portalUrl: string | null; connector: string | null; guidance: string }[]; connectors: Record<string, string> }

export function RegistrySettings() {
  const conf = useGet<Connectors>('/admin/integrations/registries');
  const cat = useGet<Catalogue>('/admin/verification-cases/registries');
  if (conf.isPending) return <Skeleton rows={6} />;
  if (conf.isError || !conf.data) return <ErrorState error={conf.error} retry={() => conf.refetch()} />;
  return (
    <div className="space-y-4">
      <ConnectorForm key={JSON.stringify(conf.data)} c={conf.data} />
      <Card title="Where Each Check Is Verified" description="The registries that are authoritative for each credential. Most Indian registries only offer a search page; the connectors above cover the ones with APIs.">
        {cat.isPending ? <Skeleton rows={5} /> : cat.isError ? <ErrorState error={cat.error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-grey-500"><tr><th className="py-1 pr-3">Registry</th><th className="px-2 py-1">Checks</th><th className="px-2 py-1">Lookup</th><th className="px-2 py-1">Guidance</th></tr></thead>
              <tbody>
                {cat.data!.registries.map((r) => (
                  <tr key={r.key} className="border-t border-grey-100 align-top">
                    <td className="py-2 pr-3"><p className="font-medium">{r.name}</p><p className="text-xs text-grey-500">{r.authority}</p></td>
                    <td className="px-2 py-2 text-xs">{r.checkTypes.map(title).join(', ')}{r.providerTypes.length ? <p className="text-grey-500">{r.providerTypes.map(title).join(', ')}</p> : null}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                      {r.mode === 'api' ? <Badge accent={cat.data!.connectors[r.connector ?? ''] === 'configured' ? 'green' : 'orange'}>{cat.data!.connectors[r.connector ?? ''] === 'configured' ? 'API Connected' : 'API Not Configured'}</Badge> : r.mode === 'portal' ? <Badge accent="blue">Portal Search</Badge> : <Badge>Issuer / Manual</Badge>}
                      {r.portalUrl && <a href={r.portalUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-grey-600 underline-offset-2 hover:underline">Open <ExternalLink size={11} aria-hidden /></a>}
                    </td>
                    <td className="max-w-md px-2 py-2 text-xs text-grey-700">{r.guidance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ConnectorForm({ c }: { c: Connectors }) {
  const { can } = useAuth();
  const toast = useToast();
  const disabled = !can('settings.manage');
  const [f, setF] = useState({ environment: c.abdm.environment, clientId: c.abdm.clientId ?? '', clientSecret: '', hprLookupUrl: c.abdm.hprLookupUrl ?? '', hfrLookupUrl: c.abdm.hfrLookupUrl ?? '', gstinBaseUrl: c.gstin.baseUrl ?? '', gstinApiKey: '', vahanBaseUrl: c.vahan.baseUrl ?? '', vahanApiKey: '' });
  const save = useAction(
    () => api.put('/admin/integrations/registries', {
      abdm: { environment: f.environment, clientId: f.clientId || null, clientSecret: f.clientSecret, hprLookupUrl: f.hprLookupUrl || null, hfrLookupUrl: f.hfrLookupUrl || null },
      gstin: { baseUrl: f.gstinBaseUrl || null, apiKey: f.gstinApiKey },
      vahan: { baseUrl: f.vahanBaseUrl || null, apiKey: f.vahanApiKey },
    }),
    { success: 'Registry connectors saved', invalidate: ['/admin/integrations/registries', '/admin/verification-cases/registries'] },
  );
  const clear = useAction((which: 'abdm' | 'gstin' | 'vahan') => api.put('/admin/integrations/registries', which === 'abdm' ? { abdm: { clientSecret: null } } : which === 'gstin' ? { gstin: { apiKey: null } } : { vahan: { apiKey: null } }), { success: 'Secret cleared', invalidate: ['/admin/integrations/registries', '/admin/verification-cases/registries'] });
  const test = useAction(() => api.post<{ data: { ok: boolean; environment: string; expiresIn: number | null } }>('/admin/integrations/registries/abdm/test'), { onSuccess: (r) => toast.success(`ABDM ${r.data.environment} gateway accepted the credentials`, r.data.expiresIn ? `Session valid ${Math.round(r.data.expiresIn / 60)} min` : undefined) });
  const status = (k: string) => c.status[k] === 'configured';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-grey-200 bg-grey-50 p-3 text-sm">
        <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-grey-500" />
        <p className="text-xs text-grey-700">There is no single government API that verifies every licence. <strong>ABDM</strong> (National Health Authority) runs the Healthcare Professionals and Health Facility registries and issues sandbox credentials to integrators; production needs a Safe-to-Host audit. <strong>GSTIN</strong> lookups go through a GST Suvidha Provider or a verification vendor. <strong>Vahan</strong> vehicle data comes through authorised partners. Everything else (NMC register, state councils, Clinical Establishments, drugs control, NABL, AERB) is a search portal: the verifier looks it up and records the reference. Secrets are stored encrypted and never shown again.</p>
      </div>

      <FormSection title="ABDM — Healthcare Professionals & Health Facility Registries" icon={Landmark} accent={status('abdm') ? 'green' : 'orange'} hint="Credentials from sandbox.abdm.gov.in. The lookup endpoints are entered once you have confirmed them against the HPR API documents and the HFR Swagger — they are versioned and change.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Environment"><Select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as 'sandbox' | 'production' })} disabled={disabled}><option value="sandbox">Sandbox (dev.abdm.gov.in)</option><option value="production">Production (live.abdm.gov.in)</option></Select></Field>
          <Field label="Client ID"><Input value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} disabled={disabled} autoComplete="off" /></Field>
          <Field label="Client Secret" hint={c.abdm.hasSecret ? 'A secret is stored. Leave blank to keep it.' : 'Not set'}><PasswordInput value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} disabled={disabled} autoComplete="new-password" /></Field>
          <div className="flex items-end gap-2 pb-0.5">
            <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={disabled || !status('abdm')}><PlugZap size={14} /> Test Session</Button>
            {c.abdm.hasSecret && !disabled && <Button variant="ghost" size="sm" className="h-10 text-red" onClick={() => clear.mutate('abdm')}>Clear Secret</Button>}
          </div>
          <Field label="HPR Lookup Endpoint" hint="https://… · professional lookup, from hpr.abdm.gov.in/apidocuments" className="md:col-span-2"><Input value={f.hprLookupUrl} onChange={(e) => setF({ ...f, hprLookupUrl: e.target.value.trim() })} disabled={disabled} placeholder="https://hpridsbx.abdm.gov.in/…" /></Field>
          <Field label="HFR Lookup Endpoint" hint="https://… · facility search, from facilitysbx.abdm.gov.in/swagger-ui.html" className="md:col-span-2"><Input value={f.hfrLookupUrl} onChange={(e) => setF({ ...f, hfrLookupUrl: e.target.value.trim() })} disabled={disabled} placeholder="https://facilitysbx.abdm.gov.in/v1/facility/search" /></Field>
        </div>
        <p className={cx('mt-3 flex items-center gap-1.5 text-xs', status('abdm') ? 'text-green' : 'text-orange')}>{status('abdm') ? <CheckCircle2 size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}{status('abdm') ? 'Credentials stored. Lookups run once the endpoints are set.' : 'Not configured — verifiers use the NMC and CERRS portals and record the reference by hand.'}</p>
      </FormSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormSection title="GSTIN Verification" icon={Landmark} accent={status('gstin') ? 'green' : 'orange'} hint="A GSP or vendor endpoint that returns JSON for GET <base URL>/<GSTIN> with a bearer key. The legal name and active status are compared with the provider record.">
          <div className="grid gap-3">
            <Field label="API Base URL"><Input value={f.gstinBaseUrl} onChange={(e) => setF({ ...f, gstinBaseUrl: e.target.value.trim() })} disabled={disabled} placeholder="https://api.yourgsp.in/v1/gstin" /></Field>
            <Field label="API Key" hint={c.gstin.hasApiKey ? 'A key is stored. Leave blank to keep it.' : 'Not set'}><PasswordInput value={f.gstinApiKey} onChange={(e) => setF({ ...f, gstinApiKey: e.target.value })} disabled={disabled} autoComplete="new-password" /></Field>
            {c.gstin.hasApiKey && !disabled && <Button variant="ghost" size="sm" className="w-fit text-red" onClick={() => clear.mutate('gstin')}>Clear Key</Button>}
          </div>
        </FormSection>
        <FormSection title="Vahan Vehicle Registration" icon={Landmark} accent={status('vahan') ? 'green' : 'orange'} hint="An authorised Vahan partner endpoint: GET <base URL>/<registration number> with a bearer key. Returns RC status, insurance and fitness validity for ambulance checks.">
          <div className="grid gap-3">
            <Field label="API Base URL"><Input value={f.vahanBaseUrl} onChange={(e) => setF({ ...f, vahanBaseUrl: e.target.value.trim() })} disabled={disabled} placeholder="https://api.partner.in/v1/rc" /></Field>
            <Field label="API Key" hint={c.vahan.hasApiKey ? 'A key is stored. Leave blank to keep it.' : 'Not set'}><PasswordInput value={f.vahanApiKey} onChange={(e) => setF({ ...f, vahanApiKey: e.target.value })} disabled={disabled} autoComplete="new-password" /></Field>
            {c.vahan.hasApiKey && !disabled && <Button variant="ghost" size="sm" className="w-fit text-red" onClick={() => clear.mutate('vahan')}>Clear Key</Button>}
          </div>
        </FormSection>
      </div>
      {!disabled && <Button onClick={() => save.mutate()} loading={save.isPending}>Save Registry Connectors</Button>}
    </div>
  );
}
