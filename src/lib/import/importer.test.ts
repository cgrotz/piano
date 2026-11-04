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

    it('falls back to a tidied filename when no title elements exist', async () => {
      const xml = makeXml({});
      const file = new File([xml], 'my-sonata_easy.xml', { type: 'text/xml' });
      const importer = createMusicImporter(unusedUnzip);

      const result = await importer.import(file);

      expect(result.title).toBe('My sonata easy');
      expect(result.composer).toBe('Unknown');
    });

    const withCredits = (credits: string) =>
      makeXml({}).replace('<part-list>', `${credits}<part-list>`);
    const credit = (words: string, size?: number, type?: string) =>
      `<credit page="1">${type ? `<credit-type>${type}</credit-type>` : ''}<credit-words${size ? ` font-size="${size}"` : ''}>${words}</credit-words></credit>`;

    it('uses typed title/composer credits when <work> is empty', async () => {
      const xml = withCredits(credit('Balu', 22, 'title') + credit('Kettcar', 10, 'composer'));
      const result = await createMusicImporter(unusedUnzip).import(new File([xml], 'balu-kettcar.mxl.xml'));
      expect(result.title).toBe('Balu');
      expect(result.composer).toBe('Kettcar');
    });

    it('takes the largest untyped page-1 credit as title and a "Composer:" credit as composer (MuseScore style)', async () => {
      const xml = withCredits(
        credit('Howl&apos;s Moving Castle', 14) +
          credit('Merry-Go-Round Of Life', 24) +
          credit('Composer: Joe Hisaishi', 12) +
          credit('Arranger: Alex Patience', 30)
      );
      const result = await createMusicImporter(unusedUnzip).import(new File([xml], 'merry-go-round-of-life.xml'));
      expect(result.title).toBe('Merry-Go-Round Of Life');
      expect(result.composer).toBe('Joe Hisaishi');
    });

    it('drops an arranger credit that shares the composer text block', async () => {
      const xml = withCredits(credit('Moon River', 24) + `<credit page="1"><credit-type>composer</credit-type><credit-words>Henry Mancini</credit-words><credit-words>Arranged by Madeline Stratford</credit-words></credit>`);
      const result = await createMusicImporter(unusedUnzip).import(new File([xml], 'moon.xml'));
      expect(result.composer).toBe('Henry Mancini');
    });

    it('strips "Words and Music by" from the composer', async () => {
      const xml = makeXml({ workTitle: 'Let It Go', composer: 'Words and Music by Kristen Anderson-Lopez and Robert Lopez' });
      const result = await createMusicImporter(unusedUnzip).import(new File([xml], 'x.xml'));
      expect(result.composer).toBe('Kristen Anderson-Lopez and Robert Lopez');
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
