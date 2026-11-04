import type { GradedStep } from '../score/extractor';

export type GradingStatus = 'empty' | 'playing' | 'completed';

/** Result of feeding one note-on to the engine; the controller maps these to OSMD actions. */
export type NoteOutcome =
  | 'idle' // not playing (no steps, or already completed)
  | 'wrong' // pitch not in the current step -> flash red, stay put
  | 'progress' // correct chord tone, but the step isn't complete yet
  | 'early' // belongs to the NEXT step: banked for it, not an error
  | 'ignored' // the other (ungraded) hand's note: neither right nor wrong
  | 'advanced' // step completed, moved on (possibly past several banked steps)
  | 'completed'; // step completed, and that was the final step

/**
 * The core grading loop (component 9 in ARCHITECTURE.md).
 *
 * Pure logic, no Svelte/OSMD/MIDI dependencies, so it is trivially testable.
 * Model: block on the current step until every expected pitch has been played.
 * - Wrong pitch: reported as 'wrong'; the step does NOT advance and already-correct
 *   chord tones are kept (the "lean" rule from DESIGN.md).
 * - Re-pressing an already-correct tone is harmless.
 * - A pitch of the NEXT step pressed before the current one is finished (real
 *   hands rarely land exactly together — e.g. the left hand a hair ahead) is
 *   banked for that step instead of counted wrong, so you never have to
 *   re-strike a key you are already holding once the cursor gets there.
 * - A pitch listed in the step's `tolerated` (the other, ungraded hand playing
 *   along) is ignored: no error, no red.
 * - Timing is irrelevant: the engine never reads a clock.
 */
export class GradingEngine {
  #steps: GradedStep[] = [];
  #index = 0;
  #satisfied = new Set<number>();
  /** Pitches of the next step that were pressed early. */
  #early = new Set<number>();
  #status: GradingStatus = 'empty';
  #errors = 0;

  load(steps: GradedStep[]): void {
    this.#steps = steps;
    this.#index = 0;
    this.#satisfied.clear();
    this.#early.clear();
    this.#errors = 0;
    this.#status = steps.length > 0 ? 'playing' : 'empty';
  }

  reset(): void {
    this.load(this.#steps);
  }

  pressNote(pitch: number): NoteOutcome {
    if (this.#status !== 'playing') return 'idle';

    const step = this.#steps[this.#index];
    // Re-striking a tone this step already has, when the next step needs that
    // same pitch (a repeated note played a hair early), is for the next step.
    if (this.#satisfied.has(pitch) && this.#steps[this.#index + 1]?.pitches.includes(pitch)) {
      this.#early.add(pitch);
      return 'early';
    }
    if (!step.pitches.includes(pitch)) {
      if (this.#steps[this.#index + 1]?.pitches.includes(pitch)) {
        this.#early.add(pitch);
        return 'early';
      }
      if (step.tolerated?.includes(pitch)) return 'ignored';
      this.#errors++;
      return 'wrong';
    }

    this.#satisfied.add(pitch);
    if (!this.#isComplete()) return 'progress';
    return this.#advance();
  }

  /**
   * Move past the completed step. Notes banked early seed the next step; if
   * they already complete it, keep going.
   */
  #advance(): NoteOutcome {
    do {
      this.#index++;
      if (this.#index >= this.#steps.length) {
        this.#satisfied.clear();
        this.#early.clear();
        this.#status = 'completed';
        return 'completed';
      }
      const next = this.#steps[this.#index].pitches;
      this.#satisfied = new Set([...this.#early].filter((p) => next.includes(p)));
      this.#early.clear();
    } while (this.#isComplete());
    return 'advanced';
  }

  #isComplete(): boolean {
    return this.#steps[this.#index].pitches.every((p) => this.#satisfied.has(p));
  }

  get status(): GradingStatus {
    return this.#status;
  }
  get index(): number {
    return this.#index;
  }
  get total(): number {
    return this.#steps.length;
  }
  get errorCount(): number {
    return this.#errors;
  }
  /** Expected pitches for the current step (empty unless playing). */
  get currentPitches(): number[] {
    return this.#status === 'playing' ? this.#steps[this.#index].pitches : [];
  }
  get satisfiedPitches(): number[] {
    return [...this.#satisfied];
  }
}
