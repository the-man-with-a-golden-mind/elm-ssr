import { describe, expect, it } from "bun:test";
import { worker } from "../examples/crypto-dashboard/runtime";

// End-to-end coverage of the crypto-dashboard's market ticker.
// /__elm-ssr/markets/stream pushes { coins, at } payloads every 2s with
// nudged prices; the MarketOverview island consumes this via SSE instead of
// the previous 15s HTTP poll.

interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
}

interface Snapshot {
  coins: MarketCoin[];
  at: string;
}

const readSnapshots = async (response: Response, count: number, timeoutMs = 10_000): Promise<Snapshot[]> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const snapshots: Snapshot[] = [];
  const start = Date.now();

  try {
    while (snapshots.length < count && Date.now() - start < timeoutMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = frame.split("\n").filter((line) => line.startsWith("data: "));
        if (dataLines.length === 0) continue;
        const data = dataLines.map((line) => line.slice(6)).join("\n");
        try {
          snapshots.push(JSON.parse(data) as Snapshot);
        } catch {
          // ignore non-JSON
        }
        if (snapshots.length >= count) break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }

  return snapshots;
};

describe("/__elm-ssr/markets/stream (live market ticker)", () => {
  it("returns a text/event-stream response", async () => {
    const response = await worker.fetch(new Request("https://example.com/__elm-ssr/markets/stream"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });

  it("emits the initial snapshot immediately with the 4 expected coins", async () => {
    const response = await worker.fetch(new Request("https://example.com/__elm-ssr/markets/stream"));
    const snapshots = await readSnapshots(response, 1, 1000);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].coins.map((c) => c.id).sort()).toEqual(["bitcoin", "cardano", "ethereum", "solana"]);
    expect(snapshots[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-ish
  });

  it("subsequent snapshots have nudged prices (server is pushing fresh data, not the same payload)", async () => {
    const response = await worker.fetch(new Request("https://example.com/__elm-ssr/markets/stream"));
    const snapshots = await readSnapshots(response, 2);

    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    // At least one coin's price moved between the snapshots.
    const first = snapshots[0].coins;
    const second = snapshots[1].coins;
    const moved = first.some((coin, i) => coin.current_price !== second[i].current_price);
    expect(moved).toBe(true);

    // Timestamps advance.
    expect(Date.parse(snapshots[1].at)).toBeGreaterThan(Date.parse(snapshots[0].at));
  }, 8_000);

  it("the dashboard page itself still renders SSR-only", async () => {
    const response = await worker.fetch(new Request("https://example.com/"));
    expect(response.status).toBe(200);
    const html = await response.text();
    // Server-rendered fallback markup for the MarketOverview island.
    expect(html).toContain("Bitcoin");
    expect(html).toContain("data-elmssr-island=\"MarketOverview\"");
  });
});
