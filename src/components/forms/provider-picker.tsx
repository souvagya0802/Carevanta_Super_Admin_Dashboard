'use client';

import { useId, useState } from 'react';
import { Building2, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { title } from '@/lib/format';
import { Input, cx } from '@/components/ui/primitives';

export interface ProviderRef { id: string; displayName: string; type: string; status?: string }

/**
 * Searchable provider selector. Typing searches the API by name, GSTIN or
 * registration number; a pasted UUID is accepted directly. Emits `null` when cleared.
 */
export function ProviderPicker({ value, onChange, placeholder = 'Search provider by name…', disabled, className, allowAny }: { value: ProviderRef | null; onChange: (p: ProviderRef | null) => void; placeholder?: string; disabled?: boolean; className?: string; allowAny?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const id = useId();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dq.trim());
  const results = useQuery({
    queryKey: ['provider-search', dq],
    queryFn: () => (isUuid ? api.get<{ data: ProviderRef }>(`/admin/providers/${dq.trim()}`).then((r) => [r.data]) : api.get<{ data: ProviderRef[] }>(`/admin/providers?q=${encodeURIComponent(dq.trim())}&limit=8`).then((r) => r.data)),
    enabled: open && dq.trim().length >= 2,
    staleTime: 60_000,
  });
  if (value) {
    return (
      <div className={cx('flex h-10 items-center gap-2 rounded-lg border border-grey-300 bg-grey-50 px-3 text-sm', className)}>
        <Building2 size={14} className="shrink-0 text-grey-500" aria-hidden />
        <span className="min-w-0 flex-1 truncate"><span className="font-medium">{value.displayName}</span> <span className="text-xs text-grey-500">· {title(value.type)}</span></span>
        {!disabled && <button type="button" onClick={() => { onChange(null); setQ(''); }} aria-label="Clear provider" className="text-grey-400 hover:text-ink"><X size={14} /></button>}
      </div>
    );
  }
  return (
    <div className={cx('relative', className)}>
      <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
      <Input role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" value={q} disabled={disabled} placeholder={placeholder} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="pl-9" />
      {open && dq.trim().length >= 2 && (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-grey-200 bg-paper py-1 text-sm shadow-[var(--shadow-float)]">
          {results.isPending ? <li className="px-3 py-2 text-xs text-grey-500">Searching…</li> : results.isError ? <li className="px-3 py-2 text-xs text-red">{isUuid ? 'No provider with that id' : 'Search failed'}</li> : results.data.length === 0 ? <li className="px-3 py-2 text-xs text-grey-500">No providers match “{dq}”</li> : results.data.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(p); setOpen(false); setQ(''); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-grey-50">
                <span className="min-w-0 truncate">{p.displayName}</span>
                <span className="shrink-0 text-xs text-grey-500">{title(p.type)}{p.status && p.status !== 'APPROVED' ? ` · ${title(p.status).toLowerCase()}` : ''}</span>
              </button>
            </li>
          ))}
          {allowAny && <li className="border-t border-grey-100 px-3 py-1.5 text-[11px] text-grey-500">Leave empty for all providers</li>}
        </ul>
      )}
    </div>
  );
}
