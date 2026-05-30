import type { EffectContext, EffectRunner } from "./effects";
import type { WorkerExecutionContext } from "./http";

/**
 * A background task handler. It receives the payload the Elm side enqueued and
 * the request's effect context (env, request, …). Its result is ignored — tasks
 * are fire-and-forget.
 */
export type TaskHandler = (payload: unknown, context: EffectContext) => unknown | Promise<unknown>;

export type TaskHandlers = Record<string, TaskHandler>;

/**
 * Wrap an effect runner so `Loader.enqueue { task, payload }` schedules a named
 * task to run AFTER the response. On Cloudflare this uses `ctx.waitUntil` to keep
 * the isolate alive; locally (no waitUntil) it runs fire-and-forget. All other
 * effects pass through to the wrapped runner unchanged.
 */
export const withTasks = (runner: EffectRunner, tasks: TaskHandlers): EffectRunner =>
  async (effect, context) => {
    if (effect.kind !== "enqueue") {
      return runner(effect, context);
    }

    const name = String(effect.payload.task);
    const handler = tasks[name];

    if (!handler) {
      return { ok: false, error: `No task handler registered for "${name}".` };
    }

    const job = Promise.resolve()
      .then(() => handler(effect.payload.payload, context))
      .catch((error) => {
        console.error(`elm-ssr: background task "${name}" failed`, error);
      });

    if (typeof context.waitUntil === "function") {
      context.waitUntil(job);
    } else {
      void job;
    }

    return { ok: true, value: null };
  };

// === Cloudflare Queues (durable background jobs) ===

interface QueueLike {
  send(message: unknown): Promise<void>;
}

export interface QueueProducerConfig {
  /** env binding name of the Cloudflare Queue. Default `"QUEUE"`. */
  queueBinding?: string;
}

/**
 * Composable alternative to `withTasks` for durable jobs: an `enqueue` effect
 * sends `{ task, payload }` to a Cloudflare Queue via `context.env[binding]`
 * instead of running it inline via `waitUntil`. All other effects pass through.
 *
 *     effects: withQueueProducer(inMemoryEffects({...}), { queueBinding: "JOBS" })
 *
 * Consume the queue in your CF entry with `createQueueConsumer(tasks)`.
 */
export const withQueueProducer = (runner: EffectRunner, config: QueueProducerConfig = {}): EffectRunner => {
  const binding = config.queueBinding ?? "QUEUE";

  return async (effect, context) => {
    if (effect.kind !== "enqueue") {
      return runner(effect, context);
    }

    const env = (context.env ?? {}) as Record<string, unknown>;
    const queue = env[binding] as QueueLike | undefined;

    if (!queue) {
      return { ok: false, error: `Missing queue binding "${binding}"` };
    }

    try {
      await queue.send({ task: String(effect.payload.task), payload: effect.payload.payload });
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: `Queue send failed: ${String(error)}` };
    }
  };
};

interface QueueMessage {
  body: unknown;
  ack(): void;
  retry(): void;
}

export interface QueueBatch {
  messages: QueueMessage[];
  queue: string;
}

/**
 * Build the `queue` handler for a Cloudflare consumer worker. Maps each message
 * `{ task, payload }` (produced by `withQueueProducer` or `Loader.enqueue` on
 * any producer) to the named handler in `tasks`. Acks on success, retries on
 * failure or missing handler.
 *
 *     export default {
 *       fetch: worker.fetch,
 *       queue: createQueueConsumer({ sendEmail, warmCache })
 *     }
 */
export const createQueueConsumer = (tasks: TaskHandlers) =>
  async (batch: QueueBatch, env?: unknown, executionCtx?: WorkerExecutionContext): Promise<void> => {
    const context: EffectContext = {
      env: (env ?? undefined) as Record<string, unknown> | undefined,
      waitUntil: executionCtx ? (promise) => executionCtx.waitUntil(promise) : undefined
    };

    for (const message of batch.messages) {
      const body = (message.body ?? {}) as { task?: string; payload?: unknown };
      const name = typeof body.task === "string" ? body.task : "";
      const handler = tasks[name];

      if (!handler) {
        console.error(`elm-ssr: queue consumer has no handler for "${name}"`);
        message.retry();
        continue;
      }

      try {
        await handler(body.payload, context);
        message.ack();
      } catch (error) {
        console.error(`elm-ssr: queue task "${name}" failed`, error);
        message.retry();
      }
    }
  };
