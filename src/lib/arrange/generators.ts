import type { PlayedNote } from '../score/timeline';
import { chordAt } from './harmony';
import {
  QUALITY_INTERVALS,
  chordPcs,
  nearestPitch,
  pc,
  pitchAtOrAbove,
  scalePcs,
  type Bar,
  type ChordSpan,
  type Key
} from './theory';

/**
 * Rule-based part generators (COMPOSER.md §3). Each one turns the melody and
 * the chord timeline into notes for one instrument — pure and deterministic
 * for a given (input, params, seed), so an arrangement only stores its recipe.
 *
 * Shared guard rails: accompaniment stays below the melody sounding at the
 * same time, voicings move as little as possible from chord to chord, and the
 * final bar is a single held chord (drums: one crash).
 */

export type GeneratorId = 'bass' | 'pad' | 'arpeggio' | 'comp' | 'drums' | 'second-voice';

export interface GenContext {
  melody: PlayedNote[];
  chords: ChordSpan[];
  bars: Bar[];
  key: Key;
}

export interface GenParams {
  style?: string;
  /** MIDI channel for the output notes (drums are always 9). */
  channel?: number;
  seed?: number;
}

export const GENERATOR_STYLES: Record<GeneratorId, string[]> = {
  bass: ['root', 'root-fifth', 'walking', 'pop-8ths'],
  pad: ['sustained'],
  arpeggio: ['alberti', 'up', 'up-down'],
  comp: ['pop', 'ballad', 'waltz', 'bossa'],
  drums: ['pop', 'ballad', 'waltz'],
  'second-voice': ['thirds']
};

export function generate(id: GeneratorId, ctx: GenContext, params: GenParams = {}): PlayedNote[] {
  const fn = { bass, pad, arpeggio, comp, drums, 'second-voice': secondVoice }[id];
  return fn(ctx, params).sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
}

// ---------------------------------------------------------------- helpers

const EPS = 1e-9;
const DRUM_CHANNEL = 9;

/** Deterministic PRNG (mulberry32). */
function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function note(onset: number, duration: number, pitch: number, velocity: number, channel: number, measure: number): PlayedNote {
  return { onset, duration, pitch, velocity: Math.round(Math.min(127, Math.max(1, velocity))), channel, cursorIndex: -1, measure };
}

/** A chord segment inside one bar (chords that cross a barline are re-struck). */
interface Segment {
  chord: ChordSpan;
  bar: Bar;
  barIndex: number;
  onset: number;
  end: number;
  /** Position of `onset` inside the bar, whole notes. */
  pos: number;
  final: boolean;
}

function segments(ctx: GenContext): Segment[] {
  const out: Segment[] = [];
  ctx.bars.forEach((bar, barIndex) => {
    const barEnd = bar.onset + bar.length;
    for (const c of ctx.chords) {
      const start = Math.max(c.onset, bar.onset);
      const end = Math.min(c.onset + c.duration, barEnd);
      if (end - start > EPS) {
        out.push({ chord: c, bar, barIndex, onset: start, end, pos: start - bar.onset, final: barIndex === ctx.bars.length - 1 });
      }
    }
  });
  return out;
}

/** Lowest melody pitch sounding in `[from, to)`, or +∞. */
function melodyFloor(melody: PlayedNote[], from: number, to: number): number {
  let low = Infinity;
  for (const n of melody) {
    if (n.onset < to - EPS && n.onset + n.duration > from + EPS) low = Math.min(low, n.pitch);
  }
  return low;
}

const beatOf = (bar: Bar) => bar.nominal / bar.beats;

/**
 * Close-position voicing of `chord` whose top stays below `ceiling` and at or
 * above `floor`, chosen to move least from `prev` (sum of voice distances).
 */
