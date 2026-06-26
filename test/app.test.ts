import { describe, expect, it } from "bun:test";
import { createWorkerApp } from "elm-ssr";
import { renderHtmlDocument } from "elm-ssr/serialize";
import { renderApp, type CompiledElmModule } from "elm-ssr/render";
import { createFlags, routes, worker, renderPath } from "../examples/basic/runtime";
import { islands, bundleSource } from "../generated/examples/basic/islands-manifest";
import { stylesheet } from "../examples/basic/styles";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../generated/examples/basic/app.mjs";

const elmModule = ElmRuntime as CompiledElmModule;

describe("example worker", () => {
  it("serves JSON health with middleware headers", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/health"));
    const body = await response.json() as { ok: boolean };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBeString();
    expect(response.headers.get("x-response-time")).toContain("ms");
    expect(response.headers.get("server-timing")).toContain("app;dur=");
    expect(body.ok).toBe(true);
  });

  it("lists route metadata including per-island assets", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/routes"));
    const body = await response.json() as typeof routes;

    expect(response.status).toBe(200);
    expect(body.pages).toBeArray();
    expect(body.assets.some((route) => route.path === "/__elm-ssr/islands-bundle.js")).toBe(true);
  });

  it("serves the island loader runtime and compiled Browser.element bundles", async () => {
    const runtimeResponse = await worker.fetch(new Request("https://example.com/__elm-ssr/islands.js"));
    const bundleResponse = await worker.fetch(new Request("https://example.com/__elm-ssr/islands-bundle.js"));
    const runtimeSource = await runtimeResponse.text();

    expect(runtimeResponse.status).toBe(200);
    expect(runtimeSource).toContain("data-elmssr-island");
    expect(runtimeSource).toContain("bootIslands");
    expect(runtimeSource).toContain("/__elm-ssr/islands-bundle.js");
    expect(bundleResponse.status).toBe(200);
    expect(await bundleResponse.text()).toContain("Browser");
  });

  it("renders HTML through the preview API", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/render?path=/counter"));
    const body = await response.json() as { status: number; html: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe(200);
    expect(body.html).toContain("Counter route");
    expect(body.html).toContain("elm-ssr-root");
  });

  it("rejects invalid API render requests", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/render?path=counter"));
    const body = await response.json() as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_path");
  });

  it("returns method not allowed for unsupported verbs", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/routes", { method: "PUT" }));
    const body = await response.json() as { error: string };

    expect(response.status).toBe(405);
    expect(body.error).toBe("method_not_allowed");
  });

  it("drops the body for HEAD requests while preserving headers", async () => {
    const response = await worker.fetch(new Request("https://example.com/counter", { method: "HEAD" }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe("");
    expect(response.headers.get("x-request-id")).toBeString();
  });

  it("normalizes internal errors for API callers", async () => {
    const brokenModule: CompiledElmModule = {
      Main: {
        init() {
          throw new Error("boom");
        }
      }
    };

    const app = createWorkerApp({
      elmModule: brokenModule,
      islands,
      islandsBundle: bundleSource,
      stylesheet,
      routes,
      createFlags: ({ path }) => ({ path })
    });

    const response = await app.fetch(new Request("https://example.com/api/render?path=/"));
    const body = await response.json() as { error: string; requestId: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_error");
    expect(body.requestId).toBeString();
  });

  it("normalizes internal errors for page requests", async () => {
    const brokenModule: CompiledElmModule = {
      Main: {
        init() {
          throw new Error("boom");
        }
      }
    };

    const app = createWorkerApp({
      elmModule: brokenModule,
      islands,
      islandsBundle: bundleSource,
      stylesheet,
      routes,
      createFlags: ({ path }) => ({ path })
    });

    const response = await app.fetch(new Request("https://example.com/"));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal Server Error");
  });
});

describe("render pipeline", () => {
  it("renders the home route", async () => {
    const result = await renderPath("/");
    const html = renderHtmlDocument(result.document);

    expect(result.status).toBe(200);
    expect(html).toContain("Write Elm once, render on the edge");
    expect(html).not.toContain("<script");
  });

  it("renders the counter page with Browser.element islands", async () => {
    const result = await renderPath("/counter");
    const html = renderHtmlDocument(result.document);

    expect(result.status).toBe(200);
    expect(html).toContain("Counter route");
    expect(html).toContain('data-elmssr-island="Counter"');
    expect(html).toContain('data-elmssr-island="Tasks"');
    expect(html).toContain("data-elmssr-props");
    expect(html).toContain("/__elm-ssr/islands.js");
    expect(html).not.toContain("data-elmssr-event-");
  });

  it("renders a 404 page for unknown routes", async () => {
    const result = await renderPath("/missing");
    const html = renderHtmlDocument(result.document);

    expect(result.status).toBe(404);
    expect(html).toContain("404");
    expect(html).toContain("Back to home");
  });

  it("renders a stateless loader page from a server effect with no client runtime", async () => {
    const result = await renderPath("/status");
    const html = renderHtmlDocument(result.document);

    expect(result.status).toBe(200);
    expect(html).toContain("Edge status");
    expect(html).toContain("Uptime: 99.98%");
    expect(html).toContain("Region: edge");
    expect(html).toContain("Builds: 128");
    expect(html).not.toContain("<script");
  });

  it("captures a dynamic route segment from the URL", async () => {
    const result = await renderPath("/greet/world");
    const html = renderHtmlDocument(result.document);

    expect(result.status).toBe(200);
    expect(html).toContain("Hello, world!");
  });

  it("falls back to NotFound for an unmatched dynamic prefix", async () => {
    const result = await renderPath("/greet");
    expect(result.status).toBe(404);
  });

  it("serves the loader page through the worker, pumping the effect loop", async () => {
    const response = await worker.fetch(new Request("https://example.com/status"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Uptime: 99.98%");
  });

  it("fails the loader page with the loader's status when an effect errors", async () => {
    const result = await renderApp(elmModule, createFlags({ path: "/status" }), {
      effects: async () => ({ ok: false, error: "upstream unavailable" })
    });
    const html = renderHtmlDocument(result.document);

    expect(result.status).toBe(502);
    expect(html).toContain("502");
    expect(html).toContain("upstream unavailable");
  });
});

// ---------------------------------------------------------------------------
// Page.* helper functions — metaCharset, metaViewport, metaName, stylesheet,
// document (lang/status), notFound (404 status)
// ---------------------------------------------------------------------------

describe("Page.* helpers (serialized HTML assertions)", () => {
  // Every route via Shared.baseHead uses all four meta helpers. The home
  // page is the simplest route that goes through them.
  it("Page.metaCharset renders <meta charset='...'> in the document head", async () => {
    const result = await renderPath("/");
    const html = renderHtmlDocument(result.document);
    expect(html).toContain('charset="utf-8"');
  });

  it("Page.metaViewport renders <meta name='viewport' content='...'> in the head", async () => {
    const result = await renderPath("/");
    const html = renderHtmlDocument(result.document);
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
  });

  it("Page.metaName renders an arbitrary <meta name='...' content='...'> pair", async () => {
    const result = await renderPath("/");
    const html = renderHtmlDocument(result.document);
    expect(html).toContain('name="description"');
    expect(html).toContain("Elm SSR library prototype");
  });

  it("Page.stylesheet renders a <link rel='stylesheet' href='...'> in the head", async () => {
    const result = await renderPath("/");
    const html = renderHtmlDocument(result.document);
    expect(html).toContain('rel="stylesheet"');
    expect(html).toContain('href="/styles.css"');
  });

  it("Page.page sets lang='en' and status 200 on the html element and response", async () => {
    const result = await renderPath("/");
    const html = renderHtmlDocument(result.document);
    expect(result.status).toBe(200);
    expect(html).toContain('lang="en"');
  });

  it("Page.notFound sets status 404 while still rendering a full HTML document", async () => {
    const result = await renderPath("/missing");
    const html = renderHtmlDocument(result.document);
    expect(result.status).toBe(404);
    // Head helpers still present on a 404 page.
    expect(html).toContain('charset="utf-8"');
    expect(html).toContain('lang="en"');
  });

  it("Page.document with a 502 status propagates that code through the render result", async () => {
    // The runtime synthesises a Page.error document (using Page.document internally)
    // when a loader fails. Verify that the status field flows through correctly.
    const result = await renderApp(elmModule, createFlags({ path: "/status" }), {
      effects: async () => ({ ok: false, error: "service down" })
    });
    expect(result.status).toBe(502);
    const html = renderHtmlDocument(result.document);
    // The runtime-generated error document still serialises to valid HTML.
    expect(html).toContain("<!doctype html>");  // serialiser emits lowercase per HTML5 spec
    expect(html).toContain("service down");
  });
});
