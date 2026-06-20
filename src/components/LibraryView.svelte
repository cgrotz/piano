<script lang="ts">
  import type { LibraryController, LibraryEntry } from '../lib/library/library.svelte';

  let { library, onOpen }: { library: LibraryController; onOpen: (entry: LibraryEntry) => void } =
    $props();

  async function handleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await library.importFile(file);
    input.value = '';
  }

  function when(ms: number): string {
    return ms === 0 ? 'Built-in' : new Date(ms).toLocaleDateString();
  }
</script>

<section class="library">
  <header>
    <h2>Library</h2>
    <label class="filebtn" class:busy={library.importing}>
      {library.importing ? 'Importing…' : 'Import .xml/.mxl'}
      <input type="file" accept=".xml,.musicxml,.mxl" onchange={handleFile} disabled={library.importing} />
    </label>
  </header>

  {#if library.error}
    <p class="error">{library.error}</p>
  {/if}

  <ul class="list">
    {#each library.entries as entry (entry.id)}
      <li>
        <button class="open" onclick={() => onOpen(entry)}>
          <span class="title">{entry.title}</span>
          <span class="meta">{entry.composer} · {when(entry.importedAt)}</span>
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
    border-radius: var(--radius);
    padding: 1rem 1.25rem 1.25rem;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .filebtn {
    background: var(--accent);
    color: #10131a;
    font-weight: 600;
    border-radius: var(--radius);
    padding: 0.6rem 1.1rem;
    cursor: pointer;
    font-size: 0.95rem;
  }
  .filebtn.busy {
    opacity: 0.6;
    cursor: progress;
  }
  .filebtn input {
    display: none;
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
  .open {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    padding: 0.7rem 0.9rem;
    font-weight: 500;
  }
  .title {
    font-weight: 600;
  }
  .meta {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .del {
    background: var(--surface-2);
    color: var(--muted);
    padding: 0 0.9rem;
    font-weight: 700;
  }
  .del:hover {
    color: var(--error);
  }
  .error {
    color: var(--error);
    margin: 0 0 0.75rem;
  }
</style>
