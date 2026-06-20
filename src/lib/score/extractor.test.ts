import { describe, it, expect } from 'vitest';
import { osmdHalfToneToMidi } from './extractor';

describe('osmdHalfToneToMidi', () => {
  it('converts OSMD half-tone 48 to MIDI 60 (middle C)', () => {
    expect(osmdHalfToneToMidi(48)).toBe(60);
  });

  it('converts OSMD half-tone 0 to MIDI 12', () => {
    expect(osmdHalfToneToMidi(0)).toBe(12);
  });

  it('converts OSMD half-tone 57 to MIDI 69 (A4)', () => {
    expect(osmdHalfToneToMidi(57)).toBe(69);
  });
});
