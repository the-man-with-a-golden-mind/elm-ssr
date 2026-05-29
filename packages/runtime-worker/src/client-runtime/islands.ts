import type { IslandMetadata } from "../app";

const encodeManifest = (islands: Record<string, IslandMetadata>): string =>
  JSON.stringify(islands);

export const createIslandsRuntimeSource = (islands: Record<string, IslandMetadata>): string => `
const manifest = ${encodeManifest(islands)};
const persistentIslands = new Map();

const lookupModule = (elm, moduleName) =>
  moduleName.split(".").reduce((current, part) => current?.[part], elm);

const bootIslands = async () => {
  const markers = document.querySelectorAll("[data-elmssr-island]");

  if (markers.length === 0) {
    return;
  }

  const { default: ElmModule } = await import("/__elm-ssr/islands-bundle.js");

  for (const root of markers) {
    // Skip if already booted (unless it's a persistent one we're about to transfer)
    if (root.getAttribute("data-elmssr-booted")) continue;

    try {
      const id = root.getAttribute("data-elmssr-id");
      
      // PERSISTENCE LOGIC: If we have a live instance for this ID, transfer it.
      if (id && persistentIslands.has(id)) {
        const liveElement = persistentIslands.get(id);
        if (liveElement !== root) {
          root.replaceWith(liveElement);
          // If the live element was booting or has ports, we might need to notify it.
          // For now, replacing the DOM node is enough to keep Elm happy.
          continue;
        }
      }

      const name = root.getAttribute("data-elmssr-island");
      const entry = name ? manifest[name] : undefined;

      if (!entry) {
        throw new Error("Unknown island: " + name);
      }

      const flags = JSON.parse(root.getAttribute("data-elmssr-props") || "{}");
      const islandModule = lookupModule(ElmModule, entry.module);

      if (!islandModule || typeof islandModule.init !== "function") {
        throw new Error("Elm island module did not expose init(): " + entry.module);
      }

      const app = islandModule.init({ node: root, flags });
      root.setAttribute("data-elmssr-booted", "true");
      
      if (id) {
        persistentIslands.set(id, root);
      }

      // Wire up Global Event Bus
      if (app.ports) {
        if (app.ports.broadcastOut) {
          app.ports.broadcastOut.subscribe((event) => {
            window.dispatchEvent(new CustomEvent("elm-ssr-broadcast", { detail: event }));
          });
        }

        if (app.ports.broadcastIn) {
          // Persistence: listeners stay active as long as the element is in the persistent map
          const handler = (event) => {
            if (persistentIslands.get(id) === root || document.contains(root)) {
               app.ports.broadcastIn.send(event.detail);
            } else if (!id) {
               // If not persistent and out of DOM, clean up
               window.removeEventListener("elm-ssr-broadcast", handler);
            }
          };
          window.addEventListener("elm-ssr-broadcast", handler);
        }
      }
    } catch (error) {
      console.error("elm-ssr: failed to boot island", root.getAttribute("data-elmssr-island"), error);
    }
  }
};

const navigate = async (url, push = true) => {
  try {
    const response = await fetch("/api/render?path=" + encodeURIComponent(url.pathname + url.search));
    const result = await response.json();

    if (result.redirect) {
      window.location.href = result.redirect;
      return;
    }

    if (result.html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(result.html, "text/html");
      
      document.title = doc.title;
      const newContent = doc.getElementById("elm-ssr-root");
      const currentRoot = document.getElementById("elm-ssr-root");
      
      if (newContent && currentRoot) {
        currentRoot.innerHTML = newContent.innerHTML;
        if (push) {
          window.history.pushState({}, "", url.href);
        }
        await bootIslands();
      }
    }
  } catch (error) {
    console.error("elm-ssr: navigation failed", error);
    window.location.href = url.href;
  }
};

window.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  if (link.getAttribute("target") === "_blank") return;
  if (link.getAttribute("download") !== null) return;
  
  const url = new URL(link.href);
  if (url.origin !== window.location.origin) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  event.preventDefault();
  navigate(url);
});

window.addEventListener("popstate", () => {
  navigate(new URL(window.location.href), false);
});

bootIslands();
`;
