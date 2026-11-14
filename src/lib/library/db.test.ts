// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  LEGACY_SETTINGS_PREFIX,
  addScore,
  closeDb,
  deleteScore,
  getAllRecords,
  getAllScores,
  getRecord,
  idbLocalStore
} from './db';
import { forgetSettings, hydrateSettings, loadSettings, saveSettings, settingsFlushed } from './settings';

// Node 26 ships its own (disabled) localStorage global that hides jsdom's: use a plain one.
class MemoryStorage implements Storage {
  #m = new Map<string, string>();
  get length() {
    return this.#m.size;
  }
  clear() {
    this.#m.clear();
  }
  getItem(k: string) {
    return this.#m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.#m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.#m.delete(k);
  }
  setItem(k: string, v: string) {
    this.#m.set(k, String(v));
  }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });

/** Create the database as version 1 of the app left it. */
function createV1(scores: object[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('scores', { keyPath: 'id' });
      for (const s of scores) store.put(s);
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function wipe(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await closeDb();
  await wipe();
  localStorage.clear();
});
afterEach(() => closeDb());

describe('v1 → v2 migration', () => {
  it('keeps scores, adds updatedAt and moves localStorage settings into records', async () => {
    await createV1([
      { id: 'a', title: 'Minuet', composer: 'Bach', importedAt: 1000, xml: '<a/>', bars: 32 },
      { id: 'b', title: 'Etude', composer: 'Czerny', importedAt: 2000, xml: '<b/>' }
    ]);
    localStorage.setItem(
      LEGACY_SETTINGS_PREFIX + 'a',
      JSON.stringify({ hand: 'left', bpm: 72, loop: true, lastPractised: 5000, best: 91 })
    );
    localStorage.setItem(LEGACY_SETTINGS_PREFIX + 'b', JSON.stringify({ view: 'notes' }));
    localStorage.setItem(LEGACY_SETTINGS_PREFIX + 'broken', '{nope');
    localStorage.setItem('piano-tutor:library-sort', 'title');

    const scores = await getAllScores();
    expect(scores.map((s) => [s.id, s.title, s.xml, s.updatedAt])).toEqual([
      ['a', 'Minuet', '<a/>', 1000],
      ['b', 'Etude', '<b/>', 2000]
    ]);
    expect(scores[0].bars).toBe(32);

    const a = await getRecord('settings', 'a');
    expect(a?.values).toEqual({ hand: 'left', bpm: 72, loop: true });
    expect(Object.keys(a!.stamps).sort()).toEqual(['bpm', 'hand', 'loop']);
    expect(await getRecord('progress', 'a')).toMatchObject({ lastPractised: 5000, best: 91 });
    expect((await getRecord('settings', 'b'))?.values).toEqual({ view: 'notes' });
    expect(await getRecord('progress', 'b')).toBeUndefined();
    expect(await getAllRecords('arrangements')).toEqual([]);

    // Everything is queued for the first sync.
    const dirty = (await idbLocalStore.dirty()).map((d) => `${d.kind}/${d.id}`).sort();
    expect(dirty).toEqual(['progress/a', 'scores/a', 'scores/b', 'settings/a', 'settings/b']);

    await hydrateSettings();
    expect(loadSettings('a')).toEqual({ hand: 'left', bpm: 72, loop: true, lastPractised: 5000, best: 91 });
  });

  it('opens a fresh database with all stores', async () => {
    expect(await getAllScores()).toEqual([]);
    for (const kind of ['settings', 'progress', 'arrangements'] as const) {
      expect(await getAllRecords(kind)).toEqual([]);
    }
  });
});

describe('library records', () => {
  it('deleting a score leaves a hidden tombstone without the MusicXML', async () => {
    await addScore({ id: 'x', title: 'T', composer: 'C', importedAt: 1, xml: '<x/>' });
    await deleteScore('x');
    expect(await getAllScores()).toEqual([]);
    expect(await getRecord('scores', 'x')).toMatchObject({ id: 'x', deleted: true, xml: '' });
  });

  it('outbox entries clear only for the pushed version', async () => {
    await addScore({ id: 'x', title: 'T', composer: 'C', importedAt: 1, xml: '<x/>', updatedAt: 5 });
    await idbLocalStore.clearDirty('scores', 'x', 4);
    expect(await idbLocalStore.dirty()).toHaveLength(1);
    await idbLocalStore.clearDirty('scores', 'x', 5);
    expect(await idbLocalStore.dirty()).toHaveLength(0);
  });
});

describe('settings', () => {
  it('persists, stamps only changed fields, and forgets as tombstones', async () => {
    await hydrateSettings();
    saveSettings('p', { bpm: 60, hand: 'right' });
    await settingsFlushed();
    const first = await getRecord('settings', 'p');
    // A piece's first save is the defaults it opened with: never beats a real choice.
    expect(first?.stamps).toEqual({ bpm: 0, hand: 0 });

    await new Promise((r) => setTimeout(r, 2));
    saveSettings('p', { bpm: 66, hand: 'right', best: 88 });
    await settingsFlushed();
    const second = await getRecord('settings', 'p');
    expect(second?.values).toEqual({ bpm: 66, hand: 'right' });
    expect(second?.stamps.hand).toBe(first?.stamps.hand);
    expect(second!.stamps.bpm!).toBeGreaterThan(first!.stamps.bpm!);
    expect(await getRecord('progress', 'p')).toMatchObject({ best: 88 });

    forgetSettings('p');
    expect(loadSettings('p')).toEqual({});
    await settingsFlushed();
    expect(await getRecord('settings', 'p')).toMatchObject({ deleted: true });
    expect(await getRecord('progress', 'p')).toMatchObject({ deleted: true });
  });
});
