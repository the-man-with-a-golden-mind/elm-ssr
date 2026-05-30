import type { AppContext, AppHandler, Middleware } from "./http";
import { json, text, withHeaders } from "./http";

const runDetached = (context: AppContext, task: Promise<unknown>): void => {
  if (context.executionCtx) {
    context.executionCtx.waitUntil(task);
    return;
  }

  void task.catch((error) => {
    console.error("detached_middleware_task_failed", error);
  });
};

export const composeMiddleware = (handler: AppHandler, middlewares: Middleware[]): AppHandler =>
  middlewares.reduceRight<AppHandler>(
    (next, middleware) => (context) => middleware(context, next),
    handler
  );

export const requestIdMiddleware: Middleware = async (context, next) => {
  const existing = context.request.headers.get("x-request-id");
  context.requestId = existing && existing.length > 0 ? existing : crypto.randomUUID();

  const response = await next(context);

  return withHeaders(response, {
    "x-request-id": context.requestId
  });
};

export const timingMiddleware: Middleware = async (context, next) => {
  const response = await next(context);
  const durationMs = performance.now() - context.startedAt;

  return withHeaders(response, {
    "server-timing": `app;dur=${durationMs.toFixed(2)}`,
    "x-response-time": `${durationMs.toFixed(2)}ms`
  });
};

export const headMiddleware: Middleware = async (context, next) => {
  const response = await next(context);

  if (context.request.method !== "HEAD") {
    return response;
  }

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
};

export const errorMiddleware: Middleware = async (context, next) => {
  try {
    return await next(context);
  } catch (error) {
    console.error("elm_ssr_request_failed", {
      requestId: context.requestId,
      path: context.url.pathname,
      error
    });

    if (context.url.pathname.startsWith("/api/")) {
      return json(
        {
          error: "internal_error",
          requestId: context.requestId
        },
        { status: 500 }
      );
    }

    return text("Internal Server Error", {
      status: 500
    });
  }
};

export const loggingMiddleware = (logger: (entry: string) => void = console.log): Middleware =>
  async (context, next) => {
    const response = await next(context);
    const durationMs = performance.now() - context.startedAt;

    runDetached(
      context,
      Promise.resolve().then(() => {
        logger(
          JSON.stringify({
            event: "request_completed",
            requestId: context.requestId,
            method: context.request.method,
            path: context.url.pathname,
            status: response.status,
            durationMs: Number(durationMs.toFixed(2))
          })
        );
      })
    );

    return response;
  };
