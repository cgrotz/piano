<script lang="ts">
  import { MidiController, type MidiStatus } from './lib/midi/midi.svelte';
  import { LibraryController, type LibraryEntry } from './lib/library/library.svelte';
  import LibraryView from './components/LibraryView.svelte';
  import ScoreView from './components/ScoreView.svelte';

  const midi = new MidiController();
  const library = new LibraryController();
  library.init();

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

  const STATUS_TEXT: Record<MidiStatus, string> = {
    unsupported: 'Web MIDI not supported in this browser',
    idle: 'Not connected',
    requesting: 'Requesting access…',
    denied: 'Access denied',
    connected: 'Connected',
    disconnected: 'No device detected'
  };

  const dotClass = $derived(
    midi.status === 'connected'
      ? 'ok'
      : midi.status === 'requesting'
        ? 'pending'
        : midi.status === 'idle'
          ? 'idle'
          : 'error'
  );
</script>

<main>
  <header class="topbar">
    <h1>Piano Tutor</h1>
    <div class="status">
      <span class="dot {dotClass}"></span>
      <span>{STATUS_TEXT[midi.status]}</span>
      {#if midi.inputNames.length > 0}
        <span class="device">· {midi.inputNames.join(', ')}</span>
      {/if}
      {#if midi.status === 'idle' || midi.status === 'denied' || midi.status === 'disconnected'}
        <button class="connect" onclick={() => midi.connect()}>Connect MIDI</button>
      {/if}
    </div>
  </header>

  {#if midi.status === 'unsupported'}
    <p class="note">
      This browser doesn't expose the Web MIDI API. Use Chrome (desktop or Android).
      iOS/Safari is not supported.
    </p>
  {/if}
  {#if midi.error}
    <p class="note error">{midi.error}</p>
  {/if}
  {#if openError}
    <p class="note error">{openError}</p>
  {/if}

  {#if selection}
    {#key selection.xml}
      <ScoreView {midi} xml={selection.xml} title={selection.title} onBack={() => (selection = null)} />
    {/key}
  {:else}
    <LibraryView {library} onOpen={openEntry} />
  {/if}
</main>

<style>
  main {
    max-width: 820px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .topbar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  h1 {
    font-size: 1.4rem;
    margin: 0;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .device {
    color: var(--text);
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.ok {
    background: var(--ok);
  }
  .dot.pending {
    background: var(--accent);
  }
  .dot.error {
    background: var(--error);
  }
  .connect {
    margin-left: 0.5rem;
    padding: 0.35rem 0.75rem;
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
