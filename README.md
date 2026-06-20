# Piano Tutor

A web app (PWA) that displays piano sheet music and verifies, note by note, that you
press the correct keys via MIDI. Pitch-correctness, not timing — it waits for you.

See the design docs in the sibling `tutor` project: `DESIGN.md` and `ARCHITECTURE.md`.

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

The import layer uses the swappable `Unzip` port (`src/lib/import/unzip.ts`), its fflate
implementation, and the `MusicImporter` that resolves `.mxl` via `META-INF/container.xml`.

### Known limitations / v2

- **Both hands at once.** Grading tracks one staff at a time (the picker switches which).
  True two-hand grading — held notes overlapping the other hand's onsets — is the v2
  problem noted in the design docs.
- **Staff choice isn't persisted** per piece yet (resets to right hand on reopen).

## Run

```sh
npm install
npm run dev        # http://localhost:5173/piano/  (localhost is a secure context → Web MIDI works)
```

> The dev URL includes `/piano/` because the app is configured for a GitHub Pages
> project site (`base: '/piano/'`). Same base in dev and prod catches path bugs early.

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
    samples/   bundled C-major-scale.musicxml
  components/
    LibraryView.svelte   library list + import
    ScoreView.svelte     player: render + practice loop
  App.svelte             shell: MIDI status + library/player switching
```
