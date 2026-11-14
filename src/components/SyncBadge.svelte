<script lang="ts">
  import type { SyncController } from '../lib/sync/sync.svelte';

  let { sync }: { sync: SyncController } = $props();

  let menuOpen = $state(false);

  const needsSignIn = $derived(sync.status === 'signed-out' || sync.status === 'signing-in');

  const label = $derived(
    sync.status === 'signing-in'
      ? 'Signing in…'
      : sync.status === 'signed-out'
        ? 'Sign in to sync'
        : sync.status === 'syncing'
          ? 'Syncing…'
          : sync.status === 'offline'
            ? 'Offline'
            : sync.status === 'error'
              ? 'Sync failed'
              : 'Synced'
  );

  const cls = $derived(
    sync.status === 'synced'
      ? 'ok'
      : sync.status === 'syncing' || sync.status === 'signing-in'
        ? 'pending'
        : sync.status === 'error'
          ? 'error'
          : 'idle'
  );

  const title = $derived(
    needsSignIn
      ? 'Keep your library, settings and progress in sync across devices (Google Drive, hidden app folder).'
      : [
          sync.lastSynced ? `Last synced ${new Date(sync.lastSynced).toLocaleTimeString()}` : '',
          sync.error ?? ''
        ]
          .filter(Boolean)
          .join('\n')
  );

  function onClick() {
    if (needsSignIn) {
      if (sync.status !== 'signing-in') void sync.signIn();
    } else {
      menuOpen = !menuOpen;
    }
  }

  function syncNow() {
    menuOpen = false;
    void sync.syncNow(true);
  }

  function signOut() {
    menuOpen = false;
    if (confirm('Stop syncing on this device? Your library stays here and in your Google Drive.')) {
      void sync.signOut();
    }
  }
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<div class="wrap">
  <button
    class="badge {cls}"
    class:link={needsSignIn}
    onclick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    {title}
    aria-haspopup={needsSignIn ? undefined : 'menu'}
    aria-expanded={needsSignIn ? undefined : menuOpen}
    aria-live="polite">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5H7Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round" />
    </svg>
    <span class="txt">{label}</span>
  </button>
  {#if menuOpen}
    <div class="menu" role="menu">
      {#if sync.error}<p class="err">{sync.error}</p>{/if}
      <button role="menuitem" onclick={syncNow}>Sync now</button>
      <button role="menuitem" onclick={signOut}>Stop syncing</button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
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
    min-height: 2.25rem;
    cursor: pointer;
  }
  .badge.link {
    box-shadow: inset 0 0 0 1.5px currentColor;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .badge.ok {
    background: var(--ok-soft);
    color: var(--ok-text);
  }
  .badge.error {
    background: var(--error-soft);
    color: var(--error);
  }
  .badge.pending svg {
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .txt {
    white-space: nowrap;
  }
  /* Narrow screens: once synced, the green cloud says it all. */
  @media (max-width: 640px) {
    .badge.ok .txt {
      display: none;
    }
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.4rem);
    z-index: 10;
    min-width: 11rem;
    max-width: 18rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
  }
  .menu button {
    text-align: left;
    background: none;
    color: var(--text);
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    min-height: var(--tap);
    font-size: 0.9rem;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .err {
    margin: 0.3rem 0.75rem 0.4rem;
    font-size: 0.8rem;
    color: var(--error);
    line-height: 1.4;
  }
</style>
