import { describe, expect, it } from "bun:test";
import { worker } from "../examples/basic/runtime";

// Phase 2: server Actions. A POST form submission runs the route's action, which
// validates, performs a server effect, then redirects (Post/Redirect/Get). All
// of this works with no client JavaScript.

const postEcho = (body: string) =>
  worker.fetch(
    new Request("https://example.com/echo", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    })
  );

describe("server actions (POST -> action -> redirect)", () => {
  it("runs an effectful action and redirects (PRG), no client JS", async () => {
    const response = await postEcho("message=hello");
    expect(response.status).toBe(302);
    // region comes from the action's server effect, so its presence proves the
    // effect ran inside the action before the redirect.
    expect(response.headers.get("location")).toBe("/echo?status=received&region=edge");
  });

  it("fails validation with 422 when the field is empty", async () => {
    const response = await postEcho("message=");
    expect(response.status).toBe(422);
  });

  it("fails validation with 422 when the field is whitespace only", async () => {
    const response = await postEcho("message=%20%20");
    expect(response.status).toBe(422);
  });

  it("fails validation with 422 when the field is missing", async () => {
    const response = await postEcho("");
    expect(response.status).toBe(422);
  });

  it("renders the form on GET and ships no client JS", async () => {
    const response = await worker.fetch(new Request("https://example.com/echo"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<form class="echo-form" method="post" action="/echo">');
    expect(html).toContain('name="message"');
    expect(html).not.toContain("/__elm-ssr/islands.js");
  });

  it("shows the confirmation page after the redirect", async () => {
    const response = await worker.fetch(new Request("https://example.com/echo?status=received&region=edge"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Message received");
    expect(html).toContain("region: edge");
  });

  it("still rejects non-POST/GET methods", async () => {
    const response = await worker.fetch(new Request("https://example.com/echo", { method: "PUT" }));
    expect(response.status).toBe(405);
  });
});
