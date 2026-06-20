import { parseMidiMessage } from './parser';
import type { MidiNoteEvent, MidiPitch } from './types';

export type MidiStatus =
  | 'unsupported' // browser has no Web MIDI API (e.g. any iOS browser)
  | 'idle' // not yet requested
  | 'requesting' // awaiting the permission prompt
  | 'denied' // user blocked access or request failed
  | 'connected' // access granted, at least one input present
  | 'disconnected'; // access granted, but no input devices

export interface MidiLogEntry {
  event: MidiNoteEvent;
  at: number;
}

/**
 * Reactive Web MIDI controller (component A1-A3 in ARCHITECTURE.md).
 *
 * Owns the connection lifecycle, normalizes raw messages into note events,
 * tracks currently-held keys, and fans events out to subscribers (the grading
 * engine, later). The recent-event log here exists for the step-2 monitor and
 * can be ignored by real consumers, who should use `subscribe()`.
 */
export class MidiController {
  status = $state<MidiStatus>('idle');
  /** Names of currently-connected input devices. */
  inputNames = $state<string[]>([]);
  error = $state<string | null>(null);
  /** Most-recent events, newest first, capped — for the dev monitor. */
  log = $state<MidiLogEntry[]>([]);
  /** Keys currently held down (needed for chord grading later). */
  heldNotes = $state<MidiPitch[]>([]);

  #access: MIDIAccess | null = null;
  #subscribers = new Set<(event: MidiNoteEvent) => void>();
  #held = new Set<MidiPitch>();

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async connect(): Promise<void> {
    if (!this.supported) {
      this.status = 'unsupported';
      return;
    }
    this.status = 'requesting';
    this.error = null;
    try {
      this.#access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.status = 'denied';
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
    this.#access.onstatechange = () => this.#refreshInputs();
    this.#refreshInputs();
  }

  /** Subscribe to normalized note events. Returns an unsubscribe function. */
  subscribe(fn: (event: MidiNoteEvent) => void): () => void {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /** Inject a note event as if it came from the device (for testing/automation). */
  emitForTest(event: MidiNoteEvent): void {
    for (const fn of this.#subscribers) fn(event);
  }

  clearLog(): void {
    this.log = [];
  }

  #refreshInputs(): void {
    if (!this.#access) return;
    const names: string[] = [];
    for (const input of this.#access.inputs.values()) {
      names.push(input.name ?? 'Unknown device');
      input.onmidimessage = (ev) => this.#onMessage(ev);
    }
    this.inputNames = names;
    this.status = names.length > 0 ? 'connected' : 'disconnected';
  }

  #onMessage(ev: MIDIMessageEvent): void {
    if (!ev.data) return;
    const event = parseMidiMessage(ev.data);
    if (!event) return;

    if (event.type === 'noteOn') {
      this.#held.add(event.pitch);
    } else {
      this.#held.delete(event.pitch);
    }
    this.heldNotes = [...this.#held].sort((a, b) => a - b);

    this.log = [{ event, at: performance.now() }, ...this.log].slice(0, 60);
    for (const fn of this.#subscribers) fn(event);
  }
}
