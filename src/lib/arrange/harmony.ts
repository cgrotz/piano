import type { PlayedNote } from '../score/timeline';
import { chordPcs, pc, scalePcs, type Bar, type Chord, type ChordSpan, type Key } from './theory';

/**
 * Rule-based harmonic analysis: which chord sounds where, when the score has
 * no chord symbols (see COMPOSER.md §2).
 *
 * 1. Slots: one per bar, or two (half bars) when the bar has an even number
 *    of beats ≥ 4 — so a chord can change mid-bar, but only when the notes
 *    clearly ask for it (a mid-bar change costs).
 * 2. Candidates: the key's diatonic chords plus the usual borrowed ones —
 *    V7, V/V (secondary dominant), and in minor the major V / V7.
 * 3. Each slot scores every candidate: notes that are chord tones add, notes
 *    that aren't subtract (less — passing tones are normal); longer and
 *    metrically stronger notes weigh more, the bass most. A bass note on the
 *    root is a strong hint.
 * 4. Transitions reward functional moves (V→I, IV→V, ii→V …), start on I
 *    and end on I (with V before it). A Viterbi pass picks the best path over
 *    the whole piece, so a cadence is judged in context, not bar by bar.
 */

export interface HarmonyInput {
  /** Melody notes (top line). */
  melody: PlayedNote[];
  /** Bass/accompaniment notes (e.g. the left hand), weighted more. May be empty. */
  bass: PlayedNote[];
  bars: Bar[];
  key: Key;
}

interface Candidate extends Chord {
  /** Scale degree 1-7 of the root, 0 for chromatic (secondary dominants). */
  degree: number;
  /** Prior: how common/plain the chord is. */
  prior: number;
}

export function candidates(key: Key): Candidate[] {
  const t = key.tonic;
  const at = (semis: number) => (t + semis) % 12;
  if (key.mode === 'major') {
    return [
      { root: at(0), quality: 'maj', degree: 1, prior: 0.6 },
      { root: at(2), quality: 'min', degree: 2, prior: 0.15 },
      { root: at(4), quality: 'min', degree: 3, prior: 0 },
      { root: at(5), quality: 'maj', degree: 4, prior: 0.45 },
      { root: at(7), quality: 'maj', degree: 5, prior: 0.5 },
      { root: at(7), quality: 'dom7', degree: 5, prior: 0.25 },
      { root: at(9), quality: 'min', degree: 6, prior: 0.2 },
      { root: at(11), quality: 'dim', degree: 7, prior: -0.4 },
      { root: at(2), quality: 'dom7', degree: 0, prior: -0.3 } // V/V
    ];
  }
  return [
    { root: at(0), quality: 'min', degree: 1, prior: 0.6 },
    { root: at(2), quality: 'dim', degree: 2, prior: -0.3 },
    { root: at(3), quality: 'maj', degree: 3, prior: 0.15 },
    { root: at(5), quality: 'min', degree: 4, prior: 0.4 },
    { root: at(7), quality: 'maj', degree: 5, prior: 0.45 },
    { root: at(7), quality: 'dom7', degree: 5, prior: 0.3 },
    { root: at(8), quality: 'maj', degree: 6, prior: 0.2 },
    { root: at(10), quality: 'maj', degree: 7, prior: 0.1 },
    { root: at(11), quality: 'dim7', degree: 0, prior: -0.4 } // vii°7
  ];
}

interface Slot {
  onset: number;
  end: number;
  /** True for the second half of a split bar. */
  midBar: boolean;
  /** Onset of the bar it belongs to, and the bar's beat length. */
  barOnset: number;
  beat: number;
}

function slotsOf(bars: Bar[]): Slot[] {
  const slots: Slot[] = [];
  for (const b of bars) {
    const beat = b.nominal / b.beats;
    const split = b.beats >= 4 && b.beats % 2 === 0 && b.length >= b.nominal - 1e-9;
    if (split) {
      const half = b.length / 2;
      slots.push({ onset: b.onset, end: b.onset + half, midBar: false, barOnset: b.onset, beat });
      slots.push({ onset: b.onset + half, end: b.onset + b.length, midBar: true, barOnset: b.onset, beat });
    } else {
      slots.push({ onset: b.onset, end: b.onset + b.length, midBar: false, barOnset: b.onset, beat });
    }
  }
  return slots;
}

/** Metric weight of an onset inside its bar: downbeat > other beats > off-beats. */
function metricWeight(onset: number, slot: Slot): number {
  const pos = onset - slot.barOnset;
  if (Math.abs(pos) < 1e-6) return 1.5;
  const beats = pos / slot.beat;
  if (Math.abs(beats - Math.round(beats)) < 1e-6) return 1.0;
  return 0.55;
}

