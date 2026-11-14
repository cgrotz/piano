/**
 * In-memory implementations of both sync ports — for tests, and a reference
 * for what a real provider has to do.
 */
import type { AnyRecord, Entry, LocalStore, RecordKind, RecordOf, RemoteRef, SyncProvider } from './types';

const clone = <T>(v: T): T => structuredClone(v);
const key = (kind: RecordKind, id: string) => `${kind}/${id}`;

export class MemoryProvider implements SyncProvider {
  records = new Map<string, Entry>();
  #log: RemoteRef[] = [];
  /** Number of `get` calls, to check that unchanged records aren't downloaded. */
  gets = 0;

  async listChanges(cursor: string | null) {
    if (cursor === null) {
      const changes = [...this.records.values()].map(({ kind, record }) => ref(kind, record));
      return { changes, cursor: String(this.#log.length) };
    }
    return { changes: this.#log.slice(Number(cursor)), cursor: String(this.#log.length) };
  }

  async get<K extends RecordKind>(kind: K, id: string): Promise<RecordOf[K] | null> {
    this.gets++;
    const e = this.records.get(key(kind, id));
    return e ? (clone(e.record) as RecordOf[K]) : null;
  }

  async put(entry: Entry) {
    this.records.set(key(entry.kind, entry.record.id), clone(entry));
    this.#log.push(ref(entry.kind, entry.record));
  }

  async delete(kind: RecordKind, id: string) {
    if (!this.records.delete(key(kind, id))) return;
    this.#log.push({ kind, id, removed: true });
  }
}

function ref(kind: RecordKind, record: AnyRecord): RemoteRef {
  return { kind, id: record.id, updatedAt: record.updatedAt, deleted: !!record.deleted };
}

export class MemoryLocalStore implements LocalStore {
  records = new Map<string, Entry>();
  outbox = new Map<string, { kind: RecordKind; id: string; updatedAt: number }>();
  meta = new Map<string, string>();

  /** A change made by the app on this device. */
  async edit(entry: Entry) {
    await this.put(entry, { dirty: true });
  }

  async get<K extends RecordKind>(kind: K, id: string): Promise<RecordOf[K] | undefined> {
    const e = this.records.get(key(kind, id));
    return e ? (clone(e.record) as RecordOf[K]) : undefined;
  }

  async all(kind: RecordKind) {
    return [...this.records.values()].filter((e) => e.kind === kind).map((e) => clone(e.record));
  }

  async put(entry: Entry, { dirty, expected }: { dirty: boolean; expected?: number | null }) {
    const k = key(entry.kind, entry.record.id);
    if (expected !== undefined && (this.records.get(k)?.record.updatedAt ?? null) !== expected) return;
    this.records.set(k, clone(entry));
    if (dirty) this.outbox.set(k, { kind: entry.kind, id: entry.record.id, updatedAt: entry.record.updatedAt });
  }

  async remove(kind: RecordKind, id: string) {
    this.records.delete(key(kind, id));
    this.outbox.delete(key(kind, id));
  }

  async dirty() {
    return [...this.outbox.values()];
  }

  async clearDirty(kind: RecordKind, id: string, updatedAt: number) {
    if (this.outbox.get(key(kind, id))?.updatedAt === updatedAt) this.outbox.delete(key(kind, id));
  }

  async getMeta(k: string) {
    return this.meta.get(k);
  }

  async setMeta(k: string, value: string | undefined) {
    if (value === undefined) this.meta.delete(k);
    else this.meta.set(k, value);
  }
}
