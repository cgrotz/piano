/**
 * Small music-theory vocabulary shared by harmony analysis and the
 * generators. Pitch classes are 0-11 (C = 0); pitches are MIDI numbers.
 */

export type Quality = 'maj' | 'min' | 'dim' | 'aug' | 'dom7' | 'maj7' | 'min7' | 'hdim7' | 'dim7' | 'sus2' | 'sus4' | 'maj6' | 'min6' | 'power';

/** Semitones above the root, root first. */
export const QUALITY_INTERVALS: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  hdim7: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj6: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  power: [0, 7]
};

const SUFFIX: Record<Quality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: '+',
  dom7: '7',
  maj7: 'maj7',
  min7: 'm7',
  hdim7: 'm7b5',
  dim7: 'dim7',
  sus2: 'sus2',
  sus4: 'sus4',
  maj6: '6',
  min6: 'm6',
  power: '5'
};

export interface Chord {
  root: number; // pitch class
  quality: Quality;
  /** Slash bass pitch class, when it isn't the root. */
  bass?: number;
}

/** A chord sounding over `[onset, onset + duration)` on the enrolled timeline (whole notes). */
export interface ChordSpan extends Chord {
  onset: number;
  duration: number;
}

export interface Key {
  tonic: number; // pitch class
  mode: 'major' | 'minor';
}

/** One bar on the enrolled timeline. */
export interface Bar {
  /** 1-based printed number. */
  number: number;
  onset: number;
  /** Actual length in whole notes (shorter for a pickup bar). */
  length: number;
  /** Nominal length from the time signature (numerator / denominator). */
  nominal: number;
  /** Metronome beats in a full bar (see metronome/bpm.ts beatsPerBar). */
  beats: number;
  numerator: number;
  denominator: number;
}

export const pc = (pitch: number) => ((pitch % 12) + 12) % 12;

export function chordPcs(c: Chord): number[] {
  return QUALITY_INTERVALS[c.quality].map((i) => (c.root + i) % 12);
}

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function chordName(c: Chord, flats = false): string {
  const names = flats ? NAMES_FLAT : NAMES_SHARP;
  const base = names[c.root] + SUFFIX[c.quality];
  return c.bass !== undefined && c.bass !== c.root ? `${base}/${names[c.bass]}` : base;
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
// Natural minor, with the raised 7th used where harmony needs it (V, vii°).
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** Diatonic scale pitch classes of a key (natural minor for minor keys). */
export function scalePcs(key: Key): number[] {
  return (key.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS).map((s) => (key.tonic + s) % 12);
}

/** Tonic of a major key with `fifths` sharps (negative = flats). */
export function majorTonicFromFifths(fifths: number): number {
  return pc(fifths * 7);
}

/** Nearest pitch with pitch class `p` to `near` (ties go down). */
export function nearestPitch(p: number, near: number): number {
  const base = near - pc(near) + p;
  const candidates = [base - 12, base, base + 12];
  return candidates.reduce((best, c) => (Math.abs(c - near) < Math.abs(best - near) ? c : best));
}

/** Highest pitch with pitch class `p` that is ≤ `ceiling`. */
export function pitchAtOrBelow(p: number, ceiling: number): number {
  return ceiling - pc(ceiling - p);
}

/** Lowest pitch with pitch class `p` that is ≥ `floor`. */
export function pitchAtOrAbove(p: number, floor: number): number {
  return floor + pc(p - floor);
}
