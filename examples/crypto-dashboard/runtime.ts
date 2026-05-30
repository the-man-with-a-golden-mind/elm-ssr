import { createWorkerApp } from "elm-ssr";
import { defaultEffectRunner, type EffectRunner } from "elm-ssr/effects";
import { renderApp, type CompiledElmModule } from "elm-ssr/render";
import type { RouteCatalog } from "elm-ssr/http";
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

export const worker = createWorkerApp({
  elmModule,
  islands,
  islandsBundle: bundleSource,
  stylesheet,
  routes,
  createFlags,
  effects: cryptoEffects
});
