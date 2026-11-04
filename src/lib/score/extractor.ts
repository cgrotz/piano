import { ChordSymbolContainer, ChordSymbolEnum } from 'opensheetmusicdisplay';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** One graded position: the set of MIDI pitches that must all be played to advance. */
export interface GradedStep {
  /** Expected MIDI pitches, de-duplicated and ascending. One entry = a chord. */
  pitches: number[];
  /**
   * Pitches struck at an earlier step whose written duration still spans this
   * one — i.e. notes that should remain physically held here (a "keep holding"
   * cue). De-duplicated and ascending; never overlaps `pitches`. Empty when
   * nothing carries over. The grading engine ignores this; it drives display.
   */
  sustained?: number[];
  /**
   * Left-hand subset of this step's sounding pitches (onset or sustained), only
   * populated when merging both staves (`staffIndex: 'all'`). Lets the keyboard
   * colour held left-hand notes correctly once their onset has scrolled past.
   */
  leftPitches?: number[];
  /**
   * Notes from the *untracked* staves that may legitimately be pressed while
   * this step is current: their onset lies between the neighbouring steps, or
   * they are sounding here. Lets you play the other hand along while grading
   * one hand without every one of its notes counting (and glowing) as wrong.
   * Never overlaps `pitches`; omitted when empty.
   */
  tolerated?: number[];
  /** 1-based measure number, for labels/debugging. */
  measure: number;
  /**
   * Ordinal of this step's vertical container across the whole score. OSMD's
   * cursor stops once per container in document order (verified), so advancing
   * the cursor to this index lands it exactly on the step's note(s) — correctly
   * skipping rests, tied continuations, and other-staff-only positions.
   */
  cursorIndex: number;
  /** Active chord name at this step, if any. */
  chordName?: string;
  /** Active chord MIDI pitches at this step, if any. */
  chordPitches?: number[];
}

export interface ExtractOptions {
  /**
   * Which staff/staves to grade (0-based, in score order). A single index grades
   * one staff; an array merges those staves at each container into one step
   * (e.g. a piano's two staves = both hands); `'all'` merges every staff.
   * Default 0.
   */
  staffIndex?: number | number[] | 'all';
  /**
   * Staff treated as the left hand for colouring (`leftPitches`). Default 1;
   * pass the piano's lower staff when other parts (e.g. a vocal line) come first.
   */
  leftStaff?: number;
}

/**
 * Convert OSMD's internal half-tone to a MIDI note number.
 *
 * OSMD's half-tone scale sits 12 below MIDI (middle C / C4 is 48 in OSMD, 60 in
 * MIDI). This is centralized and named because an octave offset error here is the
 * classic bug in this kind of code — verify against the bundled C-major scale,
 * whose first note (C4) must come out as 60.
 */
export function osmdHalfToneToMidi(halfTone: number): number {
  return halfTone + 12;
}

/**
 * Semitone offsets from the root for each chord-symbol kind (MusicXML `<kind>`).
 * Keyed by OSMD's enum so the mapping is readable and can't silently drift.
 * `none` (N.C., "no chord") deliberately maps to no notes.
 */
