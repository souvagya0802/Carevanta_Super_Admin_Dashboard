import { describe, expect, it } from 'vitest';
import { moneyCompact, rating, title } from './format';

describe('format', () => {
  it('title-cases enums and keeps acronyms upper case', () => {
    expect(title('PENDING_VERIFICATION')).toBe('Pending Verification');
    expect(title('UNDER_REVIEW')).toBe('Under Review');
    expect(title('GST_CERTIFICATE')).toBe('GST Certificate');
    expect(title('NABL_ACCREDITATION')).toBe('NABL Accreditation');
    expect(title('PCPNDT_REGISTRATION')).toBe('PCPNDT Registration');
    expect(title('CANCELLED_BY_PATIENT')).toBe('Cancelled by Patient');
    expect(title('auth.login')).toBe('Auth Login');
    expect(title('OPD_CONSULTATION')).toBe('OPD Consultation');
    expect(title('UPI')).toBe('UPI');
    expect(title(null)).toBe('—');
  });

  it('formats ratings with one decimal', () => {
    expect(rating(3.99)).toBe('4.0');
    expect(rating('4.25')).toBe('4.3');
    expect(rating(null)).toBe('—');
  });

  it('compacts large rupee amounts', () => {
    expect(moneyCompact(250_725_395)).toBe('₹25.07L');
    expect(moneyCompact(17_190_700_00)).toBe('₹1.72Cr');
    expect(moneyCompact(95_000)).toBe('₹950');
    expect(moneyCompact(null)).toBe('—');
  });
});
