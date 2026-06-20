import type { Unzip } from './unzip';

export interface ImportedScore {
  title: string;
  composer: string;
  /** Raw MusicXML, ready for OSMD and the IndexedDB library store. */
  xml: string;
}

export interface MusicImporter {
  /** Accepts a `.xml` or `.mxl` file; handles unzip + metadata internally. */
  import(file: File): Promise<ImportedScore>;
}

const decoder = new TextDecoder();

/**
 * Format-level importer (component 4). Depends only on the {@link Unzip} port,
 * so it is agnostic to the underlying zip library.
 */
export function createMusicImporter(unzip: Unzip): MusicImporter {
  return {
    async import(file: File): Promise<ImportedScore> {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const xml = isMxl(file.name)
        ? await extractMusicXmlFromMxl(bytes, unzip)
        : decoder.decode(bytes);

      // TODO(validation): once OSMD is integrated, parse here and confirm a
      // non-empty tracked voice before accepting the import (ARCHITECTURE.md, B4).
      return { xml, ...extractMetadata(xml, file.name) };
    }
  };
}

function isMxl(name: string): boolean {
  return name.toLowerCase().endsWith('.mxl');
}

/**
 * An `.mxl` is a zip that can hold several files. The actual score is named by
 * META-INF/container.xml's <rootfile full-path="...">, so we resolve that rather
 * than guessing. Falls back to the first .musicxml/.xml entry outside META-INF.
 */
async function extractMusicXmlFromMxl(bytes: Uint8Array, unzip: Unzip): Promise<string> {
  const files = await unzip(bytes);

  let rootPath: string | undefined;
  const container = files['META-INF/container.xml'];
  if (container) {
    const doc = new DOMParser().parseFromString(decoder.decode(container), 'application/xml');
    rootPath = doc.querySelector('rootfile')?.getAttribute('full-path') ?? undefined;
  }

  if (!rootPath || !files[rootPath]) {
    rootPath = Object.keys(files).find(
      (path) => !path.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(path)
    );
  }

  if (!rootPath || !files[rootPath]) {
    throw new Error('No MusicXML rootfile found inside the .mxl archive.');
  }
  return decoder.decode(files[rootPath]);
}

function extractMetadata(xml: string, fallbackName: string): { title: string; composer: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const workTitle = text(doc.querySelector('work > work-title'));
  const movementTitle = text(doc.querySelector('movement-title'));
  const composer =
    text(doc.querySelector('identification creator[type="composer"]')) ??
    text(doc.querySelector('identification creator'));

  return {
    title: workTitle ?? movementTitle ?? stripExtension(fallbackName),
    composer: composer ?? 'Unknown'
  };
}

function text(el: Element | null): string | undefined {
  const value = el?.textContent?.trim();
  return value ? value : undefined;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
