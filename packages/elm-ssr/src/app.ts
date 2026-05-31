import type {
  RenderFlagsFactory,
  RouteCatalog,
  WorkerExecutionContext,
  WorkerHandler
} from "./http";
import {
  composeMiddleware,
  errorMiddleware,
  headMiddleware,
  loggingMiddleware,
  requestIdMiddleware,
  timingMiddleware
} from "./middleware";
import { defaultEffectRunner, type EffectRunner } from "./effects";
import { createRequestHandler } from "./request-handler";
import { type CompiledElmModule } from "./render";
import {
  csrfMiddleware,
  sessionEffects,
  sessionMiddleware,
  type CsrfMiddlewareOptions,
  type SessionMiddlewareOptions
} from "./sessions";

export interface IslandMetadata {
  module: string;
}

export interface WorkerAppOptions {
  elmModule: CompiledElmModule;
  islands?: Record<string, IslandMetadata>;
  islandsBundle?: string;
  stylesheet: string;
  routes: RouteCatalog;
  createFlags: RenderFlagsFactory;
  effects?: EffectRunner;
  log?: (entry: string) => void;
  /**
   * Opt-in: install `sessionMiddleware` and auto-wrap `effects` with
   * `sessionEffects(...)` so `Loader.session` / `Action.setSession` work.
   * Pass `memorySessionStore()` for dev/tests, `cacheStore(redisCache(...))`
   * for prod.
   */
  sessions?: SessionMiddlewareOptions;
  /**
   * Opt-in: install `csrfMiddleware`. Requires `sessions` to be set, otherwise
   * the middleware fails closed at request time (500). Pass `true` to use
   * defaults, or an options object to customize the header / form field /
   * skip paths.
   */
  csrf?: CsrfMiddlewareOptions | boolean;
}

export const createWorkerApp = ({
  elmModule,
  islands,
  islandsBundle,
  stylesheet,
  routes,
  createFlags,
  effects,
  log,
  sessions,
  csrf
}: WorkerAppOptions): WorkerHandler => {
  const runner: EffectRunner = effects ?? defaultEffectRunner;
  const effectsWithSessions = sessions ? sessionEffects(runner) : runner;

  const handler = createRequestHandler({
    elmModule,
    islands,
    islandsBundle,
    stylesheet,
    routes,
    createFlags,
    effects: effectsWithSessions
  });

  const middlewares = [
    errorMiddleware,
    requestIdMiddleware,
    timingMiddleware,
    loggingMiddleware(log)
  ];
  if (sessions) {
    middlewares.push(sessionMiddleware(sessions));
    if (csrf) {
      middlewares.push(csrfMiddleware(csrf === true ? {} : csrf));
    }
  }
  middlewares.push(headMiddleware);

  const appHandler = composeMiddleware(handler, middlewares);

  return {
    fetch(request: Request, env?: unknown, executionCtx?: WorkerExecutionContext) {
      return appHandler({
        request,
        url: new URL(request.url),
        requestId: "",
        startedAt: performance.now(),
        executionCtx,
        env: (env ?? undefined) as Record<string, unknown> | undefined
      });
    }
  };
};
