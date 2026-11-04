<script lang="ts">
  import { MidiController } from './lib/midi/midi.svelte';
  import { LibraryController, type LibraryEntry } from './lib/library/library.svelte';
  import LibraryView from './components/LibraryView.svelte';

  // The player pulls in OSMD (most of the bundle), so it's loaded on demand —
  // the library appears straight away — and prefetched once the app is idle.
  const loadPlayer = () => import('./components/ScoreView.svelte');
  const idle = (fn: () => void) =>
    'requestIdleCallback' in window ? requestIdleCallback(fn) : setTimeout(fn, 1500);
  idle(() => void loadPlayer());

  const midi = new MidiController();
  const library = new LibraryController();
  library.init();
  midi.reconnectIfGranted();

  // Dev-only: lets the preview/automation drive notes without hardware. Stripped from prod.
  if (import.meta.env.DEV) (window as unknown as { pianoMidi: MidiController }).pianoMidi = midi;

  type Selection = { id: string; xml: string; title: string };
  let selection = $state<Selection | null>(null);
  let openError = $state<string | null>(null);

  async function openEntry(entry: LibraryEntry) {
    openError = null;
    try {
      const xml = await library.getXml(entry);
      selection = { id: entry.id, xml, title: entry.title };
    } catch (err) {
      openError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<main>
  <!-- MIDI problems are explained where they matter (library banner, player
       notice, badge tooltip) in plain words — not as raw browser errors here. -->
  {#if openError}
    <p class="note error" role="alert">{openError}</p>
  {/if}

  {#if selection}
    {#key selection.id}
      {#await loadPlayer()}
        <p class="note">Opening {selection.title}…</p>
      {:then { default: ScoreView }}
        <ScoreView {midi} id={selection.id} xml={selection.xml} title={selection.title} onBack={() => (selection = null)} />
      {:catch err}
        <p class="note error" role="alert">Couldn't load the player: {err?.message ?? err}</p>
      {/await}
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
    padding: 0;
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
