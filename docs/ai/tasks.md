# tasks (AI)

**Subpath:** `elm-ssr/tasks`. **Effect kind:** `enqueue`. **Elm:** `Loader.enqueue { task, payload }`.

Background work that runs **after the response goes out**. Two flavours:

- **`withTasks(runner, handlers)`** — inline after response. Uses
  `ctx.waitUntil` when the host provides it; otherwise detached. Fast, loses on
  crash/process stop.
- **`withQueueProducer + createQueueConsumer`** — durable via Cloudflare
  Queues. Survives, retries. For other providers, implement a custom `enqueue`
  runner that publishes to that provider's queue.

## Exports

```ts
type TaskHandler = (payload: unknown, context: EffectContext) => unknown | Promise<unknown>;
type TaskHandlers = Record<string, TaskHandler>;

withTasks(runner: EffectRunner, tasks: TaskHandlers): EffectRunner;

withQueueProducer(runner: EffectRunner, config?: { queueBinding?: string }): EffectRunner;

// Build the `queue` handler for a consumer Worker.
createQueueConsumer(tasks: TaskHandlers): (batch, env?, executionCtx?) => Promise<void>;
```

## Minimal example: inline (portable)

```elm
-- Elm
action _ =
    Action.fromLoader (Loader.enqueue { task = "sendEmail", payload = Encode.string "alice@example.com" })
        |> Action.andThen (\_ -> Action.redirect "/thanks")
```

```ts
// TS
import { withTasks } from "elm-ssr/tasks";

const effects = withTasks(baseEffects, {
  sendEmail: async (payload, ctx) => {
    await fetch("https://api.sendgrid.com/...", {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.env?.SENDGRID_KEY}` },
      body: JSON.stringify(payload),
    });
  },
});
```

## Minimal example: durable (Cloudflare Queues)

```ts
// Producer worker (your main worker)
const effects = withQueueProducer(cloudflareEffects(), { queueBinding: "JOBS" });

// Consumer (same or separate worker)
import { createQueueConsumer } from "elm-ssr/tasks";

export default {
  fetch: worker.fetch,
  queue: createQueueConsumer({
    sendEmail: async (payload, ctx) => { /* ... */ },
  }),
};
```

```jsonc
// wrangler.jsonc
{
  "queues": {
    "producers": [{ "queue": "elm-ssr-jobs", "binding": "JOBS" }],
    "consumers": [{ "queue": "elm-ssr-jobs", "max_batch_size": 10 }]
  }
}
```

## Behavior

- Inline (`withTasks`): uses `ctx.waitUntil(handler())` when present;
  otherwise fire-and-forget (`void`). Handler exception is
  `console.error`-logged; request unaffected.
- Durable (`withQueueProducer`): publishes `{ task, payload }` to
  `env[binding].send(...)`. Consumer dispatches by task name; `ack()` on
  success, `retry()` on error or missing handler.
- Unknown task name in inline path → `enqueue` effect fails with
  `No task handler registered for "<name>"`.

## Patterns

- Fire-and-forget non-critical work → `withTasks`.
- Must-not-lose work on Cloudflare → `withQueueProducer` + DLQ in wrangler.
- Must-not-lose work elsewhere → custom `enqueue` runner + provider queue.
- Both, by task name: layer `withTasks` (handles e.g. "log") then
  `withQueueProducer` (catches everything else). Outermost intercepts.

## Footguns

- `withTasks` handler exception is swallowed — only `console.error`. Use
  `withQueueProducer` if you need delivery guarantees.
- `createQueueConsumer` is for Cloudflare Queues and requires a `queue` handler,
  not a `fetch` route. Wire it via the consumer worker's `default export`.
- `ctx.env` may be undefined in tests; consumer handlers must `ctx.env?.X`.
- `enqueue` from Elm returns `()` — caller doesn't know if it succeeded
  beyond "the effect call resolved". For tracked work see `jobs`.
