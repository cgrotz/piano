import type { PlayedNote, PlayedPart, Timeline } from '../score/timeline';
import { channelForPart } from '../score/timeline';
import { analyzeHarmony, melodyAndBass } from './harmony';
import { generate, type GeneratorId } from './generators';
import type { ChordSpan } from './theory';

/**
 * Ready-made backing bands for "Listen" — a preview of what the composer will
 * let you build track by track. Each track is a generator + style + General
 * MIDI instrument; styles left out follow the metre (waltz in 3/4 etc.).
 */
export interface BandTrack {
  generator: GeneratorId;
  style?: string;
  program: number;
  name: string;
  /** Channel volume 0-127. */
  volume: number;
}

export interface BandPreset {
  id: string;
  label: string;
  tracks: BandTrack[];
}

export const BAND_PRESETS: BandPreset[] = [
  {
    id: 'pop',
    label: 'Pop band',
    tracks: [
      { generator: 'bass', style: 'pop-8ths', program: 33, name: 'Bass', volume: 100 },
      { generator: 'comp', program: 25, name: 'Guitar', volume: 80 },
      { generator: 'drums', program: 0, name: 'Drums', volume: 90 }
    ]
  },
  {
    id: 'ballad',
    label: 'Ballad',
    tracks: [
      { generator: 'bass', style: 'root', program: 32, name: 'Bass', volume: 95 },
      { generator: 'pad', program: 48, name: 'Strings', volume: 75 },
      { generator: 'drums', style: 'ballad', program: 0, name: 'Drums', volume: 70 }
    ]
  },
  {
    id: 'strings',
    label: 'Strings',
    tracks: [
      { generator: 'bass', style: 'root', program: 42, name: 'Cello', volume: 95 },
      { generator: 'pad', program: 48, name: 'Strings', volume: 80 },
      { generator: 'second-voice', program: 40, name: 'Violin', volume: 75 }
    ]
  },
  {
    id: 'jazz',
    label: 'Jazz trio',
    tracks: [
      { generator: 'bass', style: 'walking', program: 32, name: 'Bass', volume: 100 },
      { generator: 'comp', style: 'bossa', program: 4, name: 'E-piano', volume: 75 },
      { generator: 'drums', style: 'ballad', program: 0, name: 'Drums', volume: 70 }
    ]
  },
  {
    id: 'harp',
    label: 'Harp & bass',
    tracks: [
      { generator: 'arpeggio', program: 46, name: 'Harp', volume: 85 },
      { generator: 'bass', style: 'root', program: 43, name: 'Contrabass', volume: 90 }
    ]
  }
];

/** Which staves carry the melody and which the bass evidence. */
export interface Roles {
  melodyStaves: number[];
  bassStaves: number[];
}

/**
 * The chords the band plays: the written chord symbols when the score has
 * them, otherwise the rule-based analysis of melody + bass.
 */
export function chordsFor(timeline: Timeline, roles: Roles): { chords: ChordSpan[]; detected: boolean } {
  if (timeline.chordSymbols.length > 0) return { chords: timeline.chordSymbols, detected: false };
  const { melody, bass } = melodyAndBass(timeline.notes, roles.melodyStaves, roles.bassStaves);
  return { chords: analyzeHarmony({ melody, bass, bars: timeline.bars, key: timeline.key }), detected: true };
}

/**
 * The score plus a generated band: extra notes on fresh channels after the
 * score's own parts (drums on channel 10), ready for the TimelinePlayer.
 */
export function withBand(timeline: Timeline, preset: BandPreset, roles: Roles, seed = 1): Timeline & { chords: ChordSpan[] } {
  const { chords } = chordsFor(timeline, roles);
  const { melody } = melodyAndBass(timeline.notes, roles.melodyStaves, roles.bassStaves);
  const ctx = { melody, chords, bars: timeline.bars, key: timeline.key };
  const notes: PlayedNote[] = [...timeline.notes];
  const parts: PlayedPart[] = [...timeline.parts];
  let next = timeline.parts.length;
  for (const t of preset.tracks) {
    const drums = t.generator === 'drums';
    const channel = drums ? 9 : channelForPart(next++);
    notes.push(...generate(t.generator, ctx, { style: t.style, channel, seed }));
    parts.push({ channel, program: t.program, name: t.name, staves: [], volume: t.volume });
  }
  notes.sort((a, b) => a.onset - b.onset || a.channel - b.channel || a.pitch - b.pitch);
  return { ...timeline, notes, parts, chords };
}
