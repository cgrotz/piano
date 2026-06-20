// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createMusicImporter } from './importer';
import type { Unzip } from './unzip';

const encode = (text: string) => new TextEncoder().encode(text);

function makeXml(options: { workTitle?: string; movementTitle?: string; composer?: string } = {}): string {
  const workPart = options.workTitle
    ? `<work><work-title>${options.workTitle}</work-title></work>`
    : '';
  const movementPart = options.movementTitle
    ? `<movement-title>${options.movementTitle}</movement-title>`
    : '';
  const composerPart = options.composer
    ? `<identification><creator type="composer">${options.composer}</creator></identification>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${workPart}
  ${movementPart}
  ${composerPart}
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
</score-partwise>`;
}

function makeContainerXml(rootPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="${rootPath}" />
  </rootfiles>
</container>`;
}

/** A no-op unzip that should never be called for .xml files. */
const unusedUnzip: Unzip = async () => {
  throw new Error('unzip should not be called for .xml files');
};

describe('createMusicImporter', () => {
  describe('XML import', () => {
    it('extracts work-title and composer', async () => {
      const xml = makeXml({ workTitle: 'Test', composer: 'Bach' });
      const file = new File([xml], 'score.xml', { type: 'text/xml' });
      const importer = createMusicImporter(unusedUnzip);

      const result = await importer.import(file);

      expect(result.title).toBe('Test');
      expect(result.composer).toBe('Bach');
      expect(result.xml).toBe(xml);
    });

    it('falls back to movement-title when work-title is absent', async () => {
      const xml = makeXml({ movementTitle: 'Allegro', composer: 'Mozart' });
      const file = new File([xml], 'score.xml', { type: 'text/xml' });
      const importer = createMusicImporter(unusedUnzip);

      const result = await importer.import(file);

      expect(result.title).toBe('Allegro');
      expect(result.composer).toBe('Mozart');
    });

    it('falls back to filename (minus extension) when no title elements exist', async () => {
      const xml = makeXml({});
      const file = new File([xml], 'my-sonata.xml', { type: 'text/xml' });
      const importer = createMusicImporter(unusedUnzip);

      const result = await importer.import(file);

      expect(result.title).toBe('my-sonata');
      expect(result.composer).toBe('Unknown');
    });
  });

  describe('MXL import', () => {
    it('resolves the root file via META-INF/container.xml', async () => {
      const scoreXml = makeXml({ workTitle: 'Contained', composer: 'Liszt' });
      const containerXml = makeContainerXml('score.xml');

      const mockUnzip: Unzip = async () => ({
        'META-INF/container.xml': encode(containerXml),
        'score.xml': encode(scoreXml)
      });

      const file = new File([new Uint8Array(0)], 'archive.mxl');
      const importer = createMusicImporter(mockUnzip);

      const result = await importer.import(file);

      expect(result.title).toBe('Contained');
      expect(result.composer).toBe('Liszt');
      expect(result.xml).toBe(scoreXml);
    });

    it('falls back to first .musicxml file when container.xml is absent', async () => {
      const scoreXml = makeXml({ workTitle: 'Fallback' });

      const mockUnzip: Unzip = async () => ({
        'some/inner.musicxml': encode(scoreXml)
      });

      const file = new File([new Uint8Array(0)], 'archive.mxl');
      const importer = createMusicImporter(mockUnzip);

      const result = await importer.import(file);

      expect(result.title).toBe('Fallback');
    });

    it('throws when no .xml files are found in the archive', async () => {
      const mockUnzip: Unzip = async () => ({
        'README.txt': encode('not a score')
      });

      const file = new File([new Uint8Array(0)], 'bad.mxl');
      const importer = createMusicImporter(mockUnzip);

      await expect(importer.import(file)).rejects.toThrow(
        'No MusicXML rootfile found inside the .mxl archive.'
      );
    });
  });
});
