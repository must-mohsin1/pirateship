import { chmodSync, createReadStream, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../escrow-config.js";
import { createApiHandler } from "./app.mjs";
import { createContractVerifier } from "./contract-verifier.mjs";
import { assertPublicDeploymentMatches } from "./config-consistency.mjs";
import { KeyStore } from "./key-store.mjs";
import {
  createRedisProductKeyStore,
  productKeyMode,
} from "./redis-store-factory.mjs";
import {
  integerEnvironment,
  normalizePublicOrigin,
  requireEnvironment,
} from "./runtime-config.mjs";
import { resolvePublicFile } from "./static-files.mjs";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(serviceRoot, "../..");
const port = integerEnvironment(process.env, "PORT", "4173", 0);
const host = process.env.HOST ?? "127.0.0.1";
const publicOrigin = normalizePublicOrigin(
  process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`,
);
const corsOrigin = process.env.CORS_ORIGIN?.trim() ?? "";
const trustProxy = process.env.TRUST_PROXY === "true";

const rpcUrl = requireEnvironment(process.env, "RPC_URL");
const contractAddress = requireEnvironment(process.env, "CONTRACT_ADDRESS");
const adminToken = requireEnvironment(process.env, "ADMIN_TOKEN");
if (publicOrigin.startsWith("https://") && !trustProxy) {
  throw new Error(
    "TRUST_PROXY=true is required behind the documented HTTPS reverse proxy. Block direct access and make the proxy overwrite forwarding headers.",
  );
}

const publicEscrowConfig = globalThis.PIRATE_ESCROW_CONFIG;
const publicChainId = Number(BigInt(publicEscrowConfig.chainId));
const expectedChainId = integerEnvironment(
  process.env,
  "EXPECTED_CHAIN_ID",
  String(publicChainId),
);
assertPublicDeploymentMatches(
  publicEscrowConfig,
  contractAddress,
  expectedChainId,
);

process.umask(0o077);
const mode = productKeyMode(process.env, expectedChainId);
let store;
if (mode === "generated") {
  store = createRedisProductKeyStore({
    environment: process.env,
    contractAddress,
    expectedChainId,
  });
} else {
  const configuredDatabasePath = process.env.DATABASE_PATH ?? "data/product-keys.db";
  const databasePath =
    configuredDatabasePath === ":memory:"
      ? configuredDatabasePath
      : resolve(serviceRoot, configuredDatabasePath);
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(databasePath), 0o700);
  }
  store = new KeyStore(databasePath);
  if (databasePath !== ":memory:") chmodSync(databasePath, 0o600);
}
const verifyEntitlement = createContractVerifier({
  rpcUrl,
  contractAddress,
  expectedChainId,
  timeoutMs: integerEnvironment(process.env, "RPC_TIMEOUT_MS", "10000"),
});
const apiHandler = createApiHandler({
  store,
  verifyEntitlement,
  publicOrigin,
  adminToken,
  verificationMaxConcurrent: integerEnvironment(
    process.env,
    "VERIFICATION_MAX_CONCURRENT",
    "8",
  ),
  verificationMaxQueued: integerEnvironment(
    process.env,
    "VERIFICATION_MAX_QUEUED",
    "32",
    0,
  ),
  healthCheckTtlMs: integerEnvironment(
    process.env,
    "HEALTH_CHECK_TTL_MS",
    "10000",
  ),
  trustProxy,
});

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function serveStatic(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET, HEAD",
    });
    response.end("Method not allowed");
    return;
  }
  const url = new URL(request.url, publicOrigin);
  const filename = resolvePublicFile(repoRoot, url.pathname);
  if (!filename) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filename)] ?? "application/octet-stream",
    "Cache-Control": filename.endsWith("escrow-config.js") ? "no-store" : "no-cache",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' " + publicEscrowConfig.rpcUrls.join(" ") + " https://cloudflareinsights.com; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filename).pipe(response);
}

const server = createServer(async (request, response) => {
  if (request.url.startsWith("/api/")) {
    const requestOrigin = request.headers.origin;
    const originAllowed = Boolean(corsOrigin) && requestOrigin === corsOrigin;

    if (originAllowed) {
      response.setHeader("Access-Control-Allow-Origin", corsOrigin);
      response.setHeader("Vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      if (!originAllowed) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "This browser origin is not allowed." }));
        return;
      }
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }

    const handled = await apiHandler(request, response);
    if (!handled) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "API route not found." }));
    }
    return;
  }
  serveStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`Pirate Network launch server listening at ${publicOrigin}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    try {
      if (typeof store.close === "function") await store.close();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