const CHORD_OFFSETS: Record<ChordSymbolEnum, number[]> = {
  [ChordSymbolEnum.major]: [0, 4, 7],
  [ChordSymbolEnum.minor]: [0, 3, 7],
  [ChordSymbolEnum.augmented]: [0, 4, 8],
  [ChordSymbolEnum.diminished]: [0, 3, 6],
  [ChordSymbolEnum.dominant]: [0, 4, 7, 10],
  [ChordSymbolEnum.majorseventh]: [0, 4, 7, 11],
  [ChordSymbolEnum.minorseventh]: [0, 3, 7, 10],
  [ChordSymbolEnum.diminishedseventh]: [0, 3, 6, 9],
  [ChordSymbolEnum.augmentedseventh]: [0, 4, 8, 10],
  [ChordSymbolEnum.halfdiminished]: [0, 3, 6, 10],
  [ChordSymbolEnum.majorminor]: [0, 3, 7, 11],
  [ChordSymbolEnum.majorsixth]: [0, 4, 7, 9],
  [ChordSymbolEnum.minorsixth]: [0, 3, 7, 9],
  [ChordSymbolEnum.dominantninth]: [0, 4, 7, 10, 14],
  [ChordSymbolEnum.majorninth]: [0, 4, 7, 11, 14],
  [ChordSymbolEnum.minorninth]: [0, 3, 7, 10, 14],
  [ChordSymbolEnum.dominant11th]: [0, 4, 7, 10, 14, 17],
  [ChordSymbolEnum.major11th]: [0, 4, 7, 11, 14, 17],
  [ChordSymbolEnum.minor11th]: [0, 3, 7, 10, 14, 17],
  [ChordSymbolEnum.dominant13th]: [0, 4, 7, 10, 14, 21],
  [ChordSymbolEnum.major13th]: [0, 4, 7, 11, 14, 21],
  [ChordSymbolEnum.minor13th]: [0, 3, 7, 10, 14, 21],
  [ChordSymbolEnum.suspendedsecond]: [0, 2, 7],
  [ChordSymbolEnum.suspendedfourth]: [0, 5, 7],
  // Functional chords, spelled from the given root per the MusicXML spec.
  [ChordSymbolEnum.Neapolitan]: [0, 4, 7],
  [ChordSymbolEnum.Italian]: [0, 4, 10],
  [ChordSymbolEnum.French]: [0, 4, 6, 10],
  [ChordSymbolEnum.German]: [0, 4, 7, 10],
  [ChordSymbolEnum.pedal]: [0],
  [ChordSymbolEnum.power]: [0, 7],
  [ChordSymbolEnum.Tristan]: [0, 6, 10, 15],
  [ChordSymbolEnum.none]: []
};

/**
 * Convert an OSMD ChordSymbolContainer into absolute MIDI notes.
 * Places the chord in octave 3, and a slash bass note (if present) in octave 2.
 * Returns [] for N.C. (`none`) so no guide keys light up.
 */
export function getChordPitches(chord: ChordSymbolContainer): number[] {
  if (!chord || !chord.RootPitch) return [];

  const offsets = CHORD_OFFSETS[chord.ChordKind] ?? CHORD_OFFSETS[ChordSymbolEnum.major];
  if (offsets.length === 0) return [];

  // Root pitch class (0-11)
  const rootPc = (chord.RootPitch.getHalfTone() + 12) % 12;

  // Chord notes in octave 3 (base note C3 = 48)
  const rootMidi = 48 + rootPc;
  const pitches = offsets.map((offset) => rootMidi + offset);

  // Slash chord bass note if present (place it in octave 2, base C2 = 36)
  if (chord.BassPitch) {
    const bassHalfTone = chord.BassPitch.getHalfTone();
    const bassPc = ((bassHalfTone + 12) % 12);
    const bassMidi = 36 + bassPc;
    pitches.unshift(bassMidi);
  }

  return [...new Set(pitches)].sort((a, b) => a - b);
}

/**
 * The order in which OSMD's cursor actually visits source measures, expanding
 * repeats and jumps. For a piece with a backward repeat after measure 4 this is
 * `0,1,2,3, 0,1,2,3, 4,5,…` — the cursor plays the section twice.
 *
 * OSMD's `MusicPartManagerIterator` is the same machinery that drives the visual
 * cursor, so reading the measure index off it as it advances reproduces the
 * cursor's stop sequence exactly. We collapse consecutive duplicates (the
 * iterator stops several times per measure, once per voice entry) to get one
 * entry per measure visit. Falls back to a plain linear pass if the iterator is
 * unavailable, so a score without repeats is unaffected either way.
 */
