import { describe, it, expect } from 'vitest';
import { keyLights, KEY_COLORS, type KeyLightInput } from './keyLights';

const base: KeyLightInput = {
  playing: true,
  expected: [],
  sustained: [],
  chordPitches: [],
  showGuide: false,
  held: [],
  wrongHeld: new Set(),
  isLeft: (p) => p < 60
};

describe('keyLights', () => {
  it('lights nothing when not playing', () => {
    expect(keyLights({ ...base, playing: false, expected: [60] }).size).toBe(0);
  });

  it('colours targets by hand and held-over notes dimmed', () => {
    const m = keyLights({ ...base, expected: [72], sustained: [48] });
    expect(m.get(72)).toBe(KEY_COLORS.right);
    expect(m.get(48)).toBe(KEY_COLORS.holdLeft);
  });

  it('never turns a correctly held key red', () => {
    // C3 was played correctly and is still held while the right hand moves on.
    const m = keyLights({ ...base, expected: [74], sustained: [48], held: [48] });
    expect(m.get(48)).toBe(KEY_COLORS.holdLeft);
  });

  it('turns only wrong presses red', () => {
    const m = keyLights({ ...base, expected: [74], held: [70, 74], wrongHeld: new Set([70]) });
    expect(m.get(70)).toBe(KEY_COLORS.wrong);
    expect(m.get(74)).toBe(KEY_COLORS.right);
  });

  it('shows the chord guide only when enabled, under the targets', () => {
    expect(keyLights({ ...base, chordPitches: [48, 52] }).size).toBe(0);
    const m = keyLights({ ...base, showGuide: true, chordPitches: [48, 52], expected: [52] });
    expect(m.get(48)).toBe(KEY_COLORS.guide);
    expect(m.get(52)).toBe(KEY_COLORS.left);
  });
});
