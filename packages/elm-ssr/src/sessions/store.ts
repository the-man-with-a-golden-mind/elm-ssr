import type { CacheBackend } from "../backends";
import type { SessionRecord, SessionStore } from "./types";

/** In-memory session store. Survives only as long as the process. */
export const memorySessionStore = (initial?: Map<string, SessionRecord>): SessionStore & { store: Map<string, SessionRecord> } => {
  const store = initial ?? new Map<string, SessionRecord>();
  return {
    store,
    get: async (id) => {
      const record = store.get(id);
      if (!record) {
        return null;
      }
      if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
        store.delete(id);
        return null;
      }
      return record;
    },
    set: async (id, record) => {
      store.set(id, record);
    },
    delete: async (id) => {
      store.delete(id);
    }
  };
};

export interface CacheStoreOptions {
  /** Cache-key prefix (default `"elm-ssr:session:"`). */
  keyPrefix?: string;
  /** Default TTL in seconds when the record itself has no `expiresAt`. */
  defaultTtlSeconds?: number;
}

/**
 * Session store backed by an existing `CacheBackend` — wire any of
 * `redisCache(...)`, a KV-backed cache, etc. Sessions become invisible to the
 * cache's other uses via the key prefix.
 */
export const cacheStore = (backend: CacheBackend, options: CacheStoreOptions = {}): SessionStore => {
  const prefix = options.keyPrefix ?? "elm-ssr:session:";
  const defaultTtl = options.defaultTtlSeconds;

  return {
    get: async (id) => {
      const value = await backend.get(prefix + id);
      return (value ?? null) as SessionRecord | null;
    },
    set: async (id, record) => {
      const ttl =
        record.expiresAt !== undefined ? Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000)) : defaultTtl;
      await backend.put(prefix + id, record, ttl);
    },
    delete: async (id) => {
      // CacheBackend has no delete; overwrite with a tombstone that expires immediately.
      // For real deletes use a backend that exposes one (see `redisCache` + ad-hoc DEL).
      await backend.put(prefix + id, null, 1);
    }
  };
};
