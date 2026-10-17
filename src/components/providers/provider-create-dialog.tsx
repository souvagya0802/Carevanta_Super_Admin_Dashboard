'use client';

import Link from 'next/link';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Ambulance, Building2, CheckCircle2, FileCheck2, FlaskConical, GraduationCap, MapPin, Pill, Plus, ShieldCheck, Stethoscope, Trash2, Upload, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAction, useGet } from '@/lib/hooks';
import { councilSuggestions, useStates } from '@/lib/geo';
import { DOCUMENT_TYPES, PROVIDER_TYPES, type ProviderType } from '@/lib/providers-meta';
import { title } from '@/lib/format';
import { Badge, Button, Checkbox, Dialog, Field, FormSection, Input, Select, Stepper, Textarea, cx } from '@/components/ui/primitives';
import { PracticeLocations, toLocationPayload, validateLocation, type LocationDraft, type LocationErrors, type Region } from '@/components/forms/practice-locations';

/* ─── Reference lists ─────────────────────────────────────────────────────── */
const LANGUAGES = ['English', 'Hindi', 'Bengali', 'Odia', 'Assamese', 'Nepali', 'Santali', 'Urdu', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Punjabi'];
const ACCREDITATIONS = [
  { code: 'NABH', label: 'NABH (hospital accreditation)' },
  { code: 'NABL', label: 'NABL (laboratory accreditation)' },
  { code: 'NABH_ENTRY_LEVEL', label: 'NABH entry level' },
  { code: 'JCI', label: 'JCI' },
  { code: 'ISO_9001', label: 'ISO 9001' },
];
/** What the location list is called per provider type — matches how each business talks about its sites. */
const LOCATION_NOUN: Record<ProviderType, { noun: string; title: string; hint: string }> = {
  DOCTOR: { noun: 'chamber', title: 'Practice Locations', hint: 'Where the doctor sits: every clinic, hospital chamber or own practice. Pick the spot on the map and the address fills in; one chamber is primary.' },
  HOSPITAL: { noun: 'branch', title: 'Campus & Branches', hint: 'Main campus first, then any branches. Patients are routed by distance from these pins.' },
  CLINIC: { noun: 'branch', title: 'Clinic Locations', hint: 'The clinic and any branches. Pick the entrance on the map so patients and ambulances find the right door.' },
  DIAGNOSTIC_LAB: { noun: 'centre', title: 'Laboratory & Collection Centres', hint: 'The main laboratory plus walk-in collection centres. Home-collection coverage is configured later from the provider page.' },
  IMAGING_CENTRE: { noun: 'centre', title: 'Imaging Centres', hint: 'Each centre where scans are performed. Licences such as AERB and PCPNDT are per premises — upload them in the next step.' },
  PHARMACY: { noun: 'branch', title: 'Store Locations', hint: 'Each licensed store. A drug licence is issued per premises, so add every branch that will take orders.' },
  AMBULANCE_OPERATOR: { noun: 'base station', title: 'Base Stations', hint: 'Where vehicles are stationed. Dispatch searches outward from these pins; add every garage or stand.' },
};

/* ─── Step 1 schema ───────────────────────────────────────────────────────── */
const phone = z.string().trim().regex(/^(\+[1-9]\d{7,14}|[6-9]\d{9})?$/, 'Use +91… or a 10-digit mobile');
const year = z.string().trim().regex(/^(19[5-9]\d|20\d\d|2100)?$/, 'Enter a 4-digit year');
const Schema = z
  .object({
    type: z.enum(PROVIDER_TYPES),
    legalName: z.string().trim().min(2, 'At least 2 characters').max(200),
    displayName: z.string().trim().min(2, 'At least 2 characters').max(200),
    description: z.string().max(4000),
    contactEmail: z.string().trim().email('Invalid email').or(z.literal('')),
    contactPhone: phone,
    gstin: z.string().trim().toUpperCase().regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, 'Invalid GSTIN'),
    registrationNumber: z.string().trim().max(80),
    ownerMode: z.enum(['none', 'new', 'existing']),
    ownerFullName: z.string().trim().max(160),
    ownerEmail: z.string().trim().email('Invalid email').or(z.literal('')),
    ownerPhone: phone,
    ownerUserId: z.string().trim(),
    // Doctor
    gender: z.enum(['', 'FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']),
    yearsOfExperience: z.string(),
    languages: z.array(z.string()),
    defaultFee: z.string(),
    bio: z.string().max(4000),
    specialityCodes: z.array(z.string()),
    primarySpecialityCode: z.string(),
    qualifications: z.array(z.object({ degree: z.string().trim().max(120), institution: z.string().trim().max(200), yearAwarded: year })),
    council: z.string().trim().max(160),
    registrationNo: z.string().trim().max(64),
    registrationYear: year,
    registrationValidUntil: z.string(),
    // Hospital / clinic
    ownershipType: z.enum(['PRIVATE', 'GOVERNMENT', 'TRUST_OR_NGO', 'OTHER']),
    bedCount: z.string(),
    icuBedCount: z.string(),
    hasEmergency: z.boolean(),
    isOpen24x7: z.boolean(),
    establishmentRegistrationNo: z.string().trim().max(80),
    establishmentRegistrationAuth: z.string().trim().max(160),
    accreditations: z.array(z.string()),
    otherAccreditation: z.string().trim().max(64),
    // Diagnostics / imaging
    offersPathology: z.boolean(),
    offersImaging: z.boolean(),
    homeCollectionAvailable: z.boolean(),
    nablCertificateNo: z.string().trim().max(80),
    nablScope: z.string().max(1000),
    aerbLicenseNo: z.string().trim().max(80),
    pcpndtRegistrationNo: z.string().trim().max(80),
    typicalTurnaroundHours: z.string(),
    // Pharmacy
    retailDrugLicenseNo: z.string().trim().max(80),
    wholesaleDrugLicenseNo: z.string().trim().max(80),
    drugLicenseValidUntil: z.string(),
    pharmacistName: z.string().trim().max(160),
    pharmacistRegistrationNo: z.string().trim().max(80),
    homeDeliveryAvailable: z.boolean(),
    // Ambulance
    dispatchPhone: phone,
    fleetSize: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.contactEmail && !v.contactPhone) ctx.addIssue({ code: 'custom', path: ['contactPhone'], message: 'A contact phone or email is required' });
    if (v.type === 'DOCTOR') {
      if (v.ownerMode === 'none') ctx.addIssue({ code: 'custom', path: ['ownerMode'], message: 'A doctor must be linked to a login account' });
      if (!v.council) ctx.addIssue({ code: 'custom', path: ['council'], message: 'Medical council is required' });
      if (!v.registrationNo) ctx.addIssue({ code: 'custom', path: ['registrationNo'], message: 'Registration number is required' });
      if (v.specialityCodes.length === 0) ctx.addIssue({ code: 'custom', path: ['specialityCodes'], message: 'Choose at least one speciality' });
      if (v.primarySpecialityCode && !v.specialityCodes.includes(v.primarySpecialityCode)) ctx.addIssue({ code: 'custom', path: ['primarySpecialityCode'], message: 'Primary speciality must be one of the selected specialities' });
      v.qualifications.forEach((q, i) => {
        if ((q.degree && !q.institution) || (!q.degree && q.institution)) ctx.addIssue({ code: 'custom', path: ['qualifications', i, q.degree ? 'institution' : 'degree'], message: 'Both degree and institution are needed' });
      });
    }
    if (v.ownerMode === 'new' && !v.ownerFullName) ctx.addIssue({ code: 'custom', path: ['ownerFullName'], message: 'Required' });
    if (v.ownerMode === 'new' && !v.ownerEmail && !v.ownerPhone) ctx.addIssue({ code: 'custom', path: ['ownerEmail'], message: 'Email or mobile required' });
    if (v.ownerMode === 'existing' && !v.ownerUserId) ctx.addIssue({ code: 'custom', path: ['ownerUserId'], message: 'Required' });
    if ((v.type === 'DIAGNOSTIC_LAB' || v.type === 'IMAGING_CENTRE') && !v.offersPathology && !v.offersImaging) ctx.addIssue({ code: 'custom', path: ['offersPathology'], message: 'Select at least one service line' });
    if (v.type === 'AMBULANCE_OPERATOR' && !v.dispatchPhone && !v.contactPhone) ctx.addIssue({ code: 'custom', path: ['dispatchPhone'], message: 'A dispatch number is required so requests can reach the operator' });
  });
