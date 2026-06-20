<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ScoreRenderer } from '../lib/score/ScoreRenderer';
  import type { GradedStep } from '../lib/score/extractor';
  import { GradingEngine, type GradingStatus } from '../lib/engine/grading';
  import type { MidiController } from '../lib/midi/midi.svelte';
  import type { MidiNoteEvent } from '../lib/midi/types';
  import { pitchName } from '../lib/midi/types';
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

  let container: HTMLDivElement;
  let renderer: ScoreRenderer | undefined;
  let steps: GradedStep[] = [];
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let staffCount = $state(1);
  let staffIndex = $state(0);

  let status = $state<GradingStatus>('empty');
  let index = $state(0);
  let total = $state(0);
  let errors = $state(0);
  let expected = $state<number[]>([]);
  let keyLow = $state(60);
  let keyHigh = $state(72);

  const progress = $derived(total === 0 ? 0 : Math.round((index / total) * 100));
  const accuracy = $derived(total + errors === 0 ? 100 : Math.round((total / (total + errors)) * 100));
  const handColor = $derived(staffIndex === 0 ? RIGHT_COLOR : LEFT_COLOR);
  const handName = $derived(staffCount > 1 ? (staffIndex === 0 ? 'Right hand' : 'Left hand') : '');

  let unsubscribe: (() => void) | undefined;

  onMount(async () => {
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
    unsubscribe?.();
    renderer?.dispose();
  });

  function sync() {
    status = engine.status;
    index = engine.index;
    total = engine.total;
    errors = engine.errorCount;
    expected = engine.currentPitches;
  }

  /** Whole-octave (C..C) range covering all step pitches, for the keyboard. */
  function computeRange(allPitches: number[]) {
    if (allPitches.length === 0) return;
    const min = Math.min(...allPitches);
    const max = Math.max(...allPitches);
    keyLow = min - (((min % 12) + 12) % 12);
    keyHigh = max + ((12 - (((max % 12) + 12) % 12)) % 12);
  }

  async function startPractice() {
    if (!renderer) return;
    // Connect on demand: pressing Start is a user gesture, so the MIDI prompt works here.
    if (midi.status !== 'connected') await midi.connect();

    steps = renderer.extractSteps({ staffIndex });
    computeRange(steps.flatMap((s) => s.pitches));
    engine.load(steps);
    renderer.reset();
    renderer.clearHighlight();
    if (steps.length > 0) renderer.moveToIndex(steps[0].cursorIndex);
    unsubscribe?.();
    unsubscribe = midi.subscribe(onNote);
    sync();
  }

  function restart() {
    if (!renderer) return;
    engine.reset();
    renderer.reset();
    renderer.clearHighlight();
    if (steps.length > 0) renderer.moveToIndex(steps[0].cursorIndex);
    sync();
  }

  function selectStaff(i: number) {
    if (i === staffIndex) return;
    staffIndex = i;
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
        <div class="staffpick" role="group" aria-label="Staff selection">
          {#if staffCount === 2}
            <button class="seg" class:active={staffIndex === 1} onclick={() => selectStaff(1)} aria-pressed={staffIndex === 1}>
              Left hand
            </button>
            <button class="seg" class:active={staffIndex === 0} onclick={() => selectStaff(0)} aria-pressed={staffIndex === 0}>
              Right hand
            </button>
          {:else}
            {#each Array(staffCount) as _, i (i)}
              <button class="seg" class:active={i === staffIndex} onclick={() => selectStaff(i)} aria-pressed={i === staffIndex}>
                Staff {i + 1}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
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

  <div class="keyboard">
    {#if handName}
      <span class="hand" style="color:{handColor}">{handName}</span>
    {/if}
    <PianoKeyboard low={keyLow} high={keyHigh} highlight={status === 'playing' ? expected : []} color={handColor} />
  </div>

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

  <div class="sheet" bind:this={container} aria-label="Sheet music notation"></div>
</section>

<style>
  .score {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 1.1rem 1.25rem 1.35rem;
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
    display: inline-block;
    font-size: 0.78rem;
    font-weight: 700;
    margin-bottom: 0.35rem;
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
    scroll-behavior: smooth;
  }
  .error {
    color: var(--error);
    margin: 0 0 0.5rem;
  }
</style>
