import { describe, expect, it } from 'vitest';
import { applyWhoCanBuy, whoCanBuyOf } from './shared';

describe('"Who can buy it" maps to the schedule and prescription flag', () => {
  it('reads the stored values as one plain choice', () => {
    expect(whoCanBuyOf('OTC', false)).toBe('anyone');
    expect(whoCanBuyOf('SCHEDULE_G', false)).toBe('anyone');
    expect(whoCanBuyOf('OTC', true)).toBe('prescription');
    expect(whoCanBuyOf('SCHEDULE_H', true)).toBe('prescription');
    expect(whoCanBuyOf('SCHEDULE_X', true)).toBe('prescription');
    expect(whoCanBuyOf('SCHEDULE_H1', true)).toBe('prescription_h1');
    // H/H1/X always need a prescription even if the flag were false.
    expect(whoCanBuyOf('SCHEDULE_H', false)).toBe('prescription');
  });

  it('writes a choice back without losing the expert schedule when it still fits', () => {
    expect(applyWhoCanBuy('anyone', 'SCHEDULE_H1')).toEqual({ schedule: 'OTC', requiresPrescription: false });
    expect(applyWhoCanBuy('anyone', 'SCHEDULE_G')).toEqual({ schedule: 'SCHEDULE_G', requiresPrescription: false });
    expect(applyWhoCanBuy('prescription', 'OTC')).toEqual({ schedule: 'SCHEDULE_H', requiresPrescription: true });
    expect(applyWhoCanBuy('prescription', 'SCHEDULE_H1')).toEqual({ schedule: 'SCHEDULE_H', requiresPrescription: true });
    expect(applyWhoCanBuy('prescription', 'SCHEDULE_X')).toEqual({ schedule: 'SCHEDULE_X', requiresPrescription: true });
    expect(applyWhoCanBuy('prescription', 'SCHEDULE_G')).toEqual({ schedule: 'SCHEDULE_G', requiresPrescription: true });
    expect(applyWhoCanBuy('prescription_h1', 'OTC')).toEqual({ schedule: 'SCHEDULE_H1', requiresPrescription: true });
  });

  it('round-trips every choice', () => {
    for (const choice of ['anyone', 'prescription', 'prescription_h1'] as const) {
      for (const start of ['OTC', 'SCHEDULE_G', 'SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X', 'OTHER']) {
        const next = applyWhoCanBuy(choice, start);
        expect(whoCanBuyOf(next.schedule, next.requiresPrescription)).toBe(choice);
      }
    }
  });
});
