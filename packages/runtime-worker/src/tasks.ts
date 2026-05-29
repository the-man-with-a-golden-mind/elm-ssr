import type { EffectContext, EffectRunner } from "./effects";

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
