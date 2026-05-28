import { createWorkerApp } from "../../packages/runtime-worker/src/app";
import { defaultEffectRunner, type EffectRunner } from "../../packages/runtime-worker/src/effects";
import { renderApp, type CompiledElmModule } from "../../packages/runtime-worker/src/render";
import type { RouteCatalog } from "../../packages/runtime-worker/src/http";
import islands from "../../generated/examples/basic/islands-manifest";
import { stylesheet } from "./styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../../generated/examples/basic/app.mjs";

const elmModule = ElmRuntime as CompiledElmModule;

export const routes: RouteCatalog = {
  pages: [
    {
      path: "/",
      methods: ["GET", "HEAD"],
      description: "Stateless landing page rendered from Elm (no client runtime)."
    },
    {
      path: "/status",
      methods: ["GET", "HEAD"],
      description: "Stateless page whose Loader fetches data on the server."
    },
    {
      path: "/counter",
      methods: ["GET", "HEAD"],
      description: "SSR page that embeds Browser.element islands."
    },
    {
      path: "/greet/:name",
      methods: ["GET", "HEAD"],
      description: "Dynamic route; the name segment is captured from the URL."
    }
  ],
  assets: [
    {
      path: "/styles.css",
      methods: ["GET", "HEAD"],
      description: "Example stylesheet."
    },
    {
      path: "/__elm-ssr/islands.js",
      methods: ["GET", "HEAD"],
      description: "Island loader runtime."
    },
    {
      path: "/__elm-ssr/islands/Counter.js",
      methods: ["GET", "HEAD"],
      description: "Counter Browser.element island bundle."
    },
    {
      path: "/__elm-ssr/islands/Tasks.js",
      methods: ["GET", "HEAD"],
      description: "Tasks Browser.element island bundle."
    }
  ],
  utility: [
    {
      path: "/health",
      methods: ["GET", "HEAD"],
      description: "Plain text liveness endpoint."
    }
  ],
  api: [
    {
      path: "/api/health",
      methods: ["GET", "HEAD"],
      description: "JSON health payload."
    },
    {
      path: "/api/routes",
      methods: ["GET", "HEAD"],
      description: "Route registry for the example app."
    },
    {
      path: "/api/render",
      methods: ["GET", "HEAD"],
      description: "SSR preview endpoint."
    }
  ]
};

export const createFlags = ({ request, path }: { request?: Request; url?: URL; path: string }) => {
  const [pathname, search = ""] = path.split("?");

  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search))
  };
};

// The Worker owns effect execution. Here the example serves an in-memory
// dataset for the `app://status` URL its loader requests, and falls back to a
// real fetch for everything else.
export const exampleEffects: EffectRunner = async (effect) => {
  if (effect.kind === "fetchJson" && effect.payload.url === "app://status") {
    return {
      ok: true,
      value: { uptime: "99.98%", region: "edge", builds: 128 }
    };
  }

  return defaultEffectRunner(effect);
};

export const renderPath = async (path: string) =>
  renderApp(elmModule, createFlags({ path }), { effects: exampleEffects });

export const createExampleWorker = (log?: (entry: string) => void) =>
  createWorkerApp({
    elmModule,
    islands,
    stylesheet,
    routes,
    createFlags,
    effects: exampleEffects,
    log
  });

export const worker = createExampleWorker();
