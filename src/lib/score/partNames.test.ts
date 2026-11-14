import { describe, it, expect } from 'vitest';
import { friendlyPartName, instrumentSounds } from './partNames';

describe('friendlyPartName', () => {
  it('keeps names written in Latin script', () => {
    expect(friendlyPartName('Piano', 'keyboard.piano', 0)).toBe('Piano');
    expect(friendlyPartName('Klavier (rechts)', 'keyboard.piano')).toBe('Klavier (rechts)');
    expect(friendlyPartName('Violon 1', 'strings.violin')).toBe('Violon 1');
  });

  it('derives the name from the sound id for other scripts', () => {
    expect(friendlyPartName('Фортепиано', 'keyboard.piano', 0)).toBe('Piano');
    expect(friendlyPartName('Альт', 'voice.alto', 52)).toBe('Voice');
    expect(friendlyPartName('ヴァイオリン', 'strings.violin')).toBe('Violin');
  });

  it('falls back to the GM program family', () => {
    expect(friendlyPartName('Гитара', undefined, 25)).toBe('Guitar');
    expect(friendlyPartName('Хор', undefined, 52)).toBe('Voice');
  });

  it('keeps the written name when nothing else is known', () => {
    expect(friendlyPartName('Альт')).toBe('Альт');
  });
});

describe('instrumentSounds', () => {
  it('maps part ids to their instrument sound', () => {
    const xml = `<score-partwise><part-list>
      <score-part id="P1"><part-name>Альт</part-name><score-instrument id="P1-I1"><instrument-sound>voice.alto</instrument-sound></score-instrument></score-part>
      <score-part id="P2"><part-name>Фортепиано</part-name><score-instrument id="P2-I1"><instrument-sound>keyboard.piano</instrument-sound></score-instrument></score-part>
      <score-part id="P3"><part-name>X</part-name></score-part>
    </part-list></score-partwise>`;
    expect([...instrumentSounds(xml)]).toEqual([
      ['P1', 'voice.alto'],
      ['P2', 'keyboard.piano']
    ]);
  });
});
