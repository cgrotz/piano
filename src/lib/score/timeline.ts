import { ChordSymbolEnum, type ChordSymbolContainer, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { osmdHalfToneToMidi, playbackMeasureOrder } from './extractor';
import { beatsPerBar } from '../metronome/bpm';
import { majorTonicFromFifths, pc, type Bar, type ChordSpan, type Key, type Quality } from '../arrange/theory';

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
  /** Cursor ordinal of the note's vertical container (GradedStep.cursorIndex); -1 for generated notes. */
  cursorIndex: number;
  /** 1-based printed measure number. */
  measure: number;
  /** 0-based staff (OSMD `Sheet.Staves` order); absent for generated notes. */
  staff?: number;
}

/** A part of the score mapped onto a MIDI channel. */
export interface PlayedPart {
  channel: number;
  /** General-MIDI program (0-127) from the file's `<midi-program>`, else piano. */
  program: number;
  name: string;
  /** 0-based staff indices (OSMD `Sheet.Staves` order) belonging to this part. */
  staves: number[];
  /** Channel volume 0-127 (default: the synth's). */
  volume?: number;
}

export interface Timeline {
  notes: PlayedNote[];
  parts: PlayedPart[];
  /** Total length of the enrolled piece in whole notes. */
  length: number;
  /** Bars in playback order (repeats expanded). */
  bars: Bar[];
  /** Key from the first key signature (mode guessed when the file doesn't say). */
  key: Key;
  /** Written chord symbols (`<harmony>`), each lasting until the next one. */
  chordSymbols: ChordSpan[];
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
  const bars: Bar[] = [];
  const symbols: { onset: number; chord: Omit<ChordSpan, 'onset' | 'duration'> | null }[] = [];
  let cursorIndex = 0;
  let enrolled = 0;
  for (const measureIndex of playbackMeasureOrder(osmd)) {
    const measure = sheet.SourceMeasures[measureIndex];
    const offset = enrolled - measure.AbsoluteTimestamp.RealValue;
    const ts = measure.ActiveTimeSignature;
    const num = ts?.Numerator > 0 ? ts.Numerator : 4;
    const den = ts?.Denominator > 0 ? ts.Denominator : 4;
    bars.push({
      number: measure.MeasureNumber,
      onset: enrolled,
      length: measure.Duration.RealValue,
      nominal: num / den,
      beats: beatsPerBar(num, den),
      numerator: num,
      denominator: den
    });
    enrolled += measure.Duration.RealValue;

    for (const container of measure.VerticalSourceStaffEntryContainers) {
      const here = cursorIndex++;
      const onset = container.getAbsoluteTimestamp().RealValue + offset;
      const symbol = container.StaffEntries.find((e) => e?.ChordContainers?.length)?.ChordContainers[0];
      if (symbol) {
        const chord = chordFromSymbol(symbol);
        if (chord !== undefined) symbols.push({ onset, chord });
      }
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
              measure: measure.MeasureNumber,
              staff
            });
          }
        }
      });
    }
  }

  notes.sort((a, b) => a.onset - b.onset || a.channel - b.channel || a.pitch - b.pitch);
  return {
    notes,
    parts: only ? parts.filter((p) => p.staves.some((s) => only.has(s))) : parts,
    length: enrolled,
    bars,
    key: keyOf(osmd, notes),
    chordSymbols: spansFrom(symbols, enrolled)
  };
}

