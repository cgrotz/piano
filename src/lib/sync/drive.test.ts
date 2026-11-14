import { describe, expect, it } from 'vitest';
import { DriveProvider, fileName, parseFileName } from './drive';
import { SyncEngine } from './engine';
import { AuthRequiredError } from './googleAuth';
import { MemoryLocalStore } from './memory';
import type { ScoreRecord } from './types';

interface FakeFile {
  id: string;
  name: string;
  appProperties: Record<string, string>;
  content: string;
}

/** Just enough of the Drive v3 REST API (app data folder) to run the provider. */
class FakeDrive {
  files = new Map<string, FakeFile>();
  log: { fileId: string; removed: boolean }[] = [];
  requests: string[] = [];
  #next = 1;
  expired = false;

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${url.pathname}`);
    if (this.expired) return json({ error: { message: 'expired' } }, 401);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    const p = url.pathname;
    const q = url.searchParams;

    if (p === '/drive/v3/changes/startPageToken') return json({ startPageToken: String(this.log.length) });
    if (p === '/drive/v3/changes') {
      const from = Number(q.get('pageToken'));
      const changes = this.log.slice(from).map(({ fileId, removed }) => {
        const f = this.files.get(fileId);
        return removed || !f ? { fileId, removed: true } : { fileId, removed: false, file: meta(f) };
      });
      return json({ changes, newStartPageToken: String(this.log.length) });
    }
    if (p === '/drive/v3/files' && method === 'GET') {
      expect(q.get('spaces')).toBe('appDataFolder');
      const name = /name = '(.*)' and/.exec(q.get('q') ?? '')?.[1]?.replace(/\\'/g, "'");
      const files = [...this.files.values()].filter((f) => name === undefined || f.name === name);
      return json({ files: files.map(meta) });
    }
    const fileMatch = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(p);
    if (fileMatch && method === 'GET') {
      const f = this.files.get(fileMatch[1]);
      return f ? new Response(f.content) : json({}, 404);
    }
    if (fileMatch && method === 'DELETE') {
      if (!this.files.delete(fileMatch[1])) return json({}, 404);
      this.log.push({ fileId: fileMatch[1], removed: true });
      return new Response(null, { status: 204 });
    }
    if (p.startsWith('/upload/drive/v3/files') && (method === 'POST' || method === 'PATCH')) {
      expect(q.get('uploadType')).toBe('multipart');
      const boundary = /boundary=(.+)$/.exec(new Headers(init.headers).get('Content-Type')!)![1];
      const [metaPart, contentPart] = String(init.body)
        .split(`--${boundary}`)
        .slice(1, 3)
        .map((part) => part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const m = JSON.parse(metaPart);
      let f: FakeFile;
      if (method === 'POST') {
        expect(m.parents).toEqual(['appDataFolder']);
        f = { id: `f${this.#next++}`, name: m.name, appProperties: {}, content: '' };
        this.files.set(f.id, f);
      } else {
        const existing = this.files.get(fileMatch![1]);
        if (!existing) return json({}, 404);
        f = existing;
      }
      f.appProperties = { ...f.appProperties, ...m.appProperties };
      f.content = contentPart;
      this.log.push({ fileId: f.id, removed: false });
      return json(meta(f));
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
}

const meta = ({ id, name, appProperties }: FakeFile) => ({ id, name, appProperties });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const score = (id: string, updatedAt: number, extra: Partial<ScoreRecord> = {}): ScoreRecord => ({
  id,
  title: 'Minuet',
  composer: 'Bach',
  importedAt: 1,
  xml: '<?xml version="1.0"?><score-partwise>\r\n<part/></score-partwise>',
  updatedAt,
  ...extra
});

function device(drive: FakeDrive) {
  const local = new MemoryLocalStore();
  const provider = new DriveProvider(async () => 'tok', drive.fetch);
  return { local, provider, engine: new SyncEngine(local, provider, () => 1000) };
}

