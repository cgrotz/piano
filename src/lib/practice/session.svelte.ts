import { GradingEngine, type GradingStatus } from '../engine/grading';
import type { ExtractOptions, GradedStep } from '../score/extractor';
import type { HandOption } from '../score/hands';
import type { MidiEvent } from '../midi/types';
import { barSpan, selectBars, withGuideTolerance } from './steps';

/** What the session needs from the notation view (ScoreRenderer implements it). */
export interface SessionRenderer {
  extractSteps(options: ExtractOptions): GradedStep[];
  reset(): void;
  clearHighlight(): void;
  moveToIndex(cursorIndex: number): void;
  highlightWrong(staves?: number[]): void;
  finish(): void;
}

export interface RunResult {
  notes: number;
  mistakes: number;
  accuracy: number;
  /** True when the run covered the whole piece (counts towards "best"). */
  wholePiece: boolean;
  /** Bars with mistakes, worst first. */
  troubleBars: { bar: number; mistakes: number }[];
}

export function accuracyOf(notes: number, mistakes: number): number {
  return notes + mistakes === 0 ? 100 : Math.round((notes / (notes + mistakes)) * 100);
}

const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (n: number) => BLACK.has(((n % 12) + 12) % 12);

/**
 * One practice run over a score: which hand and bars are graded, the grading
 * engine, and the reactive state the player renders (current step, keys to
 * light, progress, loop tally, result). Owns no DOM; drives the notation view
 * through {@link SessionRenderer}, so it can be tested without a browser.
 */
export class PracticeSession {
  // Configuration
  hand = $state<HandOption | null>(null);
  showGuide = $state(false);
  loop = $state(false);
  barFirst = $state(1);
  barLast = $state(1);
  fromBar = $state(1);
  toBar = $state(1);

  // Run state
  status = $state<GradingStatus>('empty');
  total = $state(0);
  errors = $state(0);
  stepIndex = $state(0);
  expected = $state<number[]>([]);
  sustained = $state<number[]>([]);
  leftPitches = $state<number[]>([]);
  chordName = $state<string | null>(null);
  chordPitches = $state<number[]>([]);
  currentBar = $state<number | null>(null);
  /** Held keys whose press was graded wrong (the only ones drawn red). */
  wrongHeld = $state<Set<number>>(new Set());
  /**
   * Notes let go of while they should still sound (a "keep holding" hint —
   * never counted as a mistake). Cleared when re-pressed or once the note
   * is no longer meant to be held.
   */
  releasedEarly = $state<number[]>([]);
  #pedalDown = false;
  loopCount = $state(0);
  lastLoopErrors = $state(0);
  /** Set when a non-looping run finishes. */
  result = $state<RunResult | null>(null);
  keyLow = $state(60);
  keyHigh = $state(72);

  #engine = new GradingEngine();
  #renderer: SessionRenderer;
  #base: GradedStep[] = [];
  #steps: GradedStep[] = [];
  #wholePiece = true;
  #mistakesByBar = new Map<number, number>();
  #onComplete?: (r: RunResult) => void;

  constructor(renderer: SessionRenderer, onComplete?: (r: RunResult) => void) {
    this.#renderer = renderer;
    this.#onComplete = onComplete;
  }

  get rangeOn(): boolean {
    return this.fromBar !== this.barFirst || this.toBar !== this.barLast;
  }

  get bothHands(): boolean {
    return this.hand?.kind === 'both';
  }

  isLeft(pitch: number): boolean {
    return this.bothHands ? this.leftPitches.includes(pitch) : this.hand?.kind === 'left';
  }

