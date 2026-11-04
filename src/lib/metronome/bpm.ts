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
