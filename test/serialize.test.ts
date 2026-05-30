import { describe, expect, it } from "bun:test";
import { renderHtmlDocument } from "elm-ssr/serialize";
import type { SsrDocument } from "elm-ssr/protocol";

describe("renderHtmlDocument", () => {
  it("escapes HTML in text and attributes", () => {
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: false,
      head: [
        {
          kind: "void",
          tag: "meta",
          attrs: [
            {
              kind: "attribute",
              name: "content",
              value: "\"quoted\" & <unsafe>"
            }
          ]
        }
      ],
      body: [
        {
          kind: "element",
          tag: "section",
          attrs: [],
          children: [
            {
              kind: "text",
              text: "<script>alert('xss')</script>"
            }
          ]
        }
      ]
    };

    const html = renderHtmlDocument(document);

    expect(html).toContain("&quot;quoted&quot; &amp; &lt;unsafe&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(html.startsWith("<!doctype html>")).toBeTrue();
  });

  it("ships no JS for a page without islands", () => {
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: false,
      head: [],
      body: [
        {
          kind: "element",
          tag: "section",
          attrs: [],
          children: [{ kind: "text", text: "Pure SSR only" }]
        }
      ]
    };

    const html = renderHtmlDocument(document);

    expect(html).toContain("Pure SSR only");
    expect(html).not.toContain("<script");
  });

  it("emits the island bootstrap when an island marker is present", () => {
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: true,
      head: [],
      body: [
        {
          kind: "element",
          tag: "elm-ssr-island",
          attrs: [
            { kind: "attribute", name: "data-elmssr-island", value: "Counter" },
            { kind: "attribute", name: "data-elmssr-props", value: "{\"start\":0}" }
          ],
          children: []
        }
      ]
    };

    const html = renderHtmlDocument(document);

    expect(html).toContain('data-elmssr-island="Counter"');
    expect(html).toContain("/__elm-ssr/islands.js");
  });
});
