<script lang="ts">
  import { pitchName } from '../lib/midi/types';

  let {
    low,
    high,
    highlight,
    colorFor,
    height = 100
  }: {
    low: number;
    high: number;
    highlight: number[];
    /** Fill color for a highlighted key (lets callers color-code by hand). */
    colorFor: (n: number) => string;
    height?: number;
  } = $props();

  const WHITE_W = 24;
  const WHITE_H = 132;
  const BLACK_W = 15;
  const BLACK_H = 84;
  const WHITE_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
  const isWhite = (n: number) => WHITE_CLASSES.has(((n % 12) + 12) % 12);

  type Key = { n: number; x: number; white: boolean };

  const keys = $derived.by(() => {
    const arr: Key[] = [];
    let whiteCount = 0;
    for (let n = low; n <= high; n++) {
      if (isWhite(n)) {
        arr.push({ n, x: whiteCount * WHITE_W, white: true });
        whiteCount++;
      } else {
        arr.push({ n, x: whiteCount * WHITE_W - BLACK_W / 2, white: false });
      }
    }
    return arr;
  });
  const whiteKeys = $derived(keys.filter((k) => k.white));
  const blackKeys = $derived(keys.filter((k) => !k.white));
  const vbW = $derived(whiteKeys.length * WHITE_W);
  const hi = $derived(new Set(highlight));
</script>

<div class="kbd-wrap">
<svg
  class="kbd"
  style="height:{height}px"
  viewBox="0 0 {vbW} {WHITE_H}"
  preserveAspectRatio="xMidYMid meet"
  role="img"
  aria-label="piano keys to play">
  {#each whiteKeys as k (k.n)}
    <rect
      x={k.x + 0.5}
      y="0.5"
      width={WHITE_W - 1}
      height={WHITE_H - 1}
      rx="3"
      fill={hi.has(k.n) ? colorFor(k.n) : '#ffffff'}
      stroke="#c2c9d4"
      stroke-width="1" />
    {#if hi.has(k.n)}
      <text x={k.x + WHITE_W / 2} y={WHITE_H - 12} text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff">
        {pitchName(k.n)}
      </text>
    {/if}
  {/each}
  {#each blackKeys as k (k.n)}
    <rect
      x={k.x}
      y="0"
      width={BLACK_W}
      height={BLACK_H}
      rx="2.5"
      fill={hi.has(k.n) ? colorFor(k.n) : '#2a2f3a'}
      stroke="#1a1d24"
      stroke-width="1" />
  {/each}
</svg>
</div>

<style>
  .kbd-wrap {
    overflow-x: auto;
    overflow-y: hidden;
  }
  .kbd {
    width: auto;
    display: block;
    margin: 0 auto;
  }
</style>
