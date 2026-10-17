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
/** Title Case for enum-like values: `PENDING_VERIFICATION` → `Pending Verification`. */
export const title = (s: string | null | undefined) =>
  s ? s.toLowerCase().replace(/_/g, ' ').replace(/(^|\s)\w/g, (c) => c.toUpperCase()) : '—';
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
