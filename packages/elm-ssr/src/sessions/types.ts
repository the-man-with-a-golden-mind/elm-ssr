/** Persisted session record. The `data` payload is whatever the app stores. */
export interface SessionRecord {
  /** Application payload — anything JSON-serialisable. */
  data: unknown;
  /** Per-session CSRF token (rotated when the session is destroyed/created). */
  csrf: string;
  /** Epoch milliseconds at which this session should be considered expired. */
  expiresAt?: number;
}

/** Driver-agnostic session storage. Wire memory / cache / SQL behind it. */
export interface SessionStore {
  get(id: string): Promise<SessionRecord | null>;
  set(id: string, record: SessionRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** The live session attached to the per-request context. Mutated by effects. */
export interface RequestSession {
  /** Opaque session id. Round-trips through the signed cookie. */
  id: string;
  /** Whatever the app stored in this session (null until first set). */
  data: unknown;
  /** Current CSRF token. Rotated on `destroyed`. */
  csrf: string;
  /** Set to `true` by `setSession` so the middleware persists + rolls cookie. */
  dirty: boolean;
  /** Set to `true` by `clearSession` so the middleware deletes + clears cookie. */
  destroyed: boolean;
  /** Marks freshly-minted sessions so the middleware writes them even if untouched. */
  isNew: boolean;
}
