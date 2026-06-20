import type { MidiNoteEvent } from './types';

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;

/**
 * Decode a single raw MIDI message into a note event, or null for messages we
 * don't care about (control changes, clock, etc.).
 *
 * The Web MIDI API delivers one complete message per event, so there is no
 * running-status to handle here. The one subtlety we DO handle: a Note-On with
 * velocity 0 is the conventional "note off" and is normalized accordingly.
 */
export function parseMidiMessage(data: Uint8Array): MidiNoteEvent | null {
  if (data.length < 3) return null;

  const status = data[0] & 0xf0;
  const pitch = data[1];
  const velocity = data[2];

  if (status === NOTE_ON && velocity > 0) {
    return { type: 'noteOn', pitch, velocity };
  }
  if (status === NOTE_OFF || (status === NOTE_ON && velocity === 0)) {
    return { type: 'noteOff', pitch };
  }
  return null;
}
