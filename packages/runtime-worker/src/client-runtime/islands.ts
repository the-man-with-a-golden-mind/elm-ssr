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

    if (app.ports.broadcastOut) {
      app.ports.broadcastOut.subscribe((event) => {
        window.dispatchEvent(new window.CustomEvent("elm-ssr-broadcast", { detail: event }));
      });
    }

    if (app.ports.broadcastIn) {
      const handler = (event) => app.ports.broadcastIn.send(event.detail);
      window.addEventListener("elm-ssr-broadcast", handler);
      cleanups.set(marker, () => window.removeEventListener("elm-ssr-broadcast", handler));
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

  const managedHeadNodes = (head) => {
    const metas = Array.prototype.slice.call(head.getElementsByTagName("meta"));
    const links = Array.prototype.slice
      .call(head.getElementsByTagName("link"))
      .filter((link) => link.getAttribute("rel") === "stylesheet");
    return metas.concat(links);
  };

  const syncHead = (sourceDoc) => {
    document.title = sourceDoc.title;

    for (const node of managedHeadNodes(document.head)) {
      node.remove();
    }

    for (const node of managedHeadNodes(sourceDoc.head)) {
      const copy = document.createElement(node.tagName);
      for (const name of node.getAttributeNames()) {
        copy.setAttribute(name, node.getAttribute(name));
      }
      document.head.appendChild(copy);
    }
  };

  const navigate = async (url, push = true) => {
    try {
      const response = await window.fetch("/api/render?path=" + encodeURIComponent(url.pathname + url.search));
      const result = await response.json();

      if (result.redirect) {
        window.location.href = result.redirect;
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

  return { bootIslands, navigate, handleLinkClick, persistentIslands, cleanups };
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
window.addEventListener("popstate", () => runtime.navigate(new URL(window.location.href), false));

runtime.bootIslands();
`;