/** Evidence for each candidate in one slot. */
function emission(slot: Slot, melody: PlayedNote[], bass: PlayedNote[], cands: Candidate[], scale: Set<number>): number[] {
  const inSlot = (n: PlayedNote) => n.onset < slot.end - 1e-9 && n.onset + n.duration > slot.onset + 1e-9;
  const weightOf = (n: PlayedNote) => {
    const overlap = Math.min(n.onset + n.duration, slot.end) - Math.max(n.onset, slot.onset);
    const struck = n.onset >= slot.onset - 1e-9;
    // Duration in beats, capped so one long note doesn't drown the rest.
    const dur = Math.min(2, overlap / slot.beat);
    return (0.4 + dur) * (struck ? metricWeight(n.onset, slot) : 0.7);
  };
  const mel = melody.filter(inSlot);
  const low = bass.filter(inSlot);
  // Lowest bass note struck first in the slot: the strongest root hint.
  const firstBass = low.length ? low.reduce((a, b) => (b.onset < a.onset || (b.onset === a.onset && b.pitch < a.pitch) ? b : a)) : null;

  return cands.map((c) => {
    const tones = new Set(chordPcs(c));
    let score = 0;
    for (const n of mel) {
      const w = weightOf(n);
      const p = pc(n.pitch);
      if (tones.has(p)) score += w * (p === c.root ? 1.15 : 1);
      else score -= w * (scale.has(p) ? 0.6 : 0.9);
    }
    for (const n of low) {
      const w = weightOf(n) * 1.6;
      const p = pc(n.pitch);
      if (tones.has(p)) score += w;
      else score -= w * 0.9;
    }
    if (firstBass) {
      const p = pc(firstBass.pitch);
      if (p === c.root) score += 1.5;
      else if (tones.has(p)) score += 0.3; // inversion
    }
    return score;
  });
}

/** Transition preference from `a` to `b` (functional harmony, roughly). */
function transition(a: Candidate, b: Candidate, slot: Slot): number {
  const same = a.root === b.root && a.quality === b.quality;
  if (same) return slot.midBar ? 0.8 : 0.35;
  let s = slot.midBar ? -0.9 : 0;
  const from = a.degree;
  const to = b.degree;
  if (from === 5 && to === 1) s += 0.9;
  else if (from === 5 && to === 6) s += 0.3; // deceptive
  else if (from === 4 && to === 5) s += 0.5;
  else if (from === 2 && to === 5) s += 0.6;
  else if (from === 0 && to === 5) s += 0.7; // V/V → V
  else if (from === 6 && (to === 2 || to === 4)) s += 0.3;
  else if (from === 1 && (to === 4 || to === 5 || to === 6)) s += 0.2;
  else if (from === 4 && to === 1) s += 0.3; // plagal
  else if (from === 5 && to === 4) s -= 0.4;
  else if (from === 7 && to === 1) s += 0.5;
  // Same root, different flavour (V → V7): cheap.
  if (a.root === b.root) s += 0.3;
  return s;
}

/**
 * The most plausible chord per slot, merged into spans. Slots with no notes at
 * all keep the previous chord (the transition bonus makes that the winner).
 */
export function analyzeHarmony(input: HarmonyInput): ChordSpan[] {
  const slots = slotsOf(input.bars);
  if (slots.length === 0) return [];
  const cands = candidates(input.key);
  const scale = new Set(scalePcs(input.key));
  const n = cands.length;
  const isTonic = (c: Candidate) => c.degree === 1;

  const score: number[][] = [];
  const back: number[][] = [];
  slots.forEach((slot, i) => {
    const em = emission(slot, input.melody, input.bass, cands, scale);
    const last = i === slots.length - 1;
    const local = cands.map((c, k) => em[k] + c.prior + (last && isTonic(c) ? 2.5 : 0) + (i === 0 && isTonic(c) ? 0.8 : 0));
    if (i === 0) {
      score.push(local);
      back.push(new Array(n).fill(-1));
      return;
    }
    const prev = score[i - 1];
    const row: number[] = [];
    const ptr: number[] = [];
    for (let k = 0; k < n; k++) {
      let best = -Infinity;
      let arg = 0;
      for (let j = 0; j < n; j++) {
        const v = prev[j] + transition(cands[j], cands[k], slot);
        if (v > best) {
          best = v;
          arg = j;
        }
      }
      row.push(best + local[k]);
      ptr.push(arg);
    }
    score.push(row);
    back.push(ptr);
  });

  // Trace back.
  const path = new Array<number>(slots.length);
  const lastRow = score[slots.length - 1];
  path[slots.length - 1] = lastRow.indexOf(Math.max(...lastRow));
  for (let i = slots.length - 1; i > 0; i--) path[i - 1] = back[i][path[i]];

  const spans: ChordSpan[] = [];
  slots.forEach((slot, i) => {
    const c = cands[path[i]];
    const prev = spans[spans.length - 1];
    if (prev && prev.root === c.root && prev.quality === c.quality && Math.abs(prev.onset + prev.duration - slot.onset) < 1e-9) {
      prev.duration = slot.end - prev.onset;
    } else {
      spans.push({ root: c.root, quality: c.quality, onset: slot.onset, duration: slot.end - slot.onset });
    }
  });
  return spans;
}

/**
 * Split a score's notes into the melody (the top line of `melodyStaves`) and
 * the bass evidence (every note of `bassStaves`).
 */
export function melodyAndBass(notes: PlayedNote[], melodyStaves: number[], bassStaves: number[]): { melody: PlayedNote[]; bass: PlayedNote[] } {
  const mel = notes.filter((n) => n.staff !== undefined && melodyStaves.includes(n.staff));
  // Skyline: at each onset keep only the highest note.
  const top = new Map<number, PlayedNote>();
  for (const n of mel) {
    const key = Math.round(n.onset * 1e6);
    const cur = top.get(key);
    if (!cur || n.pitch > cur.pitch) top.set(key, n);
  }
  const melody = [...top.values()].sort((a, b) => a.onset - b.onset);
  const bass = notes.filter((n) => n.staff !== undefined && bassStaves.includes(n.staff));
  return { melody, bass };
}

/** Chord sounding at `t`, if any. */
export function chordAt(chords: ChordSpan[], t: number): ChordSpan | undefined {
  return chords.find((c) => t >= c.onset - 1e-9 && t < c.onset + c.duration - 1e-9);
}
