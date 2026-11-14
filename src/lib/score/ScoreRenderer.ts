import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { GraphicalNote } from 'opensheetmusicdisplay';
import { extractSteps, type ExtractOptions, type GradedStep } from './extractor';
import { extractTimeline, type Timeline } from './timeline';
import type { StaffInfo } from './hands';
import { beatsPerBar, beatUnitLength } from '../metronome/bpm';

// The sheet is always on white paper, so these are fixed (not theme) colours.
const WRONG_COLOR = '#dc2626';
const DEFAULT_COLOR = '#000000';
const COLOR_OPTS = { applyToNoteheads: true, applyToStem: true };

/** 'line': one long zoomed staff line (landscape); 'page': wrapped systems (portrait). */
export type SheetLayout = 'line' | 'page';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Thin wrapper around an OSMD instance (component 6 in ARCHITECTURE.md).
 *
 * Owns rendering and the visual cursor, and keeps OSMD as the single source of
 * truth for the score. The cursor is driven positionally by container ordinal
 * (see GradedStep.cursorIndex), so the playhead lands exactly on the graded note
 * even across rests, ties, and a second (untracked) staff.
 *
 * Layout is chosen by the caller ({@link layout}) and sized to the container:
 * a single line is zoomed to fill the available height, so notes are as large
 * as the screen allows when read from a music stand.
 */
export class ScoreRenderer {
  #osmd: OpenSheetMusicDisplay;
  #container: HTMLElement;
  /** Current cursor position as a container ordinal (matches GradedStep.cursorIndex). */
  #cursorIndex = 0;
  #cursorVisible = true;
  #layout: SheetLayout = 'line';

  constructor(container: HTMLElement, cursorColor = '#4f46e5') {
    this.#container = container;
    this.#osmd = new OpenSheetMusicDisplay(container, {
      // Resizing is driven by the player (debounced, layout-aware), not OSMD.
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawCredits: false,
      renderSingleHorizontalStaffline: true,
      cursorsOptions: [{ type: 0, color: cursorColor, alpha: 0.22, follow: true }]
    });
  }

  async load(xml: string, layout: SheetLayout = 'line'): Promise<void> {
    await this.#osmd.load(xml);
    this.#cursorIndex = 0;
    this.layout(layout);
  }

  /**
   * (Re-)render for the container's current size in the given layout and put
   * the cursor back where it was. A no-op while the container is hidden.
   */
  layout(mode: SheetLayout = this.#layout): void {
    const osmd = this.#osmd;
    const box = this.#container;
    if (!osmd.Sheet || box.clientWidth === 0 || box.clientHeight === 0) return;
    this.#layout = mode;
    osmd.setOptions({ renderSingleHorizontalStaffline: mode === 'line' });
    if (mode === 'line') {
      // Render once at 1x to measure, then zoom so the staves fill the height.
      osmd.Zoom = 1;
      osmd.render();
      const height = box.querySelector('svg')?.getBoundingClientRect().height ?? 0;
      const zoom = height > 0 ? clamp((box.clientHeight - 24) / height, 0.75, 2.1) : 1;
      if (Math.abs(zoom - 1) > 0.04) {
        osmd.Zoom = zoom;
        osmd.render();
      }
    } else {
      // Wrapped systems: bigger notes on wider screens, fewer bars per line.
      osmd.Zoom = clamp(box.clientWidth / 1050, 0.5, 1.5);
      osmd.render();
    }
    this.#restoreCursor();
  }

  /** Cursor colour follows the hand being practised. */
  setCursorColor(color: string): void {
    const cursor = this.#osmd.cursor;
    if (!cursor) return;
    cursor.CursorOptions = { ...cursor.CursorOptions, color };
    if (this.#cursorVisible) cursor.update();
  }

  #restoreCursor(): void {
    const cursor = this.#osmd.cursor;
    if (!cursor) return;
    const target = this.#cursorIndex;
    cursor.reset();
    this.#cursorIndex = 0;
    if (!this.#cursorVisible) {
      cursor.hide();
      return;
    }
    cursor.show();
    this.moveToIndex(target, false);
  }

  /** Return the cursor to the first container. */
  reset(): void {
    this.#osmd.cursor.reset();
    this.#osmd.cursor.show();
    this.#cursorVisible = true;
    this.#cursorIndex = 0;
  }

  /**
   * Move the cursor forward to a container ordinal (a GradedStep.cursorIndex).
   * Forward-only: grading never moves backward within a run.
   */
  moveToIndex(target: number, smooth = true): void {
    const cursor = this.#osmd.cursor;
    while (this.#cursorIndex < target && !cursor.iterator?.EndReached) {
      cursor.next();
      this.#cursorIndex++;
    }
    cursor.update();
    this.#scrollToCursor(smooth);
  }

  /** Hide the cursor (e.g. on completion). */
  finish(): void {
    this.#cursorVisible = false;
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

  /**
   * Keep the cursor in view with room to read ahead: about a third from the
   * left in a single line, a quarter from the top when wrapped. Scrolls only
   * the sheet container (scrollIntoView would also nudge the page itself).
   */
  #scrollToCursor(smooth = true): void {
    const el = this.#osmd.cursor.cursorElement;
    const box = this.#container;
    if (!el || box.clientWidth === 0) return;
    const b = box.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const left = box.scrollLeft + (c.left - b.left) - b.width * 0.3;
    const top = this.#layout === 'page' ? box.scrollTop + (c.top - b.top) - b.height * 0.25 : box.scrollTop;
    box.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  /**
   * Length of one metronome beat in whole notes (bar length / beats per bar),
   * so a BPM shown on the metronome converts to playback speed.
   */
  get beatLength(): number {
    const ts = this.#osmd.Sheet?.SourceMeasures[0]?.ActiveTimeSignature;
    const bar = ts && ts.Denominator > 0 ? ts.Numerator / ts.Denominator : 1;
    return bar / this.beatsPerBar;
  }

  /** Every note to be heard, per part, for computer playback ("Listen"). */
  timeline(): Timeline {
    return extractTimeline(this.#osmd);
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
