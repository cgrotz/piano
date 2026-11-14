import { describe, it, expect } from 'vitest';
import { generate, type GenContext, type GeneratorId } from './generators';
import { chordPcs, pc, type Bar, type ChordSpan, type Key } from './theory';
import type { PlayedNote } from '../score/timeline';

const C_MAJOR: Key = { tonic: 0, mode: 'major' };

function bars(count: number, numerator = 4, denominator = 4, numbers?: number[]): Bar[] {
  const len = numerator / denominator;
  const beats = denominator === 8 && numerator % 3 === 0 && numerator > 3 ? numerator / 3 : numerator;
  return Array.from({ length: count }, (_, i) => ({
    number: numbers?.[i] ?? i + 1,
    onset: i * len,
    length: len,
    nominal: len,
    beats,
    numerator,
    denominator
  }));
}

/** One chord per bar. */
function chords(b: Bar[], ...spec: [number, ChordSpan['quality']][]): ChordSpan[] {
  return spec.map(([root, quality], i) => ({ root, quality, onset: b[i].onset, duration: b[i].length }));
}

/** Melody: one note per beat, given as MIDI pitches, starting at 0. */
function melody(pitches: number[], beat = 0.25): PlayedNote[] {
  return pitches.map((pitch, i) => ({ onset: i * beat, duration: beat, pitch, velocity: 90, channel: 0, cursorIndex: i, measure: 1 + Math.floor(i / 4) }));
}

// C | F | G7 | C  with a melody around C5.
const B4 = bars(4);
const CTX: GenContext = {
  melody: melody([72, 76, 79, 76, 77, 81, 84, 81, 79, 83, 86, 83, 84, 84, 84, 84]),
  chords: chords(B4, [0, 'maj'], [5, 'maj'], [7, 'dom7'], [0, 'maj']),
  bars: B4,
  key: C_MAJOR
};

const inBar = (notes: PlayedNote[], bar: Bar) => notes.filter((n) => n.onset >= bar.onset - 1e-9 && n.onset < bar.onset + bar.length - 1e-9);
const melodyLowAt = (ctx: GenContext, n: PlayedNote) =>
  Math.min(...ctx.melody.filter((m) => m.onset < n.onset + n.duration - 1e-9 && m.onset + m.duration > n.onset + 1e-9).map((m) => m.pitch), Infinity);

describe('bass', () => {
  it('plays the chord roots in bass range, one per bar (root style)', () => {
    const notes = generate('bass', CTX, { style: 'root' });
    expect(notes.map((n) => pc(n.pitch))).toEqual([0, 5, 7, 0]);
    expect(notes.every((n) => n.pitch >= 28 && n.pitch <= 50)).toBe(true);
    expect(notes.map((n) => n.onset)).toEqual([0, 1, 2, 3]);
  });

  it('keeps leaps small between roots', () => {
    const notes = generate('bass', CTX, { style: 'root' });
    for (let i = 1; i < notes.length; i++) expect(Math.abs(notes[i].pitch - notes[i - 1].pitch)).toBeLessThanOrEqual(7);
  });

  it('alternates root and fifth on beats 1 and 3', () => {
    const bar1 = inBar(generate('bass', CTX, { style: 'root-fifth' }), B4[0]);
    expect(bar1.map((n) => [n.onset, pc(n.pitch)])).toEqual([
      [0, 0],
      [0.5, 7]
    ]);
  });

  it('walks in quarters and approaches the next root by a semitone', () => {
    const notes = generate('bass', CTX, { style: 'walking', seed: 7 });
    const bar1 = inBar(notes, B4[0]);
    expect(bar1).toHaveLength(4);
    const nextRoot = inBar(notes, B4[1])[0].pitch;
    expect(Math.abs(bar1[3].pitch - nextRoot)).toBe(1);
  });

  it('honours slash-chord bass notes', () => {
    const ctx = { ...CTX, chords: [{ ...CTX.chords[0], bass: 4 }, ...CTX.chords.slice(1)] };
    expect(pc(generate('bass', ctx)[0].pitch)).toBe(4);
  });

  it('ends on one held root', () => {
    const last = inBar(generate('bass', CTX, { style: 'pop-8ths' }), B4[3]);
    expect(last).toHaveLength(1);
    expect(pc(last[0].pitch)).toBe(0);
  });
});

describe('pad', () => {
  it('voices every chord with chord tones only, below the melody', () => {
    const notes = generate('pad', CTX);
    for (const [i, bar] of B4.entries()) {
      const v = inBar(notes, bar);
      expect(v.length).toBe(4);
      const tones = chordPcs(CTX.chords[i]);
      expect(v.every((n) => tones.includes(pc(n.pitch)))).toBe(true);
    }
    for (const n of notes) expect(n.pitch).toBeLessThan(melodyLowAt(CTX, n));
  });

  it('voice-leads: little movement between neighbouring chords', () => {
    const notes = generate('pad', CTX);
    const voicings = B4.map((b) => inBar(notes, b).map((n) => n.pitch).sort((a, b) => a - b));
    for (let i = 1; i < voicings.length; i++) {
      const moved = voicings[i].reduce((s, p, k) => s + Math.abs(p - voicings[i - 1][k]), 0);
      expect(moved).toBeLessThanOrEqual(10);
    }
  });
});