function voiceChord(chord: ChordSpan, prev: number[] | null, floor: number, ceiling: number, size = 3): number[] {
  let pcs = chordPcs(chord);
  if (pcs.length > size) pcs = [pcs[0], pcs[1], pcs[pcs.length - 1]]; // drop the 5th of 7ths when tight
  // A triad in four voices doubles its lowest note an octave up.
  const double = size === 4 && pcs.length === 3;
  const options: number[][] = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = floor; base < floor + 12; base++) {
      if (pc(base) !== order[0]) continue;
      const v = [base];
      for (const p of order.slice(1)) v.push(pitchAtOrAbove(p, v[v.length - 1] + 1));
      if (double) v.push(base + 12);
      if (v[v.length - 1] <= ceiling) options.push(v);
    }
  }
  if (options.length === 0) {
    // Not enough room under the melody: a lower, tighter fallback.
    const root = pitchAtOrAbove(chord.root, floor - 12);
    const v = [root];
    for (const p of pcs.slice(1)) v.push(pitchAtOrAbove(p, v[v.length - 1] + 1));
    if (double) v.push(root + 12);
    return v;
  }
  if (!prev) {
    // First chord: centred in the available range.
    const mid = (floor + ceiling) / 2;
    return options.reduce((best, v) => (Math.abs(avg(v) - mid) < Math.abs(avg(best) - mid) ? v : best));
  }
  const cost = (v: number[]) => v.reduce((s, p, i) => s + Math.abs(p - (prev[i] ?? prev[prev.length - 1])), 0);
  return options.reduce((best, v) => (cost(v) < cost(best) ? v : best));
}

const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** Ceiling for accompaniment in a span: under the melody, never above `max`. */
function ceilingUnder(ctx: GenContext, from: number, to: number, max: number): number {
  const floor = melodyFloor(ctx.melody, from, to);
  return Math.min(max, Number.isFinite(floor) ? floor - 1 : max);
}

/** Velocity accent by metric position. */
function accent(pos: number, bar: Bar, strong: number, weak: number): number {
  if (Math.abs(pos) < EPS) return strong;
  const b = pos / beatOf(bar);
  return Math.abs(b - Math.round(b)) < EPS ? (strong + weak) / 2 : weak;
}

// ---------------------------------------------------------------- bass

const BASS_LOW = 28; // E1
const BASS_HIGH = 50; // D3

function bassPitch(p: number, prev: number): number {
  let x = nearestPitch(p, prev);
  while (x < BASS_LOW) x += 12;
  while (x > BASS_HIGH) x -= 12;
  return x;
}

function bass(ctx: GenContext, params: GenParams): PlayedNote[] {
  const style = params.style ?? 'root';
  const ch = params.channel ?? 0;
  const rand = rng(params.seed);
  const out: PlayedNote[] = [];
  const segs = segments(ctx);
  let prev = 40;
  const scale = scalePcs(ctx.key);

  segs.forEach((s, i) => {
    const bassPc = s.chord.bass ?? s.chord.root;
    const root = bassPitch(bassPc, prev);
    const fifth = bassPitch((s.chord.root + (QUALITY_INTERVALS[s.chord.quality][2] ?? 7)) % 12, root);
    const beat = beatOf(s.bar);
    const len = s.end - s.onset;
    const m = s.bar.number;
    if (s.final) {
      out.push(note(s.onset, len, root, 95, ch, m));
      prev = root;
      return;
    }
    switch (style) {
      case 'root-fifth': {
        // Root, then the fifth on the next strong beat inside the segment.
        const step = s.bar.beats % 3 === 0 ? beat : beat * 2;
        let k = 0;
        for (let t = s.onset; t < s.end - EPS; t += step, k++) {
          const d = Math.min(step, s.end - t);
          out.push(note(t, d * 0.95, k % 2 === 0 ? root : fifth, k === 0 ? 100 : 85, ch, m));
        }
        break;
      }
      case 'walking': {
        // Quarter notes: root, chord/scale tones, chromatic approach to the next root.
        const next = segs[i + 1];
        const nextRoot = next ? bassPitch(next.chord.bass ?? next.chord.root, root) : root;
        const tones = chordPcs(s.chord);
        const count = Math.max(1, Math.round(len / beat));
        let cur = root;
        for (let k = 0; k < count; k++) {
          const t = s.onset + k * beat;
          let p: number;
          if (k === 0) p = root;
          else if (k === count - 1 && next) p = nextRoot + (nextRoot > cur ? -1 : 1); // approach
          else {
            // Step towards the next root through scale tones, chord tones preferred.
            const dir = nextRoot >= cur ? 1 : -1;
            const choices = [1, 2, 3, 4].map((st) => cur + dir * st).filter((x) => scale.includes(pc(x)));
            const chordy = choices.filter((x) => tones.includes(pc(x)));
            const pool = chordy.length ? chordy : choices;
            p = pool[Math.floor(rand() * Math.min(2, pool.length))] ?? cur;
          }
          p = Math.min(BASS_HIGH, Math.max(BASS_LOW, p));
          out.push(note(t, beat * 0.9, p, k === 0 ? 100 : 82, ch, m));
          cur = p;
        }
        break;
      }
      case 'pop-8ths': {
        const step = beat / 2;
        for (let t = s.onset; t < s.end - EPS; t += step) {
          out.push(note(t, step * 0.8, root, accent(t - s.bar.onset, s.bar, 100, 75), ch, m));
        }
        break;
      }
      default: // 'root': one note per chord segment
        out.push(note(s.onset, len * 0.97, root, 95, ch, m));
    }
    prev = root;
  });
  return out;
}

