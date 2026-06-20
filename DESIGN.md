# Piano Tutor — v1 Design Spec

A **web app (installable PWA)** that displays piano sheet music and verifies, note by
note, that the player presses the correct keys. It is a **pitch-correctness** tool, not
a timing/rhythm tool: the app waits for you, it does not push you to keep tempo.

Target platforms: **Chrome on Android (the tablet) and Chromium/Firefox on desktop.**
**iPad/Safari is not supported** — no browser on iOS exposes the Web MIDI API.

## Decisions (locked for v1)

| Area | Decision |
|------|----------|
| **Platform** | Web app / PWA (offline via service worker). No native Android build. |
| **Input** | MIDI only, via the **Web MIDI API**, over USB (e.g. Korg Liano → tablet USB-C in host/OTG mode). No microphone. |
| **Content format** | MusicXML — supports both `.xml` and compressed `.mxl`. |
| **Notation display** | OpenSheetMusicDisplay (OSMD) running natively in the browser (no WebView, no JS bridge). |
| **Position indicator** | Vertical-line playhead/cursor marking the current step. |
| **Core loop** | **Block** on the current step until it is played correctly. The cursor cannot desync from the score. |
| **Correctness** | **Exact key** — octave matters (E4 ≠ E5). |
| **A "step"** | One note, OR a chord (a set of notes struck together, any order). Single tracked voice only. |
| **Wrong press** | The current expected note flashes **red**; cursor stays put until correct. |
| **Chord in progress** | A wrong key flashes red but **keeps** already-correct notes of the chord (no reset). |
| **Tracked voice** | Default to **top staff / first voice**, with a picker to choose another. |
| **File loading** | "Import" button → browser file input (`.xml` / `.mxl`); validated, then stored in **IndexedDB** as a persistent library. |
| **End of exercise** | Show completion + a **Restart** button. |

## Why these choices

- **MIDI over microphone:** removes the entire hard problem set — polyphonic pitch
  detection, harmonics, background noise, mic AGC, sustain-pedal smearing. MIDI gives
  exact note on/off events with zero detection error. Repeated notes and octaves
  become unambiguous.
- **Block-until-right:** reduces grading to matching a *linear sequence of note-on
  events* against the expected sequence. Timing is irrelevant, so the app can never
  lose its place in the score.
- **MusicXML:** the one format that is both machine-readable (for grading) and
  renderable as real notation (via OSMD, which also provides the stepping cursor).
- **Web app over native Android:** OSMD is a JS library, so running in the browser
  eliminates the WebView + JS-bridge layer entirely — the grading engine, the OSMD
  cursor, and note coloring all live in one runtime. Web MIDI replaces the native USB
  stack. Cost: no iPad support (no Web MIDI in any iOS browser), which is acceptable
  since the target is an Android tablet.

## Explicitly out of scope for v1

- **Both hands / two independent voices.** This breaks the clean linear model: two
  hands have independent rhythms, so a held note (e.g. a left-hand whole note) overlaps
  several right-hand notes. Grading that requires a *merged timeline* distinguishing
  "press now" from "still holding" — which pulls timing back into scope. Deferred to v2.
  The right-hand/both-hands **toggle may appear in the UI**, but only right-hand is wired up.
- Microphone / acoustic-piano support.
- OMR (reading PDFs or photos of sheet music).
- Rhythm/tempo grading.

## Known edge cases to handle

- **Ties vs. repeated notes:** E–E (two notes) = two key presses; E tied across a
  barline = one held press. MusicXML distinguishes these via tie elements — handle ties explicitly.
- **note-on velocity 0:** some keyboards send this as a note-off; treat accordingly.
- **`.mxl` is zip-compressed** MusicXML — unpack before parsing.
- **Multi-staff/multi-voice files:** a downloaded file rarely contains only the
  exercise; grade only the tracked voice, ignore the rest.

## Open / deferred questions

- Sustain pedal (CC64) behavior — likely irrelevant to press detection, confirm during build.
- Brute-forcing: blocking lets a learner mash keys until the cursor advances. Acceptable
  for v1 (trusting honest practice); revisit if practice value needs enforcing.
- Content pipeline: authoring custom exercises in MuseScore is a natural source of
  MusicXML if downloadable files prove scarce.
