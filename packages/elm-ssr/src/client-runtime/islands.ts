import type { IslandMetadata } from "../app";

// The island client runtime, as a source string shipped to the browser. The
// core is factored into `createIslandsRuntime(deps)` so it can be exercised in
// tests against a real DOM with an injected Elm bundle; the browser tail just
// wires real globals and kicks it off.
export const islandsCoreSource = `
function lookupModule(elm, moduleName) {
  return moduleName.split(".").reduce((current, part) => (current ? current[part] : undefined), elm);
}

function createIslandsRuntime(deps) {
  const document = deps.document;
  const window = deps.window;
  const manifest = deps.manifest;
  const loadBundle = deps.loadBundle;

  const persistentIslands = new Map(); // id -> live marker element (kept across navigations)
  const cleanups = new Map();          // marker element -> () => void (remove its bus listener)

  const wireBus = (app, marker) => {
    if (!app || !app.ports) {
      return;
    }

    const teardowns = [];

    if (app.ports.broadcastOut) {
      app.ports.broadcastOut.subscribe((event) => {
        window.dispatchEvent(new window.CustomEvent("elm-ssr-broadcast", { detail: event }));
      });
    }

    if (app.ports.broadcastIn) {
      const handler = (event) => app.ports.broadcastIn.send(event.detail);
      window.addEventListener("elm-ssr-broadcast", handler);
      teardowns.push(() => window.removeEventListener("elm-ssr-broadcast", handler));
    }

    // Server-Sent Events ports. One EventSource per (url, island); the island
    // opens/closes via sseOpen/sseClose, and receives raw frames via sseEventIn.
    if (app.ports.sseOpen || app.ports.sseClose || app.ports.sseEventIn || app.ports.sseErrorIn) {
      const sources = new Map(); // url -> EventSource

      const open = (url) => {
        if (sources.has(url)) {
          return;
        }
        let source;
        try {
          source = new window.EventSource(url);
        } catch (error) {
          if (app.ports.sseErrorIn) {
            app.ports.sseErrorIn.send({ url, message: String(error) });
          }
          return;
        }
        source.onmessage = (event) => {
          if (app.ports.sseEventIn) {
            app.ports.sseEventIn.send({ url, data: typeof event.data === "string" ? event.data : "" });
          }
        };
        source.onerror = () => {
          if (app.ports.sseErrorIn) {
            app.ports.sseErrorIn.send({ url, message: "EventSource error" });
          }
        };
        sources.set(url, source);
      };

      const close = (url) => {
        const source = sources.get(url);
        if (source) {
          source.close();
          sources.delete(url);
        }
      };

      if (app.ports.sseOpen) {
        app.ports.sseOpen.subscribe(open);
      }
      if (app.ports.sseClose) {
        app.ports.sseClose.subscribe(close);
      }

      teardowns.push(() => {
        for (const source of sources.values()) {
          source.close();
        }
        sources.clear();
      });
    }

    if (teardowns.length > 0) {
      cleanups.set(marker, () => {
        for (const fn of teardowns) {
          fn();
        }
      });
    }
  };

  const bootMarker = (ElmModule, marker) => {
    const id = marker.getAttribute("data-elmssr-id");

    // A live persistent instance already exists: move it into this marker's
    // place instead of mounting a fresh one, preserving its state.
    if (id && persistentIslands.has(id)) {
      const live = persistentIslands.get(id);
      if (live !== marker) {
        marker.replaceWith(live);
      }
      return;
    }

    const name = marker.getAttribute("data-elmssr-island");
    const entry = name ? manifest[name] : undefined;

    if (!entry) {
      throw new Error("Unknown island: " + name);
    }

    const islandModule = lookupModule(ElmModule, entry.module);

    if (!islandModule || typeof islandModule.init !== "function") {
      throw new Error("Elm island module did not expose init(): " + entry.module);
    }

    const flags = JSON.parse(marker.getAttribute("data-elmssr-props") || "{}");

    // Browser.element replaces the node it mounts into, so mount into a child:
    // the <elm-ssr-island> marker stays in the DOM and is the persistent unit.
    while (marker.firstChild) {
      marker.removeChild(marker.firstChild);
    }

    const mount = document.createElement("div");
    marker.appendChild(mount);

    const app = islandModule.init({ node: mount, flags });
    marker.setAttribute("data-elmssr-booted", "true");

    if (id) {
      persistentIslands.set(id, marker);
    }

    wireBus(app, marker);
  };

  const findMarkers = (root) => Array.prototype.slice.call(root.getElementsByTagName("elm-ssr-island"));

  const bootIslands = async () => {
    const markers = findMarkers(document);

    if (markers.length === 0) {
      return;
    }

    const ElmModule = await loadBundle();

    for (const marker of markers) {
      if (marker.getAttribute("data-elmssr-booted")) {
        continue;
      }

      try {
        bootMarker(ElmModule, marker);
      } catch (error) {
        console.error("elm-ssr: failed to boot island", marker.getAttribute("data-elmssr-island"), error);
      }
    }
  };

  // Tear down islands that are about to be removed. Persistent islands are kept
  // alive (their refs live in persistentIslands and transfer to the next page),
  // so only non-persistent ones are cleaned up. Elm has no program shutdown, so
  // the controllable leak is the global bus listener — remove it here.
  const cleanupRemovedIslands = (container) => {
    for (const marker of findMarkers(container)) {
      const id = marker.getAttribute("data-elmssr-id");

      if (id && persistentIslands.get(id) === marker) {
        continue;
      }

      const cleanup = cleanups.get(marker);

      if (cleanup) {
        cleanup();
        cleanups.delete(marker);
      }
    }
  };

  const stylesheetLinks = (head) =>
    Array.prototype.slice
      .call(head.getElementsByTagName("link"))
      .filter((link) => link.getAttribute("rel") === "stylesheet");

  const metaNodes = (head) => Array.prototype.slice.call(head.getElementsByTagName("meta"));

  // Stable signature for diffing: href (+ media if set) for stylesheets,
  // full attribute set for metas. Two nodes with the same signature are
  // treated as identical; we never tear one down and re-create it.
  const stylesheetKey = (link) => (link.getAttribute("href") || "") + "|" + (link.getAttribute("media") || "");
  const metaKey = (meta) =>
    meta
      .getAttributeNames()
      .sort()
      .map((name) => name + "=" + meta.getAttribute(name))
      .join("|");

  // Diff-based sync: only add what's new, only remove what's gone. Avoids the
  // flash of unstyled content that came from removing-then-readding the
  // <link rel=stylesheet>, even when the href was identical across pages.
  const syncCollection = (currentNodes, incomingNodes, keyOf) => {
    const currentByKey = new Map();
    for (const node of currentNodes) {
      currentByKey.set(keyOf(node), node);
    }
    const incomingByKey = new Map();
    for (const node of incomingNodes) {
      incomingByKey.set(keyOf(node), node);
    }

    // Remove only what's not in the incoming doc.
    for (const [key, node] of currentByKey) {
      if (!incomingByKey.has(key)) {
        node.remove();
      }
    }

    // Add only what's not already present.
    for (const [key, node] of incomingByKey) {
      if (!currentByKey.has(key)) {
        const copy = document.createElement(node.tagName);
        for (const name of node.getAttributeNames()) {
          copy.setAttribute(name, node.getAttribute(name));
        }
        document.head.appendChild(copy);
      }
    }
  };

  const syncHead = (sourceDoc) => {
    if (document.title !== sourceDoc.title) {
      document.title = sourceDoc.title;
    }
    syncCollection(stylesheetLinks(document.head), stylesheetLinks(sourceDoc.head), stylesheetKey);
    syncCollection(metaNodes(document.head), metaNodes(sourceDoc.head), metaKey);
  };

  const navigate = async (url, push = true, options = {}) => {
    try {
      const renderUrl = "/api/render?path=" + encodeURIComponent(url.pathname + url.search);
      const response = await window.fetch(renderUrl, {
        method: options.method || "GET",
        body: options.body,
        headers: options.headers
      });
      const result = await response.json();

      if (result.redirect) {
        const redirectUrl = new URL(result.redirect, window.location.href);
        if (redirectUrl.origin === window.location.origin) {
          navigate(redirectUrl, push);
        } else {
          window.location.href = result.redirect;
        }
        return;
      }

      if (!result.html) {
        return;
      }

      const incoming = new window.DOMParser().parseFromString(result.html, "text/html");
      const newRoot = incoming.getElementById("elm-ssr-root");
      const currentRoot = document.getElementById("elm-ssr-root");

      if (!newRoot || !currentRoot) {
        return;
      }

      syncHead(incoming);
      cleanupRemovedIslands(currentRoot);
      currentRoot.innerHTML = newRoot.innerHTML;

      if (push) {
        window.history.pushState({}, "", url.href);
      }

      await bootIslands();
    } catch (error) {
      console.error("elm-ssr: navigation failed", error);
      window.location.href = url.href;
    }
  };

  const handleLinkClick = (event) => {
    const target = event.target;
    let link = target && target.nodeType === 1 ? target : target ? target.parentElement : null;

    while (link && link.tagName !== "A") {
      link = link.parentElement;
    }

    if (!link) {
      return;
    }

    if (link.getAttribute("target") === "_blank" || link.getAttribute("download") !== null) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const url = new URL(link.href);

    if (url.origin !== window.location.origin) {
      return;
    }

    // Same page (hash-only / in-page anchor): let the browser handle it.
    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      return;
    }

    event.preventDefault();
    navigate(url);
  };

  const handleFormSubmit = (event) => {
    const target = event.target;
    let form = target && target.nodeType === 1 ? target : null;

    while (form && form.tagName !== "FORM") {
      form = form.parentElement;
    }

    if (!form) {
      return;
    }

    const action = form.getAttribute("action") || window.location.pathname + window.location.search;
    const actionUrl = new URL(action, window.location.href);

    if (actionUrl.origin !== window.location.origin) {
      return;
    }

    if (form.getAttribute("target") === "_blank" || form.getAttribute("download") !== null) {
      return;
    }

    event.preventDefault();

    const method = (form.getAttribute("method") || "GET").toUpperCase();
    const formData = new window.FormData(form);

    if (method === "GET") {
      const params = new window.URLSearchParams(formData);
      actionUrl.search = params.toString();
      navigate(actionUrl);
    } else {
      const enctype = form.getAttribute("enctype") || "application/x-www-form-urlencoded";
      let body;
      let headers = {};

      if (enctype === "multipart/form-data") {
        body = formData;
      } else {
        body = new window.URLSearchParams(formData);
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }

      navigate(actionUrl, true, {
        method: "POST",
        body,
        headers
      });
    }
  };

  return { bootIslands, navigate, handleLinkClick, handleFormSubmit, persistentIslands, cleanups };
}
`;

const encodeManifest = (islands: Record<string, IslandMetadata>): string => JSON.stringify(islands);

export const createIslandsRuntimeSource = (islands: Record<string, IslandMetadata>): string => `
${islandsCoreSource}

const runtime = createIslandsRuntime({
  document,
  window,
  manifest: ${encodeManifest(islands)},
  loadBundle: () => import("/__elm-ssr/islands-bundle.js").then((module) => module.default)
});

window.addEventListener("click", runtime.handleLinkClick);
window.addEventListener("submit", runtime.handleFormSubmit);
window.addEventListener("popstate", () => runtime.navigate(new URL(window.location.href), false));

runtime.bootIslands();
`;
