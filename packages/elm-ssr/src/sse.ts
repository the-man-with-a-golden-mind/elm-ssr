// Server-Sent Events (text/event-stream) primitive. Use this to expose a
// streaming endpoint that an island subscribes to via `ElmSsr.Island.Sse`.
//
// Usage:
//
//   import { createSseStream } from "elm-ssr/sse";
//
//   if (url.pathname === "/__elm-ssr/live") {
//     return createSseStream(request, async (send, signal) => {
//       while (!signal.aborted) {
//         send(JSON.stringify({ time: Date.now() }));
//         await new Promise((r) => setTimeout(r, 1000));
//       }
//     });
//   }
//
// `send` accepts either a string (becomes `data:`) or a full `SseEvent` for
// custom event names / ids / retry hints. Returning from the handler closes
// the stream; throwing closes it with an error logged.

export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
  /** Reconnect hint in milliseconds (browser's EventSource respects this on reconnect). */
  retry?: number;
}

export type SseSend = (event: SseEvent | string) => void;

export type SseStreamHandler = (send: SseSend, signal: AbortSignal) => Promise<void> | void;

export interface SseStreamOptions {
  /** Extra response headers to merge with the SSE defaults. */
  headers?: HeadersInit;
  /** Initial reconnect hint sent to the client (ms). Defaults to 3000. */
  retryHintMs?: number;
}

const encoder = new TextEncoder();

const formatField = (name: string, value: string): string => {
  // Each value line gets its own `name:` prefix per the spec.
  return value
    .split(/\r?\n/)
    .map((line) => `${name}: ${line}\n`)
    .join("");
};

export const encodeSseEvent = (event: SseEvent | string): string => {
  if (typeof event === "string") {
    return `${formatField("data", event)}\n`;
  }
  let frame = "";
  if (event.event) {
    frame += formatField("event", event.event);
  }
  if (event.id !== undefined) {
    frame += formatField("id", event.id);
  }
  if (event.retry !== undefined) {
    frame += `retry: ${Math.max(0, Math.floor(event.retry))}\n`;
  }
  frame += formatField("data", event.data);
  frame += "\n";
  return frame;
};

const sseHeaders = (extra?: HeadersInit): Headers => {
  const headers = new Headers(extra);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("connection", "keep-alive");
  // Hint to disable nginx-style proxy buffering.
  if (!headers.has("x-accel-buffering")) {
    headers.set("x-accel-buffering", "no");
  }
  return headers;
};

/**
 * Create a streaming SSE Response. The handler runs inside a `ReadableStream`
 * and receives:
 *  - `send(event)` — enqueue an event (string shorthand for `{ data }`).
 *  - `signal` — fires when the client disconnects OR the handler throws.
 *
 * Returning from the handler closes the stream cleanly; throwing closes with
 * an error logged. The client-disconnect signal is sourced from
 * `request.signal`.
 */
export const createSseStream = (
  request: Request,
  handler: SseStreamHandler,
  options: SseStreamOptions = {}
): Response => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const enqueue = (frame: string): void => {
        try {
          streamController.enqueue(encoder.encode(frame));
        } catch {
          // Stream already closed (client disconnected mid-write). Best-effort.
        }
      };

      // Emit the retry hint up front so reconnects respect it.
      const retry = options.retryHintMs ?? 3000;
      enqueue(`retry: ${retry}\n\n`);

      const send: SseSend = (event) => enqueue(encodeSseEvent(event));

      try {
        await handler(send, controller.signal);
      } catch (error) {
        console.error("elm-ssr: SSE handler threw", error);
        controller.abort();
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try {
          streamController.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      controller.abort();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: sseHeaders(options.headers)
  });
};

/**
 * Convenience for endpoints that publish a single event-stream named channel.
 * Calls `send({ event, data })` with auto-incrementing ids.
 */
export const createNamedSseStream = (
  request: Request,
  channel: string,
  handler: (publish: (data: string) => void, signal: AbortSignal) => Promise<void> | void,
  options?: SseStreamOptions
): Response =>
  createSseStream(
    request,
    async (send, signal) => {
      let nextId = 0;
      const publish = (data: string): void => {
        nextId += 1;
        send({ event: channel, id: String(nextId), data });
      };
      await handler(publish, signal);
    },
    options
  );
