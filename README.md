# Piano Tutor

A web app (PWA) that displays piano sheet music and verifies, note by note, that you
press the correct keys via MIDI. Pitch-correctness, not timing — it waits for you.

Design docs: [DESIGN.md](DESIGN.md) (v1 spec) and [ARCHITECTURE.md](ARCHITECTURE.md)
(components and build order).

## Status

All seven build steps of the planned sequence are complete (v1):

- **Step 1 — PWA shell.** Svelte + TypeScript + Vite, with `vite-plugin-pwa`.
- **Step 2 — MIDI input.** Web MIDI connection + live monitor (verified on hardware).
- **Step 3 — OSMD rendering.** `ScoreRenderer` renders MusicXML with a stepping cursor.
- **Step 4 — Graded-sequence extractor.** `extractSteps()` walks OSMD's model into an
  ordered step list (top staff, chords collapsed, ties skipped). Verified headless: the
  C4→MIDI-60 mapping and chord/tie grouping check out against a known scale and a real
  1000-chord arrangement.
- **Step 5 — Grading engine + cursor/highlight.** The core loop: block on each step
  until played correctly, chords need all notes, wrong press flashes the note red,
  cursor advances, completion is detected. Engine logic verified headless (17/17).
- **Step 6 — IndexedDB library.** Import `.xml`/`.mxl` (validated at import: must parse
  and yield ≥1 graded step), stored in IndexedDB, persists across reloads. Library view
  lists scores (built-in scale always first), open → Player, delete imported entries.
- **Step 7 — Polish.** Positional cursor alignment (each graded step carries its
  container ordinal; the cursor is advanced to it, correctly skipping rests, ties, and
  the untracked staff — verified 1:1 against a 2-staff score), auto-scroll to the current
  note, and a right-hand/left-hand staff picker for multi-staff scores.

Since v1:

- **Music-stand layout.** A slim top bar (progress, metronome, Setup, Start/Restart),
  practice options in a Setup panel, larger type and 44px touch targets, and the score
  filling the screen: one line zoomed to the available height in landscape, wrapped
  systems in portrait (re-laid out on rotation, cursor kept in place). One colour per
  meaning — hand colours to press, dimmed to hold, red for wrong, grey for the chord
  guide — and the cursor wears the hand's colour. Light and dark themes; in dark mode the
  score is drawn light-on-dark too.
- **Metronome-synced keys.** While the metronome runs, the keys to press flash on every
  click (stronger on the downbeat).
- **Completion dialog** over the score with notes / mistakes / accuracy, a "new best"
  marker, and the bars with the most mistakes — one tap loops that bar.
- **Both hands.** A *Both* option merges the two staves into one step sequence. Tied /
  held notes don't re-trigger while the other hand moves, and the keyboard shows them
  as dimmed "keep holding" cues, coloured per hand.
- **Repeats.** Steps follow OSMD's playback order, so repeated sections are graded twice,
  in step with the visual cursor.
- **Chord symbols.** `<harmony>` chords are named in the player and their notes lit on
  the keyboard as a dim guide (guide keys are not graded).
