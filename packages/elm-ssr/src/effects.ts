import { parse as parseCookieHeader } from "cookie";

export interface LoaderEffect {
  kind: string;
  payload: Record<string, unknown>;
}

export interface LoaderEffectResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Per-request context handed to the effect runner (e.g. Cloudflare bindings). */
export interface EffectContext {
  env?: Record<string, unknown>;
  request?: Request;
  /** Keeps the runtime alive for background work scheduled after the response. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Populated by `sessionMiddleware`; consumed by `sessionEffects`. */
  session?: import("./sessions/types").RequestSession;
  debugLogs?: Array<{
    kind: string;
    payload: Record<string, unknown>;
    ok: boolean;
    value?: unknown;
    error?: string;
    durationMs: number;
  }>;
}

/**
 * Runs a single side effect requested by an Elm loader or action. This is the
 * only place a loader's IO actually happens — the Elm side just describes what
 * it needs, with backend-neutral kinds (`cacheGet`, `query`, …) so the same app
 * runs on Cloudflare (KV/D1) or locally (Redis/SQLite) by swapping the adapter.
 */
export type EffectRunner = (effect: LoaderEffect, context: EffectContext) => Promise<LoaderEffectResult>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const normalizeEffect = (value: unknown): LoaderEffect => {
  if (isRecord(value) && typeof value.kind === "string") {
    return {
      kind: value.kind,
      payload: isRecord(value.payload) ? value.payload : {}
    };
  }

  return { kind: "unknown", payload: {} };
};

const cookieEffect = (effect: LoaderEffect, context: EffectContext): LoaderEffectResult => {
  const header = context.request?.headers.get("cookie") ?? "";
  const cookies = header ? parseCookieHeader(header) : {};
  const name = String(effect.payload.name);
  const value = cookies[name];
  return { ok: true, value: typeof value === "string" ? value : null };
};

const fetchJsonEffect = async (effect: LoaderEffect): Promise<LoaderEffectResult> => {
  const url = typeof effect.payload.url === "string" ? effect.payload.url : "";

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return { ok: false, error: `fetchJson received ${response.status} from ${url}` };
    }

    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, error: `fetchJson failed for ${url}: ${String(error)}` };
  }
};

/**
 * The fallback runner: `fetchJson` works everywhere, but backend effects report
 * that no adapter is configured rather than silently succeeding.
 */
export const defaultEffectRunner: EffectRunner = async (effect, context) => {
  if (effect.kind === "fetchJson") {
    return fetchJsonEffect(effect);
  }

  if (effect.kind === "cookie") {
    return cookieEffect(effect, context);
  }

  return {
    ok: false,
    error: `Effect "${effect.kind}" has no configured backend. Pass an adapter (cloudflareEffects or inMemoryEffects) as \`effects\`.`
  };
};

// Minimal shapes of the Cloudflare bindings we use, to avoid a types dependency.
interface KVNamespaceLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface D1ResultLike {
  results?: unknown[];
  meta?: { changes?: number };
}

interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all(): Promise<D1ResultLike>;
  first(): Promise<unknown>;
  run(): Promise<D1ResultLike>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

export interface CloudflareEffectsConfig {
  /** KV binding used for `cacheGet`/`cachePut`. Default `"CACHE"`. */
  cacheBinding?: string;
  /** D1 binding used for `query`/`queryOne`/`execute`. Default `"DB"`. */
  dbBinding?: string;
}

const sqlParams = (effect: LoaderEffect): unknown[] =>
  Array.isArray(effect.payload.params) ? effect.payload.params : [];

