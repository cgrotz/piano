export const MIN_BPM = 30;
export const MAX_BPM = 300;

/**
 * Coerce any candidate tempo into a usable whole BPM in [MIN_BPM, MAX_BPM].
 *
 * The metronome divides by the BPM to space its clicks, so a non-finite or zero
 * value (an emptied number input binds as `undefined`/NaN) would poison the
 * schedule with NaN/Infinity and silence it until restarted. Anything that is
 * not a finite number falls back to `fallback`.
 */
export function clampBpm(value: unknown, fallback = 100): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) return clampBpm(fallback, 100);
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(n)));
}

/**
 * How many metronome clicks make one bar.
 *
 * The click follows the score's tempo marking: "dotted quarter = 40" in 6/8
 * means two clicks per bar, "half = 95" in 2/2 means two. So beats per bar is
 * the bar length divided by the marking's beat unit (both as fractions of a
 * whole note). Without a usable marking, compound metres (6/8, 9/8, 12/8) are
 * counted in dotted quarters, everything else by the time signature's top number.
 */
export function beatsPerBar(numerator: number, denominator: number, beatUnit?: number): number {
  if (!(numerator > 0) || !(denominator > 0)) return 4;
  const bar = numerator / denominator;
  if (beatUnit && beatUnit > 0) {
    const n = bar / beatUnit;
    if (n >= 1 && Math.abs(n - Math.round(n)) < 1e-6) return Math.round(n);
  }
  if (denominator === 8 && numerator > 3 && numerator % 3 === 0) return numerator / 3;
  return numerator;
}

const UNIT_LENGTH: Record<string, number> = {
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  '16th': 1 / 16,
  '32nd': 1 / 32
};

/** MusicXML `<beat-unit>` (+ dot) as a fraction of a whole note, e.g. dotted quarter = 3/8. */
export function beatUnitLength(unit: string | undefined, dotted = false): number | undefined {
  const base = unit ? UNIT_LENGTH[unit.toLowerCase()] : undefined;
  return base === undefined ? undefined : dotted ? base * 1.5 : base;
}
