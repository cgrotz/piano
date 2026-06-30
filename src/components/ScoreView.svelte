<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ScoreRenderer } from '../lib/score/ScoreRenderer';
  import type { GradedStep } from '../lib/score/extractor';
  import { GradingEngine, type GradingStatus } from '../lib/engine/grading';
  import { MetronomeController } from '../lib/metronome/metronome.svelte';
  import type { MidiController } from '../lib/midi/midi.svelte';
  import type { MidiNoteEvent } from '../lib/midi/types';
  import ConnBadge from './ConnBadge.svelte';
  import PianoKeyboard from './PianoKeyboard.svelte';

  let {
    midi,
    xml,
    title,
    onBack
  }: { midi: MidiController; xml: string; title: string; onBack: () => void } = $props();

  const RIGHT_COLOR = '#4f46e5';
  const LEFT_COLOR = '#f59e0b';
  const WRONG_COLOR = '#e5544b'; // matches the sheet's wrong-note flash
  // Dimmed hand colours for "keep holding" notes — struck earlier, still sounding.
  const HOLD_RIGHT = 'rgba(79, 70, 229, 0.4)';
  const HOLD_LEFT = 'rgba(245, 158, 11, 0.45)';

  const engine = new GradingEngine();
  const metronome = new MetronomeController();

  type StaffSel = number | 'all';
  type ViewMode = 'both' | 'notes' | 'piano';

  let container: HTMLDivElement;
  let renderer: ScoreRenderer | undefined;
  let steps: GradedStep[] = [];
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let staffCount = $state(1);
  let staffSel = $state<StaffSel>(0);
  let viewMode = $state<ViewMode>('both');

  let status = $state<GradingStatus>('empty');
  let total = $state(0);
  let errors = $state(0);
  let expected = $state<number[]>([]);
  let sustained = $state<number[]>([]);
  // Left-hand pitches sounding at the current step (onset or held); both-hands only.
  let leftPitches = $state<number[]>([]);
  let keyLow = $state(60);
  let keyHigh = $state(72);
  let currentChordName = $state<string | null>(null);
  let currentChordPitches = $state<number[]>([]);
  // Pitches currently held that were judged a wrong press — the only held keys
  // that should glow red. A correct key you're still holding after the step
  // advanced (e.g. a long note held under faster notes) must not turn red.
  let wrongHeld = $state<Set<number>>(new Set());

  const accuracy = $derived(total + errors === 0 ? 100 : Math.round((total / (total + errors)) * 100));
  const bothHands = $derived(staffSel === 'all');
  const handColor = $derived(staffSel === 1 ? LEFT_COLOR : RIGHT_COLOR);
  const handName = $derived(
    staffCount < 2 ? '' : staffSel === 'all' ? 'Both hands' : staffSel === 1 ? 'Left hand' : 'Right hand'
  );

  // Metronome beat is on the bar's first beat (accented click) — used to brighten
  // the indicator and pulse the keyboard harder on "1".
  const isDownbeat = $derived(
    metronome.running && metronome.beatCount >= 0 && metronome.beatCount % metronome.beatsPerBar === 0
  );

  function adjustBpm(delta: number): void {
    metronome.bpm = Math.min(300, Math.max(30, metronome.bpm + delta));
  }

  /** Whether pitch n belongs to the left hand at the current step. */
  function isLeft(n: number): boolean {
    return bothHands ? leftPitches.includes(n) : staffSel === 1;
  }

  /** Solid "press now" colour for a target key. */
  function keyColor(n: number): string {
    return isLeft(n) ? LEFT_COLOR : RIGHT_COLOR;
  }

  /** Dimmed "keep holding" colour for a sustained key. */
  function holdColor(n: number): string {
    return isLeft(n) ? HOLD_LEFT : HOLD_RIGHT;
  }

  /**
   * Every lit key and its color: the target note(s) as a hand-colored cue, plus
   * the keys you're physically holding — hand color if correct, red if wrong.
   */
  const litKeys = $derived.by(() => {
    const m = new Map<number, string>();
    if (status !== 'playing') return m;
    // 1. Left-hand chord guide notes in a dim soft orange/yellow.
    for (const p of currentChordPitches) {
      m.set(p, 'rgba(245, 158, 11, 0.35)');
    }
    // 2. Keep-holding cues: notes struck earlier that should still be down. Dim
    //    hand colour, reinforced by a ring (see holdKeys) so they read as "hold",
    //    not "press". A note here is never also a current onset.
    for (const p of sustained) {
      m.set(p, holdColor(p));
    }
    // 3. Target melody cues — the keys to press now (overwriting chord keys).
    for (const p of expected) {
      m.set(p, keyColor(p));
    }
    // 4. Held keys: hand color while they're a current target, red only if they
    //    were an actual wrong press. A correct key you're still holding after the
    //    step advanced keeps its keep-holding colour (or stays unlit), not red.
    for (const p of midi.heldNotes) {
      if (expected.includes(p)) m.set(p, keyColor(p));
      else if (wrongHeld.has(p)) m.set(p, WRONG_COLOR);
    }
    return m;
  });

  /** Sustained keys get a ring to distinguish "keep holding" from "press now". */
  const holdKeys = $derived(status === 'playing' ? new Set(sustained) : new Set<number>());

  let unsubscribe: (() => void) | undefined;
  let wakeLock: WakeLockSentinel | null = null;

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); }
    catch { /* denied or unsupported — practice still works, screen may sleep */ }
  }

  function releaseWakeLock() {
    wakeLock?.release();
    wakeLock = null;
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && status === 'playing') acquireWakeLock();
  }

  onMount(async () => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    try {
      renderer = new ScoreRenderer(container);
      await renderer.load(xml);
      staffCount = renderer.staffCount;
      metronome.setFromScore(renderer.bpm, renderer.beatsPerBar);
      loaded = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseWakeLock();
    metronome.dispose();
    unsubscribe?.();
    renderer?.dispose();
  });

  function sync() {
    status = engine.status;
    total = engine.total;
    errors = engine.errorCount;
    expected = engine.currentPitches;
    const currentStep = steps[engine.index];
    sustained = currentStep?.sustained ?? [];
    leftPitches = currentStep?.leftPitches ?? [];
    currentChordName = currentStep?.chordName ?? null;
    currentChordPitches = currentStep?.chordPitches ?? [];
  }

  const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);
  const isBlack = (n: number) => BLACK_CLASSES.has(((n % 12) + 12) % 12);

  /**
   * Crop the keyboard to exactly the played range. If an endpoint lands on a
   * black key, nudge it outward to the neighbouring white key so the keyboard
   * doesn't start or end on a floating black key.
   */
  function computeRange(allPitches: number[]) {
    if (allPitches.length === 0) return;
    let min = Math.min(...allPitches);
    let max = Math.max(...allPitches);
    if (isBlack(min)) min -= 1; // white key a semitone below (e.g. C# -> C)
    if (isBlack(max)) max += 1; // white key a semitone above (e.g. F# -> G)
    keyLow = min;
    keyHigh = max;
  }

  async function startPractice() {
    if (!renderer) return;
    // Connect on demand: pressing Start is a user gesture, so the MIDI prompt works here.
    if (midi.status !== 'connected') await midi.connect();

    steps = renderer.extractSteps({ staffIndex: staffSel });
    computeRange([
      ...steps.flatMap((s) => s.pitches),
      ...steps.flatMap((s) => s.chordPitches || [])
    ]);
    engine.load(steps);
    wrongHeld = new Set();
    renderer.reset();
    renderer.clearHighlight();
    if (steps.length > 0) renderer.moveToIndex(steps[0].cursorIndex);
    unsubscribe?.();
    unsubscribe = midi.subscribe(onNote);
    sync();
    acquireWakeLock();
  }

  function restart() {
    if (!renderer) return;
    engine.reset();
    wrongHeld = new Set();
    renderer.reset();
    renderer.clearHighlight();
    if (steps.length > 0) renderer.moveToIndex(steps[0].cursorIndex);
    sync();
  }

  function selectStaff(sel: StaffSel) {
    if (sel === staffSel) return;
    staffSel = sel;
    if (status === 'playing' || status === 'completed') startPractice();
  }

  function onNote(event: MidiNoteEvent) {
    if (!renderer) return;
    if (event.type !== 'noteOn') {
      // Releasing a key clears its wrong-press state so it stops glowing red.
      if (wrongHeld.has(event.pitch)) {
        wrongHeld.delete(event.pitch);
        wrongHeld = new Set(wrongHeld);
      }
      return;
    }
    switch (engine.pressNote(event.pitch)) {
      case 'wrong':
        wrongHeld.add(event.pitch);
        wrongHeld = new Set(wrongHeld);
        renderer.highlightWrong();
        break;
      case 'progress':
        renderer.clearHighlight();
        break;
      case 'advanced':
        renderer.clearHighlight();
        renderer.moveToIndex(steps[engine.index].cursorIndex);
        break;
      case 'completed':
        renderer.clearHighlight();
        renderer.finish();
        releaseWakeLock();
        break;
    }
    sync();
  }

