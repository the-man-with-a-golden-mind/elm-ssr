import { beforeAll, describe, expect, it } from "bun:test";
import { worker } from "../examples/basic/runtime";

// End-to-end coverage for ElmSsr.Svg: build an SVG tree in Elm, render the page
// on the server, and assert the serialized markup. This exercises the element
// set, the camelCase->SVG attribute-name mapping, text nodes, escaping, and the
// element-vs-void serialization — the things most likely to regress.

let html: string;

beforeAll(async () => {
  const response = await worker.fetch(new Request("https://example.com/chart"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type") || "").toContain("text/html");
  html = await response.text();
});

describe("server-rendered SVG (ElmSsr.Svg)", () => {
  it("renders the svg element and nested structure", () => {
    expect(html).toContain('<svg viewBox="0 0 200 100" width="200" height="100" class="sparkline">');
    expect(html).toContain("<defs>");
    expect(html).toContain('<linearGradient id="fill"');
    expect(html).toContain("</linearGradient>");
    expect(html).toContain("</defs>");
    expect(html).toContain("</svg>");
  });

  it("maps camelCase attribute names to the correct SVG attribute strings", () => {
    expect(html).toContain('stroke-width="3"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain('stop-color="#6366f1"');
    expect(html).toContain('stop-color="#0ea5e9"');
    expect(html).toContain('font-size="12"');
    expect(html).toContain('text-anchor="start"');
    // viewBox / x1 / y1 keep their casing (correct for SVG).
    expect(html).toContain('viewBox="0 0 200 100"');
    expect(html).toContain('x1="0"');
    // No leaked camelCase attribute names.
    expect(html).not.toContain("strokeWidth=");
    expect(html).not.toContain("stopColor=");
    expect(html).not.toContain("textAnchor=");
  });

  it("renders leaf elements with explicit closing tags (not void/self-closing)", () => {
    expect(html).toContain("</circle>");
    expect(html).toContain("</polyline>");
    expect(html).toContain("</rect>");
    expect(html).toContain("</stop>");
    expect(html).not.toContain("/>");
  });

  it("renders a text element with a text node and HTML-escapes its content", () => {
    expect(html).toContain('<text x="8" y="20" font-size="12" text-anchor="start" fill="#ffffff">');
    expect(html).toContain(">7-day trend &amp; momentum</text>");
    // The raw ampersand must not survive unescaped.
    expect(html).not.toContain("trend & momentum");
  });

  it("preserves attribute values that contain SVG-significant punctuation", () => {
    expect(html).toContain('fill="url(#fill)"');
    expect(html).toContain('points="0,80 40,60 80,70 120,30 160,45 200,10"');
    expect(html).toContain('transform="translate(0,0)"');
  });
});
