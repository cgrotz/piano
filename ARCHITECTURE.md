# Piano Tutor — Architecture (Web / PWA)

Companion to [DESIGN.md](DESIGN.md). Describes the components and a dependency-ordered
build sequence. Stack: a **web app (PWA)** built with **Svelte + TypeScript**, no native build.

## Implementation choices
- **Framework:** Svelte + TypeScript (Vite).
- **Zip:** `fflate`, but hidden behind a small **`Unzip` port** (see component 4) so it
  can be swapped without touching `.mxl` logic.

## Foundational decision

**OSMD is the single source of truth for the score.** OSMD parses the MusicXML to
render it; the graded note sequence is extracted *from OSMD's parsed model*, not from a
second parser. This guarantees the grading cursor and the visual cursor are the same
object, so the red highlight can never land on the wrong notehead.

Because it's a web app, the grading engine, the OSMD cursor, and note coloring all live
in **one JS runtime** — there is no WebView and no JS bridge.

## Components

### Layer A — MIDI input
1. **MIDI access manager** — `navigator.requestMIDIAccess()`, enumerate inputs, handle
   the permission prompt, subscribe to the device, react to connect/disconnect
   (`statechange`). Surfaces a "connected / not connected" state to the UI.
2. **MIDI message parser** — decode raw messages into `NoteOn(pitch, velocity)` /
   `NoteOff(pitch)`. Edge cases: Note-On velocity 0 = Note-Off; ignore CCs (incl.
   sustain CC64) for v1.
3. **Held-notes tracker** — set of currently-depressed keys; needed for chord grading
   and as the hook for the v2 both-hands logic.

### Layer B — Score (file → notation → graded model)
4. **Import** — file input for `.xml`/`.mxl`; for `.mxl`, unzip and resolve the inner
   MusicXML via `META-INF/container.xml` (NOT just "take the first file"); validate (parse
   with OSMD + confirm a non-empty tracked voice); extract title/composer metadata
   (`work-title`/`movement-title`/`creator`, fallback to filename). The zip primitive sits
   behind an **`Unzip` port** (fflate impl); the `.mxl` container logic depends only on the
   port, so swapping zip libs is a one-file change.
5. **Library store (IndexedDB)** — records `{ id, title, composer, importedAt, xml,
   trackedVoice }`. CRUD: list, open, delete. Stores **raw MusicXML**, re-parsed on open.
6. **Notation renderer** — OSMD instance in the page: load score, show cursor,
   next/reset, set/reset a note's color. Auto-scroll to keep the current note visible;
   responsive layout for tablet.
7. **Graded-sequence extractor** — walk OSMD's model into an ordered list of **Steps**
   (`{ expectedPitches: Set<midi>, notationHandle, tieInfo }`). **Two real risks:**
   (a) OSMD pitch → MIDI note number mapping (off-by-octave is the classic bug);
   (b) tie resolution — a tied note collapses to one step at its onset.
8. **Voice/staff selector** — default top-staff/first-voice; picker to override;
   selection persisted per piece in the library record.

### Layer C — Engine
9. **Grading engine / state machine** — `Idle → Loaded → Playing → Completed`. Holds the
   current Step pointer and a "satisfied pitches" set. On Note-On: expected→mark (advance
   when set complete); unexpected→flag error. **Lean chord rule:** a wrong key flags error
   but keeps already-correct notes. Never reads the clock (timing is ignored).
10. **Cursor & highlight controller** — translates engine events into OSMD calls:
    advance → cursor-next + clear red; error → current note red.

### Layer D — App shell
11. **Routing/screens** — Library, Player, Completion.
12. **Player screen** — notation + MIDI connection-status indicator + Restart button +
    voice picker + (disabled) right-hand/both-hands toggle.
13. **PWA shell** — service worker caching app + OSMD for offline use; web app manifest
    for "install to home screen". Must be served over HTTPS (Web MIDI requires a secure context).

## Dependency-ordered build sequence

Each step is independently testable before the next depends on it.

1. **Project + PWA shell.** Vite (or similar) TS app, HTTPS dev server, manifest +
   service worker. *Test: installs and loads offline.*
2. **MIDI input, raw.** Components A1–A3. On-screen log of incoming Note-On/Off.
   *Test: pressing Liano keys prints correct pitches; unplug/replug updates status.*
   *(No score needed yet — this de-risks the hardware/cable/Web-MIDI chain first.)*
3. **OSMD rendering.** Component 6, hardcode one bundled MusicXML. *Test: notation
   renders; cursor shows and steps via a temporary "next" button.*
4. **Graded-sequence extractor.** Component 7 against the hardcoded file. *Test: dump the
   Step list; verify pitches (MIDI numbers) and that ties/chords are grouped correctly —
   this is where the two risky bugs surface, in isolation.*
5. **Grading engine + cursor sync.** Components 9–10, wiring step 2's MIDI events to
   step 4's Steps and step 3's cursor. *Test: play the hardcoded piece end-to-end —
   blocking, chords, red on wrong notes, completion. This is the core loop proven.*
6. **Import + IndexedDB library.** Components 4–5, 8, 11–12. Replace the hardcoded file
   with import → store → pick from library → play. *Test: import `.xml` and `.mxl`,
   reopen after reload, delete, voice picker persists.*
7. **Polish.** Auto-scroll, connection UX, restart, completion screen, error messages,
   layout for the tablet.

**Why this order:** the two genuinely risky pieces (the hardware/Web-MIDI chain in step 2,
and pitch-mapping + ties in step 4) are proven *before* the engine that depends on them,
and the whole core loop (step 5) works on a hardcoded file before any import/library
plumbing exists. Content management (step 6) is routine CRUD added last.
