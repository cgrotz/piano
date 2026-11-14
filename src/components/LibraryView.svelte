<script lang="ts">
  import type { LibraryController, LibraryEntry } from '../lib/library/library.svelte';
  import { midiHelp, type MidiController } from '../lib/midi/midi.svelte';
  import ConnBadge from './ConnBadge.svelte';
  import SyncBadge from './SyncBadge.svelte';
  import type { SyncController } from '../lib/sync/sync.svelte';
  import { loadSettings } from '../lib/library/settings';

  const iconUrl = `${import.meta.env.BASE_URL}icon.svg`;

  let {
    library,
    midi,
    sync = null,
    onOpen
  }: {
    library: LibraryController;
    midi: MidiController;
    /** Present only when a sync provider is configured. */
    sync?: SyncController | null;
    onOpen: (entry: LibraryEntry) => void;
  } = $props();

  async function handleFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    await library.importFiles(files);
  }

  const importLabel = $derived(
    !library.importing
      ? 'Import'
      : library.progress && library.progress.total > 1
        ? `Importing ${library.progress.done + 1} of ${library.progress.total}…`
        : 'Importing…'
  );

  // Deletion is permanent and the ✕ is a small touch target next to the card, so
  // guard against a stray tap on the tablet.
  function confirmDelete(entry: LibraryEntry) {
    if (confirm(`Delete “${entry.title}” from your library? This can't be undone.`)) {
      library.remove(entry.id);
    }
  }

  /** "today", "yesterday", "3 days ago", else a short date. */
  function ago(ms: number): string {
    const day = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000);
    const days = day(Date.now()) - day(ms);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** Composer · bars · when last practised · best whole-piece accuracy. */
  function meta(entry: LibraryEntry): string[] {
    void library.settingsVersion;
    const s = loadSettings(entry.id);
    const parts: string[] = [];
    if (!entry.builtIn && entry.composer && entry.composer !== 'Unknown') parts.push(entry.composer);
    if (entry.bars) parts.push(`${entry.bars} bars`);
    parts.push(s.lastPractised ? `practised ${ago(s.lastPractised)}` : 'not practised yet');
    if (s.best !== undefined) parts.push(`best ${s.best}%`);
    return parts;
  }

  const onlyBuiltIn = $derived(library.entries.every((e) => e.builtIn));

  // Search appears once the list is long enough to need it; sorting once there's a choice.
  let query = $state('');
  const showSearch = $derived(library.entries.length > 8);
  const showSort = $derived(library.entries.length > 3);

  type SortKey = 'recent' | 'title' | 'added';
  const SORT_KEY = 'piano-tutor:library-sort';
  let sort = $state<SortKey>(readSort());
  function readSort(): SortKey {
    try {
      const v = localStorage.getItem(SORT_KEY);
      return v === 'title' || v === 'added' ? v : 'recent';
    } catch {
      return 'recent';
    }
  }
  function setSort(v: SortKey) {
    sort = v;
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* per-device convenience only */
    }
  }

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q ? library.entries.filter((e) => `${e.title} ${e.composer}`.toLowerCase().includes(q)) : [...library.entries];
    void library.settingsVersion;
    const practised = (e: LibraryEntry) => loadSettings(e.id).lastPractised ?? 0;
    const by: Record<SortKey, (a: LibraryEntry, b: LibraryEntry) => number> = {
      // Recently practised first; never-practised pieces follow, newest import first.
      recent: (a, b) => practised(b) - practised(a) || b.importedAt - a.importedAt,
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      added: (a, b) => b.importedAt - a.importedAt
    };
    // The built-in exercise always stays on top.
    return list.sort((a, b) => Number(!!b.builtIn) - Number(!!a.builtIn) || by[sort](a, b));
  });
</script>

