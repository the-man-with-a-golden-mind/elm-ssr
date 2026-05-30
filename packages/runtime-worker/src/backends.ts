import type { EffectRunner, SqlQuery } from "./effects";

// === Cache (KV / Redis / …) ===

/**
 * A driver-agnostic cache backend. Stores arbitrary JSON-serialisable values
 * with an optional TTL in seconds. Returns `null` on a miss.
 */
export interface CacheBackend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
}

/**
 * Wrap an effect runner so `cacheGet`/`cachePut` are served by `backend`. All
 * other effects pass through to the wrapped runner unchanged. Compose with
 * `withTasks`, `withQueueProducer`, etc.:
 *
 *     withTasks(
 *       withCache(inMemoryEffects({ sql: postgresSql(pg) }), redisCache(redis)),
 *       { sendEmail }
 *     )
 */
export const withCache = (runner: EffectRunner, backend: CacheBackend): EffectRunner =>
  async (effect, context) => {
    if (effect.kind === "cacheGet") {
      const value = await backend.get(String(effect.payload.key));
      return { ok: true, value: value ?? null };
    }

    if (effect.kind === "cachePut") {
      const ttl = typeof effect.payload.ttlSeconds === "number" ? effect.payload.ttlSeconds : undefined;
      await backend.put(String(effect.payload.key), effect.payload.value ?? null, ttl);
      return { ok: true, value: null };
    }

    return runner(effect, context);
  };

/**
 * Minimal Redis-like client interface — values are strings; the adapter handles
 * JSON encoding/decoding. Wire any matching client:
 *
 *     // Bun built-in:
 *     redisCache({
 *       get: (k) => Bun.redis.get(k),
 *       set: (k, v, ttl) => ttl !== undefined ? Bun.redis.set(k, v, "EX", ttl) : Bun.redis.set(k, v)
 *     })
 *
 *     // ioredis:
 *     redisCache({
 *       get: (k) => ioredis.get(k),
 *       set: (k, v, ttl) => ttl !== undefined ? ioredis.set(k, v, "EX", ttl) : ioredis.set(k, v)
 *     })
 */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
}

/** A `CacheBackend` backed by a Redis-like client. JSON-encodes values on store. */
export const redisCache = (client: CacheClient): CacheBackend => ({
  get: async (key) => {
    const raw = await client.get(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  },
  put: async (key, value, ttlSeconds) => {
    await client.set(key, JSON.stringify(value), ttlSeconds);
  }
});

// === SQL (D1 / Postgres / SQLite / …) ===

/**
 * Minimal SQL client interface. Wire any driver:
 *
 *     // Bun built-in (Bun.sql):
 *     postgresSql({
 *       run: async (q, p) => {
 *         const rows = await Bun.sql.unsafe(q, p);
 *         return { rows: [...rows], rowCount: (rows as { count?: number }).count ?? rows.length };
 *       }
 *     })
 *
 *     // node-postgres:
 *     postgresSql({
 *       run: (q, p) => pool.query(q, p).then((r) => ({ rows: r.rows, rowCount: r.rowCount ?? 0 }))
 *     })
 */
export interface SqlClient {
  run(sql: string, params: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
}

/**
 * A SqlQuery handler (use as `inMemoryEffects({ sql: postgresSql(client) })`)
 * backed by any client matching `SqlClient`. Maps `query`/`queryOne`/`execute`
 * to the client's single `run` method.
 */
export const postgresSql = (client: SqlClient) =>
  async ({ sql, params, mode }: SqlQuery): Promise<unknown> => {
    const { rows, rowCount } = await client.run(sql, params);
    if (mode === "first") {
      return rows[0] ?? null;
    }
    if (mode === "run") {
      return { rowsAffected: rowCount };
    }
    return rows;
  };
