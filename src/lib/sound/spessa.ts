import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { SoundOut } from './soundOut';

/**
 * Where the General-MIDI sound bank is served from (relative to the app, so it
 * works under the GitHub Pages subpath). The file is large and cached by the
 * service worker on first use rather than precached with the app.
 */
export const SOUND_BANK_URL = `${import.meta.env.BASE_URL}soundfonts/gm.sf2`;

const CC_VOLUME = 7;

export class SoundBankMissingError extends Error {
  constructor(url: string, status?: number) {
    super(
      status === 404
        ? 'No instrument sounds installed yet (sound bank not found).'
        : `Couldn't load the instrument sounds (${status ?? 'network error'}) from ${url}.`
    );
    this.name = 'SoundBankMissingError';
  }
}

/**
 * {@link SoundOut} backed by SpessaSynth (an SF2/SF3 synthesizer running in an
 * AudioWorklet) and a General-MIDI sound bank: all 128 GM instruments and the
 * drum kit on channel 10 from one file.
 *
 * SpessaSynth schedules timed events itself but can't cancel them, so
 * {@link allNotesOff} silences the channels until every already-scheduled
 * event has passed, then restores their volume (see `quietUntil`).
 */
export class SpessaSoundOut implements SoundOut {
  #ctx: AudioContext;
  #synth: WorkletSynthesizer;
  #volumes = new Array<number>(16).fill(100);
  #latestScheduled = 0;
  #quietUntil = 0;

  private constructor(ctx: AudioContext, synth: WorkletSynthesizer) {
    this.#ctx = ctx;
    this.#synth = synth;
  }

  /** Create the synth and load the sound bank. Rejects with {@link SoundBankMissingError}. */
  static async create(url = SOUND_BANK_URL, onProgress?: (fraction: number) => void): Promise<SpessaSoundOut> {
    const bank = await fetchWithProgress(url, onProgress);
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
      await ctx.audioWorklet.addModule(processorUrl);
      const synth = new WorkletSynthesizer(ctx);
      synth.connect(ctx.destination);
      await synth.soundBankManager.addSoundBank(bank, 'gm');
      await synth.isReady;
      return new SpessaSoundOut(ctx, synth);
    } catch (err) {
      void ctx.close();
      throw err;
    }
  }

  get currentTime(): number {
    return this.#ctx.currentTime;
  }

  get quietUntil(): number {
    return this.#quietUntil;
  }

  async resume(): Promise<void> {
    await this.#ctx.resume();
  }

  program(channel: number, program: number): void {
    this.#synth.programChange(channel, program);
  }

  volume(channel: number, value: number): void {
    this.#volumes[channel] = value;
    this.#synth.controllerChange(channel, CC_VOLUME, value);
  }

  noteOn(channel: number, pitch: number, velocity: number, when?: number): void {
    this.#track(when);
    this.#synth.noteOn(channel, pitch, velocity, when === undefined ? undefined : { time: when });
  }

  noteOff(channel: number, pitch: number, when?: number): void {
    this.#track(when);
    this.#synth.noteOff(channel, pitch, when === undefined ? undefined : { time: when });
  }

  allNotesOff(): void {
    const now = this.#ctx.currentTime;
    this.#synth.stopAll(true);
    if (this.#latestScheduled <= now) return;
    // Events already queued in the worklet would still fire: mute until they
    // have all passed, then silence leftovers and restore the volumes.
    const until = this.#latestScheduled + 0.02;
    for (let ch = 0; ch < 16; ch++) this.#synth.controllerChange(ch, CC_VOLUME, 0);
    for (let ch = 0; ch < 16; ch++) {
      this.#synth.controllerChange(ch, 120 as never, 0, { time: until }); // All Sound Off
      this.#synth.controllerChange(ch, CC_VOLUME, this.#volumes[ch], { time: until + 0.005 });
    }
    this.#quietUntil = until + 0.01;
    this.#latestScheduled = 0;
  }

  dispose(): void {
    this.#synth.stopAll(true);
    void this.#ctx.close();
  }

  #track(when?: number): void {
    if (when !== undefined && when > this.#latestScheduled) this.#latestScheduled = when;
  }
}

async function fetchWithProgress(url: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new SoundBankMissingError(url);
  }
  if (!res.ok) throw new SoundBankMissingError(url, res.status);
  // Vite's dev server answers unknown paths with index.html — not a sound bank.
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new SoundBankMissingError(url, 404);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}