// ---------------------------------------------------------------- pad

function pad(ctx: GenContext, params: GenParams): PlayedNote[] {
  const ch = params.channel ?? 0;
  const out: PlayedNote[] = [];
  let prev: number[] | null = null;
  // Pads hold through barlines: one voicing per chord span (not per bar).
  for (const c of ctx.chords) {
    const ceiling = ceilingUnder(ctx, c.onset, c.onset + c.duration, 76);
    const v = voiceChord(c, prev, 52, ceiling, 4);
    for (const p of v) out.push(note(c.onset, c.duration * 0.98, p, 70, ch, ctx.bars.find((b) => c.onset < b.onset + b.length)?.number ?? 1));
    prev = v;
  }
  return out;
}

// ---------------------------------------------------------------- arpeggio

const ARP_PATTERNS: Record<string, number[]> = {
  alberti: [0, 2, 1, 2],
  up: [0, 1, 2, 3],
  'up-down': [0, 1, 2, 3, 2, 1]
};

function arpeggio(ctx: GenContext, params: GenParams): PlayedNote[] {
  const ch = params.channel ?? 0;
  const out: PlayedNote[] = [];
  let prev: number[] | null = null;
  for (const s of segments(ctx)) {
    const ceiling = ceilingUnder(ctx, s.onset, s.end, 72);
    const v = voiceChord(s.chord, prev, 48, ceiling, 3);
    prev = v;
    const tones = [...v, v[0] + 12 <= ceiling ? v[0] + 12 : v[1]];
    const m = s.bar.number;
    if (s.final) {
      v.forEach((p, k) => out.push(note(s.onset + k * 0.03, s.end - s.onset - k * 0.03, p, 75, ch, m)));
      continue;
    }
    // Compound metres (6/8, 9/8) roll in eighths up-down; otherwise 8ths.
    const compound = s.bar.denominator === 8 && s.bar.numerator % 3 === 0;
    const style = params.style ?? (compound ? 'up-down' : 'alberti');
    const pattern = ARP_PATTERNS[style] ?? ARP_PATTERNS.alberti;
    const step = compound ? 1 / 8 : beatOf(s.bar) / 2;
    let k = Math.round(s.pos / step);
    for (let t = s.onset; t < s.end - EPS; t += step, k++) {
      out.push(note(t, step * 0.95, tones[pattern[k % pattern.length]], accent(t - s.bar.onset, s.bar, 82, 66), ch, m));
    }
  }
  return out;
}

