# Background jobs

Long-running work that doesn't fit in a single request: report generation,
big SQL aggregations, heavy compute, external API calls that take seconds.
Submit a job from a route, get an id back immediately, poll the status
from a follow-up page (or stream it via SSE).

Two pieces, both opt-in:

- **`elm-ssr/jobs`** (TS) — `withJobs(runner, { store, handlers })`
  adapter, `memoryJobStore()` / `cacheJobStore(backend)`, the `JobStore`
  interface for plugging anything else.
- **`Loader.startJob` / `Loader.jobStatus`** (Elm) — the submit + poll
  primitives, plus the `JobStatus a` ADT (`JobQueued | JobRunning … |
  JobDone a | JobFailed … | JobMissing`).

## Quickstart

```ts
import { createWorkerApp } from "elm-ssr";
import { withJobs, memoryJobStore, cacheJobStore } from "elm-ssr/jobs";
import { redisCache } from "elm-ssr/backends";

const effects = withJobs(baseEffects, {
  store: cacheJobStore(redisCache(redis)),
  handlers: {
    generateReport: async (payload, ctx) => {
      const month = (payload as { month: string }).month;
      await ctx.reportProgress({ phase: "fetching" });
      const rows = await pg.unsafe("SELECT … WHERE month = $1", [month]);
      await ctx.reportProgress({ phase: "rendering" });
      return { month, rows };
    }
  },
  defaultTtlSeconds: 60 * 60 * 24
});

const worker = createWorkerApp({ /* … */, effects });
```

```elm
import ElmSsr.Loader as Loader exposing (Loader)


action : Request -> Action (Document Never)
action request =
    Action.fromLoader
        (Loader.startJob
            { kind = "generateReport"
            , payload = Encode.object [ ( "month", Encode.string "2026-05" ) ]
            }
        )
        |> Action.andThen (\id -> Action.redirect ("/reports?id=" ++ id))


page : Request -> Loader (Document Never)
page request =
    case Route.query "id" request of
        Just id ->
            Loader.map render
                (Loader.jobStatus { jobId = id, decoder = reportDecoder })

        Nothing ->
            Loader.succeed submitForm
```

## How it works

1. **Submit.** `Loader.startJob { kind, payload }` emits a `startJob`
   effect. `withJobs` generates an id (UUID v4), persists a `queued`
   record, and schedules the handler via `ctx.waitUntil` when the host provides
   it, or fire-and-forget otherwise. The effect returns the id synchronously to the
   loader.
2. **Execute.** The handler runs in the background. It receives
   `(payload, { jobId, reportProgress, signal })`. The store transitions
   the record from `queued` → `running` → `done | failed` over its
   lifetime.
3. **Poll.** `Loader.jobStatus { jobId, decoder }` reads the record from
   the store and returns a typed `JobStatus a`. `JobMissing` is returned
   for unknown ids (TTL expired, never existed).

## JobStatus on the Elm side

```elm
type JobStatus a
    = JobQueued
    | JobRunning { progress : Maybe Json.Decode.Value }
    | JobDone a
    | JobFailed { reason : String }
    | JobMissing


view : JobStatus Report -> Html msg
view status =
    case status of
        JobQueued ->
            text "Waiting for a worker…"

        JobRunning { progress } ->
            text (progressDescription progress)

        JobDone report ->
            reportView report

        JobFailed { reason } ->
            text ("Failed: " ++ reason)

        JobMissing ->
            text "Unknown job (expired or never existed)"
```

`progress` is `Json.Decode.Value` — your handler decides the shape;
decode it however suits the UI (a percentage, a phase name, last-touched
record id, whatever).

## Stores

The `JobStore` interface is the same shape as `SessionStore`:

```ts
interface JobStore {
  get(id: string): Promise<JobRecord | null>;
  set(id: string, record: JobRecord): Promise<void>;
  delete(id: string): Promise<void>;
}
```

Two ship out of the box:

- **`memoryJobStore()`** — `Map`-backed. Useful for tests + local dev.
  Lost on process restart, not shared across isolates.
