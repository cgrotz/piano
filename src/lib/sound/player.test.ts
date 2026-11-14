import { describe, it, expect } from 'vitest';
import { TimelinePlayer, type PlayerClock } from './player';
import type { SoundOut } from './soundOut';
import type { PlayedNote } from '../score/timeline';

/** A SoundOut that records events against a hand-advanced clock. */
class FakeOut implements SoundOut {
  currentTime = 0;
  events: { type: string; ch: number; pitch?: number; at?: number; program?: number }[] = [];
  async resume() {}
  program(ch: number, program: number) {
    this.events.push({ type: 'program', ch, program });
  }
  volume() {}
  noteOn(ch: number, pitch: number, _vel: number, at?: number) {
    this.events.push({ type: 'on', ch, pitch, at });
  }
  noteOff(ch: number, pitch: number, at?: number) {
    this.events.push({ type: 'off', ch, pitch, at });
  }
  allNotesOff() {
    this.events.push({ type: 'stop', ch: -1 });
  }
  dispose() {}
  ons() {
    return this.events.filter((e) => e.type === 'on');
  }
}

/** Timers that only fire when the test says so. */
function manualClock() {
  const frames: (() => void)[] = [];
  const clock: PlayerClock = {
    setInterval: () => 1,
    clearInterval: () => {},
    requestFrame: (fn) => frames.push(fn),
    cancelFrame: () => {}
  };
  return { clock, frame: () => frames.splice(0).forEach((f) => f()) };
}

const note = (onset: number, pitch: number, duration = 0.25, cursorIndex = 0, measure = 1): PlayedNote => ({
  onset,
  duration,
  pitch,
  velocity: 80,
  channel: 0,
  cursorIndex,
  measure
});

// Four quarter notes; at 2 s per whole note each lasts 0.5 s.
const SCALE = [note(0, 60, 0.25, 0), note(0.25, 62, 0.25, 1), note(0.5, 64, 0.25, 2), note(0.75, 65, 0.25, 3)];

describe('TimelinePlayer', () => {
  it('schedules only notes inside the lookahead window, with exact times', () => {
    const out = new FakeOut();
    const { clock } = manualClock();
    const p = new TimelinePlayer(out, SCALE, clock);
    p.start({ secondsPerWhole: 2 });
    // t0 = 0.1 (start delay); window reaches 0.15 → only the first note.
    expect(out.ons().map((e) => [e.pitch, e.at])).toEqual([[60, 0.1]]);
    out.currentTime = 0.5;
    p.pump();
    expect(out.ons().map((e) => [e.pitch, e.at])).toEqual([
      [60, 0.1],
      [62, 0.6]
    ]);
  });

  it('releases each note just before its written end', () => {
    const out = new FakeOut();
    const p = new TimelinePlayer(out, SCALE, manualClock().clock);
    p.start({ secondsPerWhole: 2 });
    const off = out.events.find((e) => e.type === 'off')!;
    expect(off.at).toBeCloseTo(0.1 + 0.5 - 0.01);
  });

  it('plays a sub-range and ends after its last note', () => {
    const out = new FakeOut();
    let ended = false;
    const p = new TimelinePlayer(out, SCALE, manualClock().clock);
    p.start({ secondsPerWhole: 2, from: 0.25, to: 0.75, onEnd: () => (ended = true) });
    for (let t = 0; t <= 2; t += 0.05) {
      out.currentTime = t;
      p.pump();
    }
    expect(out.ons().map((e) => e.pitch)).toEqual([62, 64]);
    expect(ended).toBe(true);
    expect(p.playing).toBe(false);
  });

  it('moves the cursor when the sound gets there, not when scheduled', () => {
    const out = new FakeOut();
    const { clock, frame } = manualClock();
    const seen: number[] = [];
    const p = new TimelinePlayer(out, SCALE, clock);
    p.start({ secondsPerWhole: 2, onCursor: (i) => seen.push(i) });
    out.currentTime = 0.55;
    p.pump(); // second note scheduled for 0.6
    frame();
    expect(seen).toEqual([0]);
    out.currentTime = 0.61;
    frame();
    expect(seen).toEqual([0, 1]);
  });

  it('stop silences and schedules nothing more', () => {
    const out = new FakeOut();
    const p = new TimelinePlayer(out, SCALE, manualClock().clock);
    p.start({ secondsPerWhole: 2 });
    p.stop();
    out.currentTime = 1;
    p.pump();
    expect(out.ons()).toHaveLength(1);
    expect(out.events.at(-1)?.type).toBe('stop');
  });

  it('waits for a muted output before starting again', () => {
    const out = new FakeOut() as FakeOut & { quietUntil: number };
    out.quietUntil = 0.4;
    const p = new TimelinePlayer(out, SCALE, manualClock().clock);
    p.start({ secondsPerWhole: 2 });
    out.currentTime = 0.3;
    p.pump();
    expect(out.ons()[0].at).toBe(0.4);
  });
});
