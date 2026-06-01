/** A persisted background job. The lifecycle is queued → running → done | failed. */
export interface JobRecord {
  id: string;
  kind: string;
  /** Payload the job was started with. */
  payload: unknown;
  status: "queued" | "running" | "done" | "failed";
  /** User-supplied progress payload (set via `reportProgress`). */
  progress?: unknown;
  /** Result payload when `status === "done"`. */
  result?: unknown;
  /** Error message when `status === "failed"`. */
  error?: string;
  /** Epoch ms when the handler started executing. */
  startedAt?: number;
  /** Epoch ms when the handler resolved or rejected. */
  finishedAt?: number;
  /** Epoch ms at which the store may evict the record. */
  expiresAt?: number;
}

/** Driver-agnostic job storage. Wire memory / cache / SQL behind it. */
export interface JobStore {
  get(id: string): Promise<JobRecord | null>;
  set(id: string, record: JobRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Per-job context passed to the handler. */
export interface JobContext {
  jobId: string;
  /** Update the record's `progress` field. Safe to call concurrently with the handler's work. */
  reportProgress: (value: unknown) => Promise<void>;
  /** Fires when the request context is gone (Worker isolate teardown) or store TTL elapses. */
  signal: AbortSignal;
}

/** A handler for a named job kind. Returns the result; throw to mark failed. */
export type JobHandler = (payload: unknown, context: JobContext) => Promise<unknown> | unknown;

export type JobHandlers = Record<string, JobHandler>;