- **`cacheJobStore(backend, options?)`** — wraps any
  [`CacheBackend`](backends.md) (so `redisCache(...)`, KV-backed wrapper,
  …). Records are prefix-scoped (default `"elm-ssr:job:"`) and respect
  `expiresAt` via the cache's TTL.

For SQL-backed (Postgres / D1) durability, implement `JobStore` against
your driver — three async functions.

## Handler contract

```ts
type JobHandler = (payload: unknown, context: JobContext) => Promise<unknown>;

interface JobContext {
  jobId: string;
  reportProgress: (value: unknown) => Promise<void>;
  signal: AbortSignal;
}
```

- **Return** a JSON-serialisable value — it lands in `record.result` and
  flows back through your Elm decoder.
- **Throw** to mark the job failed; the error message lands in
  `record.error`. The framework logs `elm-ssr: job "<kind>" (<id>)
  failed` to console.
- **`reportProgress(value)`** is fire-and-forget — call as often as you
  like, last value wins. Useful for percentage bars, phase indicators,
  current-record markers.
- **`signal`** fires when the request context is gone, if the host exposes that
  lifecycle. For long handlers, check `signal.aborted` between expensive steps
  and bail out cleanly.

## Run-time semantics

| Where it runs | What keeps it alive |
| ------------- | -------------------- |
| Host provides `ctx.waitUntil` | `ctx.waitUntil(work)` keeps work alive past the response, subject to the host's limits. |
| Long-lived server process without `waitUntil` | Fire-and-forget. Stays alive as long as the process does. |
| Tests | Same as a long-lived process. The framework's own tests poll the store directly. |

**For jobs that must survive process or isolate restart**, use a durable store
(`cacheJobStore` over Redis / provider KV) and a long-enough TTL. The in-flight
execution can still be lost if the host stops the worker. For that, use a
provider queue or write a queue-backed job adapter. The store at minimum lets a
polling client see the last-known-good state.

## End-to-end demo

[examples/basic/src/Example/Basic/Routes/Reports.elm](../examples/basic/src/Example/Basic/Routes/Reports.elm)
+ the `generateReport` handler + `withJobs(...)` wiring in
[examples/basic/runtime.ts](../examples/basic/runtime.ts). The handler
sleeps three times (~400ms each) and reports progress between sleeps; the
page renders Queued / Running / Done / Failed / Missing branches.

Coverage:
[test/jobs.test.ts](../test/jobs.test.ts) (unit: stores + adapter
semantics; 12 tests) +
[test/reports.test.ts](../test/reports.test.ts) (e2e: submit, poll,
done, missing; 5 tests).

## Failure modes worth knowing

- **TTL elapses before client polls.** Returns `JobMissing`. Set
  `defaultTtlSeconds` higher if your UI can keep a tab open long enough
  to lose the result.
- **Handler missing for `kind`.** The job is created and immediately
  marked `failed` with `No handler registered for kind "<kind>"`. Catch
  this in dev — easy to forget to register a new handler.
- **Handler throws via `signal.aborted`.** Comes through as
  `JobFailed { reason = "..." }` like any other throw.
- **Same id polled by two readers.** Both see consistent state (read is
  a single store call). No locking needed.

## What's not in here yet

- **Queue-backed durability for every provider.** Cloudflare Queues exist for
  `enqueue`; a provider-neutral job queue adapter is still future work.
- **Cancellation by id.** A `cancelJob jobId` would set
  `signal.aborted = true` for an in-flight handler.
- **Retry policies.** The handler currently either succeeds or fails;
  add your own try/catch + scheduling if you need retries.
- **SSE-driven streaming results.** Today you poll `Loader.jobStatus`
  on a follow-up page. Wiring an SSE endpoint that pushes
  `JobStatus`-shaped frames is a recipe-level concern; you can compose
  it with `createSseStream` and `store.get` yourself.

## Source

- [packages/elm-ssr/src/jobs/](../packages/elm-ssr/src/jobs/) —
  `types.ts`, `store.ts`, `runner.ts`, `index.ts`.
- [packages/elm-ssr/elm-src/ElmSsr/Loader.elm](../packages/elm-ssr/elm-src/ElmSsr/Loader.elm) —
  `JobId`, `JobStatus(..)`, `startJob`, `jobStatus`.
