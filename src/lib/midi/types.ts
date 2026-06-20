/** A MIDI note number, 0-127 (60 = middle C / C4). */
export type MidiPitch = number;

export interface NoteOn {
  type: 'noteOn';
  pitch: MidiPitch;
  /** 1-127. A note-on with velocity 0 is normalized to a NoteOff. */
  velocity: number;
}

export interface NoteOff {
  type: 'noteOff';
  pitch: MidiPitch;
}

export type MidiNoteEvent = NoteOn | NoteOff;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Human-readable name for a pitch, e.g. 60 -> "C4". */
export function pitchName(pitch: MidiPitch): string {
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pitch % 12]}${octave}`;
}
