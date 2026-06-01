import type { CacheBackend } from "../backends";
import type { JobRecord, JobStore } from "./types";

/** In-memory job store. Useful for dev/tests; lost on process restart. */
export const memoryJobStore = (initial?: Map<string, JobRecord>): JobStore => {
  const store = initial ?? new Map<string, JobRecord>();
  return {
    get: async (id) => {
      const record = store.get(id);
      if (!record) return null;
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

export interface CacheJobStoreOptions {
  /** Cache-key prefix (default `"elm-ssr:job:"`). */
  keyPrefix?: string;
  /** Default TTL in seconds when the record has no `expiresAt`. */
  defaultTtlSeconds?: number;
}

/**
 * Job store backed by an existing `CacheBackend` — wire it on
 * `redisCache(...)`, a KV-backed cache, or anything matching the interface.
 * Records are namespaced via the key prefix to avoid colliding with your
 * other cache uses.
 */
export const cacheJobStore = (backend: CacheBackend, options: CacheJobStoreOptions = {}): JobStore => {
  const prefix = options.keyPrefix ?? "elm-ssr:job:";
  const defaultTtl = options.defaultTtlSeconds;

  return {
    get: async (id) => {
      const value = await backend.get(prefix + id);
      return (value ?? null) as JobRecord | null;
    },
    set: async (id, record) => {
      const ttl =
        record.expiresAt !== undefined
          ? Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000))
          : defaultTtl;
      await backend.put(prefix + id, record, ttl);
    },
    delete: async (id) => {
      // CacheBackend has no delete; tombstone with TTL=1s.
      await backend.put(prefix + id, null, 1);
    }
  };
};
