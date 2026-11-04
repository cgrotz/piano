// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { getChordPitches, extractSteps } from './extractor';

// Mock getContext to return a dummy 2D context to avoid canvas errors in jsdom
HTMLCanvasElement.prototype.getContext = function () {
  return {
    measureText: () => ({ width: 10, height: 10 }),
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({}),
    putImageData: () => {},
    createImageData: () => ({}),
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
  } as any;
};

const HARMONY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>1</staves>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <harmony>
        <root><root-step>A</root-step></root>
        <kind text="m">minor</kind>
      </harmony>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <harmony>
        <root><root-step>F</root-step></root>
        <kind>major</kind>
      </harmony>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

describe('Harmony support tests', () => {
  async function load(xml: string) {
    const div = document.createElement('div');
    const osmd = new OpenSheetMusicDisplay(div);
    await osmd.load(xml);
    return osmd;
  }

  it('correctly maps various Chord kinds to MIDI pitches', async () => {
    const osmd = await load(HARMONY_XML);
    const measure = osmd.Sheet.SourceMeasures[0];
    const container = measure.VerticalSourceStaffEntryContainers[0];
    const chord = container.StaffEntries[0]?.ChordContainers[0];
    
    expect(chord).toBeDefined();
    if (chord) {
      const pitches = getChordPitches(chord);
      // Am in octave 3 = A3 (57), C4 (60), E4 (64)
      expect(pitches).toEqual([57, 60, 64]);
    }
  });

  it('extracts chordName and chordPitches and propagates them forward', async () => {
    const osmd = await load(HARMONY_XML);
    const steps = extractSteps(osmd);
    
    // There should be 3 notes total in the first measure: A4, C5, F4
    expect(steps.length).toBe(3);
    
    // Step 0: A4 note (with Am chord)
    expect(steps[0].pitches).toEqual([69]);
    expect(steps[0].chordName).toBe('Am');
    expect(steps[0].chordPitches).toEqual([57, 60, 64]);

    // Step 1: C5 note (should inherit the active Am chord)
    expect(steps[1].pitches).toEqual([72]);
    expect(steps[1].chordName).toBe('Am');
    expect(steps[1].chordPitches).toEqual([57, 60, 64]);

    // Step 2: F4 note (with F major chord)
    expect(steps[2].pitches).toEqual([65]);
    expect(steps[2].chordName).toBe('F');
    expect(steps[2].chordPitches).toEqual([53, 57, 60]); // F3 (53), A3 (57), C4 (60)
  });
});

/** One harmony per quarter note: Cm(maj7), N.C., D pedal, G13. */
const KINDS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <harmony><root><root-step>C</root-step></root><kind>major-minor</kind></harmony>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <harmony><root><root-step>C</root-step></root><kind text="N.C.">none</kind></harmony>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <harmony><root><root-step>D</root-step></root><kind>pedal</kind></harmony>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <harmony><root><root-step>G</root-step></root><kind>dominant-13th</kind></harmony>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

describe('Chord kinds beyond the basic triads/sevenths', () => {
  it('maps each kind to its own notes, and N.C. to none', async () => {
    const osmd = new OpenSheetMusicDisplay(document.createElement('div'));
    await osmd.load(KINDS_XML);
    const chords = extractSteps(osmd).map((s) => s.chordPitches);
    expect(chords).toEqual([
      [48, 51, 55, 59], // C Eb G B (minor-major 7th), not a C major triad
      [], // N.C. lights nothing
      [50], // D pedal: just the root
      [55, 59, 62, 65, 69, 76] // G B D F A E (13th)
    ]);
  });
});
