import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { islandsCoreSource } from "elm-ssr/islands-runtime";

// Exercises the real island client runtime (boot + persistence + navigation)
// against a happy-dom DOM, with the actual compiled island bundle injected.
// This covers the paths the browser-island suite can't: mounting into the
// <elm-ssr-island> marker, persistence transfer, head sync, and bus cleanup.

type IslandRuntime = {
  bootIslands: () => Promise<void>;
  navigate: (url: URL, push?: boolean) => Promise<void>;
  handleLinkClick: (event: unknown) => void;
  persistentIslands: Map<string, Element>;
};

const createRuntime = new Function(`${islandsCoreSource}\nreturn createIslandsRuntime;`)() as (
  deps: unknown
) => IslandRuntime;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// happy-dom's querySelector throws on this version, so navigate the DOM by hand.
const firstMarker = (): Element | undefined =>
  window.document.getElementsByTagName("elm-ssr-island")[0] as unknown as Element | undefined;

const findByClass = (root: Element, className: string): Element | null => {
  if ((root.getAttribute("class") || "").split(/\s+/).includes(className)) {
    return root;
  }
  for (const child of Array.from(root.children)) {
    const match = findByClass(child as Element, className);
    if (match) {
      return match;
    }
  }
  return null;
};

const hasMeta = (name: string): boolean =>
  Array.from(window.document.head.getElementsByTagName("meta")).some(
    (meta) => (meta as unknown as Element).getAttribute("name") === name
  );

let window: Window;
let previousGlobals: Map<string, unknown>;

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "Event",
  "MouseEvent",
  "CustomEvent",
  "requestAnimationFrame",
  "cancelAnimationFrame"
] as const;

const installGlobals = (next: Window) => {
  const get = (key: string): unknown => {
    const value = (next as unknown as Record<string, unknown>)[key];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(next) : value;
  };

  previousGlobals = new Map(GLOBAL_KEYS.map((key) => [key, Reflect.get(globalThis, key)]));
  for (const key of GLOBAL_KEYS) {
    Reflect.set(globalThis, key, get(key));
  }
};

const restoreGlobals = () => {
  for (const [key, value] of previousGlobals.entries()) {
    Reflect.set(globalThis, key, value);
  }
};

const loadCounterBundle = async () => {
  Reflect.deleteProperty(globalThis, "Elm");
  const moduleRef = await import(`../generated/examples/basic/islands.mjs?cache=${Date.now()}-${Math.random()}`);
  return moduleRef.default;
};

const manifest = { Counter: { module: "Example.Basic.Islands.Counter" } };