type Values = z.infer<typeof Schema>;

function defaults(type: ProviderType): Values {
  return {
    type, legalName: '', displayName: '', description: '', contactEmail: '', contactPhone: '', gstin: '', registrationNumber: '',
    ownerMode: type === 'DOCTOR' ? 'new' : 'none', ownerFullName: '', ownerEmail: '', ownerPhone: '', ownerUserId: '',
    gender: '', yearsOfExperience: '', languages: ['English', 'Bengali', 'Hindi'], defaultFee: '', bio: '', specialityCodes: [], primarySpecialityCode: '',
    qualifications: [{ degree: '', institution: '', yearAwarded: '' }], council: '', registrationNo: '', registrationYear: '', registrationValidUntil: '',
    ownershipType: 'PRIVATE', bedCount: '', icuBedCount: '', hasEmergency: false, isOpen24x7: false, establishmentRegistrationNo: '', establishmentRegistrationAuth: '', accreditations: [], otherAccreditation: '',
    offersPathology: type === 'DIAGNOSTIC_LAB', offersImaging: type === 'IMAGING_CENTRE', homeCollectionAvailable: false, nablCertificateNo: '', nablScope: '', aerbLicenseNo: '', pcpndtRegistrationNo: '', typicalTurnaroundHours: '',
    retailDrugLicenseNo: '', wholesaleDrugLicenseNo: '', drugLicenseValidUntil: '', pharmacistName: '', pharmacistRegistrationNo: '', homeDeliveryAvailable: false,
    dispatchPhone: '', fleetSize: '',
  };
}

