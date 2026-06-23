import { describe, expect, it } from "bun:test";
import { createWorkerApp } from "elm-ssr";
import { CompiledElmModule } from "elm-ssr/render";
import { createFlags, routes, exampleEffects } from "../examples/basic/runtime";
import { islands, bundleSource } from "../generated/examples/basic/islands-manifest";
import { stylesheet } from "../examples/basic/styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../generated/examples/basic/app.mjs";

const elmModule = ElmRuntime as CompiledElmModule;

const createTestWorker = (debug?: boolean) =>
  createWorkerApp({
    elmModule,
    islands,
    islandsBundle: bundleSource,
    stylesheet,
    routes,
    createFlags,
    effects: exampleEffects,
    debug
  });

describe("frontend debugger devtools", () => {
  it("injects debug panel overlay and instrumentation logs when debug is enabled", async () => {
    const worker = createTestWorker(true);
    const response = await worker.fetch(new Request("https://example.com/status"));
    expect(response.status).toBe(200);
    
    const html = await response.text();
    
    // Check that devtools UI elements and styles are injected:
    expect(html).toContain("elm-ssr DevTools");
    expect(html).toContain("#elm-ssr-debug-panel");
    expect(html).toContain("#elm-ssr-debug-toggle");
    
    // Verify that loader server effects were correctly logged and serialized:
    expect(html).toContain("cacheGet");
    expect(html).toContain("status");
    expect(html).toContain("env");
    expect(html).toContain("GREETING");
  });

  it("does NOT inject debug panel overlay and instrumentation logs when debug is disabled", async () => {
    const worker = createTestWorker(false);
    const response = await worker.fetch(new Request("https://example.com/status"));
    expect(response.status).toBe(200);
    
    const html = await response.text();
    
    expect(html).not.toContain("elm-ssr DevTools");
    expect(html).not.toContain("#elm-ssr-debug-panel");
    expect(html).not.toContain("#elm-ssr-debug-toggle");
  });

  it("includes debug update payload on API render requests when debug is enabled", async () => {
    const worker = createTestWorker(true);
    const response = await worker.fetch(new Request("https://example.com/api/render?path=/status"));
    expect(response.status).toBe(200);
    
    const body = await response.json() as {
      status: number;
      html: string;
      debug?: {
        url: string;
        method: string;
        status: number;
        effects: Array<{ kind: string; payload: Record<string, unknown>; ok: boolean }>;
      };
    };
    
    expect(body.debug).toBeDefined();
    expect(body.debug!.method).toBe("GET");
    expect(body.debug!.status).toBe(200);
    expect(body.debug!.effects.some(eff => eff.kind === "cacheGet")).toBe(true);
  });

  it("does NOT include debug update payload on API render requests when debug is disabled", async () => {
    const worker = createTestWorker(false);
    const response = await worker.fetch(new Request("https://example.com/api/render?path=/status"));
    expect(response.status).toBe(200);
    
    const body = await response.json() as { debug?: unknown };
    expect(body.debug).toBeUndefined();
  });
});
