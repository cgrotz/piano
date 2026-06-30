// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { osmdHalfToneToMidi, extractSteps } from './extractor';

describe('osmdHalfToneToMidi', () => {
  it('converts OSMD half-tone 48 to MIDI 60 (middle C)', () => {
    expect(osmdHalfToneToMidi(48)).toBe(60);
  });

  it('converts OSMD half-tone 0 to MIDI 12', () => {
    expect(osmdHalfToneToMidi(0)).toBe(12);
  });

  it('converts OSMD half-tone 57 to MIDI 69 (A4)', () => {
    expect(osmdHalfToneToMidi(57)).toBe(69);
  });
});

/**
 * One piano part, two staves, one 4/4 measure:
 *   Right hand (staff 1): C5  D5  E5  F5   (four quarters)
 *   Left  hand (staff 2): C3 (half)  G3 (half)
 * So the left-hand notes are HELD across the right hand's faster notes — the case
 * my design notes flagged as the hard part of both-hands grading.
 */
const TWO_STAFF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>half</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe('extractSteps — two staves', () => {
  // Load the parsed model only (no render — jsdom has no real layout engine).
  async function load(xml: string) {
    const div = document.createElement('div');
    const osmd = new OpenSheetMusicDisplay(div);
    await osmd.load(xml);
    return osmd;
  }

  const pitchesOf = (osmd: OpenSheetMusicDisplay, opt?: Parameters<typeof extractSteps>[1]) =>
    extractSteps(osmd, opt).map((s) => s.pitches);

  it('grades the right hand alone (staff 0)', async () => {
    const osmd = await load(TWO_STAFF_XML);
    expect(pitchesOf(osmd, { staffIndex: 0 })).toEqual([[72], [74], [76], [77]]);
  });

  it('grades the left hand alone (staff 1)', async () => {
    const osmd = await load(TWO_STAFF_XML);
    // Two half notes; held duration does not create extra steps.
    expect(pitchesOf(osmd, { staffIndex: 1 })).toEqual([[48], [55]]);
  });

  it("merges both hands: held notes don't re-trigger under the faster hand", async () => {
    const osmd = await load(TWO_STAFF_XML);
    // Onsets only: beat 1 = C3+C5, beat 2 = D5 (C3 still held), beat 3 = G3+E5, beat 4 = F5.
    expect(pitchesOf(osmd, { staffIndex: 'all' })).toEqual([[48, 72], [74], [55, 76], [77]]);
  });

  it('keeps cursorIndex aligned across merge (one ordinal per container)', async () => {
    const osmd = await load(TWO_STAFF_XML);
    expect(extractSteps(osmd, { staffIndex: 'all' }).map((s) => s.cursorIndex)).toEqual([0, 1, 2, 3]);
  });

  it('marks held notes as sustained at the steps they span', async () => {
    const osmd = await load(TWO_STAFF_XML);
    // C3 (half) is struck on beat 1 and still sounds on beat 2; G3 (half) is
    // struck on beat 3 and still sounds on beat 4. Onset steps never re-list them.
    expect(extractSteps(osmd, { staffIndex: 'all' }).map((s) => s.sustained)).toEqual([
      [], // beat 1: nothing carried over
      [48], // beat 2: C3 held under D5
      [], // beat 3: G3 freshly struck (an onset, not sustained)
      [55] // beat 4: G3 held under F5
    ]);
  });

  it('attributes held left-hand notes to the left hand for colouring', async () => {
    const osmd = await load(TWO_STAFF_XML);
    // leftPitches = left-hand onsets ∪ left-hand sustained at each step.
    expect(extractSteps(osmd, { staffIndex: 'all' }).map((s) => s.leftPitches)).toEqual([
      [48], // C3 onset
      [48], // C3 still held (onset has scrolled past)
      [55], // G3 onset
      [55] // G3 still held
    ]);
  });

  it('reports no sustained notes when grading a single staff of equal rhythm', async () => {
    const osmd = await load(TWO_STAFF_XML);
    // The right hand is four separate quarters — nothing is ever held over.
    expect(extractSteps(osmd, { staffIndex: 0 }).map((s) => s.sustained)).toEqual([[], [], [], []]);
  });
});
