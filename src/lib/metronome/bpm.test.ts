import { describe, it, expect } from 'vitest';
import { clampBpm, MIN_BPM, MAX_BPM } from './bpm';

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
