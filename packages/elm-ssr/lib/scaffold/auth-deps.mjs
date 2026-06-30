import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// elm-ssr's own package.json declares better-auth / @better-auth/infra as
// peerDependencies — the single source of truth for what version
// elm-ssr/auth/better-auth was built and tested against. The scaffold reads
// from there instead of keeping its own separate hardcoded version strings
// that could silently drift out of sync.
let cached = null;
export const authPeerDependencies = async () => {
  if (cached) return cached;
  const pkgPath = resolve(new URL(".", import.meta.url).pathname, "../../package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  cached = pkg.peerDependencies ?? {};
  return cached;
};
