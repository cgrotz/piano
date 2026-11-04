import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { extractSteps, type ExtractOptions } from './extractor';

/**
 * Validate a MusicXML string at import time (ARCHITECTURE.md, B4): confirm OSMD
 * can parse it and that the tracked staff yields at least one graded step.
 *
 * Loads into a detached OSMD instance but never renders — `load()` populates the
 * musical model (which `extractSteps` reads), while skipping render avoids any
 * layout/canvas work on an off-screen element. Returns the graded step count
 * and the number of bars (for the library list).
 */
export async function validateScore(
  xml: string,
  options?: ExtractOptions
): Promise<{ steps: number; bars: number }> {
  const div = document.createElement('div');
  const osmd = new OpenSheetMusicDisplay(div);
  try {
    await osmd.load(xml);
    return { steps: extractSteps(osmd, options).length, bars: osmd.Sheet.SourceMeasures.length };
  } finally {
    osmd.clear();
  }
}