function toPayload(v: Values, locations: LocationDraft[]) {
  const num = (s: string) => (s === '' ? undefined : Number(s));
  const str = (s: string) => (s.trim() === '' ? undefined : s.trim());
  const owner = v.ownerMode === 'existing' ? { existingUserId: v.ownerUserId } : v.ownerMode === 'new' ? { fullName: v.ownerFullName, email: v.ownerEmail || undefined, phone: v.ownerPhone || undefined } : undefined;
  const base = {
    type: v.type, legalName: v.legalName, displayName: v.displayName, description: str(v.description), contactEmail: str(v.contactEmail), contactPhone: str(v.contactPhone), gstin: str(v.gstin), registrationNumber: str(v.registrationNumber), owner,
    locations: locations.length ? locations.map(toLocationPayload) : undefined,
  };
  switch (v.type) {
    case 'DOCTOR':
      return {
        ...base,
        doctor: {
          gender: v.gender || undefined,
          yearsOfExperience: num(v.yearsOfExperience),
          languages: v.languages,
          defaultFeeMinor: v.defaultFee ? Math.round(Number(v.defaultFee) * 100) : undefined,
          bio: str(v.bio),
          specialityCodes: v.specialityCodes,
          primarySpecialityCode: v.primarySpecialityCode || v.specialityCodes[0],
          qualifications: v.qualifications.filter((q) => q.degree && q.institution).map((q) => ({ degree: q.degree, institution: q.institution, yearAwarded: num(q.yearAwarded) })),
          registrations: [{ council: v.council, registrationNumber: v.registrationNo, registrationYear: num(v.registrationYear), validUntil: v.registrationValidUntil || undefined }],
        },
      };
    case 'HOSPITAL': case 'CLINIC':
      return { ...base, facility: { ownershipType: v.ownershipType, bedCount: num(v.bedCount), icuBedCount: num(v.icuBedCount), hasEmergency: v.hasEmergency, isOpen24x7: v.isOpen24x7, establishmentRegistrationNo: str(v.establishmentRegistrationNo), establishmentRegistrationAuth: str(v.establishmentRegistrationAuth), accreditations: [...v.accreditations, ...(v.otherAccreditation ? [v.otherAccreditation.toUpperCase().replace(/\s+/g, '_')] : [])] } };
    case 'DIAGNOSTIC_LAB': case 'IMAGING_CENTRE':
      return { ...base, diagnostic: { offersPathology: v.offersPathology, offersImaging: v.offersImaging, homeCollectionAvailable: v.homeCollectionAvailable, establishmentRegistrationNo: str(v.establishmentRegistrationNo), nablCertificateNo: str(v.nablCertificateNo), nablScope: str(v.nablScope), aerbLicenseNo: str(v.aerbLicenseNo), pcpndtRegistrationNo: str(v.pcpndtRegistrationNo), typicalTurnaroundHours: num(v.typicalTurnaroundHours) } };
    case 'PHARMACY':
      return { ...base, pharmacy: { retailDrugLicenseNo: str(v.retailDrugLicenseNo), wholesaleDrugLicenseNo: str(v.wholesaleDrugLicenseNo), drugLicenseValidUntil: v.drugLicenseValidUntil || undefined, pharmacistName: str(v.pharmacistName), pharmacistRegistrationNo: str(v.pharmacistRegistrationNo), homeDeliveryAvailable: v.homeDeliveryAvailable } };
    case 'AMBULANCE_OPERATOR':
      return { ...base, ambulance: { dispatchPhone: str(v.dispatchPhone), isOpen24x7: v.isOpen24x7, fleetSize: num(v.fleetSize) } };
  }
}

/** Documents suggested per provider type — matches the verification checks the API will require. */
const SUGGESTED_DOCS: Record<ProviderType, string[]> = {
  DOCTOR: ['MEDICAL_REGISTRATION_CERTIFICATE', 'DEGREE_CERTIFICATE', 'IDENTITY_PROOF'],
  HOSPITAL: ['CLINICAL_ESTABLISHMENT_REGISTRATION', 'TRADE_LICENSE', 'GST_CERTIFICATE', 'FIRE_NOC', 'BIOMEDICAL_WASTE_AUTHORISATION'],
  CLINIC: ['CLINICAL_ESTABLISHMENT_REGISTRATION', 'TRADE_LICENSE', 'GST_CERTIFICATE'],
  DIAGNOSTIC_LAB: ['CLINICAL_ESTABLISHMENT_REGISTRATION', 'NABL_ACCREDITATION', 'GST_CERTIFICATE'],
  IMAGING_CENTRE: ['CLINICAL_ESTABLISHMENT_REGISTRATION', 'AERB_LICENSE', 'PCPNDT_REGISTRATION', 'GST_CERTIFICATE'],
  PHARMACY: ['DRUG_LICENSE', 'PHARMACIST_REGISTRATION', 'GST_CERTIFICATE', 'TRADE_LICENSE'],
  AMBULANCE_OPERATOR: ['IDENTITY_PROOF', 'VEHICLE_REGISTRATION_CERTIFICATE', 'VEHICLE_INSURANCE', 'VEHICLE_PERMIT', 'DRIVING_LICENSE'],
};

interface UploadedDoc { id: string; documentType: string; fileName: string; sizeBytes: number; expiresAt: string | null }

