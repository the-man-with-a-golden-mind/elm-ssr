import { describe, expect, it } from "bun:test";
import { worker } from "../examples/basic/runtime";

// End-to-end through the example worker: hit /__elm-ssr/live (the wrapped
// SSE endpoint in examples/basic/runtime.ts), parse a few frames, verify the
// stream behaves as the Live island expects (monotonic `n`, ISO timestamps,
// proper headers). Drives the same code path that the browser hits — the
// only piece this can't exercise is the EventSource client (happy-dom-bound).

interface Tick {
  time: string;
  n: number;
}

const readFrames = async (response: Response, count: number, timeoutMs = 5000): Promise<Tick[]> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Tick[] = [];
  const start = Date.now();

  try {
    while (events.length < count && Date.now() - start < timeoutMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = frame.split("\n").filter((line) => line.startsWith("data: "));
        if (dataLines.length === 0) continue; // retry: hint, comment, etc.
        const data = dataLines.map((line) => line.slice(6)).join("\n");
        try {
          events.push(JSON.parse(data) as Tick);
        } catch {
          // non-JSON frame; ignore for this test
        }
        if (events.length >= count) break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }

  return events;
};

describe("/live SSE endpoint (end-to-end through the example worker)", () => {
  it("returns a text/event-stream response with the expected headers", async () => {
    const response = await worker.fetch(new Request("https://example.com/__elm-ssr/live"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    // Drain so the controller releases.
    await response.body?.cancel();
  });

  it("streams ticks with a monotonic `n` and ISO timestamps", async () => {
    const response = await worker.fetch(new Request("https://example.com/__elm-ssr/live"));
    const events = await readFrames(response, 3);

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.map((e) => e.n)).toEqual([1, 2, 3]);
    for (const event of events) {
      // ISO 8601 ish — Date.parse roundtrips successfully.
      expect(Number.isFinite(Date.parse(event.time))).toBe(true);
    }
  }, 10_000);

  it("non-SSE routes still go through the Elm worker unchanged", async () => {
    // Wrapping the worker with withLiveStream shouldn't break the normal handlers.
    const response = await worker.fetch(new Request("https://example.com/api/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
