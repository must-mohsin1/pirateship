import { chmodSync, createReadStream, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiHandler } from "./app.mjs";
import { createContractVerifier } from "./contract-verifier.mjs";
import { assertPublicContractMatches } from "./config-consistency.mjs";
import { KeyStore } from "./key-store.mjs";
import { resolvePublicFile } from "./static-files.mjs";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(serviceRoot, "../..");
const databasePath = resolve(serviceRoot, process.env.DATABASE_PATH ?? "data/product-keys.db");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const publicOrigin = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
const corsOrigin = process.env.CORS_ORIGIN?.trim() ?? "";
const trustProxy = process.env.TRUST_PROXY === "true";

for (const name of ["RPC_URL", "CONTRACT_ADDRESS", "ADMIN_TOKEN"]) {
  if (!process.env[name]) {
    throw new Error(`${name} is required. Copy .env.amoy.example to .env.amoy.`);
  }
}
if (publicOrigin.startsWith("https://") && !trustProxy) {
  throw new Error(
    "TRUST_PROXY=true is required behind the documented HTTPS reverse proxy. Block direct access and make the proxy overwrite forwarding headers.",
  );
}

const publicConfigSource = readFileSync(resolve(repoRoot, "escrow-config.js"), "utf8");
assertPublicContractMatches(publicConfigSource, process.env.CONTRACT_ADDRESS);

process.umask(0o077);
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
chmodSync(dirname(databasePath), 0o700);
const store = new KeyStore(databasePath);
chmodSync(databasePath, 0o600);
const verifyEntitlement = createContractVerifier({
  rpcUrl: process.env.RPC_URL,
  contractAddress: process.env.CONTRACT_ADDRESS,
  timeoutMs: Number(process.env.RPC_TIMEOUT_MS ?? 10_000),
});
const apiHandler = createApiHandler({
  store,
  verifyEntitlement,
  publicOrigin,
  adminToken: process.env.ADMIN_TOKEN,
  verificationMaxConcurrent: Number(process.env.VERIFICATION_MAX_CONCURRENT ?? 8),
  verificationMaxQueued: Number(process.env.VERIFICATION_MAX_QUEUED ?? 32),
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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
