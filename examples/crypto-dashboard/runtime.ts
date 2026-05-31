import { createWorkerApp } from "elm-ssr";
import { defaultEffectRunner, type EffectRunner } from "elm-ssr/effects";
import { renderApp, type CompiledElmModule } from "elm-ssr/render";
import type { RouteCatalog, WorkerHandler } from "elm-ssr/http";
import { createSseStream } from "elm-ssr/sse";
import { islands, bundleSource } from "../../generated/examples/crypto-dashboard/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../../generated/examples/crypto-dashboard/app.mjs";

const elmModule = ElmRuntime as CompiledElmModule;

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/",
      methods: ["GET", "HEAD"],
      description: "Crypto Dashboard landing page."
    }
  ],
  assets: [
    {
      path: "/styles.css",
      methods: ["GET", "HEAD"],
      description: "Tailwind base styles."
    },
    {
      path: "/__elm-ssr/islands.js",
      methods: ["GET", "HEAD"],
      description: "Island loader runtime."
    },
    {
      path: "/__elm-ssr/islands-bundle.js",
      methods: ["GET", "HEAD"],
      description: "Shared island bundle (Charts, etc)."
    }
  ],
  utility: [
    {
      path: "/health",
      methods: ["GET", "HEAD"],
      description: "Liveness endpoint."
    }
  ],
  api: [
    {
      path: "/api/health",
      methods: ["GET", "HEAD"],
      description: "JSON health payload."
    },
    {
      path: "/api/render",
      methods: ["GET", "HEAD"],
      description: "SSR preview endpoint."
    }
  ]
};

export const createFlags = ({ request, path, formData }: { request?: Request; url?: URL; path: string; formData?: Record<string, string> }) => {
  const [pathname, search = ""] = path.split("?");

  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
    formData: formData ?? {}
  };
};

// Mock CoinGecko API for stable testing and fast builds
export const cryptoEffects: EffectRunner = async (effect, context) => {
  if (effect.kind === "fetchJson" && typeof effect.payload.url === "string" && effect.payload.url.includes("api.coingecko.com")) {
    return {
      ok: true,
      value: [
        { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 65000.0, price_change_percentage_24h: 2.5 },
        { id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3500.0, price_change_percentage_24h: -1.2 },
        { id: "cardano", symbol: "ada", name: "Cardano", current_price: 0.45, price_change_percentage_24h: 0.5 },
        { id: "solana", symbol: "sol", name: "Solana", current_price: 145.0, price_change_percentage_24h: 5.8 }
      ]
    };
  }

  return defaultEffectRunner(effect, context);
};

export const renderPath = async (path: string) =>
  renderApp(elmModule, createFlags({ path }), { effects: cryptoEffects });

/**
 * Live market ticker — emits the current snapshot every 2s with small
 * randomised nudges to `current_price` (±0.5%) so the cards visibly move.
 * Caps at 5 minutes per connection to avoid keeping a Worker hot for an
 * abandoned tab; the browser auto-reconnects after `retry` ms.
 *
 * Demonstrates server push as the live alternative to the route's stateful
 * polling — the page itself ships no JS; only the MarketOverview island
 * holds the EventSource.
 */
interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
}

const seedMarket: MarketCoin[] = [
  { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 65000.0, price_change_percentage_24h: 2.5 },
  { id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3500.0, price_change_percentage_24h: -1.2 },
  { id: "cardano", symbol: "ada", name: "Cardano", current_price: 0.45, price_change_percentage_24h: 0.5 },
  { id: "solana", symbol: "sol", name: "Solana", current_price: 145.0, price_change_percentage_24h: 5.8 }
];

const nudgePrice = (coin: MarketCoin): MarketCoin => {
  // ±0.5% random walk on the price; recompute the 24h % to reflect the drift.
  const delta = (Math.random() - 0.5) * 0.01;
  const next = Math.max(0.0001, coin.current_price * (1 + delta));
  const drift = (next / coin.current_price - 1) * 100;
  return {
    ...coin,
    current_price: Number(next.toFixed(6)),
    price_change_percentage_24h: Number((coin.price_change_percentage_24h + drift * 0.05).toFixed(3))
  };
};

const marketTicker = (request: Request): Response => {
  let snapshot = seedMarket.map((coin) => ({ ...coin }));
  return createSseStream(request, async (send, signal) => {
    // Push the current snapshot immediately so the client renders without delay.
    send(JSON.stringify({ coins: snapshot, at: new Date().toISOString() }));
    let pushes = 1;
    while (!signal.aborted && pushes < 150) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (signal.aborted) break;
      snapshot = snapshot.map(nudgePrice);
      send(JSON.stringify({ coins: snapshot, at: new Date().toISOString() }));
      pushes += 1;
    }
  });
};

/** Dispatch SSE routes before falling through to the elm-ssr handler. */
const withMarketStream = (base: WorkerHandler): WorkerHandler => ({
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);
    if (url.pathname === "/__elm-ssr/markets/stream") {
      return marketTicker(request);
    }
    return base.fetch(request, env, executionCtx);
  }
});

export const worker = withMarketStream(
  createWorkerApp({
    elmModule,
    islands,
    islandsBundle: bundleSource,
    stylesheet,
    routes,
    createFlags,
    effects: cryptoEffects
  })
);
