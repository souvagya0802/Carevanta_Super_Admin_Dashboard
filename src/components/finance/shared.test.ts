import { describe, expect, it } from 'vitest';
import { calcCommission, describeTerms, pctToBps, toMinor } from './shared';

describe('client-side commission preview (must match the API)', () => {
  it('applies percentage with half-up rounding and tax on the commission', () => {
    // 10% of ₹500.00 = ₹50.00; 18% GST on ₹50 = ₹9.00; provider keeps ₹441.00
    expect(calcCommission({ method: 'PERCENTAGE', rateBps: 1000, taxRateBps: 1800 }, 50_000)).toEqual({ baseMinor: 50_000, commissionMinor: 5_000, taxMinor: 900, providerNetMinor: 44_100 });
    // 12.5% of ₹333.33 = 4166.625 paise → 4167 (half-up)
    expect(calcCommission({ method: 'PERCENTAGE', rateBps: 1250, taxRateBps: 0 }, 33_333).commissionMinor).toBe(4_167);
  });

  it('clamps to min/max and never exceeds the service value', () => {
    expect(calcCommission({ method: 'PERCENTAGE', rateBps: 1000, minMinor: 10_000, taxRateBps: 0 }, 50_000).commissionMinor).toBe(10_000);
    expect(calcCommission({ method: 'PERCENTAGE', rateBps: 5000, maxMinor: 2_000, taxRateBps: 0 }, 50_000).commissionMinor).toBe(2_000);
    const tiny = calcCommission({ method: 'FLAT', flatMinor: 100_000, taxRateBps: 1800 }, 1_000);
    expect(tiny.commissionMinor + tiny.taxMinor).toBeLessThanOrEqual(1_000);
    expect(tiny.providerNetMinor).toBeGreaterThanOrEqual(0);
  });

  it('describes terms and converts rupees / percentages to integers', () => {
    expect(describeTerms({ method: 'PERCENTAGE', rateBps: 1250, minMinor: 5_000, taxRateBps: 1800 })).toBe('12.5% of the service value (min ₹50.00) + 18% tax');
    expect(toMinor('1,234.56')).toBe(123_456);
    expect(toMinor('-5')).toBeNull();
    expect(pctToBps('12.5')).toBe(1250);
    expect(pctToBps('abc')).toBeNull();
  });
});
