import { Readable } from "node:stream";
import { Redis } from "@upstash/redis";
import { createApiHandler } from "./app.mjs";
import { createContractVerifier } from "./contract-verifier.mjs";
import { RedisKeyStore } from "./redis-key-store.mjs";

function requireEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required by the product-key function.`);
  return value;
}

function normalizePublicOrigin(value) {
  const url = new URL(value);
  if (url.origin !== value.replace(/\/$/, "")) {
    throw new Error("PUBLIC_ORIGIN must contain only the public scheme and host.");
  }
  return url.origin;
}

function createNodeRequest(request) {
  const input = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
  input.method = request.method;
  const url = new URL(request.url);
  input.url = `${url.pathname}${url.search}`;
  input.headers = Object.fromEntries(request.headers.entries());
  const clientIp =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "vercel-edge";
  // Vercel overwrites its forwarding headers. Normalize the handler-facing
  // value so a client-supplied generic header cannot select a rate-limit key.
  input.headers["x-forwarded-for"] = clientIp;
  input.socket = { remoteAddress: clientIp };
  return input;
}

async function invokeNodeHandler(apiHandler, request) {
  const input = createNodeRequest(request);
  let resolveResponse;
  const completed = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const headers = new Headers();
  let status = 200;
  let ended = false;
  const output = {
    setHeader(name, value) {
      headers.set(name, String(value));
    },
    writeHead(nextStatus, nextHeaders = {}) {
      status = nextStatus;
      for (const [name, value] of Object.entries(nextHeaders)) {
        headers.set(name, String(value));
      }
      return this;
    },
    end(body = "") {
      if (ended) return;
      ended = true;
      headers.set("Referrer-Policy", "no-referrer");
      resolveResponse(new Response(body, { status, headers }));
    },
  };

  const handled = await apiHandler(input, output);
  if (!handled && !ended) {
    output.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    output.end(JSON.stringify({ error: "API route not found." }));
  }
  return completed;
}

export function createWebProductKeyHandler({
  store,
  verifyEntitlement,
  publicOrigin,
  adminToken,
  trustProxy = true,
  ...options
}) {
  const apiHandler = createApiHandler({
    store,
    verifyEntitlement,
    publicOrigin,
    adminToken,
    trustProxy,
    ...options,
  });
  return (request) => invokeNodeHandler(apiHandler, request);
}

export function createProductionProductKeyHandler(environment = process.env) {
  const rpcUrl = requireEnvironment(environment, "RPC_URL");
  const contractAddress = requireEnvironment(environment, "CONTRACT_ADDRESS");
  const publicOrigin = normalizePublicOrigin(
    requireEnvironment(environment, "PUBLIC_ORIGIN"),
  );
  const adminToken = requireEnvironment(environment, "ADMIN_TOKEN");
  const redisUrl = requireEnvironment(environment, "UPSTASH_REDIS_REST_URL");
  const redisToken = requireEnvironment(environment, "UPSTASH_REDIS_REST_TOKEN");
  const encryptionKey = requireEnvironment(environment, "PRODUCT_KEY_ENCRYPTION_KEY");
  const redis = new Redis({ url: redisUrl, token: redisToken });
  const store = new RedisKeyStore({
    redis,
    encryptionKey,
    prefix:
      environment.PRODUCT_KEY_REDIS_PREFIX?.trim() ||
      `pirate:product-key:${contractAddress.toLowerCase()}`,
  });
  const verifyEntitlement = createContractVerifier({
    rpcUrl,
    contractAddress,
    timeoutMs: Number(environment.RPC_TIMEOUT_MS ?? 10_000),
  });
  return createWebProductKeyHandler({
    store,
    verifyEntitlement,
    publicOrigin,
    adminToken,
    verificationMaxConcurrent: Number(environment.VERIFICATION_MAX_CONCURRENT ?? 8),
    verificationMaxQueued: Number(environment.VERIFICATION_MAX_QUEUED ?? 32),
    rateLimitWindowMs: Number(environment.RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000),
    rateLimitMax: Number(environment.RATE_LIMIT_MAX ?? 60),
  });
}

let productionHandler;

export async function handleVercelProductKeyRequest(request) {
  try {
    productionHandler ??= createProductionProductKeyHandler();
    return await productionHandler(request);
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        ok: false,
        error: "The product-key service is not configured or is temporarily unavailable.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
