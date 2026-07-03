import { beforeAll, describe, expect, it } from "bun:test";

// Dynamic import (instead of a static one) so we can clear globalThis.Elm
// first — Elm's _Platform_export merges into that shared global across the
// whole `bun test` process, and crashes if an earlier test's dynamically
// scaffolded app also registered a `Main` module there.
let renderPath: (path: string) => Promise<any>;

beforeAll(async () => {
  delete (globalThis as any).Elm;
  ({ renderPath } = await import("../examples/crypto-dashboard/runtime"));
});

describe("Crypto Dashboard Interoperability", () => {
  it("renders the dashboard with MarketOverview and PriceChart islands", async () => {
    const result = await renderPath("/");
    const html = result.document.body.map(n => JSON.stringify(n)).join("");

    expect(result.status).toBe(200);
    // Check for both islands
    expect(html).toContain('"value":"MarketOverview"');
    expect(html).toContain('"value":"PriceChart"');
    
    // Check for mocked coin names inside MarketOverview fallback
    expect(html).toContain("Bitcoin");
    expect(html).toContain("Ethereum");
  });

  it("MarketOverview island has correct props", async () => {
    const result = await renderPath("/");
    const html = result.document.body.map(n => JSON.stringify(n)).join("");

    // MarketOverview should contain the coin list in its props
    expect(html).toContain('bitcoin');
    expect(html).toContain('solana');
    expect(html).toContain('"name":"data-elmssr-id","value":"global-market-overview"');
  });

  it("PriceChart island uses global persistence ID", async () => {
    const result = await renderPath("/");
    const html = result.document.body.map(n => JSON.stringify(n)).join("");

    expect(html).toContain('"name":"data-elmssr-id","value":"btc-price-chart"');
  });
});
