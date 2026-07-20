import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolvePublicFile } from "./static-files.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("serves only the public landing-page allowlist", () => {
  assert.equal(resolvePublicFile(repoRoot, "/"), resolve(repoRoot, "pirate-network-blog.html"));
  assert.equal(resolvePublicFile(repoRoot, "/page.js"), resolve(repoRoot, "page.js"));
  assert.equal(resolvePublicFile(repoRoot, "/escrow.js"), resolve(repoRoot, "escrow.js"));
  assert.equal(
    resolvePublicFile(repoRoot, "/assets/ocean-ship-poster.webp"),
    resolve(repoRoot, "assets/ocean-ship-poster.webp"),
  );

  assert.equal(resolvePublicFile(repoRoot, "/.env"), null);
  assert.equal(resolvePublicFile(repoRoot, "/services/product-key/server/index.mjs"), null);
  assert.equal(resolvePublicFile(repoRoot, "/assets/../.env"), null);
  assert.equal(resolvePublicFile(repoRoot, "/assets/%2e%2e/.env"), null);
});
