<script lang="ts">
  import { pitchName } from '../lib/midi/types';

  let {
    low,
    high,
    keyColors,
    holdKeys = new Set<number>(),
    height = 120
  }: {
    low: number;
    high: number;
    /** Pitch -> fill color for every lit key. Absent keys render unlit. */
    keyColors: Map<number, string>;
    /** Lit keys that should read as "keep holding" — drawn with a ring. */
    holdKeys?: Set<number>;
    height?: number;
  } = $props();

  const WHITE_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
  const isWhite = (n: number) => WHITE_CLASSES.has(((n % 12) + 12) % 12);

  // Fraction of a white-key width that a black key spans.
  const BLACK_FRAC = 0.62;

  type Black = { n: number; after: number }; // `after` = white keys to its left

  const layout = $derived.by(() => {
    const whites: number[] = [];
    const blacks: Black[] = [];
    let whiteCount = 0;
    for (let n = low; n <= high; n++) {
      if (isWhite(n)) {
        whites.push(n);
        whiteCount++;
      } else {
        blacks.push({ n, after: whiteCount });
      }
    }
    return { whites, blacks, W: Math.max(whiteCount, 1) };
  });

  // Cap how wide a single white key may get, proportional to height, so a narrow
  // range doesn't stretch into absurdly wide keys — the keyboard centers instead.
  const MAX_WHITE_RATIO = 0.42;
  const maxKbdWidth = $derived(layout.W * height * MAX_WHITE_RATIO);

  // Black-key geometry as percentages of the full keyboard width (so it scales
  // with whatever width the flex white keys end up at — no fixed pixels, no scroll).
  const blackWidthPct = $derived((BLACK_FRAC / layout.W) * 100);
  const blackLeftPct = (after: number) => (after / layout.W) * 100 - blackWidthPct / 2;
</script>

<div
  class="kbd"
  style="height:{height}px; max-width:{maxKbdWidth}px"
  role="img"
  aria-label="piano keys to play">
  <div class="whites">
    {#each layout.whites as n (n)}
      <div class="wk" class:on={keyColors.has(n)} class:hold={holdKeys.has(n)} style={keyColors.has(n) ? `background:${keyColors.get(n)}` : ''}>
        {#if keyColors.has(n)}<span class="lbl">{pitchName(n)}</span>{/if}
      </div>
    {/each}
  </div>
  <div class="blacks" aria-hidden="true">
    {#each layout.blacks as b (b.n)}
      <div
        class="bk"
        class:on={keyColors.has(b.n)}
        class:hold={holdKeys.has(b.n)}
        style="left:{blackLeftPct(b.after)}%; width:{blackWidthPct}%; {keyColors.has(b.n)
          ? `background:${keyColors.get(b.n)}`
          : ''}">
        {#if keyColors.has(b.n)}<span class="lbl">{pitchName(b.n)}</span>{/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .kbd {
    position: relative;
    width: 100%;
    margin: 0 auto;
    user-select: none;
  }
  .whites {
    display: flex;
    height: 100%;
  }
  .wk {
    flex: 1 1 0;
    min-width: 0;
    background: #ffffff;
    border: 1px solid #c2c9d4;
    border-radius: 0 0 4px 4px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .wk:not(:first-child) {
    border-left: none;
  }
  /* "Keep holding" cue: an inset ring over the dimmed fill, so a held note reads
     as hold-this rather than press-now. */
  .wk.hold {
    box-shadow: inset 0 0 0 2px rgba(30, 35, 50, 0.4);
  }
  .bk.hold {
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.6);
  }
  .blacks {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .bk {
    position: absolute;
    top: 0;
    height: 63%;
    background: #2a2f3a;
    border: 1px solid #1a1d24;
    border-radius: 0 0 3px 3px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .lbl {
    font-size: 0.7rem;
    font-weight: 700;
    color: #ffffff;
    padding-bottom: 0.4rem;
    line-height: 1;
    pointer-events: none;
  }
  .bk .lbl {
    font-size: 0.62rem;
    padding-bottom: 0.25rem;
  }
</style>
