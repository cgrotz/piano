<script lang="ts">
  import type { PracticeSession } from '../lib/practice/session.svelte';
  import type { HandOption } from '../lib/score/hands';
  import type { MetronomeController } from '../lib/metronome/metronome.svelte';
  import { clampBpm, MIN_BPM, MAX_BPM } from '../lib/metronome/bpm';
  import { BAND_PRESETS } from '../lib/arrange/band';
  import Icon from './Icon.svelte';

  export type ViewMode = 'both' | 'notes' | 'piano';

  let {
    session,
    hands,
    handSteps,
    hasChords,
    metronome,
    view = $bindable(),
    band = $bindable(),
    showOthers = $bindable(),
    otherParts,
    started,
    loaded,
    nameOf,
    onStart,
    onClose
  }: {
    session: PracticeSession;
    hands: HandOption[];
    handSteps: Record<string, number>;
    hasChords: boolean;
    metronome: MetronomeController;
    view: ViewMode;
    /** Backing band for "Listen": 'none' or a BAND_PRESETS id. */
    band: string;
    /** Whether non-piano parts are shown on the sheet. */
    showOthers: boolean;
    /** Names of the score's non-piano parts (empty: no toggle). */
    otherParts: string[];
    started: boolean;
    loaded: boolean;
    nameOf: (h: HandOption) => string;
    onStart: () => void;
    onClose: () => void;
  } = $props();

  function commitBar(which: 'from' | 'to', input: HTMLInputElement) {
    const n = input.valueAsNumber;
    if (!Number.isFinite(n)) {
      input.value = String(which === 'from' ? session.fromBar : session.toBar);
      return;
    }
    if (which === 'from') session.setRange(n, Math.max(n, session.toBar));
    else session.setRange(Math.min(n, session.fromBar), n);
    input.value = String(which === 'from' ? session.fromBar : session.toBar);
  }

  /** Commit a typed tempo on change (not per keystroke; see metronome/bpm.ts). */
  function commitBpm(input: HTMLInputElement) {
    metronome.bpm = clampBpm(input.valueAsNumber, metronome.bpm);
    input.value = String(metronome.bpm);
  }

  const views: { id: ViewMode; label: string }[] = [
    { id: 'both', label: 'Piano + notes' },
    { id: 'notes', label: 'Notes' },
    { id: 'piano', label: 'Piano' }
  ];
</script>

