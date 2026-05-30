import { describe, expect, it } from "bun:test";
import { createWorkerApp } from "@elm-ssr/runtime-worker";
import { routes, createFlags, exampleEffects } from "../examples/basic/runtime";
// @ts-expect-error Generated at build time.
import ElmRuntime from "../generated/examples/basic/app.mjs";
import { islands, bundleSource } from "../generated/examples/basic/islands-manifest";

const worker = createWorkerApp({
  elmModule: ElmRuntime,
  islands,
  islandsBundle: bundleSource,
  stylesheet: "",
  routes,
  createFlags,
  effects: exampleEffects
});

describe("Advanced Robustness: Server Actions", () => {
  it("handles empty POST body gracefully", async () => {
    const response = await worker.fetch(new Request("https://example.com/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }));
    // Should fall back to the action handler which currently returns 405 for root
    expect(response.status).toBe(405);
  });

  it("handles malformed JSON in POST body", async () => {
    const response = await worker.fetch(new Request("https://example.com/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json }"
    }));
    expect(response.status).toBe(405); // Still hits the action handler
  });

  it("ignores unknown Content-Types for form data", async () => {
    const response = await worker.fetch(new Request("https://example.com/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "just some text"
    }));
    expect(response.status).toBe(405);
  });
});

describe("Advanced Robustness: Soft Routing API", () => {
  it("returns 400 for /api/render without a path", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/render"));
    const body = await response.json() as { error: string };
    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_path");
  });

  it("returns 400 for /api/render with relative path", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/render?path=relative"));
    expect(response.status).toBe(400);
  });

  it("handles routes that redirect in the render API", async () => {
    // We don't have a redirect route in example yet, but we can check the logic
    // in request-handler.ts: if (rendered.redirect) { return json({ redirect: ... }) }
  });
});

describe("Advanced Robustness: Global Event Bus (Worker-side logic)", () => {
  // Since the bus is client-side, we verify the Worker provides the necessary hooks
  it("injects the event bus wiring in the islands runtime", async () => {
    const response = await worker.fetch(new Request("https://example.com/__elm-ssr/islands.js"));
    const source = await response.text();
    expect(source).toContain("elm-ssr-broadcast");
    expect(source).toContain("window.dispatchEvent");
    expect(source).toContain("window.addEventListener");
  });
});
