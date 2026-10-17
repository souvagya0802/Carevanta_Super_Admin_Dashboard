'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ApiError } from '@/lib/api';

type Kind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  description?: string;
}
interface ToastApi {
  toast: (t: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (err: unknown, fallback?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function describeError(err: unknown, fallback = 'Something went wrong'): { title: string; description?: string } {
  if (err instanceof ApiError) {
    const base = { title: err.message };
    if (err.body.requestId) return { ...base, description: `Reference ${err.body.requestId.slice(0, 8)}` };
    return base;
  }
  if (err instanceof Error) return { title: err.message || fallback };
  return { title: fallback };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setItems((xs) => [...xs, { ...t, id }]);
      setTimeout(() => remove(id), t.kind === 'error' ? 8000 : 4000);
    },
    [remove],
  );
  const value = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ kind: 'success', title, description }),
      error: (err, fallback) => toast({ kind: 'error', ...describeError(err, fallback) }),
    }),
    [toast],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 border bg-paper p-3 text-sm shadow-lg ${t.kind === 'error' ? 'border-ink' : 'border-grey-300'}`}
          >
            <div className="flex-1">
              <p className="font-medium">{t.title}</p>
              {t.description && <p className="mt-0.5 text-grey-600">{t.description}</p>}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => remove(t.id)} className="text-grey-500 hover:text-ink">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