describe('file names', () => {
  it('round-trip ids with odd characters', () => {
    for (const id of ['builtin:c-major-scale', "it's.a/test", '3f2a-…']) {
      expect(parseFileName(fileName('settings', id))).toEqual({ kind: 'settings', id, part: 'json' });
    }
    expect(parseFileName(fileName('scores', 'x', 'musicxml'))).toEqual({ kind: 'scores', id: 'x', part: 'musicxml' });
    expect(parseFileName('other.x.json')).toBeNull();
    expect(parseFileName('notes.txt')).toBeNull();
  });
});

describe('DriveProvider', () => {
  it('stores a score as metadata JSON plus its own MusicXML file', async () => {
    const drive = new FakeDrive();
    const { provider } = device(drive);
    await provider.put({ kind: 'scores', record: score('s1', 10) });

    const names = [...drive.files.values()].map((f) => f.name).sort();
    expect(names).toEqual(['scores.s1.json', 'scores.s1.musicxml']);
    const metaFile = [...drive.files.values()].find((f) => f.name.endsWith('.json'))!;
    expect(JSON.parse(metaFile.content).xml).toBeUndefined();
    expect(metaFile.appProperties).toMatchObject({ kind: 'scores', updatedAt: '10', deleted: '0' });

    expect(await provider.get('scores', 's1')).toEqual(score('s1', 10));
  });

  it('updates files in place and drops the MusicXML of a tombstone', async () => {
    const drive = new FakeDrive();
    const { provider } = device(drive);
    await provider.put({ kind: 'scores', record: score('s1', 10) });
    // A fresh provider (app restarted) must find the existing files, not duplicate them.
    const again = new DriveProvider(async () => 'tok', drive.fetch);
    await again.put({ kind: 'scores', record: { ...score('s1', 20, { xml: '' }), deleted: true } });
    expect([...drive.files.values()].map((f) => f.name)).toEqual(['scores.s1.json']);
    expect(await again.get('scores', 's1')).toMatchObject({ deleted: true, updatedAt: 20 });
  });

  it('lists changes since a cursor, including removals', async () => {
    const drive = new FakeDrive();
    const { provider } = device(drive);
    await provider.put({ kind: 'progress', record: { id: 'p', updatedAt: 5, best: 90 } });
    const first = await provider.listChanges(null);
    expect(first.changes).toEqual([{ kind: 'progress', id: 'p', updatedAt: 5, deleted: false }]);

    await provider.put({ kind: 'settings', record: { id: 'p', updatedAt: 6, values: { bpm: 70 }, stamps: { bpm: 6 } } });
    await provider.delete('progress', 'p');
    const next = await provider.listChanges(first.cursor);
    expect(next.changes).toEqual([
      { kind: 'settings', id: 'p', updatedAt: 6, deleted: false },
      { kind: 'progress', id: 'p', removed: true }
    ]);
    expect((await provider.listChanges(next.cursor)).changes).toEqual([]);
  });

  it('reports an expired token as AuthRequiredError', async () => {
    const drive = new FakeDrive();
    drive.expired = true;
    await expect(device(drive).provider.listChanges(null)).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('syncs a library between two devices end to end', async () => {
    const drive = new FakeDrive();
    const tablet = device(drive);
    const desktop = device(drive);

    await tablet.local.edit({ kind: 'scores', record: score('s1', 10) });
    await tablet.local.edit({ kind: 'settings', record: { id: 's1', updatedAt: 10, values: { bpm: 60 }, stamps: { bpm: 10 } } });
    await tablet.engine.sync();
    await desktop.engine.sync();
    expect(await desktop.local.get('scores', 's1')).toEqual(score('s1', 10));

    await desktop.local.edit({ kind: 'scores', record: { ...score('s1', 20, { xml: '' }), deleted: true } });
    await desktop.engine.sync();
    const r = await tablet.engine.sync();
    expect(r.changed.has('scores')).toBe(true);
    expect(await tablet.local.get('scores', 's1')).toMatchObject({ deleted: true });
    expect([...drive.files.values()].some((f) => f.name.endsWith('.musicxml'))).toBe(false);
  });
});
