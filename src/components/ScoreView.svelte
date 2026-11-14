<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ScoreRenderer, type SheetLayout } from '../lib/score/ScoreRenderer';
  import { MetronomeController } from '../lib/metronome/metronome.svelte';
  import { clampBpm } from '../lib/metronome/bpm';
  import { midiHelp, type MidiController } from '../lib/midi/midi.svelte';
  import { handOptions, type HandOption } from '../lib/score/hands';
  import { pitchName } from '../lib/midi/types';
  import { loadSettings, saveSettings } from '../lib/library/settings';
  import { PracticeSession, type RunResult, type SessionRenderer } from '../lib/practice/session.svelte';
  import { keyLights } from '../lib/practice/keyLights';
  import { ListenController } from '../lib/sound/listen.svelte';
  import type { Timeline } from '../lib/score/timeline';
  import ConnBadge from './ConnBadge.svelte';
  import PianoKeyboard from './PianoKeyboard.svelte';
  import PracticeSetup, { type ViewMode } from './PracticeSetup.svelte';
  import CompletionDialog from './CompletionDialog.svelte';
  import Icon from './Icon.svelte';

  let {
    midi,
    id,
    xml,
    title,
    onBack
  }: { midi: MidiController; id: string; xml: string; title: string; onBack: () => void } = $props();

  // Cursor colours — the hand colours, lighter on the dark-mode sheet.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let dark = $state(darkQuery.matches);
  const onSchemeChange = (e: MediaQueryListEvent) => (dark = e.matches);
  const cursorColor = (kind?: string) =>
    kind === 'left' ? (dark ? '#fbbf24' : '#d97706') : dark ? '#a5b4fc' : '#4f46e5';

  let container: HTMLDivElement;
  let renderer: ScoreRenderer | undefined;
  // The session drives the notation through this adapter (renderer is created on mount).
  const view: SessionRenderer = {
    extractSteps: (o) => renderer?.extractSteps(o) ?? [],
    reset: () => renderer?.reset(),
    clearHighlight: () => renderer?.clearHighlight(),
    moveToIndex: (i) => renderer?.moveToIndex(i),
    highlightWrong: (s) => renderer?.highlightWrong(s),
    finish: () => renderer?.finish()
  };
  const session = new PracticeSession(view, onComplete);
  const metronome = new MetronomeController();
  const listen = new ListenController();
  let timeline: Timeline | null = null;

  let loaded = $state(false);
  let error = $state<string | null>(null);
  let hands = $state<HandOption[]>([]);
  let handSteps = $state<Record<string, number>>({});
  let hasChords = $state(false);
  let viewMode = $state<ViewMode>('both');
  // Why Start didn't start (no MIDI keyboard, nothing to play in this hand).
  let notice = $state<string | null>(null);
  // Setup is one tap away (top bar); opening a song goes straight to the music.
  let setupOpen = $state(false);
  let newBest = $state(false);
  let resultScope = $state('');
  let dismissedResult = $state(false);

  // Stage size drives the keyboard height and the sheet layout.
  let stageH = $state(0);
  let sheetW = $state(0);
  let sheetH = $state(0);

  const started = $derived(session.status !== 'empty');
  const playing = $derived(session.status === 'playing');
  const handName = $derived(hands.length < 2 || !session.hand ? '' : nameOf(session.hand));
  const scopeLabel = $derived(
    session.rangeOn
      ? session.fromBar === session.toBar
        ? `bar ${session.fromBar}`
        : `bars ${session.fromBar}–${session.toBar}`
      : 'the whole piece'
  );
  const kbdHeight = $derived(
    viewMode === 'piano'
      ? Math.max(160, Math.round(stageH - 56))
      : Math.min(190, Math.max(96, Math.round(stageH * 0.24)))
  );
  const sheetLayout = $derived<SheetLayout>(sheetW > 0 && sheetH > 0 && sheetW / sheetH < 1.3 ? 'page' : 'line');

  const litKeys = $derived(
    keyLights({
      playing,
      expected: session.expected,
      sustained: session.sustained,
      chordPitches: session.chordPitches,
      showGuide: session.showGuide,
      held: midi.heldNotes,
      wrongHeld: session.wrongHeld,
      isLeft: (p) => session.isLeft(p)
    })
  );
  const holdKeys = $derived(playing ? new Set(session.sustained) : new Set<number>());
  // The keys to press now flash with the metronome click.
  const pulseKeys = $derived(new Set(session.expected));
  // Wrong keys held outside the drawn keyboard — otherwise they'd be invisible.
  const wrongOutside = $derived(
    [...session.wrongHeld].filter((p) => p < session.keyLow || p > session.keyHigh).sort((a, b) => a - b)
  );

  // Metronome beat on the bar's first beat (accented click).
  const isDownbeat = $derived(
    metronome.running && metronome.beatCount >= 0 && metronome.beatCount % metronome.beatsPerBar === 0
  );

  function nameOf(h: HandOption): string {
    return { right: 'Right hand', left: 'Left hand', both: 'Both hands', other: h.label }[h.kind];
  }

  let unsubscribe: (() => void) | undefined;
  let wakeLock: WakeLockSentinel | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let relayoutTimer: ReturnType<typeof setTimeout> | undefined;
  let lastLaidOut = { w: 0, h: 0, layout: '' };

  /**
   * Keep the screen on for as long as a song is open — reading through before
   * Start and pausing between runs included — on a music stand nobody touches
   * the screen. Released when leaving for the library. Android drops the lock
   * whenever the page is hidden, so it's re-requested on return.
   */
  let destroyed = false;
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock && !wakeLock.released) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (destroyed) {
        void lock.release(); // left the player while the request was pending
        return;
      }
      wakeLock = lock;
    } catch {
      /* denied (e.g. battery saver) or unsupported — practice still works, screen may sleep */
    }
  }

  function releaseWakeLock() {
    void wakeLock?.release();
    wakeLock = null;
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') acquireWakeLock();
  }

  /** Re-render the sheet for its new size/shape (debounced; skipped while hidden). */
  function scheduleRelayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      if (!renderer || !loaded || viewMode === 'piano') return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      const same = Math.abs(w - lastLaidOut.w) < 8 && Math.abs(h - lastLaidOut.h) < 8 && lastLaidOut.layout === sheetLayout;
      if (same) return;
      lastLaidOut = { w, h, layout: sheetLayout };
      renderer.layout(sheetLayout);
    }, 200);
  }

  onMount(async () => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    darkQuery.addEventListener('change', onSchemeChange);
    acquireWakeLock();
    // While the computer plays the piece, the keyboard isn't graded.
    unsubscribe = midi.subscribe((e) => {
      if (!listen.playing) session.handle(e);
    });
    try {
      renderer = new ScoreRenderer(container, cursorColor());
      await renderer.load(xml, sheetLayout);
      lastLaidOut = { w: container.clientWidth, h: container.clientHeight, layout: sheetLayout };
      hands = handOptions(renderer.staves);
      const counts: Record<string, number> = {};
      let chords = false;
      for (const h of hands) {
        const hs = renderer.extractSteps({ staffIndex: h.staves, leftStaff: h.leftStaff, alongStaves: h.alongStaves });
        counts[h.id] = hs.length;
        chords ||= hs.some((s) => s.chordPitches?.length);
      }
      handSteps = counts;
      hasChords = chords;
      metronome.setFromScore(renderer.bpm, renderer.beatsPerBar);

      // Restore this piece's last settings where they still make sense.
      const saved = loadSettings(id);
      const playable = (h?: HandOption) => !!h && counts[h.id] > 0;
      const savedHand = hands.find((h) => h.id === saved.hand);
      const hand = playable(savedHand)
        ? savedHand!
        : (hands.find((h) => h.kind === 'right' && playable(h)) ?? hands.find(playable) ?? hands[0]);
      const left = hands.find((h) => h.kind === 'left');
      // Chord guide by default only when there's no written left hand (lead sheets).
      session.showGuide = saved.guide ?? (chords && (!left || counts[left.id] === 0));
      session.loop = !!saved.loop;
      if (saved.view) viewMode = saved.view;
      if (saved.bpm) metronome.bpm = clampBpm(saved.bpm, metronome.bpm);
      session.prepare(hand, saved.from, saved.to);
      loaded = true;

      resizeObserver = new ResizeObserver(scheduleRelayout);
      resizeObserver.observe(container);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  onDestroy(() => {
    destroyed = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    darkQuery.removeEventListener('change', onSchemeChange);
    resizeObserver?.disconnect();
    clearTimeout(relayoutTimer);
    releaseWakeLock();
    metronome.dispose();
    listen.dispose();
    unsubscribe?.();
    renderer?.dispose();
  });

  // Persist preferences whenever they change (after the piece has loaded).
  $effect(() => {
    const patch = {
      hand: session.hand?.id,
      view: viewMode,
      bpm: metronome.bpm,
      guide: session.showGuide,
      from: session.fromBar,
      to: session.toBar,
      loop: session.loop
    };
    if (loaded) saveSettings(id, patch);
  });

  // The cursor wears the colour of the hand being practised.
  $effect(() => {
    renderer?.setCursorColor(cursorColor(session.hand?.kind));
  });

  // Sheet shown again, or its shape changed: lay it out for the new space.
  $effect(() => {
    void viewMode;
    void sheetLayout;
    scheduleRelayout();
  });

  async function start() {
    if (!renderer || !session.hand) return;
    notice = null;
    if (handSteps[session.hand.id] === 0) {
      notice = `${nameOf(session.hand)} has no notes to play in this piece — pick another part.`;
      return;
    }
    // Connect on demand: pressing Start is a user gesture, so the MIDI prompt works here.
    if (midi.status !== 'connected') await midi.connect();
    if (midi.status !== 'connected') {
      // Without a keyboard nothing can ever advance; say why instead of starting.
      notice = midiHelp(midi.status);
      return;
    }
    listen.stop();
    session.start();
    setupOpen = false;
    dismissedResult = false;
    newBest = false;
    saveSettings(id, { lastPractised: Date.now() });
  }

  /** Hear the piece (or the selected bars) played by the computer; again to stop. */
  async function toggleListen() {
    if (!renderer) return;
    if (listen.status === 'playing' || listen.status === 'loading') {
      listen.stop();
      cursorBack();
      return;
    }
    notice = null;
    timeline ??= renderer.timeline();
    renderer.reset();
    renderer.clearHighlight();
    await listen.play({
      timeline,
      bpm: metronome.bpm,
      beatLength: renderer.beatLength,
      fromBar: session.fromBar,
      toBar: session.toBar,
      onCursor: (i) => renderer?.moveToIndex(i),
      onEnd: cursorBack
    });
  }

  /** After listening, the cursor goes back to where practice is (or the start). */
  function cursorBack() {
    if (!renderer) return;
    renderer.reset();
    const at = session.cursorIndex;
    if (at !== null) renderer.moveToIndex(at, false);
  }

  function playAgain() {
    dismissedResult = false;
    newBest = false;
    session.restart();
  }

  /** From the result's trouble list: loop just that bar. */
  function practiseBar(bar: number) {
    session.setRange(bar, bar);
    session.loop = true;
    dismissedResult = false;
    newBest = false;
    session.start();
  }

  function onComplete(r: RunResult) {
    resultScope = scopeLabel;
    if (r.wholePiece) {
      const best = loadSettings(id).best;
      if (best === undefined || r.accuracy > best) {
        saveSettings(id, { best: r.accuracy });
        newBest = best !== undefined;
      }
    }
  }
</script>

<section class="player" aria-label="Score player">
  <header class="topbar">
    <button class="ghost icon" onclick={onBack} aria-label="Back to library"><Icon name="back" /></button>
    <div class="titleblock">
      <h2 title={title}>{title}</h2>
      {#if handName || session.rangeOn}
        <span class="sub">
          {#if handName}<span class="dot" class:left={session.hand?.kind === 'left'} class:both={session.bothHands}></span>{handName}{/if}
          {#if session.rangeOn}<span class="sep">&nbsp;·&nbsp;</span>{scopeLabel}{/if}
        </span>
      {/if}
    </div>

    {#if playing && session.currentBar !== null}
      <div class="progress">
        <span class="where">Bar {session.currentBar}<span class="of">&nbsp;/&nbsp;{session.barLast}</span></span>
        <span class="track" aria-hidden="true">
          <span class="fill" style="width:{session.total ? (session.stepIndex / session.total) * 100 : 0}%"></span>
        </span>
        {#if session.loop && session.loopCount > 0}
          <span class="loops">Loop {session.loopCount + 1} · {session.lastLoopErrors} last time</span>
        {/if}
      </div>
    {:else}
      <div class="spacer"></div>
    {/if}

    <div class="actions">
      <ConnBadge {midi} />
      {#if metronome.supported}
        <button
          class="toggle metro"
          aria-pressed={metronome.running}
          onclick={() => metronome.toggle()}
          aria-label="Metronome, {metronome.bpm} BPM"
          title="Metronome ({metronome.bpm} BPM) — change the tempo in Setup">
          {#key metronome.beatCount}
            <span class="beat-dot" class:tick={metronome.running} class:down={isDownbeat}></span>
          {/key}
          <Icon name="metronome" size={18} />
          <span class="bpm">{metronome.bpm}</span>
        </button>
      {/if}
      <button
        class="toggle listen"
        aria-pressed={listen.status === 'playing' || listen.status === 'loading'}
        onclick={toggleListen}
        disabled={!loaded}
        aria-label={listen.playing ? 'Stop listening' : 'Listen to the piece'}
        title={listen.status === 'loading'
          ? `Loading instrument sounds… ${Math.round(listen.progress * 100)}%`
          : session.rangeOn
            ? `Listen to ${scopeLabel} (${metronome.bpm} BPM)`
            : `Listen (${metronome.bpm} BPM)`}>
        <Icon name={listen.playing ? 'stop' : 'listen'} size={18} />
        <span class="lbl"
          >{listen.status === 'loading' ? `${Math.round(listen.progress * 100)}%` : listen.playing ? 'Stop' : 'Listen'}</span>
      </button>
      <button class="ghost" onclick={() => (setupOpen = !setupOpen)} aria-expanded={setupOpen} aria-controls="practice-setup">
        <Icon name="settings" size={18} /> <span class="lbl">Setup</span>
      </button>
      {#if started}
        <button class="ghost" onclick={playAgain} aria-label="Restart from the beginning of {scopeLabel}">
          <Icon name="restart" size={18} /> <span class="lbl">Restart</span>
        </button>
      {:else}
        <button class="primary-start" onclick={start} disabled={!loaded}>
          <Icon name="play" size={18} /> <span class="lbl">Start</span>
        </button>
      {/if}
    </div>
  </header>

  {#if error}
    <p class="banner error" role="alert">Couldn't open this score: {error}</p>
  {/if}
  {#if notice}
    <p class="banner" role="status">{notice}</p>
  {/if}
  {#if listen.error}
    <p class="banner error" role="alert">{listen.error}</p>
  {/if}

  <div class="stage" bind:clientHeight={stageH}>
    {#if setupOpen && loaded}
      <div class="setup-wrap" id="practice-setup">
        <PracticeSetup
          {session}
          {hands}
          {handSteps}
          {hasChords}
          {metronome}
          bind:view={viewMode}
          {started}
          {loaded}
          {nameOf}
          onStart={start}
          onClose={() => (setupOpen = false)} />
      </div>
    {/if}

    {#if viewMode !== 'notes'}
      <div class="keyboard" class:grow={viewMode === 'piano'}>
        {#if metronome.running}
          {#key metronome.beatCount}
            <div class="beat-pulse" class:down={isDownbeat}></div>
          {/key}
        {/if}
        <div class="keyboard-header">
          <div class="legend">
            {#if session.bothHands}
              <span class="hand"><span class="dot"></span>Right</span>
              <span class="hand"><span class="dot left"></span>Left</span>
            {/if}
          </div>
          <div class="header-right">
            {#if playing}
              {#each session.releasedEarly as p (p)}
                <span class="hold-hint" class:left={session.isLeft(p)} role="status">Keep holding {pitchName(p)}</span>
              {/each}
            {/if}
            {#each wrongOutside as p (p)}
              <span class="wrong-out" title="Wrong key outside the shown keyboard"
                >{p < session.keyLow ? '◀ ' : ''}{pitchName(p)}{p > session.keyHigh ? ' ▶' : ''}</span>
            {/each}
            {#if session.chordName && playing}
              <span class="chord-badge" aria-live="polite">Chord {session.chordName}</span>
            {/if}
          </div>
        </div>
        <PianoKeyboard
          low={session.keyLow}
          high={session.keyHigh}
          keyColors={litKeys}
          {holdKeys}
          height={kbdHeight}
          pulseKeys={pulseKeys}
          beat={metronome.running && playing ? metronome.beatCount : -1}
          accent={isDownbeat} />
      </div>
    {/if}

    <!-- Kept in the DOM (only CSS-hidden) so OSMD's rendered SVG survives mode switches. -->
    <div
      class="sheet"
      class:hidden={viewMode === 'piano'}
      class:page={sheetLayout === 'page'}
      bind:this={container}
      bind:clientWidth={sheetW}
      bind:clientHeight={sheetH}
      aria-label="Sheet music notation">
    </div>

    {#if session.result && !dismissedResult}
      <CompletionDialog
        result={session.result}
        scope={resultScope}
        {newBest}
        onAgain={playAgain}
        onPractiseBar={practiseBar}
        onLibrary={onBack}
        onClose={() => (dismissedResult = true)} />
    {/if}
  </div>
</section>

<style>
  .player {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  /* Top bar: one row, big targets; wraps only on narrow screens. */
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.6rem 0.8rem;
    flex-wrap: wrap;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 0.5rem 0.6rem;
  }
  button.icon {
    width: var(--tap);
    padding: 0;
  }
  .titleblock {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    flex: 0 1 auto;
    max-width: 32ch;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  .sep {
    opacity: 0.6;
  }
  .dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: var(--hand-right);
    display: inline-block;
    flex: none;
  }
  .dot.left {
    background: var(--hand-left);
  }
  .dot.both {
    background: linear-gradient(90deg, var(--hand-right) 50%, var(--hand-left) 50%);
  }
  .spacer {
    flex: 1;
  }
  .progress {
    flex: 1 1 12rem;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 10rem;
    padding: 0 0.4rem;
  }
  .where {
    font-weight: 800;
    font-size: 1.05rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .of {
    color: var(--muted);
    font-weight: 600;
  }
  .track {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.2s ease;
  }
  .loops {
    color: var(--muted);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .primary-start {
    padding-inline: 1.3rem;
  }
  .metro .bpm {
    font-variant-numeric: tabular-nums;
    font-weight: 800;
  }
  .beat-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.35;
  }
  /* Re-mounted each beat (keyed), so this entry animation replays as a flash. */
  .beat-dot.tick {
    animation: beat-flash 0.18s ease-out;
  }
  .beat-dot.tick.down {
    animation: beat-flash-down 0.22s ease-out;
  }
  @keyframes beat-flash {
    from { background: var(--accent); opacity: 1; transform: scale(1.6); }
    to { opacity: 0.35; transform: scale(1); }
  }
  @keyframes beat-flash-down {
    from { background: var(--accent); opacity: 1; transform: scale(2); }
    to { opacity: 0.35; transform: scale(1); }
  }
  @media (max-width: 900px) {
    .actions .lbl {
      display: none;
    }
  }
  /* Phones: title + icon actions on one row, progress on its own row below. */
  @media (max-width: 640px) {
    .titleblock {
      flex: 1 1 0;
      max-width: none;
    }
    .spacer {
      display: none;
    }
    .actions {
      flex-wrap: nowrap;
      gap: 0.3rem;
    }
    /* Tempo is in Setup; the metronome button keeps just its beat dot + icon. */
    .metro .bpm {
      display: none;
    }
    .actions button {
      padding-inline: 0.7rem;
    }
    .sub {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .progress {
      order: 3;
      flex: 1 1 100%;
      padding: 0 0.2rem;
    }
  }

  .banner {
    margin: 0;
    padding: 0.7rem 0.95rem;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent-text);
    line-height: 1.45;
  }
  .banner.error {
    background: var(--error-soft);
    color: var(--error-text);
  }

  /* Stage: keyboard + sheet, filling the rest of the screen. */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .setup-wrap {
    position: absolute;
    z-index: 10;
    top: 0;
    right: 0;
    width: min(40rem, 100%);
    max-height: 100%;
    overflow: auto;
  }

  .keyboard {
    position: relative;
    flex: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.45rem 0.7rem 0.7rem;
  }
  .keyboard.grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  /* A soft beat flash around the keyboard, re-mounted (keyed) each beat to replay. */
  .beat-pulse {
    position: absolute;
    inset: 0;
    border-radius: var(--radius);
    pointer-events: none;
    z-index: 2;
    box-shadow: inset 0 0 0 2px var(--accent);
    animation: keyboard-pulse 0.2s ease-out forwards;
  }
  .beat-pulse.down {
    animation: keyboard-pulse-down 0.26s ease-out forwards;
  }
  @keyframes keyboard-pulse {
    from { opacity: 0.5; }
    to { opacity: 0; }
  }
  @keyframes keyboard-pulse-down {
    from { opacity: 0.9; }
    to { opacity: 0; }
  }
  .keyboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 1.9rem;
    margin-bottom: 0.3rem;
  }
  .legend,
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .hand {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--muted);
  }
  .chord-badge {
    background: var(--surface-2);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    font-size: 0.9rem;
    font-weight: 800;
    color: var(--text);
  }
  .hold-hint {
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 800;
    color: var(--text);
    background: var(--hand-right-hold);
    box-shadow: inset 0 0 0 2px var(--hand-right);
  }
  .hold-hint.left {
    background: var(--hand-left-hold);
    box-shadow: inset 0 0 0 2px var(--hand-left);
  }
  .wrong-out {
    background: var(--error-soft);
    color: var(--error);
    border-radius: 999px;
    padding: 0.2rem 0.65rem;
    font-size: 0.85rem;
    font-weight: 800;
  }

  /* The sheet, filling the remaining space. */
  .sheet {
    flex: 1;
    min-height: 0;
    background: var(--paper);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .sheet.page {
    overflow-x: hidden;
    overflow-y: auto;
  }
  .sheet.hidden {
    display: none;
  }
  /* Dark mode: light notation on the dark surface. OSMD draws black on a
     transparent SVG, so invert just the SVG (softened to avoid glare) and rotate
     the hue back so wrong-note red stays red. The cursor is a separate element
     and keeps its own (dark-mode) colour. */
  @media (prefers-color-scheme: dark) {
    .sheet :global(svg) {
      filter: invert(0.9) hue-rotate(180deg);
    }
  }
</style>
