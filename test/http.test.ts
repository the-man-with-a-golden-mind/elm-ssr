import { describe, expect, it } from "bun:test";
import { json, text, withHeaders } from "@elm-ssr/runtime-worker/http";

describe("json", () => {
  it("serializes the body and sets content-type when not already set", async () => {
    const response = json({ a: 1 });
    expect(response.headers.get("content-type") || "").toContain("application/json");
    expect(await response.json()).toEqual({ a: 1 });
  });

  it("respects an explicit status and merges extra headers", async () => {
    const response = json({ ok: true }, { status: 201, headers: { "x-custom": "yes" } });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-custom")).toBe("yes");
    expect(response.headers.get("content-type") || "").toContain("application/json");
  });

  it("does not overwrite a user-supplied content-type", async () => {
    const response = json({}, { headers: { "content-type": "application/vnd.api+json" } });
    expect(response.headers.get("content-type")).toBe("application/vnd.api+json");
  });
});

describe("text", () => {
  it("returns the body with a text/plain content-type by default", async () => {
    const response = text("hello");
    expect(response.headers.get("content-type") || "").toContain("text/plain");
    expect(await response.text()).toBe("hello");
  });

  it("respects status and lets users override content-type", async () => {
    const response = text("# title", { status: 200, headers: { "content-type": "text/markdown" } });
    expect(response.headers.get("content-type")).toBe("text/markdown");
  });
});

describe("withHeaders", () => {
  it("preserves the response body, status, and existing headers, then sets/overwrites the given ones", async () => {
    const original = new Response("body", {
      status: 202,
      headers: { "x-keep": "yes", "x-override": "old" }
    });
    const merged = withHeaders(original, { "x-override": "new", "x-add": "added" });
    expect(merged.status).toBe(202);
    expect(merged.headers.get("x-keep")).toBe("yes");
    expect(merged.headers.get("x-override")).toBe("new");
    expect(merged.headers.get("x-add")).toBe("added");
    expect(await merged.text()).toBe("body");
  });
});
