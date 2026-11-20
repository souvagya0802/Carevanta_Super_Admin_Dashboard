'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api, request } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { date } from '@/lib/format';
import { Button, Dialog } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { MedicineThumb } from './medicine-thumb';
import type { Medicine } from './shared';

const PATH = '/admin/catalogue/medicines';
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 2 * 1024 * 1024;

/** Photo section of the medicine page: preview, Upload / Replace / Remove and who added it. */
export function MedicinePhoto({ m, addedByPharmacy, manage }: { m: Medicine; addedByPharmacy: string | null; manage: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const upload = useAction((file: File) => request(`${PATH}/${m.id}/image`, { method: 'PUT', raw: { data: file, contentType: file.type } }), { success: 'Photo saved', invalidate: [PATH] });
  const remove = useAction(() => api.delete(`${PATH}/${m.id}/image`), { success: 'Photo removed', invalidate: [PATH], onSuccess: () => setRemoving(false) });
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!TYPES.includes(file.type)) return toast.error(new Error('Choose a JPEG, PNG or WebP photo'));
    if (file.size > MAX) return toast.error(new Error('The photo must be 2 MB or smaller'));
    upload.mutate(file);
  };
  const who = !m.imageUrl ? 'No photo yet. Patients see a plain icon for the medicine form.' : m.imageSource === 'PROVIDER' ? `Added by ${addedByPharmacy ?? 'a pharmacy'} on ${date(m.imageUpdatedAt)}` : `Added by Carevanta${m.imageUpdatedAt ? ` on ${date(m.imageUpdatedAt)}` : ''}`;
  return (
    <section aria-label="Photo" className="flex flex-col gap-4 rounded-[5px] border border-grey-200 p-3 sm:flex-row sm:items-center">
      <MedicineThumb imageUrl={m.imageUrl} dosageForm={m.dosageForm} name={m.name} size="lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">Photo</p>
        <p className="text-xs text-grey-600">{who}</p>
        <p className="text-xs text-grey-500">JPEG, PNG or WebP, up to 2 MB. A clear photo of the pack front on a plain background works best.</p>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={upload.isPending}><ImagePlus size={14} aria-hidden /> {m.imageUrl ? 'Replace Photo' : 'Upload Photo'}</Button>
            {m.imageUrl && <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}><Trash2 size={14} aria-hidden /> Remove</Button>}
          </div>
        )}
      </div>
      <Dialog open={removing} onClose={() => setRemoving(false)} title="Remove Photo" footer={<><Button variant="ghost" onClick={() => setRemoving(false)} disabled={remove.isPending}>Cancel</Button><Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>Remove Photo</Button></>}>
        <p>Patients and pharmacies will see a plain icon instead. Any pharmacy can then add a new photo.</p>
      </Dialog>
    </section>
  );
}