</script>

<section class="score" aria-label="Score player">
  <header>
    <div class="left">
      <button class="ghost back" onclick={onBack} aria-label="Back to library">←</button>
      <h2>{title}</h2>
    </div>
    <div class="controls">
      <ConnBadge {midi} />
      {#if staffCount > 1}
        <div class="staffpick" role="group" aria-label="Hand selection">
          {#if staffCount === 2}
            <button class="seg" class:active={staffSel === 0} onclick={() => selectStaff(0)} aria-pressed={staffSel === 0}>
              Right
            </button>
            <button class="seg" class:active={staffSel === 1} onclick={() => selectStaff(1)} aria-pressed={staffSel === 1}>
              Left
            </button>
            <button class="seg" class:active={staffSel === 'all'} onclick={() => selectStaff('all')} aria-pressed={staffSel === 'all'}>
              Both
            </button>
          {:else}
            {#each Array(staffCount) as _, i (i)}
              <button class="seg" class:active={i === staffSel} onclick={() => selectStaff(i)} aria-pressed={i === staffSel}>
                Staff {i + 1}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
      {#if metronome.supported}
        <div class="metro" role="group" aria-label="Metronome">
          <button
            class="seg metro-toggle"
            class:active={metronome.running}
            onclick={() => metronome.toggle()}
            aria-pressed={metronome.running}
            title="Metronome">
            {#key metronome.beatCount}
              <span class="beat-dot" class:tick={metronome.running} class:down={isDownbeat}></span>
            {/key}
            Metronome
          </button>
          <div class="bpm">
            <button class="bpm-btn" onclick={() => adjustBpm(-5)} aria-label="Decrease tempo">−</button>
            <input
              class="bpm-val"
              type="number"
              min="30"
              max="300"
              bind:value={metronome.bpm}
              aria-label="Tempo in beats per minute" />
            <span class="bpm-unit">BPM</span>
            <button class="bpm-btn" onclick={() => adjustBpm(5)} aria-label="Increase tempo">+</button>
          </div>
        </div>
      {/if}
      <div class="staffpick" role="group" aria-label="View mode">
        <button class="seg" class:active={viewMode === 'both'} onclick={() => (viewMode = 'both')} aria-pressed={viewMode === 'both'}>
          Piano + Notes
        </button>
        <button class="seg" class:active={viewMode === 'notes'} onclick={() => (viewMode = 'notes')} aria-pressed={viewMode === 'notes'}>
          Notes
        </button>
        <button class="seg" class:active={viewMode === 'piano'} onclick={() => (viewMode = 'piano')} aria-pressed={viewMode === 'piano'}>
          Piano
        </button>
      </div>
      {#if status === 'playing'}
        <button class="ghost" onclick={restart} aria-label="Restart practice">↻ Restart</button>
      {:else}
        <button onclick={startPractice} disabled={!loaded}>▶ Start practice</button>
      {/if}
    </div>
  </header>

  {#if error}
    <p class="error" role="alert">Failed: {error}</p>
  {/if}

  {#if viewMode !== 'notes'}
    <div class="keyboard" class:beating={metronome.running}>
      {#if metronome.running}
        {#key metronome.beatCount}
          <div class="beat-pulse" class:down={isDownbeat}></div>
        {/key}
      {/if}
      <div class="keyboard-header">
        <div class="hands">
          {#if bothHands}
            <span class="hand"><span class="dot" style="background:{RIGHT_COLOR}"></span>Right</span>
            <span class="hand"><span class="dot" style="background:{LEFT_COLOR}"></span>Left</span>
          {:else if handName}
            <span class="hand"><span class="dot" style="background:{handColor}"></span>{handName}</span>
          {/if}
        </div>
        {#if currentChordName}
          <span class="chord-badge" aria-live="polite">Left Hand Chord: {currentChordName}</span>
        {/if}
      </div>
      <PianoKeyboard
        low={keyLow}
        high={keyHigh}
        keyColors={litKeys}
        {holdKeys}
        height={viewMode === 'piano' ? 220 : 100} />
    </div>
  {/if}

  {#if status === 'completed'}
    <div class="done" role="status" aria-label="Practice complete">
      <div class="done-emoji">🎉</div>
      <div class="done-title">Nicely done!</div>
      <div class="stats">
        <div class="stat"><span class="n">{total}</span><span class="l">notes</span></div>
        <div class="stat"><span class="n">{errors}</span><span class="l">mistakes</span></div>
        <div class="stat"><span class="n">{accuracy}%</span><span class="l">accuracy</span></div>
      </div>
      <div class="done-actions">
        <button onclick={restart}>↻ Play again</button>
        <button class="ghost" onclick={onBack}>← Library</button>
      </div>
    </div>
  {/if}

  <!-- Kept in the DOM (only CSS-hidden) so OSMD's rendered SVG survives mode switches. -->
  <div class="sheet" class:hidden={viewMode === 'piano'} bind:this={container} aria-label="Sheet music notation"></div>
</section>

<style>
  .score {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 1.1rem 1.25rem 1.35rem;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.9rem;
    flex-wrap: wrap;
  }
  .left {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
  }
  .back {
    padding: 0.45rem 0.7rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .controls {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .staffpick {
    display: inline-flex;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 0.2rem;
  }
  .seg {
    background: transparent;
    color: var(--muted);
    padding: 0.3rem 0.8rem;
    font-weight: 600;
    font-size: 0.85rem;
    border-radius: 999px;
  }
  .seg:hover {
    background: transparent;
    color: var(--text);
  }
  .seg.active {
    background: var(--surface);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }

  /* Metronome control */
  .metro {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 0.2rem 0.35rem 0.2rem 0.2rem;
  }
  .metro-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .beat-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.4;
  }
  /* Re-mounted each beat (keyed), so this entry animation replays as a flash. */
  .beat-dot.tick {
    animation: beat-flash 0.18s ease-out;
  }
  .beat-dot.tick.down {
    animation: beat-flash-down 0.22s ease-out;
  }
  @keyframes beat-flash {
    from { background: var(--accent); opacity: 1; transform: scale(1.5); }
    to { background: var(--muted); opacity: 0.4; transform: scale(1); }
  }
  @keyframes beat-flash-down {
    from { background: var(--accent); opacity: 1; transform: scale(1.9); }
    to { background: var(--muted); opacity: 0.4; transform: scale(1); }
  }
  .bpm {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
  }
  .bpm-btn {
    background: transparent;
    color: var(--muted);
    font-weight: 700;
    font-size: 1rem;
    line-height: 1;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
  }
  .bpm-btn:hover {
    color: var(--text);
    background: var(--surface);
  }
  .bpm-val {
    width: 2.6rem;
    text-align: center;
    background: transparent;
    border: none;
    color: var(--text);
    font-weight: 700;
    font-size: 0.85rem;
    padding: 0.1rem 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .bpm-val::-webkit-outer-spin-button,
  .bpm-val::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .bpm-unit {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--muted);
    letter-spacing: 0.04em;
  }

  /* Keyboard strip */
  .keyboard {
    position: relative;
    margin-bottom: 0.9rem;
  }
  /* A soft beat flash over the keyboard, re-mounted (keyed) each beat to replay. */
  .beat-pulse {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-sm);
    pointer-events: none;
    z-index: 2;
    box-shadow: inset 0 0 0 2px var(--accent);
    animation: keyboard-pulse 0.2s ease-out forwards;
  }
  .beat-pulse.down {
    animation: keyboard-pulse-down 0.26s ease-out forwards;
  }
  @keyframes keyboard-pulse {
    from { opacity: 0.5; }
    to { opacity: 0; }
  }
  @keyframes keyboard-pulse-down {
    from { opacity: 0.85; }
    to { opacity: 0; }
  }
  .keyboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
    min-height: 1.5rem;
  }
  .chord-badge {
    background: var(--accent-soft);
    border: 1px solid rgba(79, 70, 229, 0.2);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.5rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--accent);
  }
  .hand {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
  }
  .hand .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
  }

  /* Completion */
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    background: var(--ok-soft);
    border-radius: var(--radius-sm);
    padding: 1.4rem 1rem;
    margin-bottom: 0.9rem;
    text-align: center;
  }
  .done-emoji {
    font-size: 2.2rem;
  }
  .done-title {
    font-size: 1.2rem;
    font-weight: 700;
  }
  .stats {
    display: flex;
    gap: 2rem;
    margin: 0.3rem 0 0.6rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
  }
  .stat .n {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--text);
  }
  .stat .l {
    font-size: 0.78rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .done-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .sheet {
    background: #ffffff;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-behavior: smooth;
    flex: 1;
    min-height: 0;
  }
  .sheet.hidden {
    display: none;
  }
  .error {
    color: var(--error);
    margin: 0 0 0.5rem;
  }
</style>
