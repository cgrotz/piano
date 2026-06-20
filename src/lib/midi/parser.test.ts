import { describe, it, expect } from 'vitest';
import { parseMidiMessage } from './parser';

describe('parseMidiMessage', () => {
  it('returns a noteOn for status 0x90 with velocity > 0', () => {
    const data = new Uint8Array([0x90, 60, 100]);
    expect(parseMidiMessage(data)).toEqual({ type: 'noteOn', pitch: 60, velocity: 100 });
  });

  it('returns a noteOff for status 0x80', () => {
    const data = new Uint8Array([0x80, 60, 64]);
    expect(parseMidiMessage(data)).toEqual({ type: 'noteOff', pitch: 60 });
  });

  it('treats note-on with velocity 0 as noteOff', () => {
    const data = new Uint8Array([0x90, 64, 0]);
    expect(parseMidiMessage(data)).toEqual({ type: 'noteOff', pitch: 64 });
  });

  it('returns null for messages shorter than 3 bytes', () => {
    expect(parseMidiMessage(new Uint8Array([0x90]))).toBeNull();
    expect(parseMidiMessage(new Uint8Array([0x90, 60]))).toBeNull();
    expect(parseMidiMessage(new Uint8Array([]))).toBeNull();
  });

  it('returns null for control-change messages (0xB0)', () => {
    const data = new Uint8Array([0xb0, 64, 127]);
    expect(parseMidiMessage(data)).toBeNull();
  });

  it('correctly parses note-on on different MIDI channels', () => {
    // 0x91 = note-on, channel 2
    const ch2 = new Uint8Array([0x91, 48, 80]);
    expect(parseMidiMessage(ch2)).toEqual({ type: 'noteOn', pitch: 48, velocity: 80 });

    // 0x9F = note-on, channel 16
    const ch16 = new Uint8Array([0x9f, 72, 50]);
    expect(parseMidiMessage(ch16)).toEqual({ type: 'noteOn', pitch: 72, velocity: 50 });
  });

  it('correctly parses note-off on different MIDI channels', () => {
    // 0x85 = note-off, channel 6
    const data = new Uint8Array([0x85, 55, 64]);
    expect(parseMidiMessage(data)).toEqual({ type: 'noteOff', pitch: 55 });
  });
});
