import { describe, it, expect } from 'vitest';
import { pitchName } from './types';

describe('pitchName', () => {
  it('returns C4 for middle C (pitch 60)', () => {
    expect(pitchName(60)).toBe('C4');
  });

  it('returns A4 for concert A (pitch 69)', () => {
    expect(pitchName(69)).toBe('A4');
  });

  it('returns C-1 for the lowest MIDI note (pitch 0)', () => {
    expect(pitchName(0)).toBe('C-1');
  });

  it('returns G9 for the highest MIDI note (pitch 127)', () => {
    expect(pitchName(127)).toBe('G9');
  });

  it('handles sharps correctly (pitch 61 → C#4)', () => {
    expect(pitchName(61)).toBe('C#4');
  });
});
