import type { PlayedNote, PlayedPart } from '../score/timeline';
import type { SoundOut } from './soundOut';

export interface PlayOptions {
  /** Seconds per whole note (tempo). */
  secondsPerWhole: number;
  /** Start position in whole notes on the enrolled timeline. Default 0. */
  from?: number;
  /** Stop position (exclusive) in whole notes. Default: after the last note. */
  to?: number;
  /** Called (on the animation frame nearest the sound) when the cursor should move. */
  onCursor?: (cursorIndex: number) => void;
  /** Called once the last note has finished sounding (not on `stop()`). */
  onEnd?: () => void;
}

/** Timer hooks, injectable for tests. */
export interface PlayerClock {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  requestFrame(fn: () => void): unknown;
  cancelFrame(handle: unknown): void;
}

const browserClock: PlayerClock = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  requestFrame: (fn) => requestAnimationFrame(fn),
  cancelFrame: (h) => cancelAnimationFrame(h as number)
};

/**
 * Plays a note timeline at a fixed tempo through a {@link SoundOut} — the
 * composer's "Listen" preview, and the clock the accompaniment follower will
 * later replace with the player's own pace.
 *
 * Uses the same lookahead technique as the metronome: a coarse timer wakes
 * every 25 ms and hands every note starting in the next ~150 ms to the synth
 * with an exact timestamp, so timing never depends on the main thread. Cursor
 * moves are queued with their audio time and released on animation frames, so
 * the score follows the sound rather than the scheduler.
 */
export class TimelinePlayer {
  static readonly LOOKAHEAD_MS = 25;
  static readonly SCHEDULE_AHEAD = 0.15;
  /** Lead-in before the first note, seconds. */
  static readonly START_DELAY = 0.1;

  #out: SoundOut;
  #clock: PlayerClock;
  #notes: PlayedNote[];
  #opts: PlayOptions | null = null;
  #next = 0; // index of the next note to schedule
  #t0 = 0; // output time of score position `from`
  #from = 0;
  #endTime = 0; // output time at which the last note has ended
  #timer: unknown = null;
  #frame: unknown = null;
  #cursorQueue: { time: number; cursorIndex: number }[] = [];
  #lastCursor = -1;

  playing = false;

  constructor(out: SoundOut, notes: PlayedNote[], clock: PlayerClock = browserClock) {
    this.#out = out;
    this.#clock = clock;
    this.#notes = [...notes].sort((a, b) => a.onset - b.onset);
  }

  /** Set each part's instrument (program change per channel). */
  setParts(parts: PlayedPart[]): void {
    for (const p of parts) this.#out.program(p.channel, p.program);
  }

  start(opts: PlayOptions): void {
    this.stop();
    if (!(opts.secondsPerWhole > 0)) throw new Error('TimelinePlayer: tempo must be positive');
    this.#opts = opts;
    this.#from = opts.from ?? 0;
    const to = opts.to ?? Infinity;
    this.#next = this.#notes.findIndex((n) => n.onset >= this.#from - 1e-9);
    if (this.#next < 0) this.#next = this.#notes.length;
    this.#t0 = Math.max(this.#out.currentTime + TimelinePlayer.START_DELAY, this.#out.quietUntil ?? 0);
    let lastEnd = this.#from;
    for (let i = this.#next; i < this.#notes.length && this.#notes[i].onset < to - 1e-9; i++) {
      const n = this.#notes[i];
      lastEnd = Math.max(lastEnd, Math.min(n.onset + n.duration, to));
    }
    this.#endTime = this.#timeOf(lastEnd);
    this.#cursorQueue = [];
    this.#lastCursor = -1;
    this.playing = true;
    this.pump();
    this.#timer = this.#clock.setInterval(() => this.pump(), TimelinePlayer.LOOKAHEAD_MS);
    this.#frame = this.#clock.requestFrame(() => this.#draw());
  }

  stop(): void {
    if (this.#timer !== null) this.#clock.clearInterval(this.#timer);
    if (this.#frame !== null) this.#clock.cancelFrame(this.#frame);
    this.#timer = this.#frame = null;
    this.#cursorQueue = [];
    if (this.playing) this.#out.allNotesOff();
    this.playing = false;
  }

  /** Output time of a score position, at the current tempo. */
  #timeOf(pos: number): number {
    return this.#t0 + (pos - this.#from) * this.#opts!.secondsPerWhole;
  }

  /** Schedule every note that starts inside the lookahead window. Public for tests. */
  pump(): void {
    if (!this.playing || !this.#opts) return;
    const now = this.#out.currentTime;
    const horizon = now + TimelinePlayer.SCHEDULE_AHEAD;
    const to = this.#opts.to ?? Infinity;
    while (this.#next < this.#notes.length) {
      const n = this.#notes[this.#next];
      if (n.onset >= to - 1e-9) {
        this.#next = this.#notes.length;
        break;
      }
      const at = this.#timeOf(n.onset);
      if (at > horizon) break;
      const end = Math.min(n.onset + n.duration, to);
      // Tiny gap before the written end so repeated notes re-articulate.
      const off = Math.max(at + 0.02, this.#timeOf(end) - 0.01);
      this.#out.noteOn(n.channel, n.pitch, n.velocity, Math.max(at, now));
      this.#out.noteOff(n.channel, n.pitch, off);
      if (n.cursorIndex !== this.#lastCursor) {
        this.#cursorQueue.push({ time: at, cursorIndex: n.cursorIndex });
        this.#lastCursor = n.cursorIndex;
      }
      this.#next++;
    }
    if (this.#next >= this.#notes.length && now >= this.#endTime) {
      const onEnd = this.#opts.onEnd;
      this.stop();
      onEnd?.();
    }
  }

  #draw(): void {
    if (!this.playing) return;
    const now = this.#out.currentTime;
    let latest: number | null = null;
    while (this.#cursorQueue.length && this.#cursorQueue[0].time <= now) {
      latest = this.#cursorQueue.shift()!.cursorIndex;
    }
    if (latest !== null) this.#opts?.onCursor?.(latest);
    this.#frame = this.#clock.requestFrame(() => this.#draw());
  }
}
