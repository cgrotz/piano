/**
 * Google Drive `SyncProvider` (COMPOSER.md §7).
 *
 * Records live in the hidden app data folder (`drive.appdata` scope: the app
 * sees only its own files, the user's Drive shows nothing). One JSON file per
 * record, named `<kind>.<id>.json`; a score's MusicXML is its own file
 * `scores.<id>.musicxml` next to its metadata. Each JSON file carries the
 * record's kind, id, updatedAt and deleted flag as `appProperties`, so the
 * changes listing tells the engine what changed without downloading anything.
 *
 * The cursor is a Drive changes page token.
 */
import { AuthRequiredError } from './googleAuth';
import type { Entry, RecordKind, RecordOf, RemoteRef, ScoreRecord, SyncProvider } from './types';
import { RECORD_KINDS } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,appProperties';

interface DriveFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

type Part = 'json' | 'musicxml';

export function fileName(kind: RecordKind, id: string, part: Part = 'json'): string {
  return `${kind}.${encodeURIComponent(id)}.${part}`;
}

/** Inverse of fileName; null for anything this app didn't write. */
export function parseFileName(name: string): { kind: RecordKind; id: string; part: Part } | null {
  const m = /^([a-z]+)\.(.+)\.(json|musicxml)$/.exec(name);
  if (!m || !(RECORD_KINDS as readonly string[]).includes(m[1])) return null;
  try {
    return { kind: m[1] as RecordKind, id: decodeURIComponent(m[2]), part: m[3] as Part };
  } catch {
    return null;
  }
}

export class DriveProvider implements SyncProvider {
  /** File name → Drive file id, learned from listings and lookups. */
  #ids = new Map<string, string>();
  /** Drive file id → file name, to make sense of "removed" changes. */
  #names = new Map<string, string>();

  constructor(
    private getToken: () => Promise<string>,
    private fetchImpl: typeof fetch = (...args) => fetch(...args)
  ) {}

