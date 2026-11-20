'use client';

import { createElement } from 'react';
import { Droplet, FlaskConical, Package, Pill, Pipette, Syringe, Tablets, Wind, type LucideIcon } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { cx } from '@/components/ui/primitives';

/** Neutral placeholder by dosage form, used when a medicine has no photo. */
export function formIcon(form: string | null | undefined): LucideIcon {
  const f = (form ?? '').toLowerCase();
  if (/capsule/.test(f)) return Pill;
  if (/tablet|lozenge/.test(f)) return Tablets;
  if (/syrup|suspension|solution|liquid|elixir|mixture/.test(f)) return FlaskConical;
  if (/inject|vial|ampoule|infusion/.test(f)) return Syringe;
  if (/cream|ointment|gel|lotion/.test(f)) return Droplet;
  if (/inhal|rotacap|respule/.test(f)) return Wind;
  if (/drop/.test(f)) return Pipette;
  return Package;
}

/** Absolute URL for an API-relative image path. */
export const photoSrc = (imageUrl: string) => (imageUrl.startsWith('http') ? imageUrl : `${API_BASE}${imageUrl}`);

export function MedicineThumb({ imageUrl, dosageForm, name, size = 'md' }: { imageUrl?: string | null; dosageForm?: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-40 w-40' : 'h-12 w-12';
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- API-served, versioned URL; next/image would need remote config per environment
    return <img src={photoSrc(imageUrl)} alt={`Photo of ${name}`} loading="lazy" className={cx(dim, 'shrink-0 rounded-[5px] border border-grey-200 bg-paper object-contain')} />;
  }
  return (
    <span className={cx(dim, 'inline-flex shrink-0 items-center justify-center rounded-[5px] border border-grey-200 bg-grey-50 text-grey-400')} aria-hidden>
      {createElement(formIcon(dosageForm), { size: size === 'lg' ? 40 : size === 'sm' ? 16 : 20 })}
    </span>
  );
}
