import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** One graded position: the set of MIDI pitches that must all be played to advance. */
export interface GradedStep {
  /** Expected MIDI pitches, de-duplicated and ascending. One entry = a chord. */
  pitches: number[];
  /** 1-based measure number, for labels/debugging. */
  measure: number;
  /**
   * Ordinal of this step's vertical container across the whole score. OSMD's
   * cursor stops once per container in document order (verified), so advancing
   * the cursor to this index lands it exactly on the step's note(s) — correctly
   * skipping rests, tied continuations, and other-staff-only positions.
   */
  cursorIndex: number;
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
 * Walk OSMD's parsed model into an ordered list of graded steps (component 7).
 *
 * Decisions (per DESIGN.md / ARCHITECTURE.md):
 * - One tracked staff (default top), or `'all'` to merge both hands together.
 * - First voice of each tracked staff only.
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

  // Global container ordinal, incremented for every container so it matches the
  // cursor's stop sequence (1:1, in document order) regardless of which staff is tracked.
  let cursorIndex = 0;

  for (const measure of osmd.Sheet.SourceMeasures) {
    // Containers are the vertical time-slices within a measure, in order.
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      const here = cursorIndex;
      cursorIndex++;

      // One staff, or every staff present at this timestamp (both hands).
      const staffEntries =
        staffSel === 'all'
          ? container.StaffEntries.filter((e) => e)
          : container.StaffEntries[staffSel]
            ? [container.StaffEntries[staffSel]]
            : [];

      const pitches: number[] = [];
      for (const staffEntry of staffEntries) {
        const voiceEntry = staffEntry.VoiceEntries[0];
        if (!voiceEntry) continue;

        for (const note of voiceEntry.Notes) {
          if (note.isRest() || !note.Pitch) continue;

          // Tied continuation: same Tie, but not the note that started it.
          const tie = note.NoteTie;
          if (tie && tie.StartNote !== note) continue;

          pitches.push(osmdHalfToneToMidi(note.halfTone));
        }
      }

      if (pitches.length > 0) {
        steps.push({
          pitches: [...new Set(pitches)].sort((a, b) => a - b),
          measure: measure.MeasureNumber,
          cursorIndex: here
        });
      }
    }
  }

  return steps;
}
