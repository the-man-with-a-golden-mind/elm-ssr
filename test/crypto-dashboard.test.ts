import { describe, expect, it } from "bun:test";
import { renderPath } from "../examples/crypto-dashboard/runtime";

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
