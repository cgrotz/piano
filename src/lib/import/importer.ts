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

      // Musical validation (OSMD parse + ≥1 graded step) happens in
      // LibraryController.importFile via validateScore, keeping this layer OSMD-free.
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

/**
 * Title/composer, most explicit source first. Many exports (MuseScore in
 * particular) leave `<work>`/`<identification>` empty and only print the title
 * and composer as page-1 `<credit>` text, so those are the next fallback before
 * the filename.
 */
function extractMetadata(xml: string, fallbackName: string): { title: string; composer: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const credits = readCredits(doc);

  const title =
    text(doc.querySelector('work > work-title')) ??
    text(doc.querySelector('movement-title')) ??
    credits.find((c) => c.type === 'title')?.text ??
    largestUntypedCredit(credits)?.text ??
    prettifyFileName(fallbackName);

  const composer =
    text(doc.querySelector('identification creator[type="composer"]')) ??
    credits.find((c) => c.type === 'composer')?.text ??
    credits.find((c) => !c.type && COMPOSER_PREFIX.test(c.text))?.text ??
    text(doc.querySelector('identification creator'));

  return { title, composer: composer ? cleanComposer(composer) : 'Unknown' };
}

interface Credit {
  type?: string;
  text: string;
  fontSize: number;
}

/** Page-1 credits; a credit's several `<credit-words>` lines are joined. */
function readCredits(doc: Document): Credit[] {
  const out: Credit[] = [];
  for (const credit of doc.querySelectorAll('credit')) {
    const page = credit.getAttribute('page');
    if (page && page !== '1') continue;
    const words = [...credit.querySelectorAll('credit-words')];
    const joined = words.map((w) => w.textContent?.trim() ?? '').filter(Boolean).join(' ');
    if (!joined) continue;
    const sizes = words.map((w) => parseFloat(w.getAttribute('font-size') ?? '') || 0);
    out.push({
      type: text(credit.querySelector('credit-type'))?.toLowerCase(),
      text: joined.replace(/\s+/g, ' '),
      fontSize: Math.max(0, ...sizes)
    });
  }
  return out;
}

/** The biggest page-1 text that isn't labelled as something else — the title in practice. */
function largestUntypedCredit(credits: Credit[]): Credit | undefined {
  const untyped = credits.filter((c) => !c.type && !COMPOSER_PREFIX.test(c.text) && !ARRANGER_PREFIX.test(c.text));
  if (untyped.length === 0 || untyped.every((c) => c.fontSize === 0)) return undefined;
  return untyped.reduce((best, c) => (c.fontSize > best.fontSize ? c : best));
}

const COMPOSER_PREFIX = /^(words and music( by)?|music( by)?|composed by|composer|komponist|musik)\b\s*[:\-–]?\s*/i;
const ARRANGER_PREFIX = /^(arr\.?|arranged|arranger|bearbeitung)\b/i;

/**
 * Drop a "Composer:"-style prefix, and any arranger credit that shares the same
 * text block ("Joe Hisaishi Arranger: Alex Patience" -> "Joe Hisaishi").
 */
function cleanComposer(value: string): string {
  const cleaned = value
    .replace(COMPOSER_PREFIX, '')
    .split(/\s*[,;(]?\s*\b(?:arr\.|arranged\b|arrangement\b|arranger\b|bearbeitung\b)/i)[0]
    .trim();
  return cleaned || value;
}

/** "zeldas-lullaby_easy.mxl" -> "Zeldas lullaby easy". */
export function prettifyFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base[0].toUpperCase() + base.slice(1) : name;
}

function text(el: Element | null): string | undefined {
  const value = el?.textContent?.trim();
  return value ? value : undefined;
}
