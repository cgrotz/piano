<script lang="ts">
  import { midiHelp, type MidiController, type MidiStatus } from '../lib/midi/midi.svelte';

  let { midi }: { midi: MidiController } = $props();

  const TEXT: Record<MidiStatus, string> = {
    unsupported: 'No Web MIDI',
    // When tapping does something, say so: the pill is the connect button.
    idle: 'Connect keyboard',
    requesting: 'Connecting…',
    denied: 'MIDI blocked · Retry',
    connected: 'Connected',
    disconnected: 'No keyboard · Retry'
  };

  const cls = $derived(
    midi.status === 'connected'
      ? 'ok'
      : midi.status === 'requesting'
        ? 'pending'
        : midi.status === 'idle'
          ? 'idle'
          : 'error'
  );

  const canConnect = $derived(
    midi.status === 'idle' || midi.status === 'denied' || midi.status === 'disconnected'
  );

  const label = $derived(
    midi.status === 'connected' && midi.inputNames.length > 0
      ? midi.inputNames.join(', ')
      : TEXT[midi.status]
  );
</script>

<button
  class="badge {cls}"
  class:link={canConnect}
  onclick={() => canConnect && midi.connect()}
  disabled={!canConnect && midi.status !== 'connected'}
  title={midi.status === 'connected' ? label : [midiHelp(midi.status), midi.error].filter(Boolean).join('\n\n')}
  aria-label={canConnect ? 'Connect MIDI keyboard' : `MIDI status: ${label}`}
  aria-live="polite">
  <span class="dot" aria-hidden="true"></span>
  <span class="txt">{label}</span>
</button>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--surface-2);
    color: var(--muted);
    border-radius: 999px;
    padding: 0.32rem 0.7rem;
    font-size: 0.82rem;
    font-weight: 600;
    max-width: 14rem;
    min-height: 2.25rem;
  }
  .badge:disabled {
    opacity: 1;
    cursor: default;
  }
  .badge.link {
    cursor: pointer;
    box-shadow: inset 0 0 0 1.5px currentColor;
  }
  .badge.link.idle {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .badge.link.idle .dot {
    background: var(--accent);
  }
  .badge.ok {
    background: var(--ok-soft);
    color: var(--ok-text);
  }
  .badge.error {
    background: var(--error-soft);
    color: var(--error);
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--muted);
    flex: none;
  }
  .badge.ok .dot {
    background: var(--ok);
  }
  .badge.pending .dot {
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  .badge.error .dot {
    background: var(--error);
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
