/**
 * Colours for the on-screen keyboard, as CSS custom properties so they follow
 * the light/dark theme (see app.css). One meaning per colour:
 * hand colours = press now, dimmed hand colours = keep holding,
 * red = wrong, grey = chord-guide suggestion.
 */
export const KEY_COLORS = {
  right: 'var(--hand-right)',
  left: 'var(--hand-left)',
  holdRight: 'var(--hand-right-hold)',
  holdLeft: 'var(--hand-left-hold)',
  wrong: 'var(--wrong)',
  guide: 'var(--guide)'
} as const;

export interface KeyLightInput {
  playing: boolean;
  /** Pitches to press now. */
  expected: number[];
  /** Pitches struck earlier that should still be held. */
  sustained: number[];
  /** Chord-symbol notes for the current position. */
  chordPitches: number[];
  showGuide: boolean;
  /** Keys physically held right now. */
  held: number[];
  /** Held keys whose press was graded wrong. */
  wrongHeld: ReadonlySet<number>;
  /** Whether a pitch belongs to the left hand at this step. */
  isLeft: (pitch: number) => boolean;
}

/**
 * Every lit key and its colour. Later layers win: guide < keep-holding <
 * press-now < what you're actually holding (hand colour if it's a target, red
 * only if it was a wrong press — a correct key still held after the step moved
 * on must never turn red).
 */
export function keyLights(i: KeyLightInput): Map<number, string> {
  const m = new Map<number, string>();
  if (!i.playing) return m;
  const hand = (p: number) => (i.isLeft(p) ? KEY_COLORS.left : KEY_COLORS.right);
  if (i.showGuide) for (const p of i.chordPitches) m.set(p, KEY_COLORS.guide);
  for (const p of i.sustained) m.set(p, i.isLeft(p) ? KEY_COLORS.holdLeft : KEY_COLORS.holdRight);
  for (const p of i.expected) m.set(p, hand(p));
  for (const p of i.held) {
    if (i.expected.includes(p)) m.set(p, hand(p));
    else if (i.wrongHeld.has(p)) m.set(p, KEY_COLORS.wrong);
  }
  return m;
}
