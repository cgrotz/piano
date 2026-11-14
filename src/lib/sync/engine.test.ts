import { describe, expect, it } from 'vitest';
import { SyncEngine, TOMBSTONE_TTL_MS } from './engine';
import { MemoryLocalStore, MemoryProvider } from './memory';
import { mergeRecords } from './merge';
import type { ProgressRecord, ScoreRecord, SettingsRecord } from './types';

const score = (id: string, updatedAt: number, extra: Partial<ScoreRecord> = {}): ScoreRecord => ({
  id,
  title: `Piece ${id}`,
  composer: 'Anon',
  importedAt: 1,
  xml: `<score id="${id}"/>`,
  updatedAt,
  ...extra
});

const scoreTombstone = (id: string, updatedAt: number): ScoreRecord => ({
  ...score(id, updatedAt, { xml: '' }),
  deleted: true
});

function setup() {
  const cloud = new MemoryProvider();
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const device = () => {
    const local = new MemoryLocalStore();
    return { local, engine: new SyncEngine(local, cloud, clock.now) };
  };
  return { cloud, clock, a: device(), b: device() };
}

describe('SyncEngine', () => {
  it('uploads an existing library on first sync and another device downloads it', async () => {
    const { cloud, a, b } = setup();
    await a.local.edit({ kind: 'scores', record: score('s1', 10) });
    await a.local.put({ kind: 'progress', record: { id: 's1', updatedAt: 10, best: 80 } }, { dirty: false });

    const ra = await a.engine.sync();
    expect(ra.pushed).toBe(2);
    expect(cloud.records.size).toBe(2);
    expect(a.local.outbox.size).toBe(0);

    const rb = await b.engine.sync();
    expect(rb.pulled).toBe(2);
    expect(rb.changed).toEqual(new Set(['scores', 'progress']));
    expect((await b.local.get('scores', 's1'))?.xml).toBe('<score id="s1"/>');
    expect(b.local.outbox.size).toBe(0);
  });

  it("doesn't download its own pushes again", async () => {
    const { cloud, a } = setup();
    await a.engine.sync();
    await a.local.edit({ kind: 'scores', record: score('s1', 10) });
    await a.engine.sync();
    const gets = cloud.gets;
    const r = await a.engine.sync();
    expect(r.pulled).toBe(0);
    expect(cloud.gets).toBe(gets);
  });

  it('resolves concurrent score edits by last writer per record', async () => {
    const { a, b } = setup();
    await a.local.edit({ kind: 'scores', record: score('s1', 10) });
    await a.engine.sync();
    await b.engine.sync();

    await a.local.edit({ kind: 'scores', record: score('s1', 30, { title: 'Renamed on A' }) });
    await b.local.edit({ kind: 'scores', record: score('s1', 20, { title: 'Renamed on B' }) });
    await b.engine.sync(); // B pushes its older edit first
    await a.engine.sync(); // A's newer edit wins and is pushed
    await b.engine.sync();

    expect((await a.local.get('scores', 's1'))?.title).toBe('Renamed on A');
    expect((await b.local.get('scores', 's1'))?.title).toBe('Renamed on A');
  });

  it('keeps the newer local score when the remote one is older, without downloading it', async () => {
    const { cloud, a, b } = setup();
    await a.local.edit({ kind: 'scores', record: score('s1', 10) });
    await a.engine.sync();
    await b.engine.sync();
    await a.local.edit({ kind: 'scores', record: score('s1', 20, { title: 'old' }) });
    await a.engine.sync();
    await b.local.edit({ kind: 'scores', record: score('s1', 40, { title: 'new' }) });
    const gets = cloud.gets;
    await b.engine.sync();
    expect(cloud.gets).toBe(gets);
    expect((await cloud.get('scores', 's1'))?.title).toBe('new');
  });

  it('merges settings per field', async () => {
    const { a, b } = setup();
    const base: SettingsRecord = {
      id: 's1',
      updatedAt: 10,
      values: { bpm: 80, hand: 'right' },
      stamps: { bpm: 10, hand: 10 }
    };
    await a.local.edit({ kind: 'settings', record: base });
    await a.engine.sync();
    await b.engine.sync();

    // Offline at the same time: A changes the tempo, B changes the hand and the loop.
    await a.local.edit({
      kind: 'settings',
      record: { ...base, updatedAt: 30, values: { bpm: 100, hand: 'right' }, stamps: { bpm: 30, hand: 10 } }
    });
    await b.local.edit({
      kind: 'settings',
      record: {
        ...base,
        updatedAt: 20,
        values: { bpm: 80, hand: 'left', loop: true },
        stamps: { bpm: 10, hand: 20, loop: 20 }
      }
    });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    const expected = { bpm: 100, hand: 'left', loop: true };
    expect((await a.local.get('settings', 's1'))?.values).toEqual(expected);
    expect((await b.local.get('settings', 's1'))?.values).toEqual(expected);
    expect(a.local.outbox.size + b.local.outbox.size).toBe(0);
  });

  it('merges progress by max', async () => {
    const { a, b } = setup();
    await a.local.edit({ kind: 'progress', record: { id: 's1', updatedAt: 10, best: 70, lastPractised: 10 } });
    await a.engine.sync();
    await b.engine.sync();

    // A practised later; B, offline, set a better score earlier.
    await a.local.edit({ kind: 'progress', record: { id: 's1', updatedAt: 50, best: 75, lastPractised: 50 } });
    await b.local.edit({ kind: 'progress', record: { id: 's1', updatedAt: 40, best: 95, lastPractised: 40 } });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    const pa = (await a.local.get('progress', 's1')) as ProgressRecord;
    expect(pa).toMatchObject({ best: 95, lastPractised: 50 });
    expect(await b.local.get('progress', 's1')).toEqual(pa);
    expect(a.local.outbox.size + b.local.outbox.size).toBe(0);
  });

  describe('tombstones', () => {
    it('propagates a deletion', async () => {
      const { a, b } = setup();
      await a.local.edit({ kind: 'scores', record: score('s1', 10) });
      await a.engine.sync();
      await b.engine.sync();

      await a.local.edit({ kind: 'scores', record: scoreTombstone('s1', 20) });
      await a.engine.sync();
      const r = await b.engine.sync();
      expect(r.changed.has('scores')).toBe(true);
      expect(await b.local.get('scores', 's1')).toMatchObject({ deleted: true, xml: '' });
    });

    it('an older edit on another device does not bring a deleted piece back', async () => {
      const { a, b } = setup();
      await a.local.edit({ kind: 'scores', record: score('s1', 10) });
      await a.engine.sync();
      await b.engine.sync();

      await b.local.edit({ kind: 'scores', record: score('s1', 15, { title: 'edited' }) });
      await a.local.edit({ kind: 'scores', record: scoreTombstone('s1', 20) });
      await a.engine.sync();
      await b.engine.sync();
      await a.engine.sync();

      expect((await a.local.get('scores', 's1'))?.deleted).toBe(true);
      expect((await b.local.get('scores', 's1'))?.deleted).toBe(true);
    });

    it('a deletion older than a live edit loses', async () => {
      const { a, b } = setup();
      await a.local.edit({ kind: 'progress', record: { id: 's1', updatedAt: 10, best: 50 } });
      await a.engine.sync();
      await b.engine.sync();

      await a.local.edit({ kind: 'progress', record: { id: 's1', updatedAt: 20, deleted: true } });
      await b.local.edit({ kind: 'progress', record: { id: 's1', updatedAt: 30, best: 60 } });
      await a.engine.sync();
      await b.engine.sync();
      await a.engine.sync();

      for (const d of [a, b]) expect(await d.local.get('progress', 's1')).toEqual({ id: 's1', updatedAt: 30, best: 60 });
    });

    it('purges tombstones everywhere once they are old', async () => {
      const { cloud, clock, a, b } = setup();
      await a.local.edit({ kind: 'scores', record: score('s1', 10) });
      await a.engine.sync();
      await b.engine.sync();
      await a.local.edit({ kind: 'scores', record: scoreTombstone('s1', clock.now()) });
      await a.engine.sync();
      await b.engine.sync();
      expect(cloud.records.size).toBe(1);

      clock.advance(TOMBSTONE_TTL_MS + 1);
      await a.engine.sync();
      expect(cloud.records.size).toBe(0);
      expect(await a.local.get('scores', 's1')).toBeUndefined();

      const r = await b.engine.sync();
      expect(r.changed.has('scores')).toBe(true);
      expect(await b.local.get('scores', 's1')).toBeUndefined();
    });

    it('re-uploads a live record whose remote copy was purged', async () => {
      const { cloud, a, b } = setup();
      await a.local.edit({ kind: 'scores', record: score('s1', 10) });
      await a.engine.sync();
      await b.engine.sync();
      await cloud.delete('scores', 's1');
      await b.engine.sync();
      expect((await cloud.get('scores', 's1'))?.title).toBe('Piece s1');
    });
  });

  it('keeps a record queued when it changes again during a push', async () => {
    const { cloud, a } = setup();
    await a.engine.sync();
    await a.local.edit({ kind: 'scores', record: score('s1', 10) });
    const put = cloud.put.bind(cloud);
    cloud.put = async (entry) => {
      await put(entry);
      await a.local.edit({ kind: 'scores', record: score('s1', 11, { title: 'changed mid-push' }) });
    };
    await a.engine.sync();
    expect([...a.local.outbox.values()]).toEqual([{ kind: 'scores', id: 's1', updatedAt: 11 }]);
    cloud.put = put;
    await a.engine.sync();
    expect((await cloud.get('scores', 's1'))?.title).toBe('changed mid-push');
    expect(a.local.outbox.size).toBe(0);
  });

  it('never overwrites a local change made while a merge was in flight', async () => {
    const { cloud, a, b } = setup();
    const settings = (updatedAt: number, values: SettingsRecord['values'], stamps: SettingsRecord['stamps']) => ({
      kind: 'settings' as const,
      record: { id: 's1', updatedAt, values, stamps }
    });
    await a.local.edit(settings(10, { bpm: 60 }, { bpm: 10 }));
    await a.engine.sync();
    await b.engine.sync();
    await a.local.edit(settings(20, { bpm: 60, hand: 'left' }, { bpm: 10, hand: 20 }));
    await a.engine.sync();

    // B changes the tempo while its sync is downloading A's change.
    const get = cloud.get.bind(cloud);
    cloud.get = (async (kind, id) => {
      const r = await get(kind, id);
      await b.local.edit(settings(30, { bpm: 90 }, { bpm: 30 }));
      return r;
    }) as typeof cloud.get;
    await b.engine.sync();
    cloud.get = get;
    expect((await b.local.get('settings', 's1'))?.values.bpm).toBe(90);

    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    for (const d of [a, b]) expect((await d.local.get('settings', 's1'))?.values).toEqual({ bpm: 90, hand: 'left' });
  });

  it('does not advance the cursor when a pull fails', async () => {
    const { cloud, a, b } = setup();
    await b.engine.sync();
    await a.local.edit({ kind: 'scores', record: score('s1', 10) });
    await a.engine.sync();

    const get = cloud.get.bind(cloud);
    cloud.get = async () => {
      throw new Error('network down');
    };
    const before = await b.local.getMeta('sync:cursor');
    await expect(b.engine.sync()).rejects.toThrow('network down');
    expect(await b.local.getMeta('sync:cursor')).toBe(before);
    cloud.get = get;
    await b.engine.sync();
    expect(await b.local.get('scores', 's1')).toBeDefined();
  });

  it('shares one run between concurrent sync calls', async () => {
    const { a } = setup();
    expect(a.engine.sync()).toBe(a.engine.sync());
  });
});

describe('mergeRecords', () => {
  it('breaks ties deterministically, whichever side is local', () => {
    const x = score('s1', 10, { title: 'X' });
    const y = score('s1', 10, { title: 'Y' });
    expect(mergeRecords('scores', x, y)).toEqual(mergeRecords('scores', y, x));
    const t = scoreTombstone('s1', 10);
    expect(mergeRecords('scores', x, t)).toBe(t);
    expect(mergeRecords('scores', t, x)).toBe(t);
  });

  it('merges settings fields with equal stamps the same way on both sides', () => {
    const p: SettingsRecord = { id: 'a', updatedAt: 5, values: { bpm: 60 }, stamps: { bpm: 5 } };
    const q: SettingsRecord = { id: 'a', updatedAt: 5, values: { bpm: 90 }, stamps: { bpm: 5 } };
    expect(mergeRecords('settings', p, q)).toEqual(mergeRecords('settings', q, p));
  });

  it('takes the missing side from the other', () => {
    const x = score('s1', 1);
    expect(mergeRecords('scores', undefined, x)).toBe(x);
    expect(mergeRecords('scores', x, null)).toBe(x);
  });
});
