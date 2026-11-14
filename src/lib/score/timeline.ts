import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { osmdHalfToneToMidi, playbackMeasureOrder } from './extractor';

/**
 * One note to be sounded by the computer, on the score's *enrolled* timeline:
 * repeats expanded, in whole-note units from the start of the piece — the same
 * time axis `extractSteps` uses, so playback and grading always agree.
 */
export interface PlayedNote {
  /** Onset in whole notes from the start of the (repeat-expanded) piece. */
  onset: number;
  /** Sounding length in whole notes (tied notes merged into one). */
  duration: number;
  pitch: number;
  velocity: number;
  /** MIDI channel (0-15) — one per part; 9 is reserved for drums. */
  channel: number;
  /** Cursor ordinal of the note's vertical container (GradedStep.cursorIndex). */
  cursorIndex: number;
  /** 1-based printed measure number. */
  measure: number;
}

/** A part of the score mapped onto a MIDI channel. */
export interface PlayedPart {
  channel: number;
  /** General-MIDI program (0-127) from the file's `<midi-program>`, else piano. */
  program: number;
  name: string;
  /** 0-based staff indices (OSMD `Sheet.Staves` order) belonging to this part. */
  staves: number[];
}

export interface Timeline {
  notes: PlayedNote[];
  parts: PlayedPart[];
  /** Total length of the enrolled piece in whole notes. */
  length: number;
}

const DRUM_CHANNEL = 9;

/** Channel for the n-th part: 0..15, skipping the GM drum channel. */
export function channelForPart(n: number): number {
  const ch = n < DRUM_CHANNEL ? n : n + 1;
  return Math.min(ch, 15);
}

/**
 * Every note the score asks to be *heard*, for computer playback.
 *
 * Differs from `extractSteps` (what the player must *press*) in a few ways:
 * - each note keeps its own duration and part/channel;
 * - tied notes become one long note (the continuation adds to the duration);
 * - hidden notes (`print-object="no"`) are included — they exist for playback;
 * - grace and cue notes are skipped (no time of their own on the timeline).
 *
 * Measures are walked in playback order, like the extractor, so repeats play
 * twice and `cursorIndex` matches the visual cursor's stop sequence.
 */
export function extractTimeline(osmd: OpenSheetMusicDisplay, options: { staves?: number[] } = {}): Timeline {
  const sheet = osmd.Sheet;
  const only = options.staves ? new Set(options.staves) : null;

  const parts: PlayedPart[] = [];
  const channelOfStaff = new Map<number, number>();
  sheet.Instruments.forEach((inst, p) => {
    const channel = channelForPart(p);
    const staves = inst.Staves.map((s) => sheet.Staves.indexOf(s));
    const program = Number(inst.MidiInstrumentId);
    parts.push({
      channel,
      program: Number.isInteger(program) && program >= 0 && program < 128 ? program : 0,
      name: inst.Name?.trim() || `Part ${p + 1}`,
      staves
    });
    for (const s of staves) channelOfStaff.set(s, channel);
  });

  const notes: PlayedNote[] = [];
  let cursorIndex = 0;
  let enrolled = 0;
  for (const measureIndex of playbackMeasureOrder(osmd)) {
    const measure = sheet.SourceMeasures[measureIndex];
    const offset = enrolled - measure.AbsoluteTimestamp.RealValue;
    enrolled += measure.Duration.RealValue;

    for (const container of measure.VerticalSourceStaffEntryContainers) {
      const here = cursorIndex++;
      const onset = container.getAbsoluteTimestamp().RealValue + offset;
      container.StaffEntries.forEach((entry, staff) => {
        if (!entry || (only && !only.has(staff))) return;
        const channel = channelOfStaff.get(staff) ?? 0;
        for (const voiceEntry of entry.VoiceEntries) {
          if (voiceEntry.IsGrace) continue;
          for (const note of voiceEntry.Notes) {
            if (note.isRest() || !note.Pitch || note.IsCueNote) continue;
            const tie = note.NoteTie;
            if (tie && tie.StartNote !== note) continue; // sounded by its start note
            const duration = tie ? tie.Notes.reduce((sum, n) => sum + n.Length.RealValue, 0) : note.Length.RealValue;
            if (!(duration > 0)) continue;
            notes.push({
              onset,
              duration,
              pitch: osmdHalfToneToMidi(note.halfTone),
              velocity: 100,
              channel,
              cursorIndex: here,
              measure: measure.MeasureNumber
            });
          }
        }
      });
    }
  }

  notes.sort((a, b) => a.onset - b.onset || a.channel - b.channel || a.pitch - b.pitch);
  return { notes, parts: only ? parts.filter((p) => p.staves.some((s) => only.has(s))) : parts, length: enrolled };
}

/**
 * The enrolled span `[from, to)` covering printed bars `fromBar..toBar` — the
 * first pass through them when repeats visit a bar more than once. Null when
 * no note falls inside.
 */
export function barRangeSpan(notes: PlayedNote[], fromBar: number, toBar: number): { from: number; to: number } | null {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset);
  const start = sorted.findIndex((n) => n.measure >= fromBar && n.measure <= toBar);
  if (start < 0) return null;
  let to = Infinity;
  for (let i = start; i < sorted.length; i++) {
    const m = sorted[i].measure;
    if (m < fromBar || m > toBar) {
      to = sorted[i].onset;
      break;
    }
  }
  return { from: sorted[start].onset, to };
}
