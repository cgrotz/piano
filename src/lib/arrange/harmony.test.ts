import { describe, it, expect } from 'vitest';
import { analyzeHarmony, melodyAndBass } from './harmony';
import { chordName, type Bar, type Key } from './theory';
import type { PlayedNote } from '../score/timeline';

const C_MAJOR: Key = { tonic: 0, mode: 'major' };
const A_MINOR: Key = { tonic: 9, mode: 'minor' };

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C5", "G#4", "Bb3" → MIDI. */
function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)!;
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** Sequential notes: "C5:4 E5:4" = quarter C5, quarter E5 (4 = quarter, 2 = half, 1 = whole, 8 = eighth, "2." dotted). */
function line(spec: string, staff = 0, start = 0): PlayedNote[] {
  let t = start;
  return spec
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [name, div] = tok.split(':');
      const dotted = div.endsWith('.');
      const duration = (1 / Number(dotted ? div.slice(0, -1) : div)) * (dotted ? 1.5 : 1);
      const n: PlayedNote = { onset: t, duration, pitch: midi(name), velocity: 90, channel: 0, cursorIndex: 0, measure: 1, staff };
      t += duration;
      return n;
    });
}

function bars(count: number, numerator = 4, denominator = 4): Bar[] {
  const len = numerator / denominator;
  const beats = denominator === 8 && numerator % 3 === 0 && numerator > 3 ? numerator / 3 : numerator;
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, onset: i * len, length: len, nominal: len, beats, numerator, denominator }));
}

const names = (melody: PlayedNote[], b: Bar[], key: Key, bass: PlayedNote[] = []) =>
  analyzeHarmony({ melody, bass, bars: b, key }).map((c) => chordName(c));

describe('analyzeHarmony', () => {
  it('finds I – IV – V – I from arpeggiated melody bars', () => {
    const mel = line('C5:4 E5:4 G5:4 E5:4  F5:4 A5:4 C6:4 A5:4  G5:4 B5:4 D6:4 B5:4  C6:1');
    expect(names(mel, bars(4), C_MAJOR)).toEqual(['C', 'F', 'G', 'C']);
  });

  it('is not thrown by passing tones on weak beats', () => {
    // C – D(passing, weak) – E – F(passing) … still a C bar.
    const mel = line('C5:4 D5:8 E5:8 G5:4 F5:8 E5:8  D5:4 B4:4 G4:2  C5:1');
    expect(names(mel, bars(3), C_MAJOR)).toEqual(['C', 'G', 'C']);
  });

  it('lets the bass decide between relatives (C vs Am)', () => {
    // Melody C–E (fits C and Am); left hand A2 makes it Am.
    const mel = line('C5:2 E5:2  D5:2 B4:2  C5:1');
    const bass = [...line('A2:1', 1), ...line('G2:1', 1, 1), ...line('C3:1', 1, 2)];
    expect(names(mel, bars(3), C_MAJOR, bass)).toEqual(['Am', 'G', 'C']);
  });

  it('uses the major dominant in minor keys', () => {
    const mel = line('A4:4 C5:4 E5:4 C5:4  G#4:4 B4:4 E5:4 B4:4  A4:1');
    expect(names(mel, bars(3), A_MINOR)).toEqual(['Am', 'E', 'Am']);
  });

  it('changes chord mid-bar only when the notes ask for it', () => {
    const mel = line('C5:4 E5:4 F5:4 A5:4  G5:2 B4:2  C5:1');
    expect(names(mel, bars(3), C_MAJOR)).toEqual(['C', 'F', 'G', 'C']);
    const spans = analyzeHarmony({ melody: mel, bass: [], bars: bars(3), key: C_MAJOR });
    expect(spans[1].onset).toBe(0.5);
  });

  it('keeps one chord through a bar of a sustained chord tone', () => {
    const mel = line('E5:1  E5:1  C5:1');
    expect(names(mel, bars(3), C_MAJOR)).toEqual(['C']);
  });

  it('works in 3/4 (no mid-bar split)', () => {
    const mel = line('C5:4 E5:4 G5:4  B4:4 D5:4 G5:4  C5:2.');
    expect(names(mel, bars(3, 3, 4), C_MAJOR)).toEqual(['C', 'G', 'C']);
  });
});

describe('melodyAndBass', () => {
  it('keeps only the top note per onset of the melody staves', () => {
    const notes = [...line('C5:2 D5:2'), ...line('E5:2 F5:2'), ...line('C3:1', 1)];
    const { melody, bass } = melodyAndBass(notes, [0], [1]);
    expect(melody.map((n) => n.pitch)).toEqual([midi('E5'), midi('F5')]);
    expect(bass.map((n) => n.pitch)).toEqual([midi('C3')]);
  });
});
