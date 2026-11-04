import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { GraphicalNote } from 'opensheetmusicdisplay';
import { extractSteps, type ExtractOptions, type GradedStep } from './extractor';
import type { StaffInfo } from './hands';
import { beatsPerBar, beatUnitLength } from '../metronome/bpm';

const WRONG_COLOR = '#e5544b';
const DEFAULT_COLOR = '#000000';
const COLOR_OPTS = { applyToNoteheads: true, applyToStem: true };

/**
 * Thin wrapper around an OSMD instance (component 6 in ARCHITECTURE.md).
 *
 * Owns rendering and the visual cursor, and keeps OSMD as the single source of
 * truth for the score. The cursor is driven positionally by container ordinal
 * (see GradedStep.cursorIndex), so the playhead lands exactly on the graded note
 * even across rests, ties, and a second (untracked) staff.
 */
export class ScoreRenderer {
  #osmd: OpenSheetMusicDisplay;
  /** Current cursor position as a container ordinal (matches GradedStep.cursorIndex). */
  #cursorIndex = 0;

  constructor(container: HTMLElement) {
    this.#osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawCredits: false,
      renderSingleHorizontalStaffline: true
    });
  }

  async load(xml: string): Promise<void> {
    await this.#osmd.load(xml);
    this.#osmd.render();
    this.#osmd.cursor.show();
    this.#cursorIndex = 0;
  }

  /** Return the cursor to the first container. */
  reset(): void {
    this.#osmd.cursor.reset();
    this.#osmd.cursor.show();
    this.#cursorIndex = 0;
  }

  /**
   * Move the cursor forward to a container ordinal (a GradedStep.cursorIndex).
   * Forward-only: grading never moves backward within a run.
   */
  moveToIndex(target: number): void {
    const cursor = this.#osmd.cursor;
    while (this.#cursorIndex < target && !cursor.iterator?.EndReached) {
      cursor.next();
      this.#cursorIndex++;
    }
    cursor.update();
    this.#scrollToCursor();
  }

  /** Hide the cursor (e.g. on completion). */
  finish(): void {
    this.#osmd.cursor.hide();
  }

  /** Number of staves in the loaded score (1 for a single-staff exercise). */
  get staffCount(): number {
    return this.#osmd.Sheet?.Staves.length ?? 1;
  }

  /** Every staff with the part it belongs to, in score order. */
  get staves(): StaffInfo[] {
    const sheet = this.#osmd.Sheet;
    if (!sheet) return [];
    const out: StaffInfo[] = [];
    sheet.Instruments.forEach((part, p) => {
      part.Staves.forEach((staff, k) => {
        out.push({
          index: sheet.Staves.indexOf(staff),
          partName: part.Name?.trim() || `Part ${p + 1}`,
          partStaffIndex: k,
          partStaffCount: part.Staves.length
        });
      });
    });
    return out.sort((a, b) => a.index - b.index);
  }

  /** Score's notated tempo in BPM, or 0 if the file carries none. */
  get bpm(): number {
    return this.#osmd.Sheet?.DefaultStartTempoInBpm ?? 0;
  }

  /**
   * Metronome clicks per bar for the first measure, following the tempo
   * marking's beat unit (dotted quarter in 6/8, half in cut time); see
   * `beatsPerBar` in metronome/bpm.ts.
   */
  get beatsPerBar(): number {
    const sheet = this.#osmd.Sheet;
    const ts = sheet?.SourceMeasures[0]?.ActiveTimeSignature;
    if (!ts) return 4;
    // First explicit tempo marking (<metronome>), if any.
    let unit: number | undefined;
    for (const m of sheet.SourceMeasures) {
      const tempo = m.TempoExpressions?.find((t) => t.InstantaneousTempo)?.InstantaneousTempo;
      if (tempo) {
        unit = beatUnitLength(tempo.beatUnit, tempo.dotted);
        break;
      }
    }
    return beatsPerBar(ts.Numerator, ts.Denominator, unit);
  }

  #scrollToCursor(): void {
    const el = this.#osmd.cursor.cursorElement;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  /** Extract the graded step sequence from the loaded score (component 7). */
  extractSteps(options?: ExtractOptions): GradedStep[] {
    return extractSteps(this.#osmd, options);
  }

  /**
   * Flash the note(s) under the cursor red (wrong-press feedback). No re-render.
   * Only notes on `staves` (the ones being graded) turn red — the cursor spans
   * every staff, and the other hand's notes did nothing wrong.
   */
  highlightWrong(staves?: number[]): void {
    this.clearHighlight();
    const sheetStaves = this.#osmd.Sheet.Staves;
    const gnotes = this.#osmd.cursor
      .GNotesUnderCursor()
      .filter((g) => !staves || staves.includes(sheetStaves.indexOf(g.sourceNote.ParentStaff)));
    for (const g of gnotes) g.setColor(WRONG_COLOR, COLOR_OPTS);
    this.#highlighted = gnotes;
  }

  /** Restore any red-flashed notes to the default color. */
  clearHighlight(): void {
    for (const g of this.#highlighted) g.setColor(DEFAULT_COLOR, COLOR_OPTS);
    this.#highlighted = [];
  }

  #highlighted: GraphicalNote[] = [];

  dispose(): void {
    this.#osmd.clear();
  }
}
