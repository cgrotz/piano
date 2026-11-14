/**
 * Sync engine (COMPOSER.md §7): mirrors local records to a `SyncProvider`.
 *
 * One `sync()` run:
 *  1. pull — ask the provider what changed since the stored cursor, merge each
 *     changed record into local storage (see merge.ts), and queue a push
 *     wherever the merge kept something the remote copy doesn't have;
 *  2. push — upload every queued (dirty) record;
 *  3. purge — drop tombstones old enough that every device has seen them.
 *
 * The very first run (no cursor) lists everything remote and also queues every
 * local record the remote side doesn't have, which is how an existing library
 * gets uploaded. Pure logic over two ports; scheduling lives in sync.svelte.ts.
 */
import { mergeRecords, sameRecord } from './merge';
import type { LocalStore, RecordKind, RemoteRef, SyncProvider } from './types';
import { RECORD_KINDS } from './types';

export const CURSOR_KEY = 'sync:cursor';
/** Tombstones older than this are removed everywhere. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface SyncResult {
  pulled: number;
  pushed: number;
  /** Kinds whose local records changed (the UI reloads these). */
  changed: Set<RecordKind>;
}

export class SyncEngine {
  #running: Promise<SyncResult> | null = null;

  constructor(
    private local: LocalStore,
    private remote: SyncProvider,
    private now: () => number = Date.now
  ) {}

  /** Run one sync. Concurrent calls share the run in progress. */
  sync(): Promise<SyncResult> {
    this.#running ??= this.#run().finally(() => (this.#running = null));
    return this.#running;
  }

  /** Forget the cursor (e.g. on sign-out) so the next sync is a full one. */
  reset(): Promise<void> {
    return this.local.setMeta(CURSOR_KEY, undefined);
  }

  async #run(): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, changed: new Set() };
    const cursor = (await this.local.getMeta(CURSOR_KEY)) ?? null;
    const { changes, cursor: next } = await this.remote.listChanges(cursor);

    const seen = new Set<string>();
    for (const ref of latestPerRecord(changes)) {
      seen.add(key(ref.kind, ref.id));
      if (await this.#pullOne(ref)) {
        result.pulled++;
        result.changed.add(ref.kind);
      }
    }

    if (cursor === null) {
      // First sync with this remote: everything local it doesn't know about goes up.
      for (const kind of RECORD_KINDS) {
        for (const record of await this.local.all(kind)) {
          if (!seen.has(key(kind, record.id))) {
            await this.local.put({ kind, record }, { dirty: true, expected: record.updatedAt });
          }
        }
      }
    }
    // Only advance once every change is safely stored locally.
    await this.local.setMeta(CURSOR_KEY, next);

    result.pushed = await this.#push();
    await this.#purge(result);
    return result;
  }

  /** Bring one remotely changed record in. True if the local copy changed. */
  async #pullOne(ref: RemoteRef): Promise<boolean> {
    const local = await this.local.get(ref.kind, ref.id);
    if (ref.removed) {
      // Purged remotely. A local tombstone can go too; a live local copy is
      // pushed again (someone edited it while it was being purged).
      if (!local) return false;
      if (local.deleted) {
        await this.local.remove(ref.kind, ref.id);
        return true;
      }
      await this.local.put({ kind: ref.kind, record: local }, { dirty: true, expected: local.updatedAt });
      return false;
    }
    // Already have exactly this version (typically our own push coming back).
    if (local && ref.updatedAt !== undefined && local.updatedAt === ref.updatedAt && !!local.deleted === !!ref.deleted) {
      return false;
    }
    // Whole-record kinds: a newer local copy wins without downloading the remote one.
    const wholeRecord = ref.kind === 'scores' || ref.kind === 'arrangements';
    if (wholeRecord && local && ref.updatedAt !== undefined && local.updatedAt > ref.updatedAt) {
      await this.local.put({ kind: ref.kind, record: local }, { dirty: true, expected: local.updatedAt });
      return false;
    }
    const remote = await this.remote.get(ref.kind, ref.id);
    if (!remote) return false;
    let merged = mergeRecords(ref.kind, local, remote)!;
    const remoteBehind = !sameRecord(merged, remote);
    if (remoteBehind && merged.updatedAt <= remote.updatedAt) {
      // A field/max merge produced a new version: give it a new stamp, or a
      // device holding a copy with the same updatedAt would take it as seen.
      merged = { ...merged, updatedAt: remote.updatedAt + 1 };
    }
    const localChanged = !sameRecord(merged, local);
    if (localChanged || remoteBehind) {
      await this.local.put(
        { kind: ref.kind, record: merged },
        { dirty: remoteBehind, expected: local?.updatedAt ?? null }
      );
    }
    return localChanged;
  }

  async #push(): Promise<number> {
    let pushed = 0;
    for (const { kind, id, updatedAt } of await this.local.dirty()) {
      const record = await this.local.get(kind, id);
      if (!record) {
        await this.local.clearDirty(kind, id, updatedAt);
        continue;
      }
      await this.remote.put({ kind, record });
      // If it changed again meanwhile, the newer updatedAt keeps it queued.
      await this.local.clearDirty(kind, id, record.updatedAt);
      pushed++;
    }
    return pushed;
  }

  async #purge(result: SyncResult): Promise<void> {
    const cutoff = this.now() - TOMBSTONE_TTL_MS;
    const pending = new Set((await this.local.dirty()).map((d) => key(d.kind, d.id)));
    for (const kind of RECORD_KINDS) {
      for (const record of await this.local.all(kind)) {
        if (!record.deleted || record.updatedAt > cutoff || pending.has(key(kind, record.id))) continue;
        await this.remote.delete(kind, record.id);
        await this.local.remove(kind, record.id);
        result.changed.add(kind);
      }
    }
  }
}

function key(kind: RecordKind, id: string): string {
  return `${kind}/${id}`;
}

/** A listing can mention a record more than once; the last mention is current. */
function latestPerRecord(changes: RemoteRef[]): RemoteRef[] {
  const byKey = new Map<string, RemoteRef>();
  for (const c of changes) byKey.set(key(c.kind, c.id), c);
  return [...byKey.values()];
}
