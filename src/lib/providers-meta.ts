export const PROVIDER_TYPES = ['DOCTOR', 'HOSPITAL', 'CLINIC', 'DIAGNOSTIC_LAB', 'IMAGING_CENTRE', 'PHARMACY', 'AMBULANCE_OPERATOR'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_SLUGS: Record<string, { type: ProviderType; title: string; singular: string; description: string }> = {
  doctors: { type: 'DOCTOR', title: 'Doctors', singular: 'Doctor', description: 'Individual practitioners. One identity per doctor, linked to facilities through affiliations.' },
  hospitals: { type: 'HOSPITAL', title: 'Hospitals', singular: 'Hospital', description: 'Multi-department facilities with inpatient capacity.' },
  clinics: { type: 'CLINIC', title: 'Clinics', singular: 'Clinic', description: 'Outpatient facilities and polyclinics.' },
  labs: { type: 'DIAGNOSTIC_LAB', title: 'Diagnostic laboratories', singular: 'Diagnostic lab', description: 'Pathology laboratories and sample-collection services.' },
  imaging: { type: 'IMAGING_CENTRE', title: 'Imaging centres', singular: 'Imaging centre', description: 'X-ray, ultrasound, CT and MRI providers.' },
  pharmacies: { type: 'PHARMACY', title: 'Pharmacies', singular: 'Pharmacy', description: 'Licensed retail pharmacies.' },
  ambulance: { type: 'AMBULANCE_OPERATOR', title: 'Ambulance operators', singular: 'Ambulance operator', description: 'Operators with verified vehicles and crew.' },
};

export const slugForType = (t: string) => Object.entries(PROVIDER_SLUGS).find(([, m]) => m.type === t)?.[0] ?? 'hospitals';

export const PROVIDER_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'] as const;

export const DOCUMENT_TYPES = [
  'MEDICAL_REGISTRATION_CERTIFICATE', 'DEGREE_CERTIFICATE', 'IDENTITY_PROOF', 'GST_CERTIFICATE', 'CLINICAL_ESTABLISHMENT_REGISTRATION', 'TRADE_LICENSE', 'DRUG_LICENSE', 'PHARMACIST_REGISTRATION', 'NABL_ACCREDITATION', 'AERB_LICENSE', 'PCPNDT_REGISTRATION', 'FIRE_NOC', 'BIOMEDICAL_WASTE_AUTHORISATION', 'VEHICLE_REGISTRATION_CERTIFICATE', 'VEHICLE_INSURANCE', 'VEHICLE_FITNESS_CERTIFICATE', 'VEHICLE_PERMIT', 'DRIVING_LICENSE', 'BANK_PROOF', 'AGREEMENT', 'OTHER',
] as const;

export const CHECK_METHODS = ['MANUAL_DOCUMENT_REVIEW', 'OFFICIAL_REGISTRY_LOOKUP', 'AUTHORISED_THIRD_PARTY_API', 'ISSUER_CONFIRMATION', 'PHYSICAL_INSPECTION'] as const;

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
