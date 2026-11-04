import { describe, it, expect } from 'vitest';
import { handOptions, type StaffInfo } from './hands';

const staff = (index: number, partName: string, partStaffIndex = 0, partStaffCount = 1): StaffInfo => ({
  index,
  partName,
  partStaffIndex,
  partStaffCount
});

describe('handOptions', () => {
  it('offers Right / Left / Both for a plain piano score', () => {
    const opts = handOptions([staff(0, 'Piano', 0, 2), staff(1, 'Piano', 1, 2)]);
    expect(opts.map((o) => [o.label, o.staves])).toEqual([
      ['Right', [0]],
      ['Left', [1]],
      ['Both', [0, 1]]
    ]);
    expect(opts[2].leftStaff).toBe(1);
  });

  it('finds the piano after a vocal line and lists the voice by name', () => {
    // "Balu": Альт (alto voice, 1 staff) + Фортепиано (piano, 2 staves).
    const opts = handOptions([staff(0, 'Альт'), staff(1, 'Фортепиано', 0, 2), staff(2, 'Фортепиано', 1, 2)]);
    expect(opts.map((o) => [o.label, o.kind, o.staves])).toEqual([
      ['Right', 'right', [1]],
      ['Left', 'left', [2]],
      ['Both', 'both', [1, 2]],
      ['Альт', 'other', [0]]
    ]);
    expect(opts[2].leftStaff).toBe(2);
  });

  it('labels staves by part when there is no two-staff part', () => {
    const opts = handOptions([staff(0, 'Flute'), staff(1, 'Violin')]);
    expect(opts.map((o) => o.label)).toEqual(['Flute', 'Violin']);
  });

  it('returns a single option for a one-staff melody', () => {
    expect(handOptions([staff(0, 'Piano')])).toHaveLength(1);
  });
});
