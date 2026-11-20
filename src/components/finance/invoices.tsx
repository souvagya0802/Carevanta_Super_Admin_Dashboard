'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useDownload } from '@/lib/download';
import { date, money } from '@/lib/format';
import { Badge, Button, Dialog, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

export type InvoiceKind = 'TAX_INVOICE' | 'CREDIT_NOTE' | 'COMMISSION_INVOICE' | 'SETTLEMENT_STATEMENT';
export interface InvoiceMeta { id: string; number: string; kind: InvoiceKind; issuedAt: string; currency: string; totalMinor: number; taxMinor: number; sourceType?: string | null; sourceId?: string | null; transactionId?: string | null; providerId?: string | null; patientProfileId?: string | null; pdfUrl?: string | null }

export const INVOICE_LABEL: Record<InvoiceKind, string> = { TAX_INVOICE: 'Download Invoice', CREDIT_NOTE: 'Credit Note', COMMISSION_INVOICE: 'Commission Invoice', SETTLEMENT_STATEMENT: 'Statement' };
const KIND_NAME: Record<InvoiceKind, string> = { TAX_INVOICE: 'Tax Invoice', CREDIT_NOTE: 'Credit Note', COMMISSION_INVOICE: 'Commission Invoice', SETTLEMENT_STATEMENT: 'Settlement Statement' };
export const pdfPath = (inv: InvoiceMeta) => inv.pdfUrl || `/invoices/${inv.id}/pdf`;

/** Accepts `{ data: { items } }`, `{ items }` or `{ data: [] }`. */
export function invoiceItems(r: unknown): InvoiceMeta[] {
  const o = (r ?? {}) as { data?: unknown; items?: unknown };
  const inner = (o.data ?? o) as { items?: unknown } | unknown[];
  const list = Array.isArray(inner) ? inner : Array.isArray((inner as { items?: unknown }).items) ? (inner as { items: unknown[] }).items : Array.isArray(o.items) ? o.items : [];
  return list as InvoiceMeta[];
}

/** Invoices of one transaction or settlement batch, in the shared black-header dialog. 404 = none yet, never an error. */
export function InvoicesDialog({ listPath, title, description, onClose }: { listPath: string; title: string; description?: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['get', listPath],
    queryFn: async ({ signal }) => {
      try {
        return invoiceItems(await api.get<unknown>(listPath, signal));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return [] as InvoiceMeta[];
        throw e;
      }
    },
    retry: false,
  });
  const { download, busy } = useDownload();
  return (
    <Dialog open onClose={onClose} icon={FileText} title={title} description={description} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {q.isPending ? <Skeleton rows={3} /> : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : q.data.length === 0 ? (
        <EmptyState title="No Invoices Yet" description="Documents are issued when a payment is captured, a refund completes or a payout batch is approved." />
      ) : (
        <ul className="divide-y divide-grey-100">
          {q.data.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="flex items-center gap-2"><span className="font-mono text-xs">{inv.number}</span><Badge accent={inv.kind === 'CREDIT_NOTE' ? 'orange' : 'blue'}>{KIND_NAME[inv.kind] ?? inv.kind}</Badge></span>
                <span className="block text-xs text-grey-500">{date(inv.issuedAt)} · <span className="tnum">{money(inv.totalMinor)}</span>{inv.taxMinor ? ` · tax ${money(inv.taxMinor)}` : ''}</span>
              </span>
              <Button size="sm" variant="secondary" className="h-11 sm:h-8" loading={busy === pdfPath(inv)} onClick={() => void download(pdfPath(inv), { fallbackName: `${inv.number || inv.id}.pdf` })}><Download size={14} aria-hidden /> {INVOICE_LABEL[inv.kind] ?? 'Download'}</Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