  #options(h: HandOption): ExtractOptions {
    return { staffIndex: h.staves, leftStaff: h.leftStaff, alongStaves: h.alongStaves };
  }

  #allSteps(): GradedStep[] {
    return this.hand ? this.#renderer.extractSteps(this.#options(this.hand)) : [];
  }

  /**
   * Choose what to practise (before or between runs): the hand's bar span,
   * keeping `from`/`to` where they fit, and a keyboard sized to the hand's
   * range so it doesn't jump when the run starts.
   */
  prepare(hand: HandOption, from?: number, to?: number): void {
    this.hand = hand;
    const all = this.#allSteps();
    const span = barSpan(all);
    this.barFirst = span.first;
    this.barLast = span.last;
    const fits = (n?: number): n is number => n !== undefined && n >= span.first && n <= span.last;
    this.fromBar = fits(from) ? from : span.first;
    this.toBar = fits(to) && to >= this.fromBar ? to : span.last;
    this.#fitKeyboard(all);
  }

  /** Switch hand, keeping a custom bar range; restarts a run in progress. */
  selectHand(hand: HandOption): void {
    if (this.rangeOn) this.prepare(hand, this.fromBar, this.toBar);
    else this.prepare(hand);
    if (this.status !== 'empty') this.start();
  }

  setRange(from: number, to: number): void {
    const clamp = (n: number) => Math.min(this.barLast, Math.max(this.barFirst, Math.round(n)));
    const a = clamp(Math.min(from, to));
    const b = clamp(Math.max(from, to));
    this.fromBar = a;
    this.toBar = b;
    if (this.status !== 'empty') this.start();
  }

  wholePieceRange(): void {
    this.setRange(this.barFirst, this.barLast);
  }

  setGuide(on: boolean): void {
    this.showGuide = on;
    this.#fitKeyboard(this.#allSteps());
    if (this.status === 'playing') {
      this.#steps = withGuideTolerance(this.#base, on);
      this.#engine.updateSteps(this.#steps);
      this.#sync();
    }
  }

  /** Start (or restart) a run over the selected hand and bar range. */
  start(): void {
    const all = this.#allSteps();
    const range = selectBars(all, this.fromBar, this.toBar) ?? { start: 0, end: all.length - 1 };
    this.#wholePiece = range.start === 0 && range.end === all.length - 1;
    this.#base = all.slice(range.start, range.end + 1);
    this.#steps = withGuideTolerance(this.#base, this.showGuide);
    this.#fitKeyboard(all);
    this.#engine.load(this.#steps);
    this.loopCount = 0;
    this.#beginPass();
  }

  /** Go back to the start of the current run. */
  restart(): void {
    if (this.#steps.length === 0) return;
    this.#engine.reset();
    this.#beginPass();
  }

  #beginPass(): void {
    this.wrongHeld = new Set();
    this.releasedEarly = [];
    this.result = null;
    this.#mistakesByBar.clear();
    this.#renderer.reset();
    this.#renderer.clearHighlight();
    if (this.#steps.length > 0) this.#renderer.moveToIndex(this.#steps[0].cursorIndex);
    this.#sync();
  }

  /** Feed one MIDI event (notes and the sustain pedal). */
  handle(event: MidiEvent): void {
    if (event.type === 'pedal') {
      this.#pedalDown = event.down;
      if (event.down) this.releasedEarly = [];
      return;
    }
    if (event.type !== 'noteOn') {
      // Releasing a key clears its wrong-press state so it stops glowing red.
      if (this.wrongHeld.has(event.pitch)) {
        const next = new Set(this.wrongHeld);
        next.delete(event.pitch);
        this.wrongHeld = next;
      }
      if (this.#mustKeepHolding(event.pitch)) {
        this.releasedEarly = [...this.releasedEarly, event.pitch];
      }
      return;
    }
    if (this.releasedEarly.includes(event.pitch)) {
      this.releasedEarly = this.releasedEarly.filter((p) => p !== event.pitch);
    }
    // Re-striking a note that should still be sounding (to hold it again) is
    // fine — neither progress nor a mistake.
    if (this.status === 'playing' && this.sustained.includes(event.pitch) && !this.expected.includes(event.pitch)) {
      return;
    }
    const bar = this.#steps[this.#engine.index]?.measure;
    switch (this.#engine.pressNote(event.pitch)) {
      case 'wrong':
        this.wrongHeld = new Set([...this.wrongHeld, event.pitch]);
        if (bar !== undefined) this.#mistakesByBar.set(bar, (this.#mistakesByBar.get(bar) ?? 0) + 1);
        this.#renderer.highlightWrong(this.hand?.staves);
        break;
      case 'progress':
        this.#renderer.clearHighlight();
        break;
      case 'advanced':
        this.#renderer.clearHighlight();
        this.#renderer.moveToIndex(this.#steps[this.#engine.index].cursorIndex);
        break;
      case 'completed':
        this.#renderer.clearHighlight();
        this.#sync();
        this.#complete();
        return;
    }
    this.#sync();
  }

  /**
   * Released while the score says it should still sound — and it keeps
   * sounding past the next note to play (letting go right before a note's
   * written end is normal, not worth a hint). The pedal sustains for you.
   */
  #mustKeepHolding(pitch: number): boolean {
    if (this.#pedalDown || this.status !== 'playing') return false;
    const i = this.#engine.index;
    return !!this.#steps[i]?.sustained?.includes(pitch) && !!this.#steps[i + 1]?.sustained?.includes(pitch);
  }

  #complete(): void {
    const result: RunResult = {
      notes: this.#engine.total,
      mistakes: this.#engine.errorCount,
      accuracy: accuracyOf(this.#engine.total, this.#engine.errorCount),
      wholePiece: this.#wholePiece,
      troubleBars: [...this.#mistakesByBar]
        .map(([bar, mistakes]) => ({ bar, mistakes }))
        .sort((a, b) => b.mistakes - a.mistakes || a.bar - b.bar)
    };
    if (this.loop) {
      // Straight into the next pass; keep a tally so progress is visible.
      this.loopCount++;
      this.lastLoopErrors = result.mistakes;
      this.restart();
      return;
    }
    this.#renderer.finish();
    this.result = result;
    this.#onComplete?.(result);
  }

  #sync(): void {
    const e = this.#engine;
    this.status = e.status;
    this.total = e.total;
    this.errors = e.errorCount;
    this.stepIndex = e.index;
    this.expected = e.currentPitches;
    const step = this.#steps[e.index];
    this.sustained = step?.sustained ?? [];
    this.leftPitches = step?.leftPitches ?? [];
    this.chordName = step?.chordName ?? null;
    this.chordPitches = step?.chordPitches ?? [];
    this.currentBar = step?.measure ?? null;
    // Drop hints for notes that no longer need holding at this step.
    if (this.releasedEarly.length) {
      const still = new Set(this.sustained);
      this.releasedEarly = this.releasedEarly.filter((p) => still.has(p));
    }
  }

  /** Crop the keyboard to the played range, never starting/ending on a black key. */
  #fitKeyboard(steps: GradedStep[]): void {
    const pitches = [
      ...steps.flatMap((s) => s.pitches),
      ...(this.showGuide ? steps.flatMap((s) => s.chordPitches ?? []) : [])
    ];
    if (pitches.length === 0) return;
    let lo = Math.min(...pitches);
    let hi = Math.max(...pitches);
    if (isBlack(lo)) lo -= 1;
    if (isBlack(hi)) hi += 1;
    this.keyLow = lo;
    this.keyHigh = hi;
  }
}
