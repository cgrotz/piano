<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ScoreRenderer } from '../lib/score/ScoreRenderer';
  import type { GradedStep } from '../lib/score/extractor';
  import { GradingEngine, type GradingStatus } from '../lib/engine/grading';
  import type { MidiController } from '../lib/midi/midi.svelte';
  import type { MidiNoteEvent } from '../lib/midi/types';
  import { pitchName } from '../lib/midi/types';

  let {
    midi,
    xml,
    title,
    onBack
  }: { midi: MidiController; xml: string; title: string; onBack: () => void } = $props();

  const engine = new GradingEngine();

  let container: HTMLDivElement;
  let renderer: ScoreRenderer | undefined;
  let steps: GradedStep[] = [];
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let staffCount = $state(1);
  let staffIndex = $state(0);

  // Reactive mirror of the engine state, refreshed after each event.
  let status = $state<GradingStatus>('empty');
  let index = $state(0);
  let total = $state(0);
  let errors = $state(0);
  let expected = $state<number[]>([]);

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

  function startPractice() {
    if (!renderer) return;
    steps = renderer.extractSteps({ staffIndex });
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

  const staffLabel = (i: number) =>
    staffCount === 2 ? (i === 0 ? 'Right hand' : 'Left hand') : `Staff ${i + 1}`;
</script>

<section class="score">
  <header>
    <div class="left">
      <button class="ghost" onclick={onBack}>← Library</button>
      <h2>{title}</h2>
    </div>
    <div class="controls">
      {#if status === 'playing'}
        <button class="ghost" onclick={restart}>⏮ Restart</button>
      {:else}
        <button onclick={startPractice} disabled={!loaded}>▶ Start practice</button>
      {/if}
    </div>
  </header>

  {#if staffCount > 1}
    <div class="staffpick">
      <span class="label">Practice:</span>
      {#each Array(staffCount) as _, i (i)}
        <button class="seg" class:active={i === staffIndex} onclick={() => selectStaff(i)}>
          {staffLabel(i)}
        </button>
      {/each}
    </div>
  {/if}

  {#if error}
    <p class="error">Failed: {error}</p>
  {/if}

  {#if status === 'playing'}
    <div class="hud">
      <span>Note <strong>{index + 1}</strong> / {total}</span>
      <span class="expected">Play: {expected.map((p) => pitchName(p)).join(' + ') || '—'}</span>
      <span class="errors">Mistakes: {errors}</span>
    </div>
  {:else if status === 'completed'}
    <div class="done">
      🎉 Finished — {total} notes, {errors} mistake{errors === 1 ? '' : 's'}.
      <button class="ghost" onclick={restart}>Play again</button>
    </div>
  {:else if loaded && midi.status !== 'connected'}
    <p class="hint">Connect your MIDI keyboard above, then start practice.</p>
  {/if}

  <div class="sheet" bind:this={container}></div>
</section>

<style>
  .score {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 1rem 1.25rem 1.25rem;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .controls {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .ghost {
    background: var(--surface-2);
    color: var(--text);
    font-weight: 500;
  }
  .staffpick {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
    font-size: 0.9rem;
  }
  .staffpick .label {
    color: var(--muted);
  }
  .seg {
    background: var(--surface-2);
    color: var(--muted);
    padding: 0.3rem 0.7rem;
    font-weight: 500;
  }
  .seg.active {
    background: var(--accent);
    color: #10131a;
  }
  .hud {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    align-items: center;
    background: var(--surface-2);
    border-radius: 8px;
    padding: 0.5rem 0.9rem;
    margin-bottom: 0.75rem;
    font-size: 0.95rem;
  }
  .hud strong {
    color: var(--accent);
  }
  .errors {
    color: var(--muted);
  }
  .done {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: var(--surface-2);
    border-radius: 8px;
    padding: 0.6rem 0.9rem;
    margin-bottom: 0.75rem;
  }
  .sheet {
    background: #ffffff;
    border-radius: 8px;
    padding: 0.5rem;
    overflow-x: auto;
    scroll-behavior: smooth;
  }
  .error {
    color: var(--error);
    margin: 0 0 0.5rem;
  }
  .hint {
    color: var(--muted);
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }
</style>
