import { createWorkerApp } from "elm-ssr";
import { inMemoryEffects, type EffectRunner } from "elm-ssr/effects";
import { renderApp, type CompiledElmModule } from "elm-ssr/render";
import type { RouteCatalog, WorkerHandler } from "elm-ssr/http";
import { memorySessionStore } from "elm-ssr/sessions";
import { createSseStream } from "elm-ssr/sse";
import { memoryJobStore, withJobs, type JobHandlers } from "elm-ssr/jobs";
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
const baseEffects: EffectRunner = inMemoryEffects({
  env: { GREETING: "hello from the server env" },
  fetchJson: (url) => {
    if (url === "app://status") {
      return statusFixture;
    }

    throw new Error(`Unexpected fetchJson url in example: ${url}`);
  }
});

/**
 * Demonstrates `Loader.custom` + Promise.all fan-out: the /parallel route
 * emits a single `parallelMarkets` effect; the adapter runs three fake
 * "queries" concurrently and returns the combined payload. Wall-clock ≈ the
 * slowest query, not the sum. See docs/recipes/parallel-queries.md.
 */
const fakeQuery = async <T>(name: string, latencyMs: number, value: T): Promise<{ name: string; ms: number; value: T }> => {
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, latencyMs));
  return { name, ms: Math.round(performance.now() - start), value };
};

export const exampleEffects: EffectRunner = async (effect, context) => {
  if (effect.kind === "parallelMarkets") {
    const startedAt = performance.now();
    const [totals, recent, byCountry] = await Promise.all([
      fakeQuery("totalOrders", 60, 4217),
      fakeQuery("recentOrderIds", 80, [4217, 4216, 4215, 4214, 4213]),
      fakeQuery(
        "topCountries",
        70,
        [
          { country: "PL", total: 1402 },
          { country: "US", total: 1188 },
          { country: "DE", total: 803 }
        ] as Array<{ country: string; total: number }>
      )
    ]);
    return {
      ok: true,
      value: {
        totalOrders: totals.value,
        recentOrderIds: recent.value,
        topCountries: byCountry.value,
        timings: {
          totalMs: Math.round(performance.now() - startedAt),
          fanout: [
            { name: totals.name, ms: totals.ms },
            { name: recent.name, ms: recent.ms },
            { name: byCountry.name, ms: byCountry.ms }
          ]
        }
      }
    };
  }
  return baseEffects(effect, context);
};

/**
 * Background-job handlers — fan in from `withJobs` below. The `generateReport`
 * handler takes ~1.2s and reports progress at three checkpoints, which the
 * /reports page renders. A real-world handler would do heavy compute, big
 * SQL, vector search, etc.
 */
export const reportJobHandlers: JobHandlers = {
  generateReport: async (payload, ctx) => {
    const month = (payload as { month?: string }).month ?? "unknown";
    const phases = ["fetching orders", "grouping by country", "rendering"];
    const rows = [
      { country: "PL", total: 1402 },
      { country: "US", total: 1188 },
      { country: "DE", total: 803 },
      { country: "BR", total: 612 }
    ];
    for (let i = 0; i < phases.length; i += 1) {
      if (ctx.signal.aborted) {
        throw new Error("aborted");
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      await ctx.reportProgress({ phase: phases[i], step: i + 1, of: phases.length });
    }
    return { month, rows };
  }
};

// Per-process job store so /reports submissions can be polled. memory* is
// the dev/test default — production would use cacheJobStore(redisCache(...))
// so jobs survive isolate restarts and span instances.
export const jobStore = memoryJobStore();

const effectsWithJobs: EffectRunner = withJobs(exampleEffects, {
  store: jobStore,
  handlers: reportJobHandlers
});

export const renderPath = async (path: string) =>
  renderApp(elmModule, createFlags({ path }), { effects: effectsWithJobs });

/**
 * SSE endpoint demonstration — `/__elm-ssr/live`. Emits a JSON tick every
 * second. The Live island opens an EventSource against this URL and patches
 * its subtree as ticks arrive.
 *
 * `n` is a monotonic counter so the demo is obviously moving even if the
 * clock drifts between Worker isolates. We bound the loop at 600 ticks
 * (~10 min) so a forgotten tab doesn't keep a Worker hot forever.
 */
const liveStreamHandler = (request: Request): Response =>
  createSseStream(request, async (send, signal) => {
    let n = 0;
    while (!signal.aborted && n < 600) {
      n += 1;
      send(JSON.stringify({ time: new Date().toISOString(), n }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });

/**
 * Wraps a base worker so `/__elm-ssr/live` returns the SSE stream and
 * everything else falls through to the elm-ssr handler. This is the pattern
 * users follow whenever they want custom routes alongside Elm: dispatch
 * yourself, fall through to `worker.fetch`.
 */
const withLiveStream = (base: WorkerHandler): WorkerHandler => ({
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);
    if (url.pathname === "/__elm-ssr/live") {
      return liveStreamHandler(request);
    }
    return base.fetch(request, env, executionCtx);
  }
});

export const createExampleWorker = (options: { effects?: EffectRunner; log?: (entry: string) => void } = {}) =>
  withLiveStream(
    createWorkerApp({
      elmModule,
      islands,
      islandsBundle: bundleSource,
      stylesheet,
      routes,
      createFlags,
      effects: options.effects ?? effectsWithJobs,
      log: options.log
    })
  );

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
