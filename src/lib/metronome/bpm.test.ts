import { describe, it, expect } from 'vitest';
import { clampBpm, MIN_BPM, MAX_BPM, beatsPerBar, beatUnitLength } from './bpm';

describe('clampBpm', () => {
  it('passes through an in-range whole tempo', () => {
    expect(clampBpm(120)).toBe(120);
  });

  it('rounds fractional tempos (e.g. from a score)', () => {
    expect(clampBpm(96.4)).toBe(96);
  });

  it('clamps to the supported range', () => {
    expect(clampBpm(0)).toBe(MIN_BPM);
    expect(clampBpm(8)).toBe(MIN_BPM);
    expect(clampBpm(5000)).toBe(MAX_BPM);
  });

  it('falls back for empty/invalid input instead of producing NaN', () => {
    expect(clampBpm(undefined, 90)).toBe(90);
    expect(clampBpm(null, 90)).toBe(90);
    expect(clampBpm(Number.NaN, 90)).toBe(90);
    expect(clampBpm(Infinity, 90)).toBe(90);
    expect(clampBpm('120', 90)).toBe(90);
  });

  it('clamps an out-of-range fallback too', () => {
    expect(clampBpm(undefined, 0)).toBe(MIN_BPM);
  });
});

describe('beatsPerBar', () => {
  const dottedQuarter = beatUnitLength('quarter', true);

  it('counts 6/8 in two dotted-quarter beats when marked that way (Leise rieselt)', () => {
    expect(beatsPerBar(6, 8, dottedQuarter)).toBe(2);
  });

  it('counts cut time in halves when marked "half = 95" (Africa)', () => {
    expect(beatsPerBar(2, 2, beatUnitLength('half'))).toBe(2);
  });

  it('counts 6/8 in eighths when the marking is an eighth', () => {
    expect(beatsPerBar(6, 8, beatUnitLength('eighth'))).toBe(6);
  });

  it('keeps 4/4 and 3/4 in quarters', () => {
    expect(beatsPerBar(4, 4, beatUnitLength('quarter'))).toBe(4);
    expect(beatsPerBar(3, 4, beatUnitLength('quarter'))).toBe(3);
  });

  it('defaults compound metres to dotted quarters without a marking', () => {
    expect(beatsPerBar(6, 8)).toBe(2);
    expect(beatsPerBar(12, 8)).toBe(4);
    expect(beatsPerBar(3, 8)).toBe(3);
  });

  it('falls back to the numerator when the marking does not divide the bar', () => {
    expect(beatsPerBar(5, 8, beatUnitLength('quarter'))).toBe(5);
  });
});
