import { describe, expect, it } from "bun:test";
import { worker } from "../examples/basic/runtime";

// End-to-end coverage of Loader.custom + Promise.all fan-out via /parallel.
// Three fake queries with latencies 60/80/70ms run inside one effect call.
// If they ran sequentially we'd expect ~210ms wall-clock; in parallel ≈ max
// (~80ms). The asserted bound is loose to stay green on slow CI but still
// proves the queries didn't serialize.

const extractTotalMs = (html: string): number => {
  // The view emits: "Wall clock: <span class="value">NN ms</span>"
  const match = html.match(/Wall clock:[\s\S]*?>\s*(\d+)\s*ms/);
  if (!match) throw new Error("no Wall clock value in HTML");
  return Number(match[1]);
};

describe("/parallel — Loader.custom + Promise.all fan-out", () => {
  it("renders all three query results", async () => {
    const response = await worker.fetch(new Request("https://example.com/parallel"));
    expect(response.status).toBe(200);
    const html = await response.text();

    // totalOrders payload
    expect(html).toContain("4217");
    // top countries
    expect(html).toContain("PL");
    expect(html).toContain("US");
    expect(html).toContain("DE");
    // recent ids list (just check one)
    expect(html).toContain("4216");
  });

  it("queries ran in parallel — wall clock is closer to slowest than to the sum", async () => {
    const response = await worker.fetch(new Request("https://example.com/parallel"));
    const html = await response.text();
    const totalMs = extractTotalMs(html);

    // Slowest fake query is 80ms; sum is ~210ms. Parallel ≈ 80ms (plus
    // worker + render overhead). Anything well under the sum proves the
    // queries didn't serialize. 150ms keeps headroom for CI noise.
    expect(totalMs).toBeLessThan(150);
    expect(totalMs).toBeGreaterThanOrEqual(60); // at least the slowest query
  });
});
