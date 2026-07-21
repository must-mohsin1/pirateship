import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const ROOT_FILES = new Map([
  ["/", "pirate-network-blog.html"],
  ["/pirate-network-blog.html", "pirate-network-blog.html"],
  ["/mainnet-release-criteria.html", "mainnet-release-criteria.html"],
  ["/page.js", "page.js"],
  ["/escrow.js", "escrow.js"],
  ["/escrow-config.js", "escrow-config.js"],
  ["/tokens.css", "tokens.css"],
]);

export function resolvePublicFile(repoRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const rootFilename = ROOT_FILES.get(decoded);
  if (rootFilename) {
    const filename = resolve(repoRoot, rootFilename);
    return existsSync(filename) && !statSync(filename).isDirectory() ? filename : null;
  }

  if (!decoded.startsWith("/assets/")) return null;
  const assetsRoot = resolve(repoRoot, "assets");
  const filename = resolve(repoRoot, decoded.slice(1));
  if (!filename.startsWith(`${assetsRoot}${sep}`)) return null;
  return existsSync(filename) && !statSync(filename).isDirectory() ? filename : null;
}
