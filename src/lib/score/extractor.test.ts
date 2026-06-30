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

/**
 * Two whole-note measures (C4, then D4) with a backward repeat at the end of
 * measure 2. The cursor plays them as 1,2,1,2 — so the extracted steps must too,
 * or the keyboard/grading falls out of sync with the visual cursor on the loop.
 */
const REPEAT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions>
        <clef><sign>G</sign><line>2</line></clef>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <barline location="right">
        <bar-style>light-heavy</bar-style>
        <repeat direction="backward"/>
      </barline>
    </measure>
  </part>
</score-partwise>`;

describe('extractSteps — repeats', () => {
  async function load(xml: string) {
    const div = document.createElement('div');
    const osmd = new OpenSheetMusicDisplay(div);
    await osmd.load(xml);
    return osmd;
  }

  it('replays a repeated section in playback order (1,2,1,2)', async () => {
    const osmd = await load(REPEAT_XML);
    const steps = extractSteps(osmd, { staffIndex: 0 });
    // C4, D4, then the backward repeat plays C4, D4 again.
    expect(steps.map((s) => s.pitches)).toEqual([[60], [62], [60], [62]]);
    expect(steps.map((s) => s.measure)).toEqual([1, 2, 1, 2]);
  });

  it('assigns strictly increasing cursorIndex across the repeat seam', async () => {
    const osmd = await load(REPEAT_XML);
    const idx = extractSteps(osmd, { staffIndex: 0 }).map((s) => s.cursorIndex);
    // moveToIndex is forward-only, so the repeated steps must keep counting up
    // (matching the cursor's own stop sequence), not reset to the source ordinal.
    expect(idx).toEqual([0, 1, 2, 3]);
  });

  it("doesn't see the repeat's notes as held over from the first pass", async () => {
    const osmd = await load(REPEAT_XML);
    // Each note is a fresh onset; nothing carries across the repeat seam.
    expect(extractSteps(osmd, { staffIndex: 0 }).map((s) => s.sustained)).toEqual([[], [], [], []]);
  });
});