/** Cloudflare adapter: maps neutral effects to KV, D1, and env bindings. */
export const cloudflareEffects = (config: CloudflareEffectsConfig = {}): EffectRunner => {
  const cacheBinding = config.cacheBinding ?? "CACHE";
  const dbBinding = config.dbBinding ?? "DB";

  return async (effect, context) => {
    const env = context.env ?? {};

    switch (effect.kind) {
      case "fetchJson":
        return fetchJsonEffect(effect);

      case "cacheGet": {
        const kv = env[cacheBinding] as KVNamespaceLike | undefined;
        if (!kv) {
          return { ok: false, error: `Missing KV binding "${cacheBinding}"` };
        }
        const value = await kv.get(String(effect.payload.key), "json");
        return { ok: true, value: value ?? null };
      }

      case "cachePut": {
        const kv = env[cacheBinding] as KVNamespaceLike | undefined;
        if (!kv) {
          return { ok: false, error: `Missing KV binding "${cacheBinding}"` };
        }
        const ttl = typeof effect.payload.ttlSeconds === "number" ? { expirationTtl: effect.payload.ttlSeconds } : undefined;
        await kv.put(String(effect.payload.key), JSON.stringify(effect.payload.value ?? null), ttl);
        return { ok: true, value: null };
      }

      case "query":
      case "queryOne":
      case "execute": {
        const db = env[dbBinding] as D1DatabaseLike | undefined;
        if (!db) {
          return { ok: false, error: `Missing D1 binding "${dbBinding}"` };
        }
        const statement = db.prepare(String(effect.payload.sql)).bind(...sqlParams(effect));
        if (effect.kind === "query") {
          const result = await statement.all();
          return { ok: true, value: result.results ?? [] };
        }
        if (effect.kind === "queryOne") {
          const row = await statement.first();
          return { ok: true, value: row ?? null };
        }
        const result = await statement.run();
        return { ok: true, value: { rowsAffected: result.meta?.changes ?? 0 } };
      }

      case "transaction": {
        const db = env[dbBinding] as D1DatabaseLike | undefined;
        if (!db) {
          return { ok: false, error: `Missing D1 binding "${dbBinding}"` };
        }
        const stmts = (effect.payload.statements as Array<{ sql: unknown; params: unknown[] }>)
          .map(s => db.prepare(String(s.sql)).bind(...(Array.isArray(s.params) ? s.params : [])));
        const results = await db.batch(stmts);
        const rowsAffected = (results as Array<{ meta?: { changes?: number } }>)
          .reduce((acc, r) => acc + (r.meta?.changes ?? 0), 0);
        return { ok: true, value: { rowsAffected } };
      }

      case "softExecute":
      case "softQueryOne": {
        const db = env[dbBinding] as D1DatabaseLike | undefined;
        if (!db) {
          return { ok: false, error: `Missing D1 binding "${dbBinding}"` };
        }
        const statement = db.prepare(String(effect.payload.sql)).bind(...sqlParams(effect));
        try {
          if (effect.kind === "softQueryOne") {
            const row = await statement.first();
            return { ok: true, value: row ?? null };
          }
          const result = await statement.run();
          return { ok: true, value: { rowsAffected: result.meta?.changes ?? 0 } };
        } catch (error) {
          const parsed = parseConstraintError(String(error));
          if (parsed) return { ok: true, value: { constraintError: parsed } };
          return { ok: false, error: String(error) };
        }
      }

      case "env": {
        const value = env[String(effect.payload.name)];
        return { ok: true, value: typeof value === "string" ? value : null };
      }

      case "cookie":
        return cookieEffect(effect, context);

      default:
        return { ok: false, error: `Unknown effect: ${effect.kind}` };
    }
  };
};

export interface SqlQuery {
  sql: string;
  params: unknown[];
  mode: "all" | "first" | "run";
}

