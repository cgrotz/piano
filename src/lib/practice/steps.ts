import type { GradedStep } from '../score/extractor';

/** First and last bar numbers that contain a graded step. */
export function barSpan(steps: GradedStep[]): { first: number; last: number } {
  if (steps.length === 0) return { first: 1, last: 1 };
  let first = Infinity;
  let last = -Infinity;
  for (const s of steps) {
    first = Math.min(first, s.measure);
    last = Math.max(last, s.measure);
  }
  return { first, last };
}

/**
 * The run of steps from bar `from` to bar `to` (inclusive), as indices into
 * `steps`. Starts at the first step in or after `from` and stops before the
 * first step that leaves the range — so with repeats (bars 1–8 played twice)
 * a range covers its first pass only, and a backward jump ends it.
 * Returns null when no step falls in the range.
 */
export function selectBars(steps: GradedStep[], from: number, to: number): { start: number; end: number } | null {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const start = steps.findIndex((s) => s.measure >= lo && s.measure <= hi);
  if (start < 0) return null;
  let end = start;
  while (end + 1 < steps.length && steps[end + 1].measure >= lo && steps[end + 1].measure <= hi) {
    // A jump backwards in bar numbers is a repeat starting over; stop there.
    if (steps[end + 1].measure < steps[end].measure) break;
    end++;
  }
  return { start, end };
}

/**
 * When the chord guide is lit, its keys are suggestions, not mistakes: add the
 * guide's notes to each step's `tolerated` set (never its own pitches).
 * Returns new step objects; the input is not modified.
 */
export function withGuideTolerance(steps: GradedStep[], guideOn: boolean): GradedStep[] {
  if (!guideOn) return steps;
  return steps.map((s) => {
    if (!s.chordPitches?.length) return s;
    const own = new Set(s.pitches);
    const tolerated = new Set(s.tolerated ?? []);
    for (const p of s.chordPitches) if (!own.has(p)) tolerated.add(p);
    return { ...s, tolerated: [...tolerated].sort((a, b) => a - b) };
  });
}
