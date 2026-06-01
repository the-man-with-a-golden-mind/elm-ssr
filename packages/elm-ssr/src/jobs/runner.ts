import type { EffectContext, EffectRunner } from "../effects";
import type { JobContext, JobHandlers, JobRecord, JobStore } from "./types";

export interface JobsConfig {
  /** Where to persist job records. Use `memoryJobStore()` in dev/tests, `cacheJobStore(redisCache(...))` in prod. */
  store: JobStore;
  /** Named job handlers. Each maps `kind` → async function returning the result. */
  handlers: JobHandlers;
  /** Default record TTL in seconds (default `60 * 60 * 24` = 24h). */
  defaultTtlSeconds?: number;
}

const DEFAULT_TTL = 60 * 60 * 24;

const generateJobId = (): string => crypto.randomUUID();

const runJob = (
  store: JobStore,
  handler: JobHandlers[string] | undefined,
  record: JobRecord,
  context: EffectContext
): Promise<void> =>
  Promise.resolve().then(async () => {
    if (!handler) {
      await store.set(record.id, {
        ...record,
        status: "failed",
        error: `No handler registered for kind "${record.kind}"`,
        finishedAt: Date.now()
      });
      return;
    }

    const aborter = new AbortController();
    // If the request's signal is still around (e.g. Bun fetch), wire it through;
    // otherwise the job runs to completion regardless.
    if (context.request) {
      const reqSignal = context.request.signal;
      if (reqSignal.aborted) {
        aborter.abort();
      } else {
        reqSignal.addEventListener("abort", () => aborter.abort(), { once: true });
      }
    }

    let progressVersion = 0;
    const jobContext: JobContext = {
      jobId: record.id,
      reportProgress: async (value) => {
        progressVersion += 1;
        const current = await store.get(record.id);
        if (!current) return;
        await store.set(record.id, { ...current, progress: value });
      },
      signal: aborter.signal
    };

    const startedAt = Date.now();
    await store.set(record.id, { ...record, status: "running", startedAt });

    try {
      const result = await handler(record.payload, jobContext);
      await store.set(record.id, {
        ...record,
        status: "done",
        startedAt,
        finishedAt: Date.now(),
        result
      });
    } catch (error) {
      console.error(`elm-ssr: job "${record.kind}" (${record.id}) failed`, error);
      await store.set(record.id, {
        ...record,
        status: "failed",
        startedAt,
        finishedAt: Date.now(),
        error: String(error instanceof Error ? error.message : error)
      });
    }

    // Mark "finished progress version" so concurrent reportProgress calls after completion are no-ops.
    void progressVersion;
  });

/**
 * Wraps an effect runner so `Loader.startJob` schedules a background job and
 * `Loader.jobStatus` reads its current record. Jobs run via `ctx.waitUntil`
 * on Cloudflare (isolate stays alive); locally (no waitUntil) they run
 * fire-and-forget. All other effects pass through unchanged.
 *
 * Use a durable `JobStore` (cacheJobStore over Redis/KV) in production —
 * `memoryJobStore` is process-local and lost on isolate restart.
 */
export const withJobs = (runner: EffectRunner, config: JobsConfig): EffectRunner => {
  const ttlSeconds = config.defaultTtlSeconds ?? DEFAULT_TTL;

  return async (effect, context) => {
    if (effect.kind === "startJob") {
      const kind = String(effect.payload.kind ?? "");
      if (!kind) {
        return { ok: false, error: 'startJob requires a non-empty "kind"' };
      }

      const id = generateJobId();
      const record: JobRecord = {
        id,
        kind,
        payload: effect.payload.payload ?? null,
        status: "queued",
        expiresAt: Date.now() + ttlSeconds * 1000
      };
      await config.store.set(id, record);

      const work = runJob(config.store, config.handlers[kind], record, context);
      if (typeof context.waitUntil === "function") {
        context.waitUntil(work);
      } else {
        void work.catch((error) => console.error("elm-ssr: job scheduling failed", error));
      }

      return { ok: true, value: id };
    }

    if (effect.kind === "jobStatus") {
      const id = String(effect.payload.jobId ?? "");
      if (!id) {
        return { ok: false, error: 'jobStatus requires a non-empty "jobId"' };
      }
      const record = await config.store.get(id);
      // Returning the raw record (or null for unknown id). Elm-side decoder
      // turns this into JobStatus a.
      return { ok: true, value: record };
    }

    return runner(effect, context);
  };
};
