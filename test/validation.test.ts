import { describe, expect, it } from "bun:test";
import { worker } from "../examples/basic/runtime";

const postValidate = (body: string) =>
  worker.fetch(
    new Request("https://example.com/validate", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    })
  );

describe("request decoding & validation (ElmSsr.Request.Decode)", () => {
  it("renders the initial registration form on GET", async () => {
    const response = await worker.fetch(new Request("https://example.com/validate"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<form class="echo-form" method="post" action="/validate">');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="age"');
    expect(html).toContain('name="subscribe"');
  });

  it("successfully validates correct inputs and redirects to success status", async () => {
    const response = await postValidate("email=user@domain.com&age=25");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/validate?status=success");
  });

  it("handles optional fields and checkbox presence correctly", async () => {
    const response = await postValidate("email=user@domain.com&age=18&subscribe=on");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/validate?status=success");
  });

  it("accumulates multiple validation errors and redirects with query error parameters", async () => {
    const response = await postValidate("email=malformed-email&age=16");
    expect(response.status).toBe(302);
    const location = response.headers.get("location") || "";
    expect(location).toContain("error_email=Invalid email address");
    expect(location).toContain("error_age=Must be at least 18");
  });

  it("accumulates errors when required fields are completely missing", async () => {
    const response = await postValidate("");
    expect(response.status).toBe(302);
    const location = response.headers.get("location") || "";
    expect(location).toContain("error_email=Field is required");
    expect(location).toContain("error_age=Field is required");
  });

  it("renders the returned validation errors on GET when parameters are present", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/validate?error_email=Invalid email address&error_age=Must be at least 18")
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Invalid email address");
    expect(html).toContain("Must be at least 18");
  });
});