<div class="setup" role="region" aria-label="Practice setup">
  {#if hands.length > 1}
    <div class="row">
      <span class="label" id="lbl-hand">Hand</span>
      <div class="segmented" role="group" aria-labelledby="lbl-hand">
        {#each hands as h (h.id)}
          <button
            aria-pressed={h.id === session.hand?.id}
            disabled={handSteps[h.id] === 0}
            title={handSteps[h.id] === 0 ? `No notes for ${nameOf(h).toLowerCase()} in this piece` : undefined}
            onclick={() => h.id !== session.hand?.id && session.selectHand(h)}>
            {h.label}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if session.barLast > session.barFirst}
    <div class="row">
      <span class="label" id="lbl-bars">Bars</span>
      <div class="bars" role="group" aria-labelledby="lbl-bars">
        <input
          type="number"
          inputmode="numeric"
          min={session.barFirst}
          max={session.barLast}
          value={session.fromBar}
          onchange={(e) => commitBar('from', e.currentTarget)}
          aria-label="First bar" />
        <span class="to">to</span>
        <input
          type="number"
          inputmode="numeric"
          min={session.barFirst}
          max={session.barLast}
          value={session.toBar}
          onchange={(e) => commitBar('to', e.currentTarget)}
          aria-label="Last bar" />
        {#if session.rangeOn}
          <button class="ghost small" onclick={() => session.wholePieceRange()}>Whole piece</button>
        {/if}
      </div>
      <button
        class="toggle"
        aria-pressed={session.loop}
        onclick={() => (session.loop = !session.loop)}
        title="Start again automatically after the last bar">
        <Icon name="loop" size={18} /> Loop
      </button>
    </div>
  {/if}

  <div class="row">
    <span class="label" id="lbl-view">Show</span>
    <div class="segmented" role="group" aria-labelledby="lbl-view">
      {#each views as v (v.id)}
        <button aria-pressed={view === v.id} onclick={() => (view = v.id)}>{v.label}</button>
      {/each}
    </div>
    {#if hasChords}
      <button
        class="toggle"
        aria-pressed={session.showGuide}
        onclick={() => session.setGuide(!session.showGuide)}
        title="Light the chord symbols' notes in grey as a guide (never counted as mistakes)">
        Chord guide
      </button>
    {/if}
  </div>

  {#if metronome.supported}
    <div class="row">
      <span class="label" id="lbl-tempo">Tempo</span>
      <div class="tempo" role="group" aria-labelledby="lbl-tempo">
        <button class="ghost round" onclick={() => (metronome.bpm = clampBpm(metronome.bpm - 5, metronome.bpm))} aria-label="Slower">−</button>
        <input
          type="number"
          inputmode="numeric"
          min={MIN_BPM}
          max={MAX_BPM}
          value={metronome.bpm}
          onchange={(e) => commitBpm(e.currentTarget)}
          aria-label="Tempo in beats per minute" />
        <span class="unit">BPM</span>
        <button class="ghost round" onclick={() => (metronome.bpm = clampBpm(metronome.bpm + 5, metronome.bpm))} aria-label="Faster">+</button>
      </div>
      <span class="hint">for the metronome</span>
    </div>
  {/if}

  {#if otherParts.length > 0 && session.hand?.kind !== 'other'}
    <div class="row">
      <span class="label" id="lbl-parts">Sheet</span>
      <button class="toggle" aria-pressed={showOthers} onclick={() => (showOthers = !showOthers)}>
        Show {otherParts.join(', ')}
      </button>
      <span class="hint">{showOthers ? 'shown above the piano' : 'hidden — only the piano staves'}</span>
    </div>
  {/if}

  <div class="row">
    <span class="label" id="lbl-band" title="Who plays along when you press Listen">Band</span>
    <div class="segmented band" role="group" aria-labelledby="lbl-band">
      <button aria-pressed={band === 'none'} onclick={() => (band = 'none')}>Score only</button>
      {#each BAND_PRESETS as p (p.id)}
        <button aria-pressed={band === p.id} onclick={() => (band = p.id)}>{p.label}</button>
      {/each}
    </div>
    <span class="hint">plays along on Listen, from the melody and chords</span>
  </div>

  <div class="actions">
    {#if started}
      <button class="ghost" onclick={onClose}>Done</button>
    {:else}
      <button class="start" onclick={onStart} disabled={!loaded}>
        <Icon name="play" size={18} /> Start practice
      </button>
    {/if}
  </div>
</div>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 1.1rem 1.25rem;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem 0.9rem;
  }
  .segmented.band {
    flex-wrap: wrap;
    border-radius: 1.4rem;
  }
  .segmented.band button {
    white-space: nowrap;
    padding-inline: 0.8rem;
  }
  .label {
    width: 4.2rem;
    flex: none;
    font-weight: 700;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .bars,
  .tempo {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  input[type='number'] {
    width: 4.2rem;
    min-height: var(--tap);
    font: inherit;
    font-weight: 700;
    text-align: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
  }
  .to,
  .unit,
  .hint {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .unit {
    font-weight: 700;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }
  button.small {
    min-height: calc(var(--tap) - 6px);
    padding: 0.3rem 0.8rem;
    font-size: 0.9rem;
  }
  button.round {
    width: var(--tap);
    padding: 0;
    border-radius: 50%;
    font-size: 1.2rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.2rem;
  }
  .start {
    min-height: 52px;
    padding: 0.6rem 1.6rem;
    font-size: 1.05rem;
  }
  @media (max-width: 640px) {
    .label {
      width: 100%;
    }
    .actions .start {
      width: 100%;
    }
  }
</style>