/** OSMD chord-symbol kinds folded onto the generators' chord vocabulary. */
const KIND_TO_QUALITY: Partial<Record<ChordSymbolEnum, Quality>> = {
  [ChordSymbolEnum.major]: 'maj',
  [ChordSymbolEnum.minor]: 'min',
  [ChordSymbolEnum.augmented]: 'aug',
  [ChordSymbolEnum.diminished]: 'dim',
  [ChordSymbolEnum.dominant]: 'dom7',
  [ChordSymbolEnum.majorseventh]: 'maj7',
  [ChordSymbolEnum.minorseventh]: 'min7',
  [ChordSymbolEnum.diminishedseventh]: 'dim7',
  [ChordSymbolEnum.augmentedseventh]: 'aug',
  [ChordSymbolEnum.halfdiminished]: 'hdim7',
  [ChordSymbolEnum.majorminor]: 'min',
  [ChordSymbolEnum.majorsixth]: 'maj6',
  [ChordSymbolEnum.minorsixth]: 'min6',
  [ChordSymbolEnum.dominantninth]: 'dom7',
  [ChordSymbolEnum.majorninth]: 'maj7',
  [ChordSymbolEnum.minorninth]: 'min7',
  [ChordSymbolEnum.dominant11th]: 'dom7',
  [ChordSymbolEnum.major11th]: 'maj7',
  [ChordSymbolEnum.minor11th]: 'min7',
  [ChordSymbolEnum.dominant13th]: 'dom7',
  [ChordSymbolEnum.major13th]: 'maj7',
  [ChordSymbolEnum.minor13th]: 'min7',
  [ChordSymbolEnum.suspendedsecond]: 'sus2',
  [ChordSymbolEnum.suspendedfourth]: 'sus4',
  [ChordSymbolEnum.Neapolitan]: 'maj',
  [ChordSymbolEnum.Italian]: 'dom7',
  [ChordSymbolEnum.French]: 'dom7',
  [ChordSymbolEnum.German]: 'dom7',
  [ChordSymbolEnum.pedal]: 'power',
  [ChordSymbolEnum.power]: 'power',
  [ChordSymbolEnum.Tristan]: 'hdim7'
};

/**
 * A written chord symbol as a chord; `null` for N.C. (no chord — the band
 * rests), `undefined` when it can't be read.
 */
function chordFromSymbol(c: ChordSymbolContainer): Omit<ChordSpan, 'onset' | 'duration'> | null | undefined {
  if (c.ChordKind === ChordSymbolEnum.none) return null;
  if (!c.RootPitch) return undefined;
  const root = pc(c.RootPitch.getHalfTone());
  const bass = c.BassPitch ? pc(c.BassPitch.getHalfTone()) : undefined;
  return { root, quality: KIND_TO_QUALITY[c.ChordKind] ?? 'maj', ...(bass !== undefined && bass !== root ? { bass } : {}) };
}

function spansFrom(symbols: { onset: number; chord: Omit<ChordSpan, 'onset' | 'duration'> | null }[], end: number): ChordSpan[] {
  const out: ChordSpan[] = [];
  symbols.forEach((s, i) => {
    const next = i + 1 < symbols.length ? symbols[i + 1].onset : end;
    if (s.chord && next > s.onset) out.push({ ...s.chord, onset: s.onset, duration: next - s.onset });
  });
  return out;
}

/**
 * Key from the first key signature. MusicXML often omits `<mode>`; then the
 * relative minor wins if the piece's lowest final note (or, failing that, its
 * first bass note) is the minor tonic.
 */
function keyOf(osmd: OpenSheetMusicDisplay, notes: PlayedNote[]): Key {
  const instr = osmd.Sheet.SourceMeasures[0]?.getKeyInstruction(0);
  const major = majorTonicFromFifths(instr?.Key ?? 0);
  const minor = (major + 9) % 12;
  if (instr?.Mode === 1) return { tonic: minor, mode: 'minor' };
  if (instr?.Mode === 0 && notes.length === 0) return { tonic: major, mode: 'major' };
  if (notes.length > 0) {
    const lastOnset = notes[notes.length - 1].onset;
    const final = notes.filter((n) => n.onset >= lastOnset - 1e-9).reduce((a, b) => (b.pitch < a.pitch ? b : a));
    if (pc(final.pitch) === minor) return { tonic: minor, mode: 'minor' };
    if (pc(final.pitch) !== major) {
      const first = notes.filter((n) => n.onset <= notes[0].onset + 1e-9).reduce((a, b) => (b.pitch < a.pitch ? b : a));
      if (pc(first.pitch) === minor) return { tonic: minor, mode: 'minor' };
    }
  }
  return { tonic: major, mode: 'major' };
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
