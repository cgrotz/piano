<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ScoreRenderer } from '../lib/score/ScoreRenderer';
  import type { GradedStep } from '../lib/score/extractor';
  import { GradingEngine, type GradingStatus } from '../lib/engine/grading';
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

  const engine = new GradingEngine();

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

  // For both-hands coloring: which MIDI pitches belong to the left hand, keyed by
  // the step's cursorIndex. Empty unless grading both staves.
  let leftByIndex = new Map<number, Set<number>>();

  let status = $state<GradingStatus>('empty');
  let total = $state(0);
  let errors = $state(0);
  let expected = $state<number[]>([]);
  let curCursorIndex = $state(-1);
  let keyLow = $state(60);
  let keyHigh = $state(72);

  const accuracy = $derived(total + errors === 0 ? 100 : Math.round((total / (total + errors)) * 100));
  const bothHands = $derived(staffSel === 'all');
  const handColor = $derived(staffSel === 1 ? LEFT_COLOR : RIGHT_COLOR);
  const handName = $derived(
    staffCount < 2 ? '' : staffSel === 'all' ? 'Both hands' : staffSel === 1 ? 'Left hand' : 'Right hand'
  );

  /** Color for a highlighted key: per-hand in both-hands mode, else the single hand color. */
  function keyColor(n: number): string {
    if (!bothHands) return handColor;
    return leftByIndex.get(curCursorIndex)?.has(n) ? LEFT_COLOR : RIGHT_COLOR;
  }

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
      loaded = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseWakeLock();
    unsubscribe?.();
    renderer?.dispose();
  });

  function sync() {
    status = engine.status;
    total = engine.total;
    errors = engine.errorCount;
    expected = engine.currentPitches;
    curCursorIndex = steps[engine.index]?.cursorIndex ?? -1;
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
    // For both-hands coloring, learn which pitches are left hand at each container.
    leftByIndex = new Map();
    if (staffSel === 'all' && staffCount > 1) {
      for (const s of renderer.extractSteps({ staffIndex: 1 })) {
        leftByIndex.set(s.cursorIndex, new Set(s.pitches));
      }
    }
    computeRange(steps.flatMap((s) => s.pitches));
    engine.load(steps);
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
    if (event.type !== 'noteOn' || !renderer) return;
    switch (engine.pressNote(event.pitch)) {
      case 'wrong':
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
    <div class="keyboard">
      {#if bothHands}
        <span class="hand"><span class="dot" style="background:{RIGHT_COLOR}"></span>Right</span>
        <span class="hand"><span class="dot" style="background:{LEFT_COLOR}"></span>Left</span>
      {:else if handName}
        <span class="hand"><span class="dot" style="background:{handColor}"></span>{handName}</span>
      {/if}
      <PianoKeyboard
        low={keyLow}
        high={keyHigh}
        highlight={status === 'playing' ? expected : []}
        colorFor={keyColor}
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

  /* Keyboard strip */
  .keyboard {
    margin-bottom: 0.9rem;
  }
  .hand {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
    margin: 0 0.7rem 0.35rem 0;
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
