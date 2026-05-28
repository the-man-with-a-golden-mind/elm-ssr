import type { IslandAsset } from "../app";

const encodeManifest = (islands: Record<string, IslandAsset>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(islands).map(([name, island]) => [
        name,
        {
          module: island.module,
          url: `/__elm-ssr/islands/${name}.js`
        }
      ])
    )
  );

export const createIslandsRuntimeSource = (islands: Record<string, IslandAsset>): string => `
const manifest = ${encodeManifest(islands)};

const lookupModule = (elm, moduleName) =>
  moduleName.split(".").reduce((current, part) => current?.[part], elm);

const bootIsland = async (root) => {
  const name = root.getAttribute("data-elmssr-island");
  const entry = name ? manifest[name] : undefined;

  if (!entry) {
    throw new Error("Unknown island: " + name);
  }

  const flags = JSON.parse(root.getAttribute("data-elmssr-props") || "{}");
  const { default: ElmModule } = await import(entry.url);
  const islandModule = lookupModule(ElmModule, entry.module);

  if (!islandModule || typeof islandModule.init !== "function") {
    throw new Error("Elm island module did not expose init(): " + entry.module);
  }

  islandModule.init({ node: root, flags });
};

const markers = document.querySelectorAll("[data-elmssr-island]");

for (const root of markers) {
  try {
    await bootIsland(root);
  } catch (error) {
    console.error("elm-ssr: failed to boot island", root.getAttribute("data-elmssr-island"), error);
  }
}
`;
