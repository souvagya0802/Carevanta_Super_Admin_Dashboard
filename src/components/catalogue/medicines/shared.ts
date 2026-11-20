/** Types and plain-language helpers for the Medicines tab. */

export interface Medicine {
  id: string;
  name: string;
  composition: string | null;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  manufacturer: string | null;
  route: string | null;
  code: string | null;
  genericCode?: string | null;
  compositionKey?: string | null;
  source: string;
  proposedByProviderId: string | null;
  schedule: string;
  requiresPrescription: boolean;
  isActive: boolean;
  createdAt: string;
  therapeuticClass?: string | null;
  uses?: string | null;
  howItWorks?: string | null;
  sideEffects?: string | null;
  contraindications?: string | null;
  interactions?: string | null;
  precautions?: string | null;
  storage?: string | null;
  infoSource?: string | null;
  infoUpdatedAt?: string | null;
  imageUrl?: string | null;
  imageSource?: string | null;
  imageUpdatedAt?: string | null;
  imageCredit?: string | null;
  imageLicence?: string | null;
  imageSourceUrl?: string | null;
  imageIsRepresentative?: boolean;
  stockedAt?: number;
}

export const SCHEDULES = ['OTC', 'SCHEDULE_G', 'SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X', 'OTHER'] as const;
/** Schedules the API always treats as prescription-only. */
export const RX_SCHEDULES = ['SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X'];

/** Plain words for where a medicine came from. */
export const SOURCE_LABEL: Record<string, string> = { CDCI: 'Government List', PROVIDER: 'Added by Pharmacy', MANUAL: 'Added by Admin' };

/** Short code under the "Who can buy it" choice, for experts. */
export const SCHEDULE_LABEL: Record<string, string> = {
  OTC: 'OTC (over the counter)',
  SCHEDULE_G: 'Schedule G',
  SCHEDULE_H: 'Schedule H',
  SCHEDULE_H1: 'Schedule H1',
  SCHEDULE_X: 'Schedule X (narcotic)',
  OTHER: 'Other',
};

export type WhoCanBuy = 'anyone' | 'prescription' | 'prescription_h1';

export const WHO_CAN_BUY: { value: WhoCanBuy; label: string; help: string }[] = [
  { value: 'anyone', label: 'Anyone (No Prescription)', help: 'Patients can order it without uploading a prescription. For common medicines such as pain relief or antacids.' },
  { value: 'prescription', label: 'Needs a Prescription', help: 'Patients must upload a doctor’s prescription before the pharmacy can sell it. Most antibiotics and long-term medicines.' },
  { value: 'prescription_h1', label: 'Needs a Prescription and Pharmacist Check', help: 'Stricter: the pharmacist also keeps a record of each sale (Schedule H1, for example some antibiotics and sleeping pills).' },
];

/** Which "Who can buy it" choice the stored schedule and flag mean. */
export function whoCanBuyOf(schedule: string, requiresPrescription: boolean): WhoCanBuy {
  if (schedule === 'SCHEDULE_H1') return 'prescription_h1';
  if (requiresPrescription || RX_SCHEDULES.includes(schedule)) return 'prescription';
  return 'anyone';
}

/**
 * Schedule and prescription flag for a choice. Keeps the expert schedule when it already fits the choice
 * (Schedule X stays X, G stays G), so the simple radio never silently loses detail.
 */
export function applyWhoCanBuy(choice: WhoCanBuy, current: string): { schedule: string; requiresPrescription: boolean } {
  if (choice === 'anyone') return { schedule: RX_SCHEDULES.includes(current) ? 'OTC' : current, requiresPrescription: false };
  if (choice === 'prescription_h1') return { schedule: 'SCHEDULE_H1', requiresPrescription: true };
  return { schedule: current === 'OTC' || current === 'SCHEDULE_H1' ? 'SCHEDULE_H' : current, requiresPrescription: true };
}

/** "Dolo 650 · 650 mg · Oral Tablet" */
export const medicineTitle = (m: Pick<Medicine, 'name' | 'strength' | 'dosageForm'>) => [m.name, m.strength, m.dosageForm].filter(Boolean).join(' · ');

export const hasInfo = (m: Pick<Medicine, 'uses'>) => !!m.uses?.trim();

/** Patient-information fields with a hint and an example for each. */
export const INFO_FIELDS = [
  { key: 'uses', label: 'Uses', hint: 'What the medicine is for, in everyday words.', example: 'Fever, headache, toothache and body pain.' },
  { key: 'howItWorks', label: 'How It Works', hint: 'One or two simple sentences.', example: 'It lowers the chemicals in the body that cause pain and fever.' },
  { key: 'sideEffects', label: 'Side Effects', hint: 'Common side effects first; say when to see a doctor.', example: 'Usually none. Rarely nausea or skin rash. Stop and see a doctor if a rash appears.' },
  { key: 'contraindications', label: 'When Not To Use', hint: 'People who should not take it.', example: 'Severe liver disease, or an allergy to paracetamol.' },
  { key: 'interactions', label: 'Interactions', hint: 'Other medicines, food or alcohol to avoid.', example: 'Do not take with other medicines that contain paracetamol. Avoid alcohol.' },
  { key: 'precautions', label: 'Precautions', hint: 'Pregnancy, breastfeeding, driving, kidney or liver problems.', example: 'Safe in pregnancy at the usual dose. Ask a doctor if you have liver problems.' },
  { key: 'storage', label: 'Storage', hint: 'How to keep it at home.', example: 'Store below 30 °C, away from sunlight and out of reach of children.' },
] as const;
export type InfoKey = (typeof INFO_FIELDS)[number]['key'] | 'therapeuticClass';

/** Plain words for audit actions on the History tab. */
export const HISTORY_LABEL: Record<string, string> = {
  'catalogue.medicine_created': 'Added to the catalogue',
  'catalogue.medicine_updated': 'Details changed',
  'catalogue.medicine_added_by_provider': 'Added by a pharmacy',
  'catalogue.medicine_info_updated': 'Patient information edited',
  'catalogue.medicine_info_restored': 'Government text put back',
  'catalogue.medicine_bulk_updated': 'Changed in a bulk action',
  'catalogue.medicine_merged': 'Merged into another medicine (hidden)',
  'catalogue.medicine_merge_kept': 'Kept when a duplicate was merged',
  'catalogue.medicine_photo_set': 'Photo set by Carevanta',
  'catalogue.medicine_photo_removed': 'Photo removed',
  'catalogue.medicine_photo_added_by_provider': 'Photo added by a pharmacy',
};

export const BULK_LABEL: Record<string, string> = { hide: 'Hidden from patients', show: 'Shown to patients', require_prescription: 'Marked as prescription required', no_prescription: 'Marked as no prescription needed' };

export const ATTRIBUTION = 'Medicine names from Common Drug Codes for India (CDCI), © C-DAC / NRCeS, MoHFW, CC BY 4.0.';
