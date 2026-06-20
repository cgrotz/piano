import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { GraphicalNote } from 'opensheetmusicdisplay';
import { extractSteps, type ExtractOptions, type GradedStep } from './extractor';

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
      drawTitle: true,
      followCursor: true
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

  #scrollToCursor(): void {
    const el = this.#osmd.cursor.cursorElement;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  /** Extract the graded step sequence from the loaded score (component 7). */
  extractSteps(options?: ExtractOptions): GradedStep[] {
    return extractSteps(this.#osmd, options);
  }

  /** Flash the note(s) under the cursor red (wrong-press feedback). No re-render. */
  highlightWrong(): void {
    this.clearHighlight();
    const gnotes = this.#osmd.cursor.GNotesUnderCursor();
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
