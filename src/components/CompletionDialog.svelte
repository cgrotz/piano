<script lang="ts">
  import type { RunResult } from '../lib/practice/session.svelte';
  import Icon from './Icon.svelte';

  let {
    result,
    scope,
    newBest,
    onAgain,
    onPractiseBar,
    onLibrary,
    onClose
  }: {
    result: RunResult;
    /** "the whole piece" or "bars 5–8". */
    scope: string;
    newBest: boolean;
    onAgain: () => void;
    onPractiseBar: (bar: number) => void;
    onLibrary: () => void;
    onClose: () => void;
  } = $props();

  const trouble = $derived(result.troubleBars.slice(0, 3));
  const clean = $derived(result.mistakes === 0);
  let againBtn: HTMLButtonElement | undefined = $state();
  $effect(() => againBtn?.focus());
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="done-title">
  <button class="close ghost" onclick={onClose} aria-label="Close and look at the score"><Icon name="close" size={18} /></button>
  <div class="badge" class:clean aria-hidden="true"><Icon name="check" size={28} /></div>
  <h2 id="done-title">{clean ? 'Flawless!' : 'Finished!'}</h2>
  <p class="scope">You played {scope}.</p>

  <div class="stats">
    <div class="stat"><span class="n">{result.notes}</span><span class="l">notes</span></div>
    <div class="stat"><span class="n">{result.mistakes}</span><span class="l">{result.mistakes === 1 ? 'mistake' : 'mistakes'}</span></div>
    <div class="stat">
      <span class="n">{result.accuracy}%</span><span class="l">accuracy</span>
      {#if newBest}<span class="best">New best</span>{/if}
    </div>
  </div>

  {#if trouble.length > 0}
    <div class="trouble">
      <span class="t-label">Most mistakes in</span>
      <div class="t-list">
        {#each trouble as t (t.bar)}
          <button class="ghost t-bar" onclick={() => onPractiseBar(t.bar)} title="Loop bar {t.bar}">
            Bar {t.bar} <span class="t-n">{t.mistakes}×</span> <Icon name="loop" size={16} />
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="actions">
    <button class="ghost" onclick={onLibrary}><Icon name="back" size={18} /> Library</button>
    <button bind:this={againBtn} onclick={onAgain}><Icon name="restart" size={18} /> Play again</button>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(2px);
    z-index: 20;
  }
  .dialog {
    position: absolute;
    z-index: 21;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(32rem, calc(100% - 2rem));
    max-height: calc(100% - 2rem);
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 1.6rem 1.5rem 1.3rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.55rem;
  }
  .close {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    width: var(--tap);
    padding: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
  }
  .badge {
    display: grid;
    place-items: center;
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .badge.clean {
    background: var(--ok-soft);
    color: var(--ok);
  }
  h2 {
    margin: 0.2rem 0 0;
    font-size: 1.45rem;
  }
  .scope {
    margin: 0;
    color: var(--muted);
  }
  .stats {
    display: flex;
    gap: 2.2rem;
    margin: 0.6rem 0 0.4rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
  }
  .stat .n {
    font-size: 1.8rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .stat .l {
    font-size: 0.78rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .best {
    margin-top: 0.3rem;
    font-size: 0.72rem;
    font-weight: 800;
    color: var(--ok-text);
    background: var(--ok-soft);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }
  .trouble {
    width: 100%;
    border-top: 1px solid var(--border);
    padding-top: 0.8rem;
    margin-top: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .t-label {
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .t-list {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .t-n {
    color: var(--error);
    font-weight: 800;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.8rem;
    flex-wrap: wrap;
    justify-content: center;
  }
</style>