function parseConstraintError(msg: string): { kind: string; field: string | null } | null {
  // SQLite: "SQLITE_CONSTRAINT: UNIQUE constraint failed: table.column"
  const sqliteUnique = msg.match(/UNIQUE constraint failed: \w+\.(\w+)/i);
  if (sqliteUnique) return { kind: "unique", field: sqliteUnique[1] };

  const sqliteNotNull = msg.match(/NOT NULL constraint failed: \w+\.(\w+)/i);
  if (sqliteNotNull) return { kind: "notNull", field: sqliteNotNull[1] };

  if (/FOREIGN KEY constraint failed/i.test(msg)) return { kind: "foreignKey", field: null };
  if (/CHECK constraint failed/i.test(msg)) return { kind: "check", field: null };

  // PostgreSQL: "duplicate key value violates unique constraint …  Key (col)=(val) already exists"
  if (/duplicate key value violates unique constraint/i.test(msg)) {
    const f = msg.match(/Key \((\w+)\)=/);
    return { kind: "unique", field: f?.[1] ?? null };
  }

  // PostgreSQL: 'null value in column "col" of relation …'
  const pgNotNull = msg.match(/null value in column ["`]?(\w+)["`]?/i);
  if (pgNotNull) return { kind: "notNull", field: pgNotNull[1] };

  if (/violates foreign key constraint/i.test(msg)) return { kind: "foreignKey", field: null };
  if (/violates check constraint/i.test(msg)) return { kind: "check", field: null };

  return null;
}

export interface InMemoryEffectsOptions {
  /** Values returned by the `env` effect. */
  env?: Record<string, string>;
  /** Backing store for the cache; pass one in to share/inspect it. */
  cache?: Map<string, { value: unknown; expiresAt?: number }>;
  /** SQL backend, e.g. a bun:sqlite or Postgres handler. Required for query/execute. */
  sql?: (query: SqlQuery) => unknown | Promise<unknown>;
  /**
   * Atomic multi-statement SQL transaction handler. Required for `Loader.transaction`.
   * Receives an ordered list of `{ sql, params }` statements; must execute all of them
   * inside a single BEGIN/COMMIT block and roll back on any failure.
   * Returns `{ rowsAffected: number }` — the total rows changed across all statements.
   *
   * Example with bun:sqlite:
   *   sqlTransaction: (stmts) => {
   *     const txn = db.transaction(() => {
   *       let rows = 0;
   *       for (const s of stmts) rows += db.query(s.sql).run(...s.params).changes;
   *       return { rowsAffected: rows };
   *     });
   *     return txn();
   *   }
   *
   * Example with Bun.sql (PostgreSQL):
   *   sqlTransaction: async (stmts) => {
   *     let rows = 0;
   *     await pgSql.begin(async tx => {
   *       for (const s of stmts) { await tx.unsafe(s.sql, s.params); rows++; }
   *     });
   *     return { rowsAffected: rows };
   *   }
   */
  sqlTransaction?: (statements: Array<{ sql: string; params: unknown[] }>) => Promise<{ rowsAffected: number }>;
  /** Override `fetchJson` (e.g. fixtures in tests); defaults to a real fetch. */
  fetchJson?: (url: string) => unknown | Promise<unknown>;
  now?: () => number;
}

/** Local/test adapter: in-memory cache + env, with a pluggable SQL backend. */
export const inMemoryEffects = (options: InMemoryEffectsOptions = {}): EffectRunner => {
  const cache = options.cache ?? new Map<string, { value: unknown; expiresAt?: number }>();
  const env = options.env ?? {};
  const now = options.now ?? (() => Date.now());

  return async (effect, context) => {
    switch (effect.kind) {
      case "fetchJson": {
        if (options.fetchJson) {
          try {
            return { ok: true, value: await options.fetchJson(String(effect.payload.url)) };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        }
        return fetchJsonEffect(effect);
      }

      case "cacheGet": {
        const entry = cache.get(String(effect.payload.key));
        if (!entry) {
          return { ok: true, value: null };
        }
        if (entry.expiresAt !== undefined && entry.expiresAt <= now()) {
          cache.delete(String(effect.payload.key));
          return { ok: true, value: null };
        }
        return { ok: true, value: entry.value };
      }

      case "cachePut": {
        const ttl = typeof effect.payload.ttlSeconds === "number" ? effect.payload.ttlSeconds : undefined;
        cache.set(String(effect.payload.key), {
          value: effect.payload.value ?? null,
          expiresAt: ttl !== undefined ? now() + ttl * 1000 : undefined
        });
        return { ok: true, value: null };
      }

      case "query":
      case "queryOne":
      case "execute": {
        if (!options.sql) {
          return { ok: false, error: 'The "sql" handler is not configured in inMemoryEffects.' };
        }
        const mode = effect.kind === "query" ? "all" : effect.kind === "queryOne" ? "first" : "run";
        try {
          const value = await options.sql({ sql: String(effect.payload.sql), params: sqlParams(effect), mode });
          return { ok: true, value };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      }

      case "transaction": {
        if (!options.sqlTransaction) {
          return { ok: false, error: 'The "sqlTransaction" handler is not configured in inMemoryEffects.' };
        }
        const stmts = (effect.payload.statements as Array<{ sql: unknown; params: unknown[] }>).map(s => ({
          sql: String(s.sql),
          params: Array.isArray(s.params) ? s.params : []
        }));
        try {
          const result = await options.sqlTransaction(stmts);
          return { ok: true, value: result };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      }

      case "softExecute":
      case "softQueryOne": {
        if (!options.sql) {
          return { ok: false, error: 'The "sql" handler is not configured in inMemoryEffects.' };
        }
        const mode = effect.kind === "softQueryOne" ? "first" : "run";
        try {
          const value = await options.sql({ sql: String(effect.payload.sql), params: sqlParams(effect), mode });
          return { ok: true, value };
        } catch (error) {
          const parsed = parseConstraintError(String(error));
          if (parsed) return { ok: true, value: { constraintError: parsed } };
          return { ok: false, error: String(error) };
        }
      }

      case "env": {
        const value = env[String(effect.payload.name)];
        return { ok: true, value: typeof value === "string" ? value : null };
      }

      default:
        return defaultEffectRunner(effect, context);
    }
  };
};
