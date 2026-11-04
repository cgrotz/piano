<script lang="ts">
  /** A small, consistent icon set (24px grid, stroke icons) instead of emoji/glyphs. */
  type Name = 'back' | 'play' | 'restart' | 'loop' | 'settings' | 'metronome' | 'check' | 'close' | 'plus' | 'music';
  let { name, size = 20 }: { name: Name; size?: number } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true">
  {#if name === 'back'}
    <path d="M15 18l-6-6 6-6" />
  {:else if name === 'play'}
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  {:else if name === 'restart'}
    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
  {:else if name === 'loop'}
    <path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" />
  {:else if name === 'settings'}
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
  {:else if name === 'metronome'}
    <path d="M8.5 3h7l3.5 18H5z" /><path d="M12 15l5-9" />
  {:else if name === 'check'}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6L6 18" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'music'}
    <path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" />
  {/if}
</svg>
