import { describe, it, expect } from 'vitest';
import { BAND_PRESETS, chordsFor, withBand } from './band';
import { chordName } from './theory';
import type { PlayedNote, Timeline } from '../score/timeline';

const bars = [0, 1, 2].map((i) => ({ number: i + 1, onset: i, length: 1, nominal: 1, beats: 4, numerator: 4, denominator: 4 }));
const n = (onset: number, pitch: number, staff = 0, duration = 0.25): PlayedNote => ({
  onset,
  duration,
  pitch,
  velocity: 90,
  channel: 0,
  cursorIndex: Math.round(onset * 4),
  measure: Math.floor(onset) + 1,
  staff
});

// C – G – C: melody arpeggios, left hand roots.
const TL: Timeline = {
  notes: [
    ...[72, 76, 79, 76].map((p, i) => n(i / 4, p)),
    ...[71, 74, 79, 74].map((p, i) => n(1 + i / 4, p)),
    n(2, 72, 0, 1),
    n(0, 48, 1, 1),
    n(1, 43, 1, 1),
    n(2, 48, 1, 1)
  ],
  parts: [{ channel: 0, program: 0, name: 'Piano', staves: [0, 1] }],
  length: 3,
  bars,
  key: { tonic: 0, mode: 'major' },
  chordSymbols: []
};
const ROLES = { melodyStaves: [0], bassStaves: [1] };

describe('band', () => {
  it('detects chords when the score has no symbols', () => {
    const { chords, detected } = chordsFor(TL, ROLES);
    expect(detected).toBe(true);
    expect(chords.map((c) => chordName(c))).toEqual(['C', 'G', 'C']);
  });

  it('prefers written chord symbols', () => {
    const tl = { ...TL, chordSymbols: [{ root: 9, quality: 'min' as const, onset: 0, duration: 3 }] };
    expect(chordsFor(tl, ROLES)).toEqual({ chords: tl.chordSymbols, detected: false });
  });

  it('adds each track on its own channel, drums on channel 10', () => {
    const pop = BAND_PRESETS.find((p) => p.id === 'pop')!;
    const out = withBand(TL, pop, ROLES);
    expect(out.parts.map((p) => [p.name, p.channel])).toEqual([
      ['Piano', 0],
      ['Bass', 1],
      ['Guitar', 2],
      ['Drums', 9]
    ]);
    expect(out.notes.filter((x) => x.channel === 0)).toHaveLength(TL.notes.length);
    for (const ch of [1, 2, 9]) expect(out.notes.some((x) => x.channel === ch)).toBe(true);
    // Sorted for the player.
    for (let i = 1; i < out.notes.length; i++) expect(out.notes[i].onset).toBeGreaterThanOrEqual(out.notes[i - 1].onset);
  });

  it('builds every preset without errors', () => {
    for (const p of BAND_PRESETS) expect(withBand(TL, p, ROLES).notes.length).toBeGreaterThan(TL.notes.length);
  });
});