<section class="library" aria-label="Music library">
  <header>
    <div class="brand">
      <img src={iconUrl} alt="" width="30" height="30" />
      <span>Piano Tutor</span>
    </div>
    <div class="head-actions">
      {#if sync}<SyncBadge {sync} />{/if}
      <ConnBadge {midi} />
      <label class="filebtn" class:busy={library.importing} aria-busy={library.importing}>
        {#if !library.importing}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        {/if}
        {importLabel}
        <input
          type="file"
          accept=".xml,.musicxml,.mxl"
          multiple
          onchange={handleFiles}
          disabled={library.importing}
          aria-label={library.importing ? `${importLabel} Please wait.` : 'Import MusicXML files (.xml, .mxl)'} />
      </label>
    </div>
  </header>

  {#if midi.status !== 'connected'}
    <div class="banner" class:warn={midi.status === 'denied' || midi.status === 'unsupported'} role="status">
      {midiHelp(midi.status)}
    </div>
  {:else if onlyBuiltIn}
    <div class="banner subtle">
      Tip: Import a MusicXML (<code>.xml</code> / <code>.mxl</code>) to add your own pieces —
      try exporting from MuseScore.
    </div>
  {/if}

  {#if library.error}
    <p class="error" role="alert">{library.error}</p>
  {/if}

  {#if showSearch || showSort}
    <div class="tools">
      {#if showSearch}
        <input class="search" type="search" placeholder="Search title or composer" bind:value={query} aria-label="Search your library" />
      {/if}
      {#if showSort}
        <div class="segmented" role="group" aria-label="Sort by">
          <button aria-pressed={sort === 'recent'} onclick={() => setSort('recent')}>Recent</button>
          <button aria-pressed={sort === 'title'} onclick={() => setSort('title')}>A–Z</button>
          <button aria-pressed={sort === 'added'} onclick={() => setSort('added')}>Added</button>
        </div>
      {/if}
    </div>
  {/if}

  <ul class="list" aria-label="Scores">
    {#if visible.length === 0}
      <li class="empty">No pieces match “{query}”.</li>
    {/if}
    {#each visible as entry (entry.id)}
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
            <span class="metaline">
              {#if entry.builtIn}<span class="badge">Built-in</span>{/if}
              {meta(entry).join(' · ')}
            </span>
          </span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
        {#if !entry.builtIn}
          <button
            class="del"
            title="Delete"
            aria-label="Delete {entry.title}"
            onclick={() => confirmDelete(entry)}>✕</button>
        {:else}
          <span class="del" aria-hidden="true"></span>
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
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    width: 100%;
    max-width: 60rem;
    margin: 0 auto;
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
    color: var(--on-accent);
    font-weight: 600;
    border-radius: var(--radius-sm);
    padding: 0.55rem 1rem;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .filebtn:hover {
    background: var(--accent-hover);
  }
  .filebtn.busy {
    opacity: 0.6;
    cursor: progress;
    pointer-events: none;
  }
  /* Visually hidden but still focusable, so keyboard users can reach Import. */
  .filebtn {
    position: relative;
  }
  .filebtn input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .filebtn:focus-within {
    outline: 3px solid color-mix(in srgb, var(--accent) 45%, transparent);
    outline-offset: 2px;
  }
  .tools {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .tools .segmented {
    margin-left: auto;
  }
  .search {
    font: inherit;
    flex: 1 1 14rem;
    min-height: var(--tap);
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }
  .empty {
    color: var(--muted);
    padding: 0.75rem 0.2rem;
  }
  .banner {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-radius: var(--radius-sm);
    padding: 0.7rem 0.9rem;
    margin-bottom: 0.9rem;
    font-size: 0.9rem;
  }
  .banner.warn {
    background: var(--error-soft);
    color: var(--error-text);
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
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-height: 0;
  }
  .list li {
    min-width: 0;
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  .card {
    flex: 1;
    min-width: 0; /* let long titles truncate instead of widening the card */
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
    margin-right: 0.35rem;
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
    /* Fixed width (and an empty placeholder on built-in rows) keeps every card
       the same width. */
    flex: none;
    width: 2.75rem;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--muted);
    padding: 0;
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
    white-space: pre-line; /* one line per failed file */
  }
</style>
