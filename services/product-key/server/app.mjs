import { randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";
import { logServerError } from "./safe-log.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_ADMIN_KEYS = 1_000;
const MAX_PRODUCT_KEY_CHARACTERS = 256;
const MAX_JSON_BYTES_PER_CHARACTER = 6;
const MAX_ADMIN_BODY_BYTES =
  MAX_ADMIN_KEYS * (MAX_PRODUCT_KEY_CHARACTERS * MAX_JSON_BYTES_PER_CHARACTER + 3) +
  32;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 5_000;
const MAX_READINESS_FAILURE_CACHE_MS = 2_000;

function exposedRequestError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw exposedRequestError("Request body is too large.", 413);
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw exposedRequestError("Request body must contain valid JSON.", 400);
  }
}

function hasValidAdminToken(request, expected) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function isLoopbackAddress(address) {
  const normalized = String(address ?? "").toLowerCase();
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(normalized);
}

function challengeMessage({ address, nonce, expiresAt, publicOrigin }) {
  return [
    "HR Launch Escrow",
    "",
    "Verify wallet ownership to retrieve your approved product key.",
    "This signature does not authorize a blockchain transaction.",
    "",
    `Address: ${address}`,
    `Origin: ${publicOrigin}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");
}

function createVerificationPool(worker, maxConcurrent, maxQueued) {
  let active = 0;
  const queue = [];

  function start(job) {
    active += 1;
    Promise.resolve()
      .then(() => worker(job.address))
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        const next = queue.shift();
        if (next) start(next);
      });
  }

  return function verify(address) {
    return new Promise((resolve, reject) => {
      const job = { address, resolve, reject };
      if (active < maxConcurrent) {
        start(job);
        return;
      }
      if (queue.length >= maxQueued) {
        const error = new Error("Wallet verification is temporarily busy.");
        error.status = 503;
        error.safeStatus = true;
        reject(error);
        return;
      }
      queue.push(job);
    });
  };
}

export function createApiHandler({
  store,
  verifyEntitlement,
  publicOrigin,
  adminToken,
  challengeTtlMs = 5 * 60 * 1000,
  rateLimitWindowMs = 10 * 60 * 1000,
  rateLimitMax = 60,
  rateLimitMaxClients = 10_000,
  verificationMaxConcurrent = 8,
  verificationMaxQueued = 32,
  healthCheckTtlMs = 10_000,
  trustProxy = false,
  now = () => Date.now(),
}) {
  if (!adminToken || adminToken.length < 32) {
    throw new Error("ADMIN_TOKEN must contain at least 32 characters.");
  }
  if (!Number.isInteger(verificationMaxConcurrent) || verificationMaxConcurrent < 1) {
    throw new Error("VERIFICATION_MAX_CONCURRENT must be a positive integer.");
  }
  if (!Number.isInteger(verificationMaxQueued) || verificationMaxQueued < 0) {
    throw new Error("VERIFICATION_MAX_QUEUED must be a non-negative integer.");
  }
  if (!Number.isInteger(rateLimitWindowMs) || rateLimitWindowMs < 1) {
    throw new Error("RATE_LIMIT_WINDOW_MS must be a positive integer.");
  }
  if (!Number.isInteger(rateLimitMax) || rateLimitMax < 1) {
    throw new Error("RATE_LIMIT_MAX must be a positive integer.");
  }
  if (!Number.isInteger(healthCheckTtlMs) || healthCheckTtlMs < 1) {
    throw new Error("HEALTH_CHECK_TTL_MS must be a positive integer.");
  }

  const rateLimits = new Map();
  const verifyWithCapacity = createVerificationPool(
    verifyEntitlement,
    verificationMaxConcurrent,
    verificationMaxQueued,
  );
  let lastRateLimitSweep = 0;
  let readinessExpiresAt = 0;
  let readinessFailureExpiresAt = 0;
  let readinessFailure;
  let readinessCheck;

  async function checkReadiness() {
    const timestamp = now();
    if (readinessExpiresAt > timestamp) return;
    if (readinessFailureExpiresAt > timestamp) throw readinessFailure;
    if (!readinessCheck) {
      readinessCheck = (async () => {
        try {
          if (typeof store.healthCheck === "function") await store.healthCheck();
          if (typeof verifyEntitlement.healthCheck === "function") {
            await verifyEntitlement.healthCheck();
          }
          readinessFailure = undefined;
          readinessFailureExpiresAt = 0;
          readinessExpiresAt = now() + healthCheckTtlMs;
        } catch (error) {
          readinessFailure = error;
          readinessFailureExpiresAt =
            now() + Math.min(healthCheckTtlMs, MAX_READINESS_FAILURE_CACHE_MS);
          throw error;
        }
      })().finally(() => {
        readinessCheck = undefined;
      });
    }
    await readinessCheck;
  }

  async function exceedsRateLimit(request) {
    const forwarded = trustProxy ? request.headers["x-forwarded-for"] : null;
    const forwardedAddresses =
      typeof forwarded === "string"
        ? forwarded.split(",").map((address) => address.trim()).filter(Boolean)
        : [];
    const key =
      forwardedAddresses.at(-1) ??
      request.socket?.remoteAddress ??
      "unknown-client";
    const timestamp = now();
    if (typeof store.takeRateLimit === "function") {
      return store.takeRateLimit(key, timestamp, rateLimitWindowMs, rateLimitMax);
    }
    if (
      timestamp - lastRateLimitSweep >=
      Math.min(rateLimitWindowMs, RATE_LIMIT_SWEEP_INTERVAL_MS)
    ) {
      for (const [client, limit] of rateLimits) {
        if (limit.resetAt <= timestamp) rateLimits.delete(client);
      }
      lastRateLimitSweep = timestamp;
    }
    const current = rateLimits.get(key);
    if (!current || current.resetAt <= timestamp) {
      if (!current && rateLimits.size >= rateLimitMaxClients) return true;
      rateLimits.set(key, { count: 1, resetAt: timestamp + rateLimitWindowMs });
      return false;
    }
    current.count += 1;
    return current.count > rateLimitMax;
  }

  return async function apiHandler(request, response) {
    const url = new URL(request.url, publicOrigin);

    try {
      if (request.method === "GET" && url.pathname === "/api/live") {
        sendJson(response, 200, { ok: true });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        // The existing ECS task definition probes /api/health over loopback.
        // Keep that probe as liveness while remote ALB requests check storage/RPC.
        if (!isLoopbackAddress(request.socket?.remoteAddress)) {
          await checkReadiness();
        }
        sendJson(response, 200, { ok: true });
        return true;
      }

      if (
        request.method === "POST" &&
        ["/api/auth/challenge", "/api/keys/redeem"].includes(url.pathname) &&
        await exceedsRateLimit(request)
      ) {
        sendJson(response, 429, {
          error: "Too many wallet-verification requests. Wait and try again later.",
        });
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/challenge") {
        const body = await readJson(request);
        let address;
        try {
          address = getAddress(body.address);
        } catch {
          sendJson(response, 400, {
            error: "The wallet address is invalid. Reconnect your wallet and try again.",
          });
          return true;
        }

        const expiresAt = now() + challengeTtlMs;
        const challengeId = randomBytes(18).toString("hex");
        const message = challengeMessage({
          address,
          nonce: challengeId,
          expiresAt,
          publicOrigin,
        });
        await store.putChallenge(challengeId, address, message, expiresAt, now());
        sendJson(response, 200, { challengeId, address, message, expiresAt });
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/keys/redeem") {
        const body = await readJson(request);
        let address;
        try {
          address = getAddress(body.address);
        } catch {
          sendJson(response, 400, {
            error: "The wallet address is invalid. Reconnect your wallet and try again.",
          });
          return true;
        }

        const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
        if (!/^[0-9a-f]{36}$/i.test(challengeId)) {
          sendJson(response, 401, {
            error: "The verification request expired or was already used. Request a new signature.",
          });
          return true;
        }

        const challenge = await store.getChallenge(challengeId, address);
        if (!challenge || challenge.used || challenge.expiresAt < now()) {
          sendJson(response, 401, {
            error: "The verification request expired or was already used. Request a new signature.",
          });
          return true;
        }

        let recovered;
        try {
          recovered = getAddress(verifyMessage(challenge.message, body.signature));
        } catch {
          sendJson(response, 401, {
            error: "The wallet signature was invalid. Request a new signature and try again.",
          });
          return true;
        }

        if (recovered !== address) {
          sendJson(response, 401, {
            error: "The signature belongs to a different wallet. Reconnect the approving wallet.",
          });
          return true;
        }

        if (!(await store.consumeChallenge(challengeId, address, challenge.message, now()))) {
          sendJson(response, 409, {
            error: "That verification request was already used. Request a new signature.",
          });
          return true;
        }

        const entitlement = await verifyWithCapacity(address);

        if (!entitlement.eligible) {
          sendJson(response, 403, {
            error: "This wallet has not approved a funded pledge. Approve the product on-chain first.",
          });
          return true;
        }

        const assignment = await store.assignKey(address, now());
        if (!assignment) {
          sendJson(response, 503, {
            error: "No product keys are available yet. The project owner must add inventory.",
          });
          return true;
        }

        sendJson(response, 200, assignment);
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/admin/keys") {
        if (!hasValidAdminToken(request, adminToken)) {
          sendJson(response, 401, { error: "A valid administrator token is required." });
          return true;
        }

        const body = await readJson(request, MAX_ADMIN_BODY_BYTES);
        if (
          !body ||
          typeof body !== "object" ||
          !Array.isArray(body.keys) ||
          body.keys.length === 0 ||
          body.keys.length > MAX_ADMIN_KEYS
        ) {
          sendJson(response, 400, {
            error: "Provide between 1 and 1,000 product keys in the keys array.",
          });
          return true;
        }
        if (
          body.keys.some(
            (key) =>
              typeof key !== "string" ||
              !key.trim() ||
              key.trim().length > MAX_PRODUCT_KEY_CHARACTERS,
          )
        ) {
          sendJson(response, 400, {
            error: "Every product key must be a string no longer than 256 characters.",
          });
          return true;
        }

        const inserted = await store.addKeys(body.keys);
        sendJson(response, 200, { inserted, inventory: await store.stats() });
        return true;
      }

      return false;
    } catch (error) {
      logServerError("Product-key request failed.", error);
      const exposeToClient =
        error?.exposeToClient === true &&
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 500;
      const safeStatus =
        error?.safeStatus === true &&
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 599;
      sendJson(response, exposeToClient || safeStatus ? error.status : 500, {
        error:
          exposeToClient
            ? error.message
            : "The product-key service could not complete the request. Try again shortly.",
      });
      return true;
    }
  };
}
