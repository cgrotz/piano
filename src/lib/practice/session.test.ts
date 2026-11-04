import { describe, it, expect, beforeEach } from 'vitest';
import { PracticeSession, type SessionRenderer, type RunResult } from './session.svelte';
import type { GradedStep } from '../score/extractor';
import type { HandOption } from '../score/hands';

/** Bars 1-4, one note per beat-ish; bar 2 carries a chord symbol. */
const STEPS: GradedStep[] = [
  { pitches: [60], measure: 1, cursorIndex: 0 },
  { pitches: [62], measure: 1, cursorIndex: 1 },
  { pitches: [64], measure: 2, cursorIndex: 2, chordPitches: [48, 52, 55] },
  { pitches: [65], measure: 3, cursorIndex: 3 },
  { pitches: [67], measure: 4, cursorIndex: 4 }
];

const RIGHT: HandOption = { id: 'right', label: 'Right', kind: 'right', staves: [0], alongStaves: [1] };

class FakeRenderer implements SessionRenderer {
  cursor = -1;
  finished = false;
  highlights = 0;
  extractSteps() {
    return STEPS.map((s) => ({ ...s }));
  }
  reset() {
    this.cursor = 0;
    this.finished = false;
  }
  clearHighlight() {}
  moveToIndex(i: number) {
    this.cursor = i;
  }
  highlightWrong() {
    this.highlights++;
  }
  finish() {
    this.finished = true;
  }
}

describe('PracticeSession', () => {
  let r: FakeRenderer;
  let s: PracticeSession;
  let results: RunResult[];
  const play = (...pitches: number[]) =>
    pitches.forEach((p) => {
      s.handle({ type: 'noteOn', pitch: p, velocity: 80 });
      s.handle({ type: 'noteOff', pitch: p });
    });

  beforeEach(() => {
    r = new FakeRenderer();
    results = [];
    s = new PracticeSession(r, (res) => results.push(res));
    s.prepare(RIGHT);
  });

  it('prepares the bar span and keyboard before the run starts', () => {
    expect([s.barFirst, s.barLast, s.fromBar, s.toBar]).toEqual([1, 4, 1, 4]);
    expect([s.keyLow, s.keyHigh]).toEqual([60, 67]);
    expect(s.status).toBe('empty');
  });

  it('runs the whole piece and reports trouble bars', () => {
    s.start();
    play(60, 62, 70, 71, 64, 65, 67);
    expect(s.status).toBe('completed');
    expect(r.finished).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ notes: 5, mistakes: 2, wholePiece: true });
    expect(results[0].troubleBars).toEqual([{ bar: 2, mistakes: 2 }]);
  });

  it('practises just the chosen bars and moves the cursor there', () => {
    s.setRange(2, 3);
    s.start();
    expect(r.cursor).toBe(2);
    expect(s.currentBar).toBe(2);
    play(64, 65);
    expect(s.status).toBe('completed');
    expect(results[0].wholePiece).toBe(false);
  });

  it('loops a range, counting passes and the last pass’s mistakes', () => {
    s.setRange(3, 4);
    s.loop = true;
    s.start();
    play(65, 66, 67); // one mistake
    expect(s.status).toBe('playing');
    expect(s.loopCount).toBe(1);
    expect(s.lastLoopErrors).toBe(1);
    expect(r.cursor).toBe(3); // back at the start of the range
    expect(results).toHaveLength(0);
  });

  it('keeps a custom range when switching hands', () => {
    s.setRange(2, 3);
    s.selectHand({ ...RIGHT, id: 'left', kind: 'left', staves: [1], alongStaves: [0] });
    expect([s.fromBar, s.toBar]).toEqual([2, 3]);
  });

  it('does not count chord-guide keys as mistakes while the guide is on', () => {
    s.start();
    play(60, 62);
    s.setGuide(true);
    play(48); // guide note at bar 2
    expect(s.errors).toBe(0);
    s.setGuide(false);
    play(48);
    expect(s.errors).toBe(1);
  });

  it('marks a wrong key red until it is released', () => {
    s.start();
    s.handle({ type: 'noteOn', pitch: 70, velocity: 80 });
    expect([...s.wrongHeld]).toEqual([70]);
    expect(r.highlights).toBe(1);
    s.handle({ type: 'noteOff', pitch: 70 });
    expect(s.wrongHeld.size).toBe(0);
  });
});
