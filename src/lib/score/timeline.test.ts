// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { extractTimeline, barRangeSpan, channelForPart } from './timeline';

async function load(xml: string) {
  const osmd = new OpenSheetMusicDisplay(document.createElement('div'));
  await osmd.load(xml);
  return osmd;
}

/** A note; `tie` adds both the sound (`<tie>`) and notation (`<tied>`) elements, as real files do. */
const note = (step: string, octave: number, duration: number, type: string, tie?: 'start' | 'stop') =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>` +
  (tie ? `<tie type="${tie}"/>` : '') +
  `<type>${type}</type>` +
  (tie ? `<notations><tied type="${tie}"/></notations>` : '') +
  `</note>`;

/**
 * Two parts: a violin (program 41 → GM 40) and a piano. Bar 1: violin C5 tied
 * into bar 2; piano E4 half + rest. Bar 2 ends with a backward repeat, so bars
 * 1–2 play twice.
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Violin</part-name>
      <score-instrument id="P1-I1"><instrument-name>Violin</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>41</midi-program></midi-instrument>
    </score-part>
    <score-part id="P2"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note('C', 5, 4, 'whole', 'start')}
    </measure>
    <measure number="2">
      ${note('C', 5, 2, 'half', 'stop')}
      ${note('D', 5, 2, 'half')}
      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note('E', 4, 2, 'half')}
      <note><rest/><duration>2</duration><type>half</type></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>4</duration><type>whole</type></note>
      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;

describe('extractTimeline', () => {
  it('maps parts to channels and GM programs', async () => {
    const t = extractTimeline(await load(XML));
    expect(t.parts.map((p) => [p.name, p.channel, p.program])).toEqual([
      ['Violin', 0, 40],
      ['Piano', 1, 0]
    ]);
  });

  it('merges ties into one long note and plays repeats twice', async () => {
    const t = extractTimeline(await load(XML));
    const violin = t.notes.filter((n) => n.channel === 0).map((n) => [n.onset, n.duration, n.pitch]);
    expect(violin).toEqual([
      [0, 1.5, 72], // C5 whole tied to a half
      [1.5, 0.5, 74],
      [2, 1.5, 72], // repeat
      [3.5, 0.5, 74]
    ]);
    expect(t.length).toBe(4);
  });

  it('keeps notes of all parts, sorted by onset', async () => {
    const t = extractTimeline(await load(XML));
    expect(t.notes.filter((n) => n.onset === 0).map((n) => n.pitch)).toEqual([72, 64]);
  });

  it('finds the span of a bar range (first pass)', async () => {
    const t = extractTimeline(await load(XML));
    expect(barRangeSpan(t.notes, 2, 2)).toEqual({ from: 1.5, to: 2 });
    expect(barRangeSpan(t.notes, 1, 2)).toEqual({ from: 0, to: Infinity });
  });
});

describe('channelForPart', () => {
  it('skips the drum channel', () => {
    expect([0, 8, 9, 10].map(channelForPart)).toEqual([0, 8, 10, 11]);
  });
});
