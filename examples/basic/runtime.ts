import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects, type EffectRunner } from "elm-ssr/effects";
import { renderApp, type CompiledElmModule } from "elm-ssr/render";
import type { RouteCatalog } from "elm-ssr/http";
import { memorySessionStore } from "elm-ssr/sessions";
import { islands, bundleSource } from "../../generated/examples/basic/islands-manifest";
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
      path: "/__elm-ssr/islands-bundle.js",
      methods: ["GET", "HEAD"],
      description: "Shared Browser.element island bundle."
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

export const createFlags = ({ request, path, formData }: { request?: Request; url?: URL; path: string; formData?: Record<string, string> }) => {
  const [pathname, search = ""] = path.split("?");

  return {
    method: request?.method ?? "GET",
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
    formData: formData ?? {}
  };
};

export const statusFixture = { uptime: "99.98%", region: "edge", builds: 128 };

// The Worker owns effect execution. Locally we use the in-memory adapter: a Map
// cache, env values, and a fixture for the `app://status` fetch its loader uses.
// On Cloudflare you'd swap in `cloudflareEffects()` (KV/D1/env) without touching
// any Elm.
export const exampleEffects: EffectRunner = inMemoryEffects({
  env: { GREETING: "hello from the server env" },
  fetchJson: (url) => {
    if (url === "app://status") {
      return statusFixture;
    }

    throw new Error(`Unexpected fetchJson url in example: ${url}`);
  }
});

export const renderPath = async (path: string) =>
  renderApp(elmModule, createFlags({ path }), { effects: exampleEffects });

export const createExampleWorker = (options: { effects?: EffectRunner; log?: (entry: string) => void } = {}) =>
  createWorkerApp({
    elmModule,
    islands,
    islandsBundle: bundleSource,
    stylesheet,
    routes,
    createFlags,
    effects: options.effects ?? exampleEffects,
    log: options.log
  });

export const worker = createExampleWorker();

/**
 * A second example worker that enables sessions + CSRF (against an in-memory
 * store). Used by the /profile end-to-end tests. The hardened cookie defaults
 * are turned down for the example because tests run over plain HTTP — in
 * production `secure: true` is the default.
 */
export const createSessionExampleWorker = (
  options: { effects?: EffectRunner; log?: (entry: string) => void; secret?: string } = {}
) =>
  createWorkerApp({
    elmModule,
    islands,
    islandsBundle: bundleSource,
    stylesheet,
    routes,
    createFlags,
    effects: options.effects ?? exampleEffects,
    log: options.log,
    sessions: {
      secret: options.secret ?? "elm-ssr-example-dev-secret-do-not-use-in-prod",
      store: memorySessionStore(),
      secure: false
    },
    csrf: true
  });