- **On-screen keyboard** cropped to the piece's range, with Piano / Notes / both views.
- **Practice metronome** (Web Audio scheduled), seeded from the score's tempo and metre.
- **Screen wake lock** while practicing.
- **Forgiving grading for real hands.** Practising one hand while playing the other
  along doesn't count the other hand's notes as mistakes, and a note of the *next*
  step played a hair early is credited to it (no re-striking a key you're holding).
- **Part-aware hand picker.** The piano's two staves give Right / Left / Both even when
  a vocal line comes first; other parts are listed by name. Hands with no notes are
  disabled.
- **Practise a passage.** Pick a bar range, optionally looping it (with a per-loop
  mistake count); a progress readout shows the current bar.
- **Remembered per piece** (on this device): hand, tempo, view, chord guide, bar range
  and loop; the library shows bars, when you last practised and your best accuracy.
- **Chord guide** lights the chord symbols' notes in neutral grey — on by default only
  when the left hand has no written part (lead sheets) — and never counts them as
  mistakes.
- **Bulk import** of several files at once, with titles/composers read from the score's
  printed credits when its metadata is empty.

The import layer uses the swappable `Unzip` port (`src/lib/import/unzip.ts`), its fflate
implementation, and the `MusicImporter` that resolves `.mxl` via `META-INF/container.xml`.

### Known limitations / v2

- **Grace notes, cue notes and hidden notes** are not graded (all voices otherwise are).
- **Same key, both hands.** MIDI can't say which hand pressed a key. When practising
  one hand while the other plays along, a key both hands use (e.g. a melody doubled
  between the hands) can be credited to the graded hand.
- **Both-hands grading is still pitch-only.** Held notes are shown, but releasing one
  early isn't detected.
- **Dev testing without hardware:** in `npm run dev`, call
  `window.pianoMidi.useVirtualDevice()` then `window.pianoMidi.emitForTest({...})` in
  the console — practice won't start without a (virtual) keyboard.

## Run

```sh
npm install
npm run dev        # http://localhost:5173/  (localhost is a secure context → Web MIDI works)
```

> Dev serves from root; the **production build** uses `base: '/piano/'` for the GitHub
> Pages project site (see `vite.config.ts`). The build output paths are verified, so this
> split is safe and keeps local URLs clean.

### Testing on the Android tablet

Web MIDI needs a **secure context**. The easiest path is to use the deployed GitHub
Pages URL (served over HTTPS) directly on the tablet — see Deploy below.

For local dev against the tablet over the LAN you need HTTPS, since a LAN IP is not a
secure context:

```sh
npm run dev:https  # serves over HTTPS on your LAN IP; accept the self-signed cert once
```

Then connect the Korg Liano to the tablet (USB-OTG), open the page in **Chrome**, tap
**Connect MIDI**, approve the prompt, and play.

## Deploy (GitHub Pages)

The app is fully static (all state in IndexedDB, no backend), and GitHub Pages serves
over HTTPS — which satisfies Web MIDI's secure-context requirement, so the tablet can
just open the published URL in Chrome.

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `main`.
One-time setup:

1. Create a GitHub repo **named `piano`** (the name must match `base: '/piano/'` in
   `vite.config.ts`).
2. Push this project to it on `main`.
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

It deploys to `https://<you>.github.io/piano/`.

## Other scripts

```sh
npm run check      # svelte-check type checking
npm test           # vitest unit + session integration tests
npm run build      # production build
npm run preview    # preview the production build
```

## Layout

```
src/
  lib/
    midi/      MIDI input: types, message parser, reactive controller (A1-A3)
    score/     ScoreRenderer (OSMD), extractor (graded steps), validate
    engine/    GradingEngine (pure core loop)
    import/    Unzip port + fflate impl + MusicImporter (.mxl/container.xml)
    library/   IndexedDB store (db.ts) + reactive LibraryController
    metronome/ MetronomeController (Web Audio) + BPM / beats-per-bar helpers
    practice/  PracticeSession (one run: hand, bars, loop, grading state),
               keyLights (keyboard colours), bar-range/guide helpers
    samples/   bundled C-major-scale.musicxml
  components/
    LibraryView.svelte       library list, search + import
    ScoreView.svelte         player screen: top bar, keyboard, sheet (lazy-loaded with OSMD)
    PracticeSetup.svelte     setup panel: hand, bars, loop, view, chord guide, tempo
    CompletionDialog.svelte  result + trouble bars
    PianoKeyboard.svelte     on-screen keyboard (target / held / wrong / beat flash)
    ConnBadge.svelte         MIDI connection status + connect button
    Icon.svelte              small SVG icon set
  App.svelte                shell: library/player switching, MIDI auto-reconnect
```
