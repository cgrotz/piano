/**
 * Optional practice metronome (independent of grading).
 *
 * The practice loop is self-paced — the cursor only advances when you play the
 * right note, there is no clock. This controller is therefore a free-running
 * timekeeper that ticks at a fixed BPM alongside your playing; it never touches
 * the grading engine. It owns a click sound and a reactive beat counter that the
 * UI uses to flash an indicator and pulse the keyboard.
 *
 * Clicks are scheduled against the Web Audio clock with a small lookahead window
 * (the "Tale of Two Clocks" technique) rather than fired straight from a timer,
 * so the beat stays rock-steady even when the main thread is busy. A separate
 * animation-frame loop drains the scheduled beats to drive the visuals in sync
 * with the sound.
 */
export class MetronomeController {
  /** Whether the metronome is currently ticking. */
  running = $state(false);
  /** Beats per minute. Read from the score, user-overridable. */
  bpm = $state(100);
  /** Beats per bar (time-signature numerator), for accenting the downbeat. */
  beatsPerBar = $state(4);
  /**
   * Monotonic beat index, bumped once per audible click in visual sync with it.
   * `-1` before the first beat. The UI keys its pulse animation off this so each
   * beat re-triggers; downbeat = `beatCount % beatsPerBar === 0`.
   */
  beatCount = $state(-1);

  #ctx: AudioContext | null = null;
  // Audio-clock time (seconds) of the next click still to be scheduled.
  #nextNoteTime = 0;
  // Beat index of that next click, used to accent the downbeat.
  #nextBeat = 0;
  // Beats scheduled but not yet reached, drained by the draw loop for visuals.
  #queue: { beat: number; time: number }[] = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #raf = 0;

  // How often the scheduler wakes, and how far ahead it schedules.
  static #LOOKAHEAD_MS = 25;
  static #SCHEDULE_AHEAD = 0.1; // seconds

  get supported(): boolean {
    return typeof window !== 'undefined' && 'AudioContext' in window;
  }

  /** Toggle on/off. Must be called from a user gesture the first time (audio unlock). */
  toggle(): void {
    if (this.running) this.stop();
    else this.start();
  }

  start(): void {
    if (this.running || !this.supported) return;
    if (!this.#ctx) this.#ctx = new AudioContext();
    // A suspended context (autoplay policy) resumes on this user gesture.
    void this.#ctx.resume();
    this.running = true;
    this.#nextBeat = 0;
    this.#nextNoteTime = this.#ctx.currentTime + 0.05;
    this.#queue = [];
    this.beatCount = -1;
    this.#timer = setInterval(() => this.#schedule(), MetronomeController.#LOOKAHEAD_MS);
    this.#raf = requestAnimationFrame(() => this.#draw());
  }

  stop(): void {
    this.running = false;
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    this.#queue = [];
    this.beatCount = -1;
  }

  /** Apply the score's tempo/metre as the starting values (only when not running). */
  setFromScore(bpm: number, beatsPerBar: number): void {
    if (bpm > 0) this.bpm = Math.round(bpm);
    if (beatsPerBar > 0) this.beatsPerBar = beatsPerBar;
  }

  dispose(): void {
    this.stop();
    void this.#ctx?.close();
    this.#ctx = null;
  }

  /** Push every click that falls inside the lookahead window onto the audio clock. */
  #schedule(): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    while (this.#nextNoteTime < ctx.currentTime + MetronomeController.#SCHEDULE_AHEAD) {
      const isDownbeat = this.#nextBeat % this.beatsPerBar === 0;
      this.#click(this.#nextNoteTime, isDownbeat);
      this.#queue.push({ beat: this.#nextBeat, time: this.#nextNoteTime });
      this.#nextNoteTime += 60 / this.bpm;
      this.#nextBeat++;
    }
  }

  /** A short click: a sine pip with a fast decay. Downbeat is higher and louder. */
  #click(time: number, isDownbeat: boolean): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = isDownbeat ? 1500 : 1000;
    const peak = isDownbeat ? 0.5 : 0.32;
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.04);
  }

  /** Advance the visible beat counter exactly when each scheduled click sounds. */
  #draw(): void {
    const ctx = this.#ctx;
    if (ctx) {
      while (this.#queue.length > 0 && this.#queue[0].time <= ctx.currentTime) {
        this.beatCount = this.#queue.shift()!.beat;
      }
    }
    if (this.running) this.#raf = requestAnimationFrame(() => this.#draw());
  }
}
