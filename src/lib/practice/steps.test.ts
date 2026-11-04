import { describe, it, expect } from 'vitest';
import type { GradedStep } from '../score/extractor';
import { barSpan, selectBars, withGuideTolerance } from './steps';

const s = (measure: number, pitches = [60], extra: Partial<GradedStep> = {}): GradedStep => ({
  pitches,
  measure,
  cursorIndex: 0,
  ...extra
});

describe('barSpan', () => {
  it('covers pickup bar 0 through the last bar', () => {
    expect(barSpan([s(0), s(1), s(5), s(3)])).toEqual({ first: 0, last: 5 });
  });
});

describe('selectBars', () => {
  const steps = [s(1), s(1), s(2), s(3), s(4), s(5)];

  it('selects the steps of the requested bars', () => {
    expect(selectBars(steps, 2, 4)).toEqual({ start: 2, end: 4 });
  });

  it('accepts a reversed range', () => {
    expect(selectBars(steps, 4, 2)).toEqual({ start: 2, end: 4 });
  });

  it('starts at the next bar with notes when the first bar has none', () => {
    expect(selectBars([s(1), s(3), s(4)], 2, 3)).toEqual({ start: 1, end: 1 });
  });

  it('takes only the first pass through a repeated section', () => {
    // Bars 1-2 repeated: 1,2,1,2,3
    const rep = [s(1), s(2), s(1), s(2), s(3)];
    expect(selectBars(rep, 1, 2)).toEqual({ start: 0, end: 1 });
  });

  it('returns null when no step is in range', () => {
    expect(selectBars(steps, 8, 9)).toBeNull();
  });
});

describe('withGuideTolerance', () => {
  it('tolerates the guide notes except the step’s own pitches', () => {
    const [out] = withGuideTolerance([s(1, [60], { chordPitches: [48, 52, 55, 60], tolerated: [43] })], true);
    expect(out.tolerated).toEqual([43, 48, 52, 55]);
  });

  it('leaves steps untouched when the guide is off', () => {
    const steps = [s(1, [60], { chordPitches: [48] })];
    expect(withGuideTolerance(steps, false)).toBe(steps);
  });
});