  async listChanges(cursor: string | null): Promise<{ changes: RemoteRef[]; cursor: string }> {
    if (cursor === null) {
      // Take the token first: anything changing during the listing shows up next time.
      const { startPageToken } = await this.#json<{ startPageToken: string }>(`${API}/changes/startPageToken`);
      const changes: RemoteRef[] = [];
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({
          spaces: 'appDataFolder',
          pageSize: '1000',
          fields: `nextPageToken,files(${FILE_FIELDS})`
        });
        if (pageToken) q.set('pageToken', pageToken);
        const page = await this.#json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${q}`);
        for (const f of page.files) {
          const ref = this.#learn(f);
          if (ref) changes.push(ref);
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { changes, cursor: startPageToken };
    }

    const changes: RemoteRef[] = [];
    let pageToken = cursor;
    for (;;) {
      const q = new URLSearchParams({
        pageToken,
        spaces: 'appDataFolder',
        pageSize: '1000',
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS},trashed))`
      });
      const page = await this.#json<{
        changes: { fileId: string; removed?: boolean; file?: DriveFile & { trashed?: boolean } }[];
        nextPageToken?: string;
        newStartPageToken?: string;
      }>(`${API}/changes?${q}`);
      for (const c of page.changes) {
        if (c.removed || !c.file || c.file.trashed) {
          const name = this.#names.get(c.fileId);
          this.#names.delete(c.fileId);
          if (name) this.#ids.delete(name);
          const parsed = name ? parseFileName(name) : null;
          if (parsed?.part === 'json') changes.push({ kind: parsed.kind, id: parsed.id, removed: true });
          continue;
        }
        const ref = this.#learn(c.file);
        if (ref) changes.push(ref);
      }
      if (page.newStartPageToken) return { changes, cursor: page.newStartPageToken };
      if (!page.nextPageToken) return { changes, cursor: pageToken };
      pageToken = page.nextPageToken;
    }
  }

  async get<K extends RecordKind>(kind: K, id: string): Promise<RecordOf[K] | null> {
    const jsonId = await this.#find(fileName(kind, id));
    if (!jsonId) return null;
    const record = await this.#json<RecordOf[K]>(`${API}/files/${jsonId}?alt=media`, {}, true);
    if (!record) return null;
    if (kind === 'scores' && !record.deleted) {
      const xmlId = await this.#find(fileName(kind, id, 'musicxml'));
      // Metadata without its MusicXML (an upload cut short): skip until it's complete.
      if (!xmlId) return null;
      const res = await this.#fetch(`${API}/files/${xmlId}?alt=media`);
      if (res.status === 404) return null;
      (record as ScoreRecord).xml = await res.text();
    }
    return record;
  }

  async put({ kind, record }: Entry): Promise<void> {
    const props: Record<string, string> = {
      kind,
      rid: record.id.slice(0, 80),
      updatedAt: String(record.updatedAt),
      deleted: record.deleted ? '1' : '0'
    };
    let body: object = record;
    if (kind === 'scores') {
      const { xml, ...meta } = record as ScoreRecord;
      body = meta;
      // MusicXML first, so the metadata never points at a file that isn't there yet.
      if (record.deleted) await this.#remove(fileName(kind, record.id, 'musicxml'));
      else await this.#upload(fileName(kind, record.id, 'musicxml'), xml, 'application/vnd.recordare.musicxml+xml', {
        kind,
        rid: props.rid
      });
    }
    await this.#upload(fileName(kind, record.id), JSON.stringify(body), 'application/json', props);
  }

  async delete(kind: RecordKind, id: string): Promise<void> {
    if (kind === 'scores') await this.#remove(fileName(kind, id, 'musicxml'));
    await this.#remove(fileName(kind, id));
  }

  // ---- Drive plumbing -------------------------------------------------------

  #learn(f: DriveFile): RemoteRef | null {
    this.#ids.set(f.name, f.id);
    this.#names.set(f.id, f.name);
    const parsed = parseFileName(f.name);
    if (!parsed || parsed.part !== 'json') return null;
    const updatedAt = Number(f.appProperties?.updatedAt);
    return {
      kind: parsed.kind,
      id: parsed.id,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
      deleted: f.appProperties?.deleted === '1'
    };
  }

  /** Drive file id for a name: from what we've seen, else by asking Drive. */
  async #find(name: string): Promise<string | null> {
    const known = this.#ids.get(name);
    if (known) return known;
    const q = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed = false`,
      orderBy: 'modifiedTime desc',
      fields: `files(${FILE_FIELDS})`
    });
    const { files } = await this.#json<{ files: DriveFile[] }>(`${API}/files?${q}`);
    if (!files.length) return null;
    this.#learn(files[0]);
    return files[0].id;
  }

  async #upload(name: string, content: string, mimeType: string, appProperties: Record<string, string>): Promise<void> {
    const existing = await this.#find(name);
    const meta = existing ? { appProperties } : { name, parents: ['appDataFolder'], appProperties, mimeType };
    const boundary = `piano-tutor-${crypto.randomUUID()}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const url = existing
      ? `${UPLOAD}/files/${existing}?uploadType=multipart&fields=${FILE_FIELDS}`
      : `${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`;
    const res = await this.#fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    if (res.status === 404 && existing) {
      // Removed by another device meanwhile: forget it and create a new one.
      this.#ids.delete(name);
      return this.#upload(name, content, mimeType, appProperties);
    }
    await ensureOk(res);
    this.#learn((await res.json()) as DriveFile);
  }

  async #remove(name: string): Promise<void> {
    const id = await this.#find(name);
    if (!id) return;
    const res = await this.#fetch(`${API}/files/${id}`, { method: 'DELETE' });
    // Keep id → name: the changes listing reports the removal by file id only.
    this.#ids.delete(name);
    if (res.status !== 404) await ensureOk(res);
  }

  async #json<T>(url: string, init: RequestInit = {}, allow404 = false): Promise<T> {
    const res = await this.#fetch(url, init);
    if (allow404 && res.status === 404) return null as T;
    await ensureOk(res);
    return (await res.json()) as T;
  }

  async #fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await this.fetchImpl(url, { ...init, headers });
    if (res.status === 401) throw new AuthRequiredError('Google sign-in expired.');
    return res;
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    /* not JSON */
  }
  throw new Error(`Google Drive error ${res.status}${detail ? `: ${detail}` : ''}`);
}
