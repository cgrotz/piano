import { addScore, getAllScores, getScore, deleteScore, type ScoreRecord } from './db';
import { createMusicImporter } from '../import/importer';
import { fflateUnzip } from '../import/unzip.fflate';
import { validateScore } from '../score/validate';
import builtinScaleXml from '../samples/c-major-scale.musicxml?raw';

/** A row in the library list. Metadata only — XML is fetched on open via getXml(). */
export interface LibraryEntry {
  id: string;
  title: string;
  composer: string;
  /** Epoch ms; 0 for the built-in sample. */
  importedAt: number;
  builtIn?: boolean;
}

const BUILTIN: LibraryEntry = {
  id: 'builtin:c-major-scale',
  title: 'C Major Scale',
  composer: 'Built-in',
  importedAt: 0,
  builtIn: true
};

/**
 * Reactive library over IndexedDB (components 4-5). Always lists the built-in
 * sample first so the app is usable before anything is imported, then imported
 * scores newest-first.
 */
export class LibraryController {
  entries = $state<LibraryEntry[]>([BUILTIN]);
  importing = $state(false);
  error = $state<string | null>(null);

  #importer = createMusicImporter(fflateUnzip);

  /**
   * Load imported scores. Never rejects: if IndexedDB is unavailable (e.g. some
   * private-browsing modes) the built-in sample still works and the reason is
   * surfaced in `error` instead of an unhandled rejection and a silently empty list.
   */
  async init(): Promise<void> {
    try {
      this.#apply(await getAllScores());
    } catch (err) {
      this.error = `Couldn't load your library: ${message(err)}`;
    }
  }

  async importFile(file: File): Promise<void> {
    this.error = null;
    this.importing = true;
    try {
      const score = await this.#importer.import(file);
      const stepCount = await validateScore(score.xml);
      if (stepCount === 0) {
        throw new Error('No playable notes found in the top staff.');
      }
      await addScore({
        id: crypto.randomUUID(),
        title: score.title,
        composer: score.composer,
        importedAt: Date.now(),
        xml: score.xml
      });
      this.#apply(await getAllScores());
    } catch (err) {
      this.error = message(err);
    } finally {
      this.importing = false;
    }
  }

  /** Delete an imported score. Never rejects; failures land in `error`. */
  async remove(id: string): Promise<void> {
    this.error = null;
    try {
      await deleteScore(id);
      this.#apply(await getAllScores());
    } catch (err) {
      this.error = `Couldn't delete the score: ${message(err)}`;
    }
  }

  async getXml(entry: LibraryEntry): Promise<string> {
    if (entry.builtIn) return builtinScaleXml;
    const record = await getScore(entry.id);
    if (!record) throw new Error('Score not found in library.');
    return record.xml;
  }

  #apply(records: ScoreRecord[]): void {
    const imported = records
      .map(({ id, title, composer, importedAt }) => ({ id, title, composer, importedAt }))
      .sort((a, b) => b.importedAt - a.importedAt);
    this.entries = [BUILTIN, ...imported];
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
