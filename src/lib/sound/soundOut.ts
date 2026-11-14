/**
 * The `SoundOut` port: everything the app needs from a sound source to let the
 * computer play. Mirrors the `Unzip` port — the SoundFont synth is one
 * implementation (see spessa.ts); a Web MIDI output or a hand-made sampler can
 * be swapped in without touching the scheduler or the generators.
 *
 * Times are seconds on the implementation's own clock (`currentTime`), so
 * events can be scheduled ahead with sample accuracy.
 */
export interface SoundOut {
  /** Current time on the output's clock, in seconds. */
  readonly currentTime: number;
  /** Unlock audio; call from a user gesture (autoplay policy). */
  resume(): Promise<void>;
  /** Select a General-MIDI program (0-127) on a channel. */
  program(channel: number, program: number): void;
  /** Channel volume, 0-127 (MIDI CC7). */
  volume(channel: number, value: number): void;
  noteOn(channel: number, pitch: number, velocity: number, when?: number): void;
  noteOff(channel: number, pitch: number, when?: number): void;
  /** Silence everything now, including events already scheduled ahead. */
  allNotesOff(): void;
  /**
   * After `allNotesOff`, an implementation that can't cancel scheduled events
   * may stay muted until this time; new playback should not start earlier.
   */
  readonly quietUntil?: number;
  dispose(): void;
}
