import { describe, expect, it } from "bun:test";
import { renderHtmlDocument } from "@elm-ssr/runtime-worker/serialize";
import type { SsrDocument, SsrNode } from "@elm-ssr/runtime-worker/protocol";

describe("extended robustness tests", () => {
  it("handles deeply nested island markers with O(1) flag correctly", () => {
    // Even if markers are buried deep, the serializer relies on hasIslands
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: true,
      head: [],
      body: [
        {
          kind: "element",
          tag: "div",
          attrs: [],
          children: [
            {
              kind: "element",
              tag: "section",
              attrs: [],
              children: [
                {
                  kind: "element",
                  tag: "elm-ssr-island",
                  attrs: [{ kind: "attribute", name: "data-elmssr-island", value: "Deep" }],
                  children: []
                }
              ]
            }
          ]
        }
      ]
    };

    const html = renderHtmlDocument(document);
    expect(html).toContain("/__elm-ssr/islands.js");
  });

  it("respects hasIslands=false even if markers are accidentally present in tree", () => {
    // This verifies the serializer is TRULY O(1) and doesn't look at the tree if the flag is false
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: false,
      head: [],
      body: [
        {
          kind: "element",
          tag: "elm-ssr-island",
          attrs: [{ kind: "attribute", name: "data-elmssr-island", value: "Ghost" }],
          children: []
        }
      ]
    };

    const html = renderHtmlDocument(document);
    expect(html).not.toContain("/__elm-ssr/islands.js");
  });

  it("handles empty strings and null-like attributes safely", () => {
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: false,
      head: [],
      body: [
        {
          kind: "element",
          tag: "button",
          attrs: [
            { kind: "attribute", name: "class", value: "" },
            { kind: "attribute", name: "disabled", value: "disabled" }
          ],
          children: [{ kind: "text", text: "" }]
        }
      ]
    };

    const html = renderHtmlDocument(document);
    expect(html).toContain('class=""');
    expect(html).toContain('disabled="disabled"');
  });

  it("serializes complex event payloads correctly", () => {
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: false,
      head: [],
      body: [
        {
          kind: "element",
          tag: "div",
          attrs: [
            {
              kind: "event",
              name: "custom",
              payload: { foo: "bar", nested: [1, 2, 3] },
              capture: "value"
            }
          ],
          children: []
        }
      ]
    };

    const html = renderHtmlDocument(document);
    expect(html).toContain("data-elmssr-event-custom");
    // Check if JSON in attribute is correctly escaped
    expect(html).toContain("foo%22%3A%22bar");
  });

  it("renders void elements without closing tags", () => {
    const document: SsrDocument = {
      status: 200,
      lang: "en",
      hasIslands: false,
      head: [],
      body: [
        { kind: "void", tag: "img", attrs: [{ kind: "attribute", name: "src", value: "x" }] },
        { kind: "void", tag: "br", attrs: [] },
        { kind: "void", tag: "hr", attrs: [] }
      ]
    };

    const html = renderHtmlDocument(document);
    expect(html).toContain("<img src=\"x\">");
    expect(html).toContain("<br>");
    expect(html).toContain("<hr>");
    expect(html).not.toContain("</img>");
    expect(html).not.toContain("</br>");
  });
});
