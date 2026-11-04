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

  /**
   * Inject a note event as if it came from the device (for testing/automation).
   * Goes through the same path as real input, so held-key tracking applies.
   */
  emitForTest(event: MidiNoteEvent): void {
    this.#handle(event);
  }

  /**
   * Dev/automation only: pretend a keyboard is connected so the practice flow
   * (which refuses to start without one) can be driven via `emitForTest`.
   */
  useVirtualDevice(): void {
    this.inputNames = ['Virtual keyboard (dev)'];
    this.status = 'connected';
    this.error = null;
  }

  clearLog(): void {
    this.log = [];
  }

  #refreshInputs(): void {
    if (!this.#access) return;
    const names: string[] = [];
    for (const input of this.#access.inputs.values()) {
      // Chrome can keep an unplugged port in the map with state 'disconnected';
      // it must not count as a live device.
      if (input.state === 'disconnected') continue;
      names.push(input.name ?? 'Unknown device');
      input.onmidimessage = (ev) => this.#onMessage(ev);
    }
    // A device that goes away mid-press never sends its note-offs. Release
    // everything we think is held so keys don't stay lit (or red) forever.
    if (names.length < this.inputNames.length) this.#releaseAll();
    this.inputNames = names;
    this.status = names.length > 0 ? 'connected' : 'disconnected';
  }

  /** Synthesize a note-off for every held key and clear the held set. */
  #releaseAll(): void {
    if (this.#held.size === 0) return;
    const pitches = [...this.#held];
    this.#held.clear();
    this.heldNotes = [];
    for (const pitch of pitches) {
      for (const fn of this.#subscribers) fn({ type: 'noteOff', pitch });
    }
  }

  #onMessage(ev: MIDIMessageEvent): void {
    if (!ev.data) return;
    const event = parseMidiMessage(ev.data);
    if (event) this.#handle(event);
  }

  #handle(event: MidiNoteEvent): void {
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

/**
 * What to tell the player for a MIDI state that blocks practice, in plain words
 * with the next step — rather than the browser's raw exception text.
 */
export function midiHelp(status: MidiStatus): string {
  switch (status) {
    case 'unsupported':
      return "This browser can't talk to MIDI keyboards. Use Chrome on Android or a desktop computer (iPad/iPhone browsers don't support Web MIDI).";
    case 'denied':
      return 'MIDI access is blocked for this site. Allow it in Chrome (lock icon in the address bar → Site settings → MIDI devices), then tap Connect.';
    case 'disconnected':
      return 'No MIDI keyboard found. Plug it in (on a tablet via a USB-OTG adapter), switch it on, then tap Connect.';
    case 'requesting':
      return 'Waiting for MIDI permission — accept the browser prompt.';
    case 'idle':
      return 'Connect your MIDI keyboard to start practising.';
    case 'connected':
      return '';
  }
}