// ---------------------------------------------------------------- comp

/** Strum positions in beats (from the bar start), with length and accent. */
const COMP_PATTERNS: Record<string, (beats: number) => { at: number; len: number; vel: number }[]> = {
  pop: (beats) =>
    beats === 4
      ? [
          { at: 0, len: 1, vel: 92 },
          { at: 1.5, len: 0.5, vel: 72 },
          { at: 2, len: 1, vel: 84 },
          { at: 3.5, len: 0.5, vel: 72 }
        ]
      : Array.from({ length: beats }, (_, b) => ({ at: b, len: 0.9, vel: b === 0 ? 90 : 72 })),
  ballad: (beats) =>
    beats === 4
      ? [
          { at: 0, len: 2, vel: 80 },
          { at: 2, len: 2, vel: 70 }
        ]
      : [{ at: 0, len: beats, vel: 78 }],
  waltz: (beats) => Array.from({ length: Math.max(0, beats - 1) }, (_, b) => ({ at: b + 1, len: 0.8, vel: 72 })),
  bossa: (beats) =>
    beats === 4
      ? [
          { at: 0, len: 0.5, vel: 80 },
          { at: 1.5, len: 0.5, vel: 76 },
          { at: 3, len: 0.5, vel: 76 }
        ]
      : [{ at: 0, len: 0.5, vel: 80 }]
};

function comp(ctx: GenContext, params: GenParams): PlayedNote[] {
  const ch = params.channel ?? 0;
  const out: PlayedNote[] = [];
  let prev: number[] | null = null;
  for (const s of segments(ctx)) {
    const ceiling = ceilingUnder(ctx, s.onset, s.end, 74);
    const v = voiceChord(s.chord, prev, 55, ceiling, 4);
    prev = v;
    const m = s.bar.number;
    if (s.final) {
      v.forEach((p, k) => out.push(note(s.onset + k * 0.012, s.end - s.onset - k * 0.012, p, 80, ch, m)));
      continue;
    }
    const style = params.style ?? (s.bar.beats === 3 ? 'waltz' : 'pop');
    const beat = beatOf(s.bar);
    for (const hit of (COMP_PATTERNS[style] ?? COMP_PATTERNS.pop)(s.bar.beats)) {
      const t = s.bar.onset + hit.at * beat;
      if (t < s.onset - EPS || t >= s.end - EPS) continue;
      const len = Math.min(hit.len * beat, s.end - t) * 0.95;
      // A quick strum: lowest string first.
      v.forEach((p, k) => out.push(note(t + k * 0.008, len, p, hit.vel, ch, m)));
    }
  }
  return out;
}

// ---------------------------------------------------------------- drums

const KICK = 36;
const SNARE = 38;
const HAT = 42;
const CRASH = 49;
const SIDE_STICK = 37;

