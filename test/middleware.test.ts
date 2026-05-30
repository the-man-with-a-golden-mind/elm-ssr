import { describe, expect, it } from "bun:test";
import type { AppContext, AppHandler, Middleware } from "@elm-ssr/runtime-worker/http";
import {
  composeMiddleware,
  errorMiddleware,
  headMiddleware,
  loggingMiddleware,
  requestIdMiddleware,
  timingMiddleware
} from "@elm-ssr/runtime-worker/middleware";

const contextFor = (request: Request): AppContext => ({
  request,
  url: new URL(request.url),
  requestId: "",
  startedAt: performance.now()
});

const ok = (): AppHandler => async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });

describe("composeMiddleware", () => {
  it("runs middlewares outermost-first on the way in and innermost-first on the way out", async () => {
    const order: string[] = [];
    const a: Middleware = async (ctx, next) => {
      order.push("a-in");
      const res = await next(ctx);
      order.push("a-out");
      return res;
    };
    const b: Middleware = async (ctx, next) => {
      order.push("b-in");
      const res = await next(ctx);
      order.push("b-out");
      return res;
    };

    const handler = composeMiddleware(async () => {
      order.push("handler");
      return new Response("");
    }, [a, b]);

    await handler(contextFor(new Request("https://example.com/")));
    expect(order).toEqual(["a-in", "b-in", "handler", "b-out", "a-out"]);
  });
});

describe("requestIdMiddleware", () => {
  it("reuses an incoming x-request-id and echoes it back", async () => {
    const handler = composeMiddleware(ok(), [requestIdMiddleware]);
    const response = await handler(
      contextFor(new Request("https://example.com/", { headers: { "x-request-id": "abc-123" } }))
    );
    expect(response.headers.get("x-request-id")).toBe("abc-123");
  });

  it("generates an id when the header is missing", async () => {
    const handler = composeMiddleware(ok(), [requestIdMiddleware]);
    const response = await handler(contextFor(new Request("https://example.com/")));
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("timingMiddleware", () => {
  it("adds server-timing and x-response-time headers", async () => {
    const handler = composeMiddleware(ok(), [timingMiddleware]);
    const response = await handler(contextFor(new Request("https://example.com/")));
    expect(response.headers.get("server-timing")).toMatch(/^app;dur=\d+(\.\d+)?$/);
    expect(response.headers.get("x-response-time")).toMatch(/^\d+(\.\d+)?ms$/);
  });
});

describe("headMiddleware", () => {
  it("strips the body for HEAD while preserving status + headers", async () => {
    const inner: AppHandler = async () =>
      new Response("payload", { status: 200, headers: { "x-custom": "yes", "content-type": "text/plain" } });
    const handler = composeMiddleware(inner, [headMiddleware]);
    const response = await handler(contextFor(new Request("https://example.com/", { method: "HEAD" })));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-custom")).toBe("yes");
    expect(await response.text()).toBe("");
  });

  it("leaves non-HEAD responses untouched", async () => {
    const handler = composeMiddleware(ok(), [headMiddleware]);
    const response = await handler(contextFor(new Request("https://example.com/")));
    expect(await response.text()).toBe("ok");
  });
});

describe("errorMiddleware", () => {
  const failingHandler: AppHandler = async () => {
    throw new Error("boom");
  };

  it("returns plain-text 500 for non-/api/ routes when the handler throws", async () => {
    const handler = composeMiddleware(failingHandler, [errorMiddleware]);
    const response = await handler(contextFor(new Request("https://example.com/page")));
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type") || "").toContain("text/plain");
    expect(await response.text()).toBe("Internal Server Error");
  });

  it("returns JSON 500 with requestId for /api/ routes when the handler throws", async () => {
    const context = contextFor(new Request("https://example.com/api/things"));
    context.requestId = "req-7";
    const handler = composeMiddleware(failingHandler, [errorMiddleware]);
    const response = await handler(context);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "internal_error", requestId: "req-7" });
  });
});

describe("loggingMiddleware", () => {
  it("emits one JSON log line per completed request", async () => {
    const lines: string[] = [];
    const logger = (entry: string) => lines.push(entry);
    const handler = composeMiddleware(ok(), [loggingMiddleware(logger)]);

    await handler(contextFor(new Request("https://example.com/things?x=1", { method: "GET" })));
    // The logger is dispatched detached; let microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string);
    expect(entry).toMatchObject({
      event: "request_completed",
      method: "GET",
      path: "/things",
      status: 200
    });
    expect(typeof entry.durationMs).toBe("number");
  });
});
