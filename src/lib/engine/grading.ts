import type { GradedStep } from '../score/extractor';

export type GradingStatus = 'empty' | 'playing' | 'completed';

/** Result of feeding one note-on to the engine; the controller maps these to OSMD actions. */
export type NoteOutcome =
  | 'idle' // not playing (no steps, or already completed)
  | 'wrong' // pitch not in the current step -> flash red, stay put
  | 'progress' // correct chord tone, but the step isn't complete yet
  | 'advanced' // step completed, moved to the next one
  | 'completed'; // step completed, and that was the final step

/**
 * The core grading loop (component 9 in ARCHITECTURE.md).
 *
 * Pure logic, no Svelte/OSMD/MIDI dependencies, so it is trivially testable.
 * Model: block on the current step until every expected pitch has been played.
 * - Wrong pitch: reported as 'wrong'; the step does NOT advance and already-correct
 *   chord tones are kept (the "lean" rule from DESIGN.md).
 * - Re-pressing an already-correct tone is harmless.
 * - Timing is irrelevant: the engine never reads a clock.
 */
export class GradingEngine {
  #steps: GradedStep[] = [];
  #index = 0;
  #satisfied = new Set<number>();
  #status: GradingStatus = 'empty';
  #errors = 0;

  load(steps: GradedStep[]): void {
    this.#steps = steps;
    this.#index = 0;
    this.#satisfied.clear();
    this.#errors = 0;
    this.#status = steps.length > 0 ? 'playing' : 'empty';
  }

  reset(): void {
    this.load(this.#steps);
  }

  pressNote(pitch: number): NoteOutcome {
    if (this.#status !== 'playing') return 'idle';

    const expected = this.#steps[this.#index].pitches;
    if (!expected.includes(pitch)) {
      this.#errors++;
      return 'wrong';
    }

    this.#satisfied.add(pitch);
    const complete = expected.every((p) => this.#satisfied.has(p));
    if (!complete) return 'progress';

    this.#index++;
    this.#satisfied.clear();
    if (this.#index >= this.#steps.length) {
      this.#status = 'completed';
      return 'completed';
    }
    return 'advanced';
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