function drums(ctx: GenContext, params: GenParams): PlayedNote[] {
  const out: PlayedNote[] = [];
  const hit = (t: number, p: number, v: number, m: number) => out.push(note(t, 1 / 16, p, v, DRUM_CHANNEL, m));
  ctx.bars.forEach((bar, i) => {
    const beat = beatOf(bar);
    const t0 = bar.onset;
    const end = t0 + bar.length;
    const m = bar.number;
    const final = i === ctx.bars.length - 1;
    // A pickup bar is shorter than its nominal length: count from its end.
    const shift = bar.nominal - bar.length;
    const at = (beats: number) => t0 + beats * beat - shift;
    const inBar = (t: number) => t >= t0 - EPS && t < end - EPS;
    if (final) {
      hit(t0, KICK, 105, m);
      hit(t0, CRASH, 100, m);
      return;
    }
    // Crash on the first full bar, and after a repeat/jump.
    const pickup = bar.length < bar.nominal - EPS;
    const firstFull = !pickup && ctx.bars.slice(0, i).every((b) => b.length < b.nominal - EPS);
    if (firstFull || (i > 0 && ctx.bars[i - 1].number + 1 !== bar.number && !pickup)) hit(t0, CRASH, 95, m);
    const next = ctx.bars[i + 1];
    const fill = next && (next.number !== bar.number + 1 || (i + 1) % 8 === 0);
    const compound = bar.denominator === 8 && bar.numerator % 3 === 0;
    const style = params.style ?? (bar.beats === 3 && !compound ? 'waltz' : 'pop');

    if (compound) {
      // 6/8 feel: hats on every eighth, kick on 1, snare on the second dotted beat.
      for (let k = 0; k < bar.numerator; k++) {
        const t = t0 + k / 8 - shift;
        if (inBar(t)) hit(t, HAT, k % 3 === 0 ? 80 : 55, m);
      }
      for (let b = 0; b < bar.beats; b++) {
        const t = at(b);
        if (!inBar(t)) continue;
        hit(t, b % 2 === 0 ? KICK : SNARE, b === 0 ? 100 : 85, m);
      }
    } else if (style === 'waltz') {
      for (let b = 0; b < bar.beats; b++) {
        const t = at(b);
        if (!inBar(t)) continue;
        hit(t, b === 0 ? KICK : HAT, b === 0 ? 95 : 65, m);
        if (b > 0) hit(t, SIDE_STICK, 55, m);
      }
    } else {
      const ballad = style === 'ballad';
      for (let k = 0; k < bar.beats * 2; k++) {
        const t = at(k / 2);
        if (inBar(t) && !(ballad && k % 2 === 1)) hit(t, HAT, k % 2 === 0 ? 75 : 55, m);
      }
      for (let b = 0; b < bar.beats; b++) {
        const t = at(b);
        if (!inBar(t)) continue;
        if (b % 2 === 0) hit(t, KICK, b === 0 ? 100 : 88, m);
        else hit(t, ballad ? SIDE_STICK : SNARE, ballad ? 60 : 90, m);
      }
      if (!ballad && bar.beats === 4 && inBar(at(2.5))) hit(at(2.5), KICK, 70, m);
    }
    if (fill && bar.length >= bar.nominal - EPS) {
      // Snare 16ths over the last beat (replacing the groove there).
      const from = end - beat;
      for (let j = out.length - 1; j >= 0; j--) {
        if (out[j].onset >= from - EPS && out[j].onset < end - EPS && out[j].pitch !== KICK) out.splice(j, 1);
      }
      for (let k = 0; k < 4; k++) hit(from + (k * beat) / 4, SNARE, 70 + k * 8, m);
    }
  });
  return out;
}

// ---------------------------------------------------------------- second voice

function secondVoice(ctx: GenContext, params: GenParams): PlayedNote[] {
  const ch = params.channel ?? 0;
  const scale = scalePcs(ctx.key);
  const out: PlayedNote[] = [];
  /** The diatonic note `steps` scale degrees below `pitch`. */
  const below = (pitch: number, steps: number) => {
    let p = pitch;
    let n = 0;
    while (n < steps) {
      p--;
      if (scale.includes(pc(p))) n++;
    }
    return p;
  };
  for (const n of ctx.melody) {
    const chord = chordAt(ctx.chords, n.onset);
    const tones = chord ? chordPcs(chord) : scale;
    // Prefer a diatonic third below; else a sixth; else the nearest chord tone 3-9 semitones down.
    let p = below(n.pitch, 2);
    if (!tones.includes(pc(p))) {
      const sixth = below(n.pitch, 5);
      if (tones.includes(pc(sixth))) p = sixth;
      else {
        for (let d = 3; d <= 9; d++) {
          if (tones.includes(pc(n.pitch - d))) {
            p = n.pitch - d;
            break;
          }
        }
      }
    }
    if (p < 48) continue; // too low to sing; leave the gap
    out.push(note(n.onset, n.duration, p, n.velocity - 15, ch, n.measure));
  }
  return out;
}

