import { describe, expect, it } from "bun:test";
import { createSseStream, encodeSseEvent } from "elm-ssr/sse";

const decoder = new TextDecoder();

/** Read a streaming Response into an array of decoded chunks. */
const collect = async (response: Response): Promise<string[]> => {
  const reader = response.body!.getReader();
  const chunks: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
};

describe("encodeSseEvent (framing)", () => {
  it("string shorthand becomes a single data field + blank line", () => {
    expect(encodeSseEvent("hello")).toBe("data: hello\n\n");
  });

  it("multi-line strings get one `data:` per line", () => {
    expect(encodeSseEvent("a\nb\nc")).toBe("data: a\ndata: b\ndata: c\n\n");
  });

  it("frames event/id/retry alongside data", () => {
    expect(
      encodeSseEvent({ event: "tick", id: "42", retry: 5000, data: "ping" })
    ).toBe("event: tick\nid: 42\nretry: 5000\ndata: ping\n\n");
  });

  it("skips optional fields when absent", () => {
    expect(encodeSseEvent({ data: "x" })).toBe("data: x\n\n");
  });

  it("clamps a negative retry to 0", () => {
    expect(encodeSseEvent({ data: "x", retry: -5 })).toContain("retry: 0");
  });
});

describe("createSseStream", () => {
  const sseRequest = () => new Request("https://example.com/__elm-ssr/live");

  it("sets the SSE response headers", async () => {
    const response = createSseStream(sseRequest(), (_send, _signal) => {
      // close immediately
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    // drain to release the controller
    await response.text();
  });

  it("emits the configured retry hint before any events", async () => {
    const response = createSseStream(
      sseRequest(),
      (send) => {
        send("hello");
      },
      { retryHintMs: 7000 }
    );
    const body = (await collect(response)).join("");
    expect(body.startsWith("retry: 7000\n\n")).toBe(true);
    expect(body).toContain("data: hello");
  });

  it("frames multiple events in order", async () => {
    const response = createSseStream(sseRequest(), async (send) => {
      send("first");
      send({ event: "tick", id: "1", data: "second" });
      send("third");
    });
    const body = (await collect(response)).join("");
    const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
    expect(dataLines).toEqual(["data: first", "data: second", "data: third"]);
    expect(body).toContain("event: tick");
    expect(body).toContain("id: 1");
  });

  it("merges custom headers without overwriting the SSE defaults", async () => {
    const response = createSseStream(
      sseRequest(),
      (send) => {
        send("x");
      },
      { headers: { "x-custom": "yes", "content-type": "should-be-ignored" } }
    );
    expect(response.headers.get("x-custom")).toBe("yes");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.text();
  });

  it("the handler's signal fires when the client disconnects", async () => {
    const requestAbort = new AbortController();
    const request = new Request("https://example.com/__elm-ssr/live", { signal: requestAbort.signal });

    let observedSignal: AbortSignal | undefined;
    const done = new Promise<void>((resolve) => {
      const response = createSseStream(request, async (send, signal) => {
        observedSignal = signal;
        send("hello");
        // Wait until the signal aborts (driven by the abort below).
        await new Promise<void>((resolveInner) => {
          if (signal.aborted) {
            resolveInner();
            return;
          }
          signal.addEventListener("abort", () => resolveInner(), { once: true });
        });
        resolve();
      });
      // Drain the body so the start() runs and we see at least one frame.
      void response.text();
    });

    // Trigger the client-disconnect abort.
    await new Promise((r) => setTimeout(r, 10));
    requestAbort.abort();
    await done;

    expect(observedSignal?.aborted).toBe(true);
  });

  it("closes cleanly when the handler throws (and logs)", async () => {
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const response = createSseStream(sseRequest(), () => {
        throw new Error("boom");
      });
      // Drain — the stream should close without an unhandled rejection.
      await response.text();
    } finally {
      console.error = originalError;
    }
    expect(errors.some((args) => String(args).includes("boom"))).toBe(true);
  });

  it("works end-to-end through a Response: caller sees the full body", async () => {
    const response = createSseStream(sseRequest(), async (send) => {
      for (let i = 1; i <= 3; i += 1) {
        send(JSON.stringify({ n: i }));
      }
    });
    const body = await response.text();
    expect(body).toContain('data: {"n":1}');
    expect(body).toContain('data: {"n":2}');
    expect(body).toContain('data: {"n":3}');
  });
});
