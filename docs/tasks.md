# Tasks and queues

Background work that runs **after** the response goes out — emails, cache
warming, webhooks, anything you don't want blocking the user.

`Loader.enqueue { task, payload }` is the Elm-side entry point. What happens
to that payload depends on which adapter you wrap the runner with:

- **`withTasks(runner, handlers)`** — runs the task inline after the
  response, kept alive by `ctx.waitUntil` on Cloudflare, fire-and-forget on
  Bun. Best for fast, idempotent work.
- **`withQueueProducer(runner, { queueBinding })`** — sends the task to a
  Cloudflare Queue (durable, retried on failure). A separate consumer Worker
  picks it up with `createQueueConsumer(handlers)`.

Both wrap any existing runner, so they compose with `withCache`,
`cloudflareEffects`, `inMemoryEffects`, etc.

## Enqueueing from Elm

```elm
import Json.Encode as Encode
import ElmSsr.Action as Action
import ElmSsr.Loader as Loader


sendThankYou : String -> Loader ()
sendThankYou email =
    Loader.enqueue
        { task = "sendEmail"
        , payload =
            Encode.object
                [ ( "to", Encode.string email )
                , ( "subject", Encode.string "Thanks!" )
                ]
        }


action : Request -> Action (Document Never)
action request =
    case Route.formValue "email" request of
        Just email ->
            Action.fromLoader (saveSubscriber email)
                |> Action.andThen (\_ -> Action.fromLoader (sendThankYou email))
                |> Action.andThen (\_ -> Action.redirect "/thanks")

        Nothing ->
            Action.fail 422 "Email is required"
```

The action returns its response right after `saveSubscriber`; `sendEmail` runs
afterward (with `waitUntil`), so the user isn't waiting for SMTP.

## `withTasks` (inline, fastest)

```ts
import { withTasks } from "elm-ssr/tasks";
import { cloudflareEffects } from "elm-ssr/effects";

const effects = withTasks(cloudflareEffects(), {
  sendEmail: async (payload, ctx) => {
    await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.env?.SENDGRID_KEY}` },
      body: JSON.stringify(payload)
    });
  },
  warmCache: async (_payload, ctx) => {
    /* … */
  }
});
```

Each handler receives `(payload, effectContext)`. The context has `env`,
`request`, and `waitUntil` — same shape every effect sees.

**Behavior:**
- On Cloudflare: scheduled via `ctx.waitUntil(handler(...))`. The isolate
  stays alive long enough to finish.
- On Bun (no `waitUntil`): runs detached (`void promise`). Survives only as
  long as the process does.
- Handler throws → `console.error("elm-ssr: background task \"NAME\" failed",
  error)`; the request is unaffected.
- Unknown task name → the **`enqueue`** effect fails (`No task handler
  registered for "NAME"`), so the action surfaces the error to the caller.

## `withQueueProducer` + `createQueueConsumer` (durable)

For work that **must** survive a Worker restart or retry on failure, use a
Cloudflare Queue. The producer Worker enqueues; a separate consumer Worker
(or the same Worker with a `queue` handler) processes the messages.

### Producer

```ts
import { withQueueProducer } from "elm-ssr/tasks";

const effects = withQueueProducer(cloudflareEffects(), {
  queueBinding: "JOBS" // default "QUEUE"
});
```

`Loader.enqueue { task: "warmCache", payload: ... }` sends
`{ task: "warmCache", payload: ... }` to `env.JOBS.send(...)`. If the binding
is missing, the effect fails with `Missing queue binding "JOBS"`.

### Consumer

```ts
import { createQueueConsumer } from "elm-ssr/tasks";

export default {
  fetch: worker.fetch, // from createWorkerApp
  queue: createQueueConsumer({
    warmCache: async (payload, ctx) => { /* … */ },
    sendEmail: async (payload, ctx) => { /* … */ }
  })
};
```

The consumer reads each message's `{ task, payload }`, dispatches to the
named handler, and:
- **`message.ack()`** on success.
- **`message.retry()`** if the handler throws or the task name has no
  handler.

Bind the queue in `wrangler.jsonc`:

```jsonc
{
  "queues": {
    "producers": [{ "queue": "elm-ssr-jobs", "binding": "JOBS" }],
    "consumers": [{ "queue": "elm-ssr-jobs", "max_batch_size": 10 }]
  }
}
```

## Choosing

| Need | Use |
| ---- | --- |
| Quick post-response work, fine to lose on crash | `withTasks` |
| Durable jobs, retry on failure, backpressure | `withQueueProducer` + `createQueueConsumer` |
| Both (some inline, some durable) | Wrap the runner with **both** — `enqueue` is intercepted by the outermost matching adapter, so order matters. Put the more-specific one outside, or split task names cleanly. |

## Source

- [packages/elm-ssr/src/tasks.ts](../packages/elm-ssr/src/tasks.ts)
- [packages/elm-ssr/elm-src/ElmSsr/Loader.elm](../packages/elm-ssr/elm-src/ElmSsr/Loader.elm) (`enqueue`)
