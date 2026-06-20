<script lang="ts">
  import type { LibraryController, LibraryEntry } from '../lib/library/library.svelte';
  import type { MidiController } from '../lib/midi/midi.svelte';
  import ConnBadge from './ConnBadge.svelte';

  const iconUrl = `${import.meta.env.BASE_URL}icon.svg`;

  let {
    library,
    midi,
    onOpen
  }: {
    library: LibraryController;
    midi: MidiController;
    onOpen: (entry: LibraryEntry) => void;
  } = $props();

  async function handleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await library.importFile(file);
    input.value = '';
  }

  function when(ms: number): string {
    if (ms === 0) return '';
    const d = new Date(ms);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? 'Today'
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function meta(entry: LibraryEntry): string {
    if (entry.builtIn) return '';
    const who = entry.composer && entry.composer !== 'Unknown' ? entry.composer : 'Imported';
    return `${who} · ${when(entry.importedAt)}`;
  }

  const onlyBuiltIn = $derived(library.entries.every((e) => e.builtIn));
</script>

<section class="library">
  <header>
    <div class="brand">
      <img src={iconUrl} alt="" width="30" height="30" />
      <span>Piano Tutor</span>
    </div>
    <div class="head-actions">
      <ConnBadge {midi} />
      <label class="filebtn" class:busy={library.importing}>
        {#if !library.importing}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        {/if}
        {library.importing ? 'Importing…' : 'Import'}
        <input type="file" accept=".xml,.musicxml,.mxl" onchange={handleFile} disabled={library.importing} />
      </label>
    </div>
  </header>

  {#if midi.status !== 'connected'}
    <div class="banner">
      🎹 Connect your MIDI keyboard (top right) to start practicing.
    </div>
  {:else if onlyBuiltIn}
    <div class="banner subtle">
      Tip: Import a MusicXML (<code>.xml</code> / <code>.mxl</code>) to add your own pieces —
      try exporting from MuseScore.
    </div>
  {/if}

  {#if library.error}
    <p class="error">{library.error}</p>
  {/if}

  <ul class="list">
    {#each library.entries as entry (entry.id)}
      <li>
        <button class="card" onclick={() => onOpen(entry)}>
          <span class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 17.5V5l11-2v10.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              <circle cx="17.5" cy="15.5" r="2.5" />
              <circle cx="6.5" cy="17.5" r="2.5" />
            </svg>
          </span>
          <span class="text">
            <span class="title">{entry.title}</span>
            {#if entry.builtIn}
              <span class="badge">Built-in</span>
            {:else}
              <span class="metaline">{meta(entry)}</span>
            {/if}
          </span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
        {#if !entry.builtIn}
          <button
            class="del"
            title="Delete"
            aria-label="Delete {entry.title}"
            onclick={() => library.remove(entry.id)}>✕</button>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .library {
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
  .brand {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .brand img {
    border-radius: 7px;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .filebtn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    border-radius: var(--radius-sm);
    padding: 0.55rem 1rem;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .filebtn:hover {
    background: #4338ca;
  }
  .filebtn.busy {
    opacity: 0.6;
    cursor: progress;
  }
  .filebtn input {
    display: none;
  }
  .banner {
    background: var(--accent-soft);
    color: #3730a3;
    border-radius: var(--radius-sm);
    padding: 0.7rem 0.9rem;
    margin-bottom: 0.9rem;
    font-size: 0.9rem;
  }
  .banner.subtle {
    background: var(--surface-2);
    color: var(--muted);
  }
  .banner code {
    background: rgba(0, 0, 0, 0.06);
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
    font-size: 0.85em;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .list li {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  .card {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    text-align: left;
    padding: 0.75rem 0.9rem;
    border-radius: var(--radius-sm);
  }
  .card:hover {
    background: var(--surface-2);
    border-color: var(--surface-3);
  }
  .ico {
    display: grid;
    place-items: center;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    flex: none;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    align-self: flex-start;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }
  .metaline {
    font-size: 0.82rem;
    color: var(--muted);
  }
  .chev {
    color: var(--muted);
    font-size: 1.3rem;
    line-height: 1;
    flex: none;
  }
  .del {
    background: transparent;
    color: var(--muted);
    padding: 0 0.9rem;
    font-weight: 700;
    border-radius: var(--radius-sm);
  }
  .del:hover {
    background: var(--error-soft);
    color: var(--error);
  }
  .error {
    color: var(--error);
    margin: 0 0 0.75rem;
  }
</style>
