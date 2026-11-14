import type { Timeline } from '../score/timeline';
import { barRangeSpan } from '../score/timeline';
import type { SoundOut } from './soundOut';
import { TimelinePlayer } from './player';

export type ListenStatus = 'idle' | 'loading' | 'playing' | 'error';

/**
 * "Listen": the computer plays the piece (or the selected bars) so you can hear
 * how it should sound, with the cursor following along.
 *
 * The synth and its sound bank are loaded on first use only — they're large —
 * and kept for the rest of the visit. The synth module itself is imported
 * lazily so it stays out of the player's bundle.
 */
export class ListenController {
  status = $state<ListenStatus>('idle');
  /** Sound-bank download progress 0..1 while loading. */
  progress = $state(0);
  error = $state<string | null>(null);

  #out: SoundOut | null = null;
  #player: TimelinePlayer | null = null;
  #timeline: Timeline | null = null;
  #disposed = false;
  #generation = 0;

  get playing(): boolean {
    return this.status === 'playing';
  }

  /**
   * Play `timeline` from `fromBar` to `toBar` (printed bar numbers) at `bpm`
   * beats per minute, a beat being `beatLength` whole notes (the metronome's
   * beat). Call from a user gesture: it unlocks audio.
   */
  async play(opts: {
    timeline: Timeline;
    bpm: number;
    beatLength: number;
    fromBar: number;
    toBar: number;
    onCursor: (cursorIndex: number) => void;
    onEnd: () => void;
  }): Promise<void> {
    this.stop();
    const gen = ++this.#generation;
    this.error = null;
    try {
      if (!this.#out) {
        this.status = 'loading';
        this.progress = 0;
        const { SpessaSoundOut } = await import('./spessa');
        const out = await SpessaSoundOut.create(undefined, (f) => (this.progress = f));
        if (this.#disposed) {
          out.dispose();
          return;
        }
        this.#out = out;
        if (gen !== this.#generation) return;
      }
      await this.#out.resume();
      if (gen !== this.#generation) return; // stopped (or restarted) while loading
      if (this.#timeline !== opts.timeline) {
        this.#timeline = opts.timeline;
        this.#player = new TimelinePlayer(this.#out, opts.timeline.notes);
      }
      this.#player!.setParts(opts.timeline.parts);
      const span = barRangeSpan(opts.timeline.notes, opts.fromBar, opts.toBar) ?? { from: 0, to: Infinity };
      this.#player!.start({
        secondsPerWhole: 60 / opts.bpm / opts.beatLength,
        from: span.from,
        to: span.to,
        onCursor: opts.onCursor,
        onEnd: () => {
          this.status = 'idle';
          opts.onEnd();
        }
      });
      this.status = 'playing';
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  stop(): void {
    this.#generation++;
    this.#player?.stop();
    if (this.status === 'playing' || this.status === 'loading') this.status = 'idle';
  }

  dispose(): void {
    this.#disposed = true;
    this.#player?.stop();
    this.#out?.dispose();
    this.#out = null;
  }
}