const TYPE_ICONS: Record<ProviderType, typeof Building2> = {
  DOCTOR: Stethoscope, HOSPITAL: Building2, CLINIC: Building2, DIAGNOSTIC_LAB: FlaskConical, IMAGING_CENTRE: FlaskConical, PHARMACY: Pill, AMBULANCE_OPERATOR: Ambulance,
};

/* ─── Small building blocks ───────────────────────────────────────────────── */
function ChipGroup({ options, value, onChange, columns = 'md:grid-cols-3 xl:grid-cols-5' }: { options: { code: string; label: string }[]; value: string[]; onChange: (next: string[]) => void; columns?: string }) {
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className={cx('grid gap-2 sm:grid-cols-2', columns)}>
      {options.map((o) => {
        const on = value.includes(o.code);
        return (
          <label key={o.code} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', on ? 'border-ink bg-ink text-paper' : 'border-grey-200 bg-paper hover:bg-grey-50')}>
            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(o.code)} />
            <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]', on ? 'border-paper bg-paper text-ink' : 'border-grey-300')}>{on ? '✓' : ''}</span>
            <span className="truncate">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/* ─── Dialog ──────────────────────────────────────────────────────────────── */
type DialogProps = { open: boolean; onClose: () => void; initialType?: ProviderType; onCreated?: (id: string) => void };

/** Remounts the form each time the dialog opens so every field, step and location starts fresh. */
export function ProviderCreateDialog(props: DialogProps) {
  return <ProviderCreateDialogInner key={props.open ? 'open' : 'closed'} {...props} />;
}

function ProviderCreateDialogInner({ open, onClose, initialType = 'HOSPITAL', onCreated }: DialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState('');
  const [locations, setLocations] = useState<LocationDraft[]>([]);
  const [locationErrors, setLocationErrors] = useState<Record<string, LocationErrors>>({});
  const regions = useGet<Region[]>(open ? '/admin/regions' : null);
  const specialities = useGet<{ code: string; name: string }[]>(open ? '/admin/catalogue/specialities' : null);
  const form = useForm<Values>({ resolver: zodResolver(Schema), defaultValues: defaults(initialType) });
  const type = useWatch({ control: form.control, name: 'type' });
  const ownerMode = useWatch({ control: form.control, name: 'ownerMode' });
  const specialityCodes = useWatch({ control: form.control, name: 'specialityCodes' });
  const languages = useWatch({ control: form.control, name: 'languages' });
  const accreditations = useWatch({ control: form.control, name: 'accreditations' });
  const offersImaging = useWatch({ control: form.control, name: 'offersImaging' });
  const qualifications = useFieldArray({ control: form.control, name: 'qualifications' });
  const states = useStates();
  const primaryState = locations.find((l) => l.isPrimary)?.address.state ?? locations[0]?.address.state ?? '';
  const loc = LOCATION_NOUN[type];

  const create = useAction((v: Values) => api.post<{ data: { id: string; displayName: string } }>('/admin/providers', toPayload(v, locations)), {
    success: 'Provider created in DRAFT — now add its documents',
    invalidate: ['/admin/providers'],
    onSuccess: (r) => { setProviderId(r.data.id); setCreatedName(r.data.displayName); setStep(2); onCreated?.(r.data.id); },
    onError: (e) => {
      if (!(e instanceof ApiError)) return;
      const locErrs: Record<string, LocationErrors> = {};
      for (const [k, m] of Object.entries(e.fieldErrors)) {
        const loc = /^locations\.(\d+)\.(\w+)$/.exec(k);
        if (loc) {
          const key = locations[Number(loc[1])]?.key;
          if (key) locErrs[key] = { ...locErrs[key], [loc[2] as keyof LocationErrors]: m };
        } else {
          form.setError(k.split('.').pop() as keyof Values, { message: m });
        }
      }
      if (Object.keys(locErrs).length) setLocationErrors(locErrs);
    },
  });

  const submit = () => {
    const errs: Record<string, LocationErrors> = {};
    for (const l of locations) { const e = validateLocation(l); if (Object.keys(e).length) errs[l.key] = e; }
    setLocationErrors(errs);
    void form.handleSubmit((v) => { if (Object.keys(errs).length === 0) create.mutate(v); })();
  };

  const err = (k: keyof Values) => form.formState.errors[k]?.message as string | undefined;
  const r = form.register;
  const dirty = (form.formState.isDirty || locations.length > 0) && step === 1;
  const close = () => {
    if (dirty && !window.confirm('Discard this unsaved provider?')) return;
    onClose();
  };
  const onTypeChange = (next: ProviderType) => {
    form.setValue('type', next);
    form.setValue('ownerMode', next === 'DOCTOR' ? 'new' : form.getValues('ownerMode'));
    if (next === 'DIAGNOSTIC_LAB' || next === 'IMAGING_CENTRE') {
      form.setValue('offersPathology', next === 'DIAGNOSTIC_LAB');
      form.setValue('offersImaging', next === 'IMAGING_CENTRE');
    }
  };

  const TypeIcon = TYPE_ICONS[type];
  const specialityOptions = (specialities.data ?? []).map((s) => ({ code: s.code, label: s.name }));

  return (
    <Dialog
      open={open}
      onClose={close}
      size="full"
      icon={step === 3 ? CheckCircle2 : step === 2 ? FileCheck2 : TypeIcon}
      title={step === 1 ? `Register ${title(type)}` : step === 2 ? `Documents — ${createdName}` : 'Provider Registered'}
      description={step === 1 ? 'Step 1 of 3 · Identity, professional details and locations. The provider is created in DRAFT.' : step === 2 ? 'Step 2 of 3 · Upload the licences and certificates the verification team will check.' : 'Step 3 of 3 · Submit for verification from the provider page when the documents are complete.'}
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={submit} loading={create.isPending}>Create and Continue to Documents</Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="ghost" onClick={() => setStep(3)}>Skip for Now</Button>
            <Button onClick={() => setStep(3)}>Finish</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => { form.reset(defaults(type)); setLocations([]); setLocationErrors({}); setStep(1); setProviderId(null); }}>Register Another</Button>
            <Link href={`/providers/${providerId}`}><Button onClick={onClose}>Open Provider</Button></Link>
          </>
        )
      }
    >
      <Stepper steps={['Details', 'Documents', 'Done']} current={step} />

      {step === 1 && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="space-y-4">
          <FormSection title="Provider Type" icon={TypeIcon} accent="blue" hint="Determines the sections below and the documents required for verification.">
            <Field label="Type" required className="max-w-sm"><Select value={type} onChange={(e) => onTypeChange(e.target.value as ProviderType)}>{PROVIDER_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
          </FormSection>

          <FormSection title={type === 'DOCTOR' ? 'Identity' : 'Organisation'} icon={type === 'DOCTOR' ? UserRound : Building2} accent="purple" hint={type === 'DOCTOR' ? 'The doctor\'s name as registered with the medical council, and how patients will see it.' : 'Legal identity as it appears on registrations and invoices.'}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label={type === 'DOCTOR' ? 'Full Name (as Registered)' : 'Legal Name'} required error={err('legalName')}><Input placeholder={type === 'DOCTOR' ? 'Dr. Anirban Maity' : ''} {...r('legalName')} /></Field>
              <Field label="Display Name" required error={err('displayName')} hint="Shown to patients"><Input {...r('displayName')} /></Field>
              <Field label="Contact Phone" error={err('contactPhone')}><Input inputMode="tel" {...r('contactPhone')} /></Field>
              <Field label="Contact Email" error={err('contactEmail')}><Input type="email" {...r('contactEmail')} /></Field>
              {type !== 'DOCTOR' && <Field label="GSTIN" error={err('gstin')} hint="15 characters, if registered for GST"><Input {...r('gstin')} /></Field>}
              {type !== 'DOCTOR' && <Field label={type === 'AMBULANCE_OPERATOR' ? 'Business Registration No.' : 'Government Registration No.'} error={err('registrationNumber')} hint={type === 'PHARMACY' ? 'Shop & Establishment or trade licence' : type === 'AMBULANCE_OPERATOR' ? 'Udyam, company or partnership registration' : 'Company, society or trust registration'}><Input {...r('registrationNumber')} /></Field>}
              <Field label={type === 'DOCTOR' ? 'Short Introduction' : 'Description'} className="md:col-span-2 xl:col-span-3" hint={type === 'DOCTOR' ? 'Shown on the profile, e.g. areas of interest' : 'Shown on the public listing'}><Textarea {...r(type === 'DOCTOR' ? 'bio' : 'description')} /></Field>
            </div>
          </FormSection>

          <FormSection title={type === 'DOCTOR' ? 'Login Account' : 'Owner / Authorised User'} icon={ShieldCheck} accent="teal" hint={type === 'DOCTOR' ? 'The doctor signs in with this account to manage schedules and appointments.' : 'Who signs in to manage this provider. Staff can be added later.'}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Account" error={err('ownerMode')}>
                <Select {...r('ownerMode')}>
                  {type !== 'DOCTOR' && <option value="none">Add Later</option>}
                  <option value="new">Invite a New Account</option>
                  <option value="existing">Link an Existing User</option>
                </Select>
              </Field>
              {ownerMode === 'new' && (<>
                <Field label="Full Name" required error={err('ownerFullName')}><Input {...r('ownerFullName')} /></Field>
                <Field label="Email" error={err('ownerEmail')} hint="The invitation is sent here"><Input type="email" {...r('ownerEmail')} /></Field>
                <Field label="Mobile" error={err('ownerPhone')}><Input inputMode="tel" {...r('ownerPhone')} /></Field>
              </>)}
              {ownerMode === 'existing' && <Field label="User ID" required error={err('ownerUserId')} hint="Paste the ID from the Users page"><Input {...r('ownerUserId')} /></Field>}
            </div>
            {type === 'DOCTOR' && <p className="mt-2 text-xs text-grey-500">A doctor has exactly one identity on the platform. If this doctor already exists, link the existing user instead of creating a duplicate.</p>}
          </FormSection>

          {type === 'DOCTOR' && (<>
            <FormSection title="Specialities" icon={Stethoscope} accent="green" hint="Pick every speciality the doctor practises; the primary one leads the profile. Only verified specialities are shown to patients.">
              {specialities.isPending ? <p className="text-sm text-grey-500">Loading specialities…</p> : specialityOptions.length === 0 ? <p className="text-sm text-grey-500">No specialities in the catalogue yet — add them under Departments &amp; Services.</p> : (
                <ChipGroup options={specialityOptions} value={specialityCodes} onChange={(next) => { form.setValue('specialityCodes', next, { shouldValidate: form.formState.isSubmitted }); if (!next.includes(form.getValues('primarySpecialityCode'))) form.setValue('primarySpecialityCode', next[0] ?? ''); }} />
              )}
              {err('specialityCodes') && <p role="alert" className="mt-2 text-xs text-red">{err('specialityCodes')}</p>}
              {specialityCodes.length > 1 && (
                <Field label="Primary Speciality" className="mt-3 max-w-sm" error={err('primarySpecialityCode')}>
                  <Select {...r('primarySpecialityCode')}>{specialityCodes.map((c) => <option key={c} value={c}>{specialityOptions.find((o) => o.code === c)?.label ?? c}</option>)}</Select>
                </Field>
              )}
            </FormSection>

            <FormSection title="Medical Council Registration" icon={ShieldCheck} accent="orange" hint="Verified against the state medical council or the National Medical Register before the doctor goes live.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Medical Council" required error={err('council')} className="xl:col-span-2" hint="State council or the National Medical Commission"><Input list="medical-councils" placeholder={primaryState ? `${primaryState} Medical Council` : 'Start typing…'} {...r('council')} /><datalist id="medical-councils">{councilSuggestions(states.data).map((c) => <option key={c} value={c} />)}</datalist></Field>
                <Field label="Registration Number" required error={err('registrationNo')}><Input {...r('registrationNo')} /></Field>
                <Field label="Registration Year" error={err('registrationYear')}><Input inputMode="numeric" placeholder="2012" {...r('registrationYear')} /></Field>
                <Field label="Valid Until" hint="If the council issues renewable registrations"><Input type="date" {...r('registrationValidUntil')} /></Field>
              </div>
            </FormSection>

            <FormSection title="Qualifications & Experience" icon={GraduationCap} accent="blue" hint="Degrees in the order they were awarded; the certificate for each is uploaded in the next step.">
              <div className="space-y-2">
                {qualifications.fields.map((f, i) => (
                  <div key={f.id} className="grid gap-3 md:grid-cols-[1fr_2fr_120px_auto]">
                    <Field label={i === 0 ? 'Degree' : ''} error={form.formState.errors.qualifications?.[i]?.degree?.message}><Input placeholder="MBBS, MD, DNB…" {...r(`qualifications.${i}.degree`)} /></Field>
                    <Field label={i === 0 ? 'Institution' : ''} error={form.formState.errors.qualifications?.[i]?.institution?.message}><Input placeholder="University or college" {...r(`qualifications.${i}.institution`)} /></Field>
                    <Field label={i === 0 ? 'Year' : ''} error={form.formState.errors.qualifications?.[i]?.yearAwarded?.message}><Input inputMode="numeric" {...r(`qualifications.${i}.yearAwarded`)} /></Field>
                    <div className={cx('flex items-end', i === 0 && 'pb-0')}><Button type="button" variant="ghost" size="sm" className="h-10 text-red" aria-label="Remove qualification" onClick={() => qualifications.remove(i)} disabled={qualifications.fields.length === 1}><Trash2 size={14} /></Button></div>
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" onClick={() => qualifications.append({ degree: '', institution: '', yearAwarded: '' })}><Plus size={14} aria-hidden /> Add Qualification</Button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Years of Experience"><Input type="number" min={0} max={70} {...r('yearsOfExperience')} /></Field>
                <Field label="Gender"><Select {...r('gender')}><option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select></Field>
                <Field label="Default Consultation Fee (₹)" hint="Can differ per chamber later"><Input type="number" min={0} step="1" {...r('defaultFee')} /></Field>
              </div>
              <Field label="Languages Spoken" className="mt-3" hint="Helps patients pick a doctor they can talk to">
                <ChipGroup options={LANGUAGES.map((l) => ({ code: l, label: l }))} value={languages} onChange={(next) => form.setValue('languages', next)} />
              </Field>
            </FormSection>
          </>)}

          {(type === 'HOSPITAL' || type === 'CLINIC') && (
            <FormSection title="Facility Details" icon={Building2} accent="green" hint="Registration under the Clinical Establishments Act (or the state equivalent) is checked during verification.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Ownership"><Select {...r('ownershipType')}>{['PRIVATE', 'GOVERNMENT', 'TRUST_OR_NGO', 'OTHER'].map((o) => <option key={o} value={o}>{title(o)}</option>)}</Select></Field>
                <Field label="Clinical Establishment Reg. No."><Input {...r('establishmentRegistrationNo')} /></Field>
                <Field label="Registering Authority" hint="e.g. CMOH Purba Medinipur" className="xl:col-span-2"><Input {...r('establishmentRegistrationAuth')} /></Field>
                {type === 'HOSPITAL' && <Field label="Inpatient Beds"><Input type="number" min={0} {...r('bedCount')} /></Field>}
                {type === 'HOSPITAL' && <Field label="ICU Beds"><Input type="number" min={0} {...r('icuBedCount')} /></Field>}
                {type === 'CLINIC' && <Field label="Observation / Day-Care Beds" hint="0 for consultation-only clinics"><Input type="number" min={0} {...r('bedCount')} /></Field>}
                <div className="flex flex-col justify-end gap-2 pb-1 md:col-span-2"><Checkbox label="Has an emergency / casualty department" {...r('hasEmergency')} /><Checkbox label="Open 24×7" {...r('isOpen24x7')} /></div>
              </div>
              <Field label="Accreditations" className="mt-3" hint="Only accreditations you can evidence with a certificate in the next step">
                <ChipGroup options={ACCREDITATIONS} value={accreditations} onChange={(next) => form.setValue('accreditations', next)} columns="md:grid-cols-3" />
              </Field>
              <Field label="Other Accreditation" className="mt-3 max-w-sm"><Input placeholder="e.g. NABH Nursing Excellence" {...r('otherAccreditation')} /></Field>
            </FormSection>
          )}

          {(type === 'DIAGNOSTIC_LAB' || type === 'IMAGING_CENTRE') && (<>
            <FormSection title="Service Lines" icon={FlaskConical} accent="green" hint="What this centre performs. The test catalogue and prices are configured from the provider page after approval.">
              <div className="grid gap-2 md:grid-cols-3">
                <Checkbox label="Pathology (blood, urine, biochemistry, microbiology)" {...r('offersPathology')} />
                <Checkbox label="Imaging (X-ray, ultrasound, CT, MRI)" {...r('offersImaging')} />
                <Checkbox label="Home sample collection" {...r('homeCollectionAvailable')} />
              </div>
              {err('offersPathology') && <p role="alert" className="mt-2 text-xs text-red">{err('offersPathology')}</p>}
              <Field label="Typical Report Turnaround (Hours)" className="mt-3 max-w-xs" hint="Shown to patients as an estimate"><Input type="number" min={1} max={720} {...r('typicalTurnaroundHours')} /></Field>
            </FormSection>
            <FormSection title="Licensing & Accreditation" icon={ShieldCheck} accent="orange" hint="Each licence is verified against the issuing authority. Leave blank what does not apply.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Clinical Establishment Reg. No."><Input {...r('establishmentRegistrationNo')} /></Field>
                <Field label="NABL Certificate No." hint="ISO 15189 accreditation, if held"><Input {...r('nablCertificateNo')} /></Field>
                <Field label="NABL Scope" className="md:col-span-2" hint="Disciplines covered by the accreditation"><Input placeholder="Clinical biochemistry, haematology…" {...r('nablScope')} /></Field>
                <Field label="AERB Licence No." hint={offersImaging ? 'Required for X-ray, CT and mammography equipment' : 'Only if radiation equipment is operated'}><Input {...r('aerbLicenseNo')} /></Field>
                <Field label="PC-PNDT Registration No." hint={offersImaging ? 'Required for every ultrasound machine' : 'Only if ultrasound is offered'}><Input {...r('pcpndtRegistrationNo')} /></Field>
              </div>
            </FormSection>
          </>)}

          {type === 'PHARMACY' && (
            <FormSection title="Drug Licensing" icon={Pill} accent="green" hint="Licences under the Drugs and Cosmetics Rules are issued per premises by the State Drugs Control authority. The registered pharmacist must be present during dispensing.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Retail Drug Licence No." hint="Form 20 / 21"><Input {...r('retailDrugLicenseNo')} /></Field>
                <Field label="Wholesale Drug Licence No." hint="Form 20B / 21B, if any"><Input {...r('wholesaleDrugLicenseNo')} /></Field>
                <Field label="Licence Valid Until" required><Input type="date" {...r('drugLicenseValidUntil')} /></Field>
                <Field label="Registered Pharmacist" hint="Name as on the Pharmacy Council register"><Input {...r('pharmacistName')} /></Field>
                <Field label="Pharmacist Registration No." hint="State Pharmacy Council"><Input {...r('pharmacistRegistrationNo')} /></Field>
                <div className="flex items-end pb-2 md:col-span-2 xl:col-span-3"><Checkbox label="Home delivery (Schedule H / H1 delivery is enabled only after legal review)" {...r('homeDeliveryAvailable')} /></div>
              </div>
            </FormSection>
          )}

          {type === 'AMBULANCE_OPERATOR' && (
            <FormSection title="Dispatch & Fleet" icon={Ambulance} accent="green" hint="The dispatch number receives requests when the app cannot reach the operator. Vehicles, crew and permits are added per vehicle on the provider page.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Dispatch Phone" required error={err('dispatchPhone')} hint="Answered 24×7 if the operator is marked 24×7"><Input inputMode="tel" {...r('dispatchPhone')} /></Field>
                <Field label="Fleet Size" hint="Vehicles currently in service"><Input type="number" min={0} {...r('fleetSize')} /></Field>
                <div className="flex items-end pb-2"><Checkbox label="Operates 24×7" {...r('isOpen24x7')} /></div>
              </div>
              <p className="mt-3 text-xs text-grey-500">Each vehicle needs its registration certificate, insurance, fitness certificate, permit and the driver&apos;s licence before it can be dispatched. Add them under Vehicles once the operator is created.</p>
            </FormSection>
          )}

          <FormSection title={loc.title} icon={MapPin} accent="orange" hint={loc.hint}>
            <PracticeLocations value={locations} onChange={(next) => { setLocations(next); if (Object.keys(locationErrors).length) setLocationErrors({}); }} regions={regions.data} regionsLoading={regions.isPending} errors={locationErrors} noun={loc.noun} />
            {locations.length === 0 && <p className="mt-3 text-xs text-grey-500">You can also add {loc.noun}s later from the provider page, but at least one active location is required before verification.</p>}
          </FormSection>
        </form>
      )}

      {step === 2 && providerId && <DocumentsStep providerId={providerId} type={type} />}

      {step === 3 && (
        <div className="flex flex-col items-center rounded-2xl border border-grey-200 bg-paper py-12 text-center shadow-[var(--shadow-card)]">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-soft text-green"><CheckCircle2 size={32} aria-hidden /></span>
          <p className="mt-4 text-lg font-semibold">{createdName} is registered in DRAFT</p>
          <p className="mt-1 max-w-md text-sm text-grey-600">{locations.length ? `${locations.length} ${loc.noun}${locations.length > 1 ? 's' : ''} saved.` : `No ${loc.noun} added yet — add one from the provider page.`} Complete the documents, then submit for verification. A verification officer other than you must approve it.</p>
        </div>
      )}
    </Dialog>
  );
}

function DocumentsStep({ providerId, type }: { providerId: string; type: ProviderType }) {
  const docs = useGet<UploadedDoc[]>(`/admin/providers/${providerId}/documents`);
  const [docType, setDocType] = useState<string>(SUGGESTED_DOCS[type][0] ?? 'OTHER');
  const [file, setFile] = useState<File | null>(null);
  const [docNo, setDocNo] = useState('');
  const [expires, setExpires] = useState('');
  const upload = useAction(async () => {
    if (!file) throw new Error('Choose a file');
    const q = new URLSearchParams({ documentType: docType, fileName: file.name, ...(docNo ? { documentNumber: docNo } : {}), ...(expires ? { expiresAt: expires } : {}) });
    return api.upload(`/admin/providers/${providerId}/documents?${q}`, file, file.type || 'application/pdf');
  }, { success: 'Document uploaded', invalidate: [`/admin/providers/${providerId}/documents`, `/admin/providers/${providerId}`], onSuccess: () => { setFile(null); setDocNo(''); setExpires(''); } });
  const uploadedTypes = new Set(docs.data?.map((d) => d.documentType));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4 rounded-2xl border border-grey-200 bg-paper p-5 shadow-[var(--shadow-card)]">
        <p className="text-sm text-grey-600">Upload the credential documents for this {title(type).toLowerCase()}. Verification officers accept or reject each one; accepted documents become evidence for the required checks.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Document Type"><Select value={docType} onChange={(e) => setDocType(e.target.value)}>{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{title(t)}{SUGGESTED_DOCS[type].includes(t) ? ' (Recommended)' : ''}</option>)}</Select></Field>
          <Field label="File" hint="PDF, JPEG or PNG · max 10 MB"><Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-1.5" /></Field>
          <Field label="Document Number"><Input value={docNo} onChange={(e) => setDocNo(e.target.value)} /></Field>
          <Field label="Expires On"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        </div>
        <Button onClick={() => upload.mutate()} loading={upload.isPending} disabled={!file}><Upload size={16} /> Upload</Button>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-grey-500">Uploaded</h3>
          {docs.data?.length ? (
            <ul className="divide-y divide-grey-200 text-sm">{docs.data.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 py-1.5"><span>{title(d.documentType)} <span className="text-xs text-grey-500">{d.fileName} · {Math.round(d.sizeBytes / 1024)} kB</span></span><Badge>UPLOADED</Badge></li>)}</ul>
          ) : <p className="text-sm text-grey-500">Nothing uploaded yet.</p>}
        </div>
      </div>
      <aside className="h-fit rounded-2xl border border-grey-200 bg-paper p-5 text-sm shadow-[var(--shadow-card)]">
        <h3 className="text-xs font-semibold uppercase text-grey-500">Recommended for {title(type)}</h3>
        <ul className="mt-2 space-y-1.5">
          {SUGGESTED_DOCS[type].map((t) => (
            <li key={t} className="flex items-center justify-between gap-2">
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setDocType(t)}>{title(t)}</button>
              {uploadedTypes.has(t) ? <CheckCircle2 size={16} className="text-green" aria-label="uploaded" /> : <span className="text-xs text-grey-400">pending</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-grey-500">You can also add documents later from the provider page. <Trash2 size={12} className="inline" aria-hidden /> Removing a document is not possible — upload a newer version and it supersedes the old one.</p>
      </aside>
    </div>
  );
}