function playbackMeasureOrder(osmd: OpenSheetMusicDisplay): number[] {
  const measureCount = osmd.Sheet.SourceMeasures.length;
  const linear = () => Array.from({ length: measureCount }, (_, i) => i);

  const manager = osmd.Sheet.MusicPartManager;
  if (!manager || typeof manager.getIterator !== 'function') return linear();

  try {
    const it = manager.getIterator();
    const order: number[] = [];
    let last = -1;
    // Guard against a malformed repeat structure looping forever. Generous cap:
    // every measure may be visited many times by nested repeats.
    let guard = 0;
    const maxGuard = Math.max(1000, measureCount * 50);
    while (!it.EndReached && guard < maxGuard) {
      const idx = it.CurrentMeasureIndex;
      if (idx !== last) {
        order.push(idx);
        last = idx;
      }
      it.moveToNext();
      guard++;
    }
    return order.length > 0 && guard < maxGuard ? order : linear();
  } catch {
    return linear();
  }
}

/**
 * Walk OSMD's parsed model into an ordered list of graded steps (component 7).
 *
 * Decisions (per DESIGN.md / ARCHITECTURE.md):
 * - One tracked staff (default top), or several merged (both hands together).
 * - First non-grace voice of each tracked staff only.
 * - Measures are visited in playback order, so repeats and jumps replay their
 *   steps — matching the visual cursor, which follows them (see
 *   `playbackMeasureOrder`). A repeated section therefore appears twice in the
 *   step list, each occurrence carrying its own ascending `cursorIndex`.
 * - Notes struck together (a chord, or both hands at one timestamp) collapse
 *   into one step.
 * - Tied continuations are skipped: a tied note sounds once at its onset and is
 *   held, so it must not become a second step. (This is what makes both-hands
 *   work across differing rhythms — a held note in one hand never re-triggers
 *   while the other hand moves.)
 * - Rests are skipped.
 */
