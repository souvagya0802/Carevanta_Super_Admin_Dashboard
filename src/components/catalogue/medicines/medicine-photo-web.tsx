'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

const PATH = '/admin/catalogue/medicines';

export interface PhotoCandidate {
  provider: 'openverse' | 'commons';
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  width: number | null;
  height: number | null;
  licence: string;
  licenceUrl: string | null;
  creator: string | null;
  sourcePageUrl: string;
  attribution: string;
  matchedOn: 'brand' | 'composition';
}
interface SearchResult { candidates: PhotoCandidate[]; queries: string[]; exhausted: boolean }

const via = (p: PhotoCandidate['provider']) => (p === 'commons' ? 'Wikimedia Commons' : 'Openverse');

/**
 * "Find Photo Online": openly licensed photos (CC0, public domain, CC BY, CC BY-SA) from Openverse and
 * Wikimedia Commons. Nothing is attached automatically; a salt match must be marked representative.
 */
export function FindPhotoOnline({ medicineId, open, onClose }: { medicineId: string; open: boolean; onClose: () => void }) {
  const q = useGet<SearchResult>(open ? `${PATH}/${medicineId}/image/search` : null);
  const [chosen, setChosen] = useState<PhotoCandidate | null>(null);
  const [representative, setRepresentative] = useState(false);
  const attach = useAction(
    (c: PhotoCandidate) => api.post(`${PATH}/${medicineId}/image/from-web`, { fullUrl: c.fullUrl, sourcePageUrl: c.sourcePageUrl, licence: c.licence, creator: c.creator, attribution: c.attribution, representative }),
    { success: 'Photo saved', invalidate: [PATH], onSuccess: () => { setChosen(null); onClose(); } },
  );
  const choose = (c: PhotoCandidate) => { setChosen(c); setRepresentative(c.matchedOn === 'composition'); };
  const mustFlag = chosen?.matchedOn === 'composition';

  return (
    <>
      <Dialog open={open && !chosen} onClose={onClose} title="Find Photo Online" size="lg" description="Openly licensed photos only. Check the photo shows this medicine before using it.">
        <div className="space-y-3">
          <p className="text-xs text-grey-600">Indian brand packs are rarely online under an open licence. The best photo is a real pack photo: pharmacies can add one from their counter with the camera upload.</p>
          {q.isLoading && <Skeleton rows={4} />}
          {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
          {q.data?.exhausted && <p role="status" className="rounded-[5px] bg-orange-50 px-3 py-2 text-xs text-orange-800">Image search limit reached, try again in an hour. Some results may be missing.</p>}
          {q.data && q.data.candidates.length === 0 && <EmptyState title="No Openly Licensed Photos Found" description={`Searched: ${q.data.queries.join(', ') || 'nothing to search'}`} />}
          {q.data && q.data.candidates.length > 0 && (
            <>
              <p className="text-xs text-grey-500">Searched: {q.data.queries.join(', ')}</p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {q.data.candidates.map((c) => (
                  <li key={`${c.provider}:${c.id}`} className="flex flex-col overflow-hidden rounded-[5px] border border-grey-200">
                    {/* eslint-disable-next-line @next/next/no-img-element -- external, openly licensed thumbnails */}
                    <img src={c.thumbUrl} alt={c.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full bg-grey-50 object-contain" />
                    <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
                      <p className="line-clamp-2 font-medium" title={c.title}>{c.title}</p>
                      <div className="flex flex-wrap gap-1">
                        <Badge accent="blue">{<span>{c.licence}</span>}</Badge>
                        <Badge accent={c.matchedOn === 'brand' ? 'green' : 'orange'}>{c.matchedOn === 'brand' ? 'Brand Match' : 'Salt Match'}</Badge>
                      </div>
                      <p className="truncate text-grey-600" title={c.creator ?? ''}>{c.creator ?? 'Unknown creator'} · {via(c.provider)}</p>
                      <a href={c.sourcePageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-grey-600 underline">Source <ExternalLink size={11} aria-hidden /></a>
                      <Button size="sm" className="mt-auto" onClick={() => choose(c)}>Use This Photo</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={open && !!chosen}
        onClose={() => setChosen(null)}
        title="Use This Photo"
        footer={<><Button variant="ghost" onClick={() => setChosen(null)} disabled={attach.isPending}>Back</Button><Button onClick={() => chosen && attach.mutate(chosen)} loading={attach.isPending} disabled={mustFlag && !representative}>Use This Photo</Button></>}
      >
        {chosen && (
          <div className="space-y-3 text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element -- external, openly licensed thumbnail */}
            <img src={chosen.thumbUrl} alt={chosen.title} referrerPolicy="no-referrer" className="mx-auto max-h-48 rounded-[5px] object-contain" />
            <p>Licence: <a href={chosen.licenceUrl ?? chosen.sourcePageUrl} target="_blank" rel="noopener noreferrer" className="underline">{chosen.licence}</a></p>
            <p className="text-xs text-grey-600">Patients will see: Photo: {chosen.creator ?? 'Unknown creator'}, {chosen.licence} via {via(chosen.provider)}</p>
            {mustFlag && <p className="text-xs text-orange-800">This photo was found by the salt name, not the brand. It does not show this brand&apos;s pack.</p>}
            <Checkbox label="This is a representative image, not this brand's pack" checked={representative} onChange={(e) => setRepresentative(e.target.checked)} required={mustFlag} />
          </div>
        )}
      </Dialog>
    </>
  );
}

/** "Photo: <creator>, <licence> via <source>" under a web photo, with the representative label. */
export function PhotoCredit({ credit, licence, sourceUrl, representative }: { credit?: string | null; licence?: string | null; sourceUrl?: string | null; representative?: boolean }) {
  if (!credit && !representative) return null;
  return (
    <div className="space-y-1 text-xs text-grey-600">
      {representative && <Badge accent="orange">Representative Image</Badge>}
      {credit && (
        <p>
          Photo: {credit.replace(/ via (.+)$/, '')}, {licence ?? 'open licence'}{/ via (.+)$/.exec(credit) ? ` via ${/ via (.+)$/.exec(credit)![1]}` : ''}
          {sourceUrl && <> · <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Source</a></>}
        </p>
      )}
    </div>
  );
}
