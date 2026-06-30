import { ChordSymbolContainer } from 'opensheetmusicdisplay';
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
   * Which staff to grade. A 0-based index grades one staff (0 = top = right
   * hand); `'all'` merges every staff at each container into one step (both
   * hands together). Default 0.
   */
  staffIndex?: number | 'all';
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
 * Convert an OSMD ChordSymbolContainer into absolute MIDI notes.
 * Places the chord in octave 3, and a slash bass note (if present) in octave 2.
 */
export function getChordPitches(chord: ChordSymbolContainer): number[] {
  if (!chord || !chord.RootPitch) return [];

  // 1. Get root pitch class (0-11)
  const rootHalfTone = chord.RootPitch.getHalfTone();
  const rootPc = ((rootHalfTone + 12) % 12);

  // 2. Map ChordSymbolEnum to semitone offsets
  // 0: major, 1: minor, 2: augmented, 3: diminished, 4: dominant, 
  // 5: majorseventh, 6: minorseventh, 7: diminishedseventh, 8: augmentedseventh, 9: halfdiminished
  // 22: suspendedsecond, 23: suspendedfourth, 29: power
  let offsets = [0, 4, 7]; // major default
  const kind = chord.ChordKind;
  switch (kind) {
    case 1: // minor
      offsets = [0, 3, 7];
      break;
    case 2: // augmented
      offsets = [0, 4, 8];
      break;
    case 3: // diminished
      offsets = [0, 3, 6];
      break;
    case 4: // dominant
      offsets = [0, 4, 7, 10];
      break;
    case 5: // majorseventh
      offsets = [0, 4, 7, 11];
      break;
    case 6: // minorseventh
      offsets = [0, 3, 7, 10];
      break;
    case 7: // diminishedseventh
      offsets = [0, 3, 6, 9];
      break;
    case 8: // augmentedseventh
      offsets = [0, 4, 8, 10];
      break;
    case 9: // halfdiminished
      offsets = [0, 3, 6, 10];
      break;
    case 11: // majorsixth
      offsets = [0, 4, 7, 9];
      break;
    case 12: // minorsixth
      offsets = [0, 3, 7, 9];
      break;
    case 13: // dominantninth
      offsets = [0, 4, 7, 10, 14];
      break;
    case 14: // majorninth
      offsets = [0, 4, 7, 11, 14];
      break;
    case 15: // minorninth
      offsets = [0, 3, 7, 10, 14];
      break;
    case 22: // suspendedsecond
      offsets = [0, 2, 7];
      break;
    case 23: // suspendedfourth
      offsets = [0, 5, 7];
      break;
    case 29: // power
      offsets = [0, 7];
      break;
  }

  // 3. Construct chord notes in octave 3 (base note C3 = 48)
  const rootMidi = 48 + rootPc;
  const pitches = offsets.map((offset) => rootMidi + offset);

  // 4. Handle slash chord bass note if present (place it in octave 2, base C2 = 36)
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
 * - One tracked staff (default top), or `'all'` to merge both hands together.
 * - First voice of each tracked staff only.
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
  const staffSel = options.staffIndex ?? 0;
  const steps: GradedStep[] = [];

  // Staff index treated as the left hand for both-hands colouring (top staff = 0).
  const LEFT_STAFF = 1;

  // Every tracked note as an absolute [onset, end) interval, used after the walk
  // to work out which pitches are still sounding (held) at each step's onset.
  const intervals: { onset: number; end: number; pitch: number; staff: number }[] = [];
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

      // One staff, or every staff present at this timestamp (both hands). Keep
      // the staff index alongside the entry so held notes can be hand-coloured.
      const tracked: { entry: (typeof container.StaffEntries)[number]; staff: number }[] = [];
      if (staffSel === 'all') {
        container.StaffEntries.forEach((entry, staff) => {
          if (entry) tracked.push({ entry, staff });
        });
      } else if (container.StaffEntries[staffSel]) {
        tracked.push({ entry: container.StaffEntries[staffSel], staff: staffSel });
      }

      const onset = container.getAbsoluteTimestamp().RealValue + offset;
      const pitches: number[] = [];
      const leftOnsets: number[] = [];
      for (const { entry, staff } of tracked) {
        const voiceEntry = entry.VoiceEntries[0];
        if (!voiceEntry) continue;

        for (const note of voiceEntry.Notes) {
          if (note.isRest() || !note.Pitch) continue;

          const pitch = osmdHalfToneToMidi(note.halfTone);
          // Record the sounding span (including tied continuations) so the
          // sustained-pitch pass below sees full coverage of held notes.
          intervals.push({ onset, end: onset + note.Length.RealValue, pitch, staff });

          // Tied continuation: same Tie, but not the note that started it.
          const tie = note.NoteTie;
          if (tie && tie.StartNote !== note) continue;

          pitches.push(pitch);
          if (staff === LEFT_STAFF) leftOnsets.push(pitch);
        }
      }

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

  // Second pass: for each step, find pitches whose interval started earlier and
  // has not yet ended (strictly), i.e. notes still being held at this onset.
  const EPS = 1e-9;
  for (let i = 0; i < steps.length; i++) {
    const t = stepTimes[i];
    const onsetSet = new Set(steps[i].pitches);
    const held = new Set<number>();
    const heldLeft = new Set<number>();
    for (const iv of intervals) {
      if (iv.onset < t - EPS && iv.end > t + EPS && !onsetSet.has(iv.pitch)) {
        held.add(iv.pitch);
        if (iv.staff === LEFT_STAFF) heldLeft.add(iv.pitch);
      }
    }
    steps[i].sustained = [...held].sort((a, b) => a - b);
    steps[i].leftPitches = [...new Set([...(steps[i].leftPitches ?? []), ...heldLeft])].sort(
      (a, b) => a - b
    );
  }

  return steps;
}
