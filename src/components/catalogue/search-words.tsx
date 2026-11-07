'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useDebounced, useGet } from '@/lib/hooks';
import { money } from '@/lib/format';
import { Badge, Button, Card, Dialog, ErrorState, Input, Skeleton } from '@/components/ui/primitives';

/**
 * Everyday words patients type for a catalogue item ("child doctor",
 * "bukhar", "sugar test"). Patient search matches these as well as the
 * official name, and forgives small typos, so one spelling per word is enough.
 */
export function SearchWordsDialog({ open, onClose, title, words, path, invalidate }: { open: boolean; onClose: () => void; title: string; words: string[]; path: string; invalidate: string[] }) {
  const [list, setList] = useState<string[]>(words);
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2);
    setList((l) => [...l, ...parts.filter((w) => !l.includes(w))].slice(0, 40));
    setDraft('');
  };
  const save = useAction(() => api.patch(path, { synonyms: list }), { success: 'Search words saved', invalidate, onSuccess: onClose });
  return (
    <Dialog open={open} onClose={onClose} title={`Everyday Words · ${title}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Save Words</Button></>}>
      <p className="text-sm text-grey-600">Words patients type when they mean <b>{title}</b>. Include local words written in English letters (for example &quot;bukhar&quot;, &quot;pet dard&quot;). Small typos are forgiven automatically.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {list.length === 0 && <span className="text-sm text-grey-500">No words yet.</span>}
        {list.map((w) => (
          <span key={w} className="inline-flex items-center gap-1 rounded-[5px] bg-grey-100 py-1 pr-1 pl-2 text-sm">
            {w}
            <button type="button" aria-label={`Remove ${w}`} onClick={() => setList((l) => l.filter((x) => x !== w))} className="rounded-[5px] p-0.5 text-grey-500 hover:bg-grey-200"><X size={12} /></button>
          </span>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Input aria-label="Add Words" placeholder="Add words, separated by commas" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={!draft.trim()}>Add</Button>
      </form>
      <p className="mt-2 text-xs text-grey-500">{list.length} of 40 words. Changes reach patient search within a few seconds.</p>
    </Dialog>
  );
}

/** Small inline summary used in tables: the first few words and a count. */
export function WordsSummary({ words }: { words: string[] }) {
  if (!words.length) return <span className="text-xs text-grey-400">No Everyday Words</span>;
  return <span className="text-xs text-grey-600">{words.slice(0, 4).join(', ')}{words.length > 4 && <span className="text-grey-400"> +{words.length - 4} more</span>}</span>;
}

interface Suggest {
  understood: { label: string; kind: string; corrected: boolean; from: string } | null;
  emergency: { message: string; number: string } | null;
  conditions: { id: string; name: string; matchedTerm: string; approved: boolean; isRedFlag: boolean }[];
  specialities: { code: string; name: string; doctors: number; via: string; because: string | null }[];
  awaitingReview: string[];
  doctors: { id: string; name: string; specialities: string[]; matchedByName: boolean }[];
  places: { id: string; name: string; type: string }[];
  tests: { code: string; name: string; providers: number; fromMinor: number | null }[];
  medicines: { id: string; name: string; pharmacies: number }[];
}

/** Type what a patient would type and see exactly what the patient app will understand and show. */
export function SearchTester() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const res = useGet<Suggest>(dq.length >= 2 ? `/discovery/suggest?q=${encodeURIComponent(dq)}&limit=6` : null);
  const d = res.data;
  return (
    <div className="space-y-4">
      <Card title="Search Tester" description="Type the way a patient would. This is the same search the patient app uses.">
        <div className="relative max-w-xl">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" aria-hidden />
          <Input aria-label="Patient Search" placeholder="Try: bukhar, child doctor, sugar test, pet dard, paracitamol" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['bukhar', 'my son has fever', 'child doctor', 'sugar test', 'pet dard', 'fevr', 'chest pain', 'paracitamol'].map((x) => <button key={x} type="button" onClick={() => setQ(x)} className="rounded-[5px] border border-grey-200 px-2 py-1 text-xs hover:bg-grey-50">{x}</button>)}
        </div>
      </Card>
      {dq.length >= 2 && (res.isPending ? <Skeleton rows={4} /> : res.isError ? <ErrorState error={res.error} /> : d && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="What Search Understood">
            {d.emergency && <p className="mb-2 rounded-[5px] bg-red-soft p-2 text-sm text-red">Red flag: patients see “{d.emergency.message}” and the number {d.emergency.number} first.</p>}
            {d.understood ? <p className="text-sm">Showing results for <b>{d.understood.label}</b> <span className="text-grey-500">({d.understood.kind}{d.understood.corrected ? `, typo corrected from “${d.understood.from}”` : d.understood.from.toLowerCase() !== d.understood.label.toLowerCase() ? `, matched the word “${d.understood.from}”` : ''})</span></p> : <p className="text-sm text-grey-500">No symptom, speciality or test recognised. Add the word to a catalogue item if patients use it.</p>}
            {d.awaitingReview.length > 0 && <p className="mt-2 rounded-[5px] bg-orange-soft p-2 text-sm text-orange">Recognised <b>{d.awaitingReview.join(', ')}</b>, but no approved specialist mapping yet, so patients see no doctors for it. Approve mappings in Conditions &amp; Mappings.</p>}
            <ul className="mt-3 space-y-1 text-sm">{d.specialities.map((s) => <li key={s.code} className="flex justify-between"><span>{s.name} {s.because && <span className="text-xs text-grey-500">for {s.because}</span>}</span><span className="tnum text-grey-600">{s.doctors} doctors</span></li>)}</ul>
          </Card>
          <Card title="What Patients See">
            <Group label="Doctors" items={d.doctors.map((x) => `${x.name}${x.specialities[0] ? ` · ${x.specialities[0]}` : ''}${x.matchedByName ? ' (by name)' : ''}`)} />
            <Group label="Hospitals, Labs & Pharmacies" items={d.places.map((x) => x.name)} />
            <Group label="Tests" items={d.tests.map((x) => `${x.name} · ${x.providers} providers${x.fromMinor != null ? ` · from ${money(x.fromMinor)}` : ''}`)} />
            <Group label="Medicines" items={d.medicines.map((x) => `${x.name} · ${x.pharmacies} pharmacies`)} />
          </Card>
        </div>
      ))}
    </div>
  );
}

function Group({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold text-grey-500">{label} <Badge>{items.length}</Badge></p>
      {items.length ? <ul className="space-y-0.5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-grey-400">None</p>}
    </div>
  );
}
