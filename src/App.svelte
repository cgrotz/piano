<script lang="ts">
  import { MidiController } from './lib/midi/midi.svelte';
  import { LibraryController, type LibraryEntry } from './lib/library/library.svelte';
  import LibraryView from './components/LibraryView.svelte';
  import ScoreView from './components/ScoreView.svelte';

  const midi = new MidiController();
  const library = new LibraryController();
  library.init();

  // Dev-only: lets the preview/automation drive notes without hardware. Stripped from prod.
  if (import.meta.env.DEV) (window as unknown as { pianoMidi: MidiController }).pianoMidi = midi;

  type Selection = { xml: string; title: string };
  let selection = $state<Selection | null>(null);
  let openError = $state<string | null>(null);

  async function openEntry(entry: LibraryEntry) {
    openError = null;
    try {
      const xml = await library.getXml(entry);
      selection = { xml, title: entry.title };
    } catch (err) {
      openError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<main>
  {#if midi.status === 'unsupported'}
    <p class="note">
      This browser doesn't support Web MIDI. Use Chrome (desktop or Android) — iOS/Safari
      won't work.
    </p>
  {/if}
  {#if midi.error}
    <p class="note error" role="alert">{midi.error}</p>
  {/if}
  {#if openError}
    <p class="note error" role="alert">{openError}</p>
  {/if}

  {#if selection}
    {#key selection.xml}
      <ScoreView {midi} xml={selection.xml} title={selection.title} onBack={() => (selection = null)} />
    {/key}
  {:else}
    <LibraryView {library} {midi} onOpen={openEntry} />
  {/if}
</main>

<style>
  main {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow: hidden;
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .note.error {
    color: var(--error);
  }
</style>