export function extractSteps(
  osmd: OpenSheetMusicDisplay,
  options: ExtractOptions = {}
): GradedStep[] {
  const sel = options.staffIndex ?? 0;
  const staffCount = osmd.Sheet.Staves.length;
  const trackedStaves = new Set<number>(
    sel === 'all' ? Array.from({ length: staffCount }, (_, i) => i) : Array.isArray(sel) ? sel : [sel]
  );
  const steps: GradedStep[] = [];

  // Staff index treated as the left hand for colouring (top staff = 0).
  const LEFT_STAFF = options.leftStaff ?? 1;

  // Every note as an absolute [onset, end) interval. Tracked ones drive the
  // "keep holding" pass; untracked ones drive `tolerated` (the other hand).
  const intervals: { onset: number; end: number; pitch: number; staff: number; tracked: boolean }[] = [];
  // Absolute onset time of each pushed step, parallel to `steps`.
  const stepTimes: number[] = [];

  // Global container ordinal, incremented for every container so it matches the
  // cursor's stop sequence (1:1, in document order) regardless of which staff is tracked.
  let cursorIndex = 0;

  // Track currently active chord name and pitches to propagate them forward.
  let activeChordName: string | undefined = undefined;
  let activeChordPitches: number[] | undefined = undefined;

  // Source-measure indices in the order the cursor plays them (repeats expanded).
  const order = playbackMeasureOrder(osmd);

  // Running playback ("enrolled") time. Repeated measures share the same source
  // timestamp, so we offset each visit by the time already elapsed; this keeps
  // the held-note pass below monotonic and stops a repeat's notes from being
  // seen as overlapping their first pass.
  let enrolled = 0;

  for (const measureIndex of order) {
    const measure = osmd.Sheet.SourceMeasures[measureIndex];
    const keyInstruction = measure.getKeyInstruction(0);
    // Shift this visit's absolute (source) timestamps onto the enrolled timeline.
    const offset = enrolled - measure.AbsoluteTimestamp.RealValue;
    enrolled += measure.Duration.RealValue;

    // Containers are the vertical time-slices within a measure, in order.
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      const here = cursorIndex;
      cursorIndex++;

      // Check if this container contains a new chord symbol (harmony)
      for (const entry of container.StaffEntries) {
        if (entry && entry.ChordContainers && entry.ChordContainers.length > 0) {
          const chord = entry.ChordContainers[0];
          try {
            activeChordName = ChordSymbolContainer.calculateChordText(chord, 0, keyInstruction);
          } catch {
            const rootShort = chord.RootPitch?.ToStringShort() || '';
            const rootName = rootShort.replace(/[0-9]/g, '');
            const kindText = chord.ChordKind === 1 ? 'm' : '';
            activeChordName = `${rootName}${kindText}`;
          }
          activeChordPitches = getChordPitches(chord);
          break; // Use the first chord symbol found at this timestamp
        }
      }

      const onset = container.getAbsoluteTimestamp().RealValue + offset;
      const pitches: number[] = [];
      const leftOnsets: number[] = [];
      container.StaffEntries.forEach((entry, staff) => {
        if (!entry) return;
        const tracked = trackedStaves.has(staff);
        // Tracked staves: the first non-grace voice entry. OSMD lists a grace
        // note's voice entry ahead of the main note it decorates (same staff
        // entry), so taking VoiceEntries[0] would grade the ornament and drop
        // the real note. Grace notes are ungraded: the cursor has no stop of
        // their own. Untracked staves only feed `tolerated`, so take every voice.
        const mainVoices = entry.VoiceEntries.filter((v) => !v.IsGrace);
        const voices = tracked ? mainVoices.slice(0, 1) : mainVoices;

        for (const voiceEntry of voices) {
          for (const note of voiceEntry.Notes) {
            if (note.isRest() || !note.Pitch) continue;

            const pitch = osmdHalfToneToMidi(note.halfTone);
            // Record the sounding span (including tied continuations) so the
            // sustained-pitch pass below sees full coverage of held notes.
            intervals.push({ onset, end: onset + note.Length.RealValue, pitch, staff, tracked });
            if (!tracked) continue;

            // Tied continuation: same Tie, but not the note that started it.
            const tie = note.NoteTie;
            if (tie && tie.StartNote !== note) continue;

            pitches.push(pitch);
            if (staff === LEFT_STAFF) leftOnsets.push(pitch);
          }
        }
      });

      if (pitches.length > 0) {
        steps.push({
          pitches: [...new Set(pitches)].sort((a, b) => a - b),
          leftPitches: [...new Set(leftOnsets)].sort((a, b) => a - b),
          measure: measure.MeasureNumber,
          cursorIndex: here,
          chordName: activeChordName,
          chordPitches: activeChordPitches
        });
        stepTimes.push(onset);
      }
    }
  }

  // Second pass, per step:
  // - sustained: tracked pitches whose interval started earlier and has not yet
  //   ended (strictly), i.e. notes still being held at this onset;
  // - tolerated: untracked pitches struck between the neighbouring steps or
  //   sounding here — the other hand playing along.
  const EPS = 1e-9;
  const asc = (set: Set<number>) => [...set].sort((a, b) => a - b);
  for (let i = 0; i < steps.length; i++) {
    const t = stepTimes[i];
    const tPrev = i > 0 ? stepTimes[i - 1] : -Infinity;
    const tNext = i + 1 < steps.length ? stepTimes[i + 1] : Infinity;
    const onsetSet = new Set(steps[i].pitches);
    const held = new Set<number>();
    const heldLeft = new Set<number>();
    const tolerated = new Set<number>();
    for (const iv of intervals) {
      if (onsetSet.has(iv.pitch)) continue;
      const soundingHere = iv.onset < t - EPS && iv.end > t + EPS;
      if (iv.tracked) {
        if (soundingHere) {
          held.add(iv.pitch);
          if (iv.staff === LEFT_STAFF) heldLeft.add(iv.pitch);
        }
      } else if (soundingHere || (iv.onset >= tPrev - EPS && iv.onset < tNext - EPS)) {
        tolerated.add(iv.pitch);
      }
    }
    steps[i].sustained = asc(held);
    steps[i].leftPitches = asc(new Set([...(steps[i].leftPitches ?? []), ...heldLeft]));
    if (tolerated.size > 0) steps[i].tolerated = asc(tolerated);
  }

  return steps;
}