describe('arpeggio', () => {
  it('plays an Alberti figure in eighths, under the melody', () => {
    const bar1 = inBar(generate('arpeggio', CTX), B4[0]);
    expect(bar1).toHaveLength(8);
    const [lo, hi, mid] = [bar1[0].pitch, bar1[1].pitch, bar1[2].pitch];
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(bar1[3].pitch).toBe(hi);
    for (const n of bar1) expect(n.pitch).toBeLessThan(melodyLowAt(CTX, n));
  });

  it('rolls up and down in 6/8', () => {
    const b = bars(2, 6, 8);
    const ctx: GenContext = { melody: [], chords: chords(b, [0, 'maj'], [0, 'maj']), bars: b, key: C_MAJOR };
    const bar1 = inBar(generate('arpeggio', ctx), b[0]);
    expect(bar1).toHaveLength(6);
    const p = bar1.map((n) => n.pitch);
    expect(p[0] < p[1] && p[1] < p[2] && p[2] < p[3] && p[4] === p[2] && p[5] === p[1]).toBe(true);
  });
});

describe('comp', () => {
  it('strums the pop pattern: 1, 2&, 3, 4&', () => {
    const bar1 = inBar(generate('comp', CTX, { style: 'pop' }), B4[0]);
    const starts = [...new Set(bar1.map((n) => Math.round(n.onset * 16) / 16))];
    expect(starts).toEqual([0, 0.375, 0.5, 0.875]);
  });

  it('leaves beat 1 to the bass in a waltz', () => {
    const b = bars(3, 3, 4);
    const ctx: GenContext = { melody: [], chords: chords(b, [0, 'maj'], [7, 'maj'], [0, 'maj']), bars: b, key: C_MAJOR };
    const bar1 = inBar(generate('comp', ctx), b[0]);
    expect(Math.min(...bar1.map((n) => n.onset))).toBeCloseTo(0.25);
  });
});

describe('drums', () => {
  const kit = generate('drums', CTX, { style: 'pop' });
  const at = (bar: Bar, pitch: number) => inBar(kit, bar).filter((n) => n.pitch === pitch).map((n) => n.onset - bar.onset);

  it('plays on the drum channel', () => {
    expect(kit.every((n) => n.channel === 9)).toBe(true);
  });

  it('backbeat: kick on 1 and 3, snare on 2 and 4, crash to start', () => {
    expect(at(B4[0], 49)).toEqual([0]);
    expect(at(B4[1], 36)).toEqual([0, 0.5, 0.625]);
    expect(at(B4[1], 38)).toEqual([0.25, 0.75]);
    expect(at(B4[1], 42)).toHaveLength(8);
  });

  it('ends with a single crash and kick', () => {
    expect(inBar(kit, B4[3]).map((n) => n.pitch).sort()).toEqual([36, 49]);
  });

  it('fills before a repeat jump', () => {
    const b = bars(5, 4, 4, [1, 2, 1, 2, 3]);
    const ctx: GenContext = { melody: [], chords: chords(b, [0, 'maj'], [7, 'maj'], [0, 'maj'], [7, 'maj'], [0, 'maj']), bars: b, key: C_MAJOR };
    const k = generate('drums', ctx);
    const fillSnares = inBar(k, b[1]).filter((n) => n.pitch === 38 && n.onset - b[1].onset >= 0.75 - 1e-9);
    expect(fillSnares).toHaveLength(4);
    expect(inBar(k, b[2]).some((n) => n.pitch === 49)).toBe(true); // crash after the jump
  });
});

describe('second voice', () => {
  it('harmonises below the melody with chord tones', () => {
    const notes = generate('second-voice', CTX);
    expect(notes.length).toBeGreaterThan(10);
    for (const n of notes) {
      const m = CTX.melody.find((x) => x.onset === n.onset)!;
      expect(n.pitch).toBeLessThan(m.pitch);
      expect(m.pitch - n.pitch).toBeLessThanOrEqual(9);
      const chord = CTX.chords.find((c) => n.onset >= c.onset && n.onset < c.onset + c.duration)!;
      expect(chordPcs(chord)).toContain(pc(n.pitch));
    }
  });
});

describe('all generators', () => {
  const ids: GeneratorId[] = ['bass', 'pad', 'arpeggio', 'comp', 'drums', 'second-voice'];

  it('are deterministic for a seed', () => {
    for (const id of ids) expect(generate(id, CTX, { seed: 3 })).toEqual(generate(id, CTX, { seed: 3 }));
  });

  it('stay within the piece and use valid MIDI', () => {
    for (const id of ids) {
      for (const n of generate(id, CTX)) {
        expect(n.onset).toBeGreaterThanOrEqual(0);
        expect(n.onset + n.duration).toBeLessThanOrEqual(4 + 1e-9);
        expect(n.pitch).toBeGreaterThanOrEqual(0);
        expect(n.pitch).toBeLessThanOrEqual(127);
        expect(n.velocity).toBeGreaterThan(0);
      }
    }
  });

  it('handle a pickup bar', () => {
    const b: Bar[] = [
      { number: 0, onset: 0, length: 0.25, nominal: 1, beats: 4, numerator: 4, denominator: 4 },
      { number: 1, onset: 0.25, length: 1, nominal: 1, beats: 4, numerator: 4, denominator: 4 },
      { number: 2, onset: 1.25, length: 1, nominal: 1, beats: 4, numerator: 4, denominator: 4 }
    ];
    const ctx: GenContext = { melody: [], chords: [{ root: 7, quality: 'maj', onset: 0, duration: 0.25 }, { root: 0, quality: 'maj', onset: 0.25, duration: 2 }], bars: b, key: C_MAJOR };
    const kit = generate('drums', ctx);
    // The pickup is the last beat of a bar: only beat-4 hits, no crash.
    expect(inBar(kit, b[0]).every((n) => n.pitch !== 49)).toBe(true);
    for (const id of ids) expect(() => generate(id, ctx)).not.toThrow();
  });
});
