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
import { type EffectRunner } from "./effects";
import { createRequestHandler } from "./request-handler";
import { type CompiledElmModule } from "./render";

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
}

export const createWorkerApp = ({
  elmModule,
  islands,
  islandsBundle,
  stylesheet,
  routes,
  createFlags,
  effects,
  log
}: WorkerAppOptions): WorkerHandler => {
  const handler = createRequestHandler({
    elmModule,
    islands,
    islandsBundle,
    stylesheet,
    routes,
    createFlags,
    effects
  });

  const appHandler = composeMiddleware(handler, [
    errorMiddleware,
    requestIdMiddleware,
    timingMiddleware,
    loggingMiddleware(log),
    headMiddleware
  ]);

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
