# jobs (AI)

**Subpath:** `elm-ssr/jobs`. **Effect kinds:** `startJob`, `jobStatus`.
**Elm:** `Loader.startJob`, `Loader.jobStatus`, `JobStatus a`.

Long-running background work. Submit → get `JobId`. Poll status (or push
via your own SSE recipe). Handler runs via `ctx.waitUntil` on CF,
fire-and-forget on Bun.

## Exports

```ts
interface JobRecord {
  id: string;
  kind: string;
  payload: unknown;
  status: "queued" | "running" | "done" | "failed";
  progress?: unknown;
  result?: unknown;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  expiresAt?: number;
}

interface JobStore { get(id): Promise<JobRecord | null>; set(id, r): Promise<void>; delete(id): Promise<void>; }

interface JobContext {
  jobId: string;
  reportProgress: (value: unknown) => Promise<void>;
  signal: AbortSignal;       // fires when request context is gone
}

type JobHandler = (payload: unknown, ctx: JobContext) => Promise<unknown> | unknown;
type JobHandlers = Record<string, JobHandler>;

interface JobsConfig {
  store: JobStore;
  handlers: JobHandlers;
  defaultTtlSeconds?: number;   // default 86400 (24h)
}

memoryJobStore(initial?: Map<string, JobRecord>): JobStore;
cacheJobStore(backend: CacheBackend, options?: { keyPrefix?: string; defaultTtlSeconds?: number }): JobStore;

withJobs(runner: EffectRunner, config: JobsConfig): EffectRunner;
```

## Elm side

```elm
type alias JobId = String

type JobStatus a
    = JobQueued
    | JobRunning { progress : Maybe Json.Decode.Value }
    | JobDone a
    | JobFailed { reason : String }
    | JobMissing

startJob : { kind : String, payload : Json.Encode.Value } -> Loader JobId
jobStatus : { jobId : JobId, decoder : Decoder a } -> Loader (JobStatus a)
```

## Minimal example

```ts
// TS: wire jobs into the runner
import { withJobs, memoryJobStore } from "elm-ssr/jobs";

const effects = withJobs(baseEffects, {
  store: memoryJobStore(),
  handlers: {
    generateReport: async (payload, ctx) => {
      const phases = ["fetch", "group", "render"];
      for (let i = 0; i < phases.length; i++) {
        if (ctx.signal.aborted) throw new Error("aborted");
        await new Promise((r) => setTimeout(r, 400));
        await ctx.reportProgress({ phase: phases[i], step: i + 1, of: phases.length });
      }
      return { month: (payload as { month: string }).month, rows: [/* ... */] };
    },
  },
});
```

```elm
-- Elm: submit (PRG) + poll
action request =
    Action.fromLoader (Loader.startJob { kind = "generateReport", payload = Encode.object [ ( "month", Encode.string "2026-05" ) ] })
        |> Action.andThen (\id -> Action.redirect ("/reports?id=" ++ id))


page request =
    case Route.query "id" request of
        Just id -> Loader.map render (Loader.jobStatus { jobId = id, decoder = reportDecoder })
        Nothing -> Loader.succeed submitForm


render : Loader.JobStatus Report -> Document Never
render status =
    case status of
        JobQueued -> ...
        JobRunning { progress } -> ...
        JobDone report -> ...
        JobFailed { reason } -> ...
        JobMissing -> ...
```

## Patterns

- PRG submit → `Action.fromLoader (Loader.startJob ...)` + `andThen (\id -> Action.redirect ("/jobs?id=" ++ id))`.
- Auto-refresh polling: render `<meta http-equiv="refresh" content="2">` while `JobQueued`/`JobRunning`; remove on `JobDone`.
- Stream status via SSE: combine `createSseStream` + `store.get(id)` in a loop — recipe-level, not framework-provided.
- Production store: `cacheJobStore(redisCache(redis))` (or KV). Dev: `memoryJobStore()`.
- Cancellation: read `ctx.signal.aborted` between expensive steps. Throw to mark failed.

## Footguns

- Handler **throws** → record marked failed with the message; loader still sees `JobDone`-or-the-status (not a Loader error). The Elm side gets `JobFailed { reason }`.
- Unknown `kind` → record immediately failed with `No handler registered for kind "<kind>"`. Easy to forget when adding new handlers.
- `memoryJobStore` is per-process — DOESN'T survive isolate restarts AND isn't shared across CF isolates. Use `cacheJobStore` in prod.
- Without `ctx.waitUntil` (Bun, tests), job is fire-and-forget — process must stay alive long enough.
- TTL elapses before client polls → `JobMissing`. Bump `defaultTtlSeconds` if your UI can keep tabs open longer than 24h.
- In-flight execution itself can still be lost on CF isolate rotation. Durable RUN (not just storage) needs queue-backed handlers — not in framework yet.
- `Loader.jobStatus` decoder runs against the handler's RESULT (only when `JobDone`). For `JobRunning.progress` you get raw `Maybe Value` — decode separately.