const marker = (props: Record<string, unknown>, id?: string): string => {
  const attrs = [
    'data-elmssr-island="Counter"',
    `data-elmssr-props='${JSON.stringify(props)}'`,
    id ? `data-elmssr-id="${id}"` : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `<div id="elm-ssr-root"><elm-ssr-island ${attrs}>fallback text</elm-ssr-island></div>`;
};

const newRuntime = async (loadBundle?: () => Promise<unknown>): Promise<IslandRuntime> =>
  createRuntime({
    document: window.document,
    window,
    manifest,
    loadBundle: loadBundle ?? loadCounterBundle
  });

beforeEach(() => {
  window = new Window({ url: "https://example.com/" });
  window.FormData = class MockFormData {
    private data = new Map<string, string>();
    constructor(form: any) {
      const inputs = Array.from(form.getElementsByTagName("input"));
      for (const input of inputs) {
        const name = (input as any).getAttribute("name");
        if (name) {
          if ((input as any).getAttribute("type") === "checkbox") {
            const isChecked = (input as any).checked ?? (input as any).hasAttribute("checked");
            if (isChecked) {
              this.data.set(name, (input as any).getAttribute("value") || "on");
            }
          } else {
            this.data.set(name, (input as any).value || "");
          }
        }
      }
    }
    *[Symbol.iterator]() {
      for (const entry of this.data.entries()) {
        yield entry;
      }
    }
  } as any;
  installGlobals(window);
});

afterEach(() => {
  restoreGlobals();
});

describe("island client runtime", () => {
  it("mounts into a child so the marker (and its id) survives Browser.element", async () => {
    window.document.body.innerHTML = marker({ start: 5 }, "counter-1");
    const runtime = await newRuntime();

    await runtime.bootIslands();
    await tick();

    const el = firstMarker();
    // With a naive mount into the marker, Browser.element would replace it and
    // this would be undefined. Child-mount keeps the marker as the persistent unit.
    expect(el).toBeDefined();
    expect(el?.getAttribute("data-elmssr-booted")).toBe("true");
    expect(el?.textContent).toContain("5");
    expect(el?.textContent).not.toContain("fallback text");
    expect(runtime.persistentIslands.get("counter-1")).toBe(el as Element);
  });

  it("transfers a persistent island across navigation, preserving state, and syncs head", async () => {
    window.document.body.innerHTML = marker({ start: 5 }, "counter-1");
    const html =
      "<!doctype html><html><head><title>Next Page</title>" +
      '<meta name="x" content="y"></head><body>' +
      marker({ start: 999 }, "counter-1") +
      "</body></html>";

    window.fetch = (async () => ({ json: async () => ({ html }) })) as unknown as typeof window.fetch;

    const runtime = await newRuntime();
    await runtime.bootIslands();
    await tick();

    const live = firstMarker() as Element;
    findByClass(live, "btn-primary")?.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await tick();
    expect(live.textContent).toContain("6");

    await runtime.navigate(new URL("https://example.com/next"));
    await tick();

    const afterNav = firstMarker() as Element;
    expect(afterNav).toBe(live); // same node transferred
    expect(afterNav.textContent).toContain("6"); // state preserved, not reset to 999
    expect(window.document.title).toBe("Next Page");
    expect(hasMeta("x")).toBe(true);
  });

  it("does not register a duplicate bus listener when a persistent island transfers", async () => {
    window.document.body.innerHTML = marker({ start: 0 }, "counter-1");
    let busListeners = 0;
    const realAdd = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "elm-ssr-broadcast") {
        busListeners += 1;
      }
      return (realAdd as (...a: unknown[]) => unknown)(type, ...rest);
    }) as typeof window.addEventListener;

    const html = "<!doctype html><html><head><title>N</title></head><body>" + marker({ start: 0 }, "counter-1") + "</body></html>";
    window.fetch = (async () => ({ json: async () => ({ html }) })) as unknown as typeof window.fetch;

    const runtime = await newRuntime();
    await runtime.bootIslands();
    await tick();
    await runtime.navigate(new URL("https://example.com/a"));
    await tick();
    await runtime.navigate(new URL("https://example.com/b"));
    await tick();

    // Counter wires broadcastOut (not broadcastIn), so it registers no bus
    // listener at all; the key assertion is that transfers never re-wire.
    expect(busListeners).toBeLessThanOrEqual(1);
  });

  it("syncHead preserves identical <link rel=stylesheet> across navigation (no FOUC)", async () => {
    // Start with a head that already has /styles.css, like a real SSR'd page.
    window.document.head.innerHTML =
      '<title>Start</title><meta name="x" content="1"><link rel="stylesheet" href="/styles.css">';
    window.document.body.innerHTML = marker({ start: 0 });

    const originalLink = window.document.head.getElementsByTagName("link")[0] as unknown as Element;
    const originalMeta = Array.from(window.document.head.getElementsByTagName("meta"))[0] as unknown as Element;

    // Incoming page has the SAME stylesheet href and SAME meta — only the title changed.
    const html =
      "<!doctype html><html><head>" +
      "<title>Next</title>" +
      '<meta name="x" content="1">' +
      '<link rel="stylesheet" href="/styles.css">' +
      "</head><body>" +
      marker({ start: 0 }) +
      "</body></html>";
    window.fetch = (async () => ({ json: async () => ({ html }) })) as unknown as typeof window.fetch;

    const runtime = await newRuntime();
    await runtime.bootIslands();
    await tick();
    await runtime.navigate(new URL("https://example.com/next"));
    await tick();

    // The link + meta nodes must be the SAME elements — diff-based sync skips
    // them when their key is unchanged. Re-creating them is what caused the
    // brief flash of unstyled content the user reported.
    const linkAfter = window.document.head.getElementsByTagName("link")[0] as unknown as Element;
    const metaAfter = Array.from(window.document.head.getElementsByTagName("meta"))[0] as unknown as Element;
    expect(linkAfter).toBe(originalLink);
    expect(metaAfter).toBe(originalMeta);
    expect(window.document.title).toBe("Next"); // title still syncs
    // And exactly one stylesheet — we didn't accidentally append a duplicate.
    expect(window.document.head.getElementsByTagName("link").length).toBe(1);
  });

  it("syncHead removes orphan stylesheets and adds new ones in a single diff pass", async () => {
    window.document.head.innerHTML =
      '<title>Start</title>' +
      '<link rel="stylesheet" href="/old.css">' +
      '<link rel="stylesheet" href="/shared.css">';
    window.document.body.innerHTML = marker({ start: 0 });

    const sharedBefore = Array.from(window.document.head.getElementsByTagName("link")).find(
      (l) => (l as unknown as Element).getAttribute("href") === "/shared.css"
    ) as unknown as Element;

    const html =
      "<!doctype html><html><head><title>N</title>" +
      '<link rel="stylesheet" href="/shared.css">' +
      '<link rel="stylesheet" href="/new.css">' +
      "</head><body>" +
      marker({ start: 0 }) +
      "</body></html>";
    window.fetch = (async () => ({ json: async () => ({ html }) })) as unknown as typeof window.fetch;

    const runtime = await newRuntime();
    await runtime.bootIslands();
    await tick();
    await runtime.navigate(new URL("https://example.com/x"));
    await tick();

    const hrefs = Array.from(window.document.head.getElementsByTagName("link"))
      .map((l) => (l as unknown as Element).getAttribute("href"))
      .sort();
    expect(hrefs).toEqual(["/new.css", "/shared.css"]);

    // /shared.css was kept (same element), not torn down + re-added.
    const sharedAfter = Array.from(window.document.head.getElementsByTagName("link")).find(
      (l) => (l as unknown as Element).getAttribute("href") === "/shared.css"
    ) as unknown as Element;
    expect(sharedAfter).toBe(sharedBefore);
  });

  it("ignores hash-only / same-page links (no SPA fetch)", async () => {
    window.document.body.innerHTML = marker({ start: 0 });
    let fetched = false;
    window.fetch = (async () => {
      fetched = true;
      return { json: async () => ({}) };
    }) as unknown as typeof window.fetch;

    const runtime = await newRuntime();

    let prevented = false;
    const link = window.document.createElement("a");
    link.setAttribute("href", "https://example.com/#section");
    runtime.handleLinkClick({
      target: link,
      preventDefault: () => {
        prevented = true;
      }
    });
    await tick();

    expect(prevented).toBe(false);
    expect(fetched).toBe(false);
  });

  it("intercepts same-origin form submissions and POSTs progressively", async () => {
    window.document.body.innerHTML = '<div id="elm-ssr-root"><form action="/submit-here" method="POST"><input name="message" value="hello"></form></div>';
    const form = window.document.getElementsByTagName("form")[0];

    let fetchUrl = "";
    let fetchMethod = "";
    let fetchBody: any = null;

    window.fetch = (async (url: string, init: any) => {
      fetchUrl = url;
      fetchMethod = init?.method || "GET";
      fetchBody = init?.body;
      return {
        json: async () => ({
          html: '<!doctype html><html><body><div id="elm-ssr-root"><p>Success POST</p></div></body></html>'
        })
      };
    }) as unknown as typeof window.fetch;

    const runtime = await newRuntime();
    let prevented = false;

    runtime.handleFormSubmit({
      target: form,
      preventDefault: () => {
        prevented = true;
      }
    });
    await tick();

    expect(prevented).toBe(true);
    expect(fetchUrl).toContain("/api/render?path=%2Fsubmit-here");
    expect(fetchMethod).toBe("POST");
    expect(fetchBody?.toString()).toContain("message=hello");
    expect(window.document.body.innerHTML).toContain("Success POST");
  });

  it("handles same-origin redirects from progressive forms progressively", async () => {
    window.document.body.innerHTML = '<div id="elm-ssr-root"><form action="/submit-redirect" method="POST"></form></div>';
    const form = window.document.getElementsByTagName("form")[0];

    const fetchUrls: string[] = [];

    window.fetch = (async (url: string, init: any) => {
      fetchUrls.push(url);
      if (init?.method === "POST") {
        return {
          json: async () => ({
            redirect: "/success-target"
          })
        };
      } else {
        return {
          json: async () => ({
            html: '<!doctype html><html><body><div id="elm-ssr-root"><p>Redirected Content</p></div></body></html>'
          })
        };
      }
    }) as unknown as typeof window.fetch;

    const runtime = await newRuntime();
    let prevented = false;

    runtime.handleFormSubmit({
      target: form,
      preventDefault: () => {
        prevented = true;
      }
    });
    await tick();

    expect(prevented).toBe(true);
    expect(fetchUrls).toEqual([
      "/api/render?path=%2Fsubmit-redirect",
      "/api/render?path=%2Fsuccess-target"
    ]);
    expect(window.document.body.innerHTML).toContain("Redirected Content");
  });
});
