'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { cx } from '@/components/ui/primitives';

export interface ChipOption { value: string; label: string }

/**
 * A pill that opens a short list of plain choices. Shows "Label: Choice" when set, with a clear button,
 * so an operator sees every active filter at a glance.
 */
export function FilterChip({ label, value, options, onChange }: { label: string; value: string; options: ChipOption[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <div className={cx('inline-flex h-9 items-center rounded-full border text-xs font-medium', value ? 'border-ink bg-ink text-paper' : 'border-grey-300 bg-paper text-grey-800 hover:bg-grey-50')}>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex h-full items-center gap-1 pl-3 pr-2">
          {label}
          {current && value ? <span className="font-semibold">: {current.label}</span> : null}
          <ChevronDown size={14} aria-hidden />
        </button>
        {value && (
          <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange('')} className="mr-1 flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/15">
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute left-0 z-20 mt-1 min-w-48 overflow-hidden rounded-lg border border-grey-200 bg-paper py-1 text-sm shadow-[var(--shadow-float)]">
          {[{ value: '', label: 'Any' }, ...options].map((o) => (
            <li key={o.value || 'any'} role="option" aria-selected={o.value === value}>
              <button type="button" onClick={() => { onChange(o.value); setOpen(false); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-grey-50">
                {o.label}
                {o.value === value && <Check size={14} aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
