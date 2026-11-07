const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN');
const dt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const d = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** Minor units (paise) → "₹1,234.56". */
export const money = (minor: number | null | undefined, currency = 'INR') =>
  minor == null ? '—' : currency === 'INR' ? inr.format(minor / 100) : `${currency} ${(minor / 100).toFixed(2)}`;
export const count = (n: number | null | undefined) => (n == null ? '—' : num.format(n));
export const dateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '—');
export const date = (iso: string | null | undefined) => (iso ? d.format(new Date(iso)) : '—');
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
/** Words that stay upper case in labels (registries, documents, tax and payment terms). */
const ACRONYMS = new Set([
  'ABDM', 'AERB', 'ALS', 'API', 'BLS', 'CEA', 'CSV', 'CT', 'ECG', 'EEG', 'EMT', 'FCM', 'GST', 'GSTIN', 'HFR', 'HPR', 'HTTP', 'HTTPS', 'ICU', 'ID', 'IFSC', 'IMPS', 'INR', 'IPD', 'ISO',
  'KYC', 'MRI', 'NABH', 'NABL', 'NEFT', 'NMC', 'NOC', 'OPD', 'OTP', 'PAN', 'PCPNDT', 'PDF', 'PIN', 'PNDT', 'PWA', 'RTGS', 'SLA', 'SMS', 'SMTP', 'TDS', 'UPI', 'URL', 'USG', 'UTR', 'VAPID',
]);
/** Short joining words kept lower case unless they open or close the label. */
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'vs', 'with']);

/**
 * Title Case for enum-like and free-text labels, keeping acronyms upper case:
 * `PENDING_VERIFICATION` → `Pending Verification`, `GST_CERTIFICATE` → `GST Certificate`,
 * `auth.login` → `Auth Login`, `cancelled by patient` → `Cancelled by Patient`.
 */
export const title = (s: string | null | undefined) => {
  if (!s) return '—';
  const words = s.replace(/[_.]+/g, ' ').trim().split(/\s+/);
  return words
    .map((w, i) => {
      const up = w.toUpperCase();
      if (ACRONYMS.has(up.replace(/[^A-Z]/g, ''))) return up;
      const lower = w.toLowerCase();
      if (i > 0 && i < words.length - 1 && MINOR.has(lower)) return lower;
      return lower.replace(/(^|[-/(])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
    })
    .join(' ');
};
/** Alias for enum display (statuses, provider types, document kinds). */
export const label = title;
/** Ratings always show one decimal everywhere: 3.99 → "4.0". */
export const rating = (v: number | string | null | undefined) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(1);
};
const compactNum = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** Compact INR for tiles (minor units in): ₹950, ₹12.5K, ₹25.07L, ₹1.72Cr. Show `money()` in a title for the exact value. */
export const moneyCompact = (minor: number | null | undefined) => {
  if (minor == null) return '—';
  const rupees = minor / 100;
  const a = Math.abs(rupees);
  const sign = rupees < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${compactNum.format(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${compactNum.format(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${compactNum.format(a / 1e3)}K`;
  return `${sign}₹${compactNum.format(a)}`;
};
export const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');
export const minutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const relative = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
};
