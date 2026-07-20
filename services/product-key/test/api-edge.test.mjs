import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { Wallet } from "ethers";
import { createApiHandler } from "../server/app.mjs";
import { KeyStore } from "../server/key-store.mjs";

const ADMIN_TOKEN = "test-admin-token-that-is-longer-than-32-characters";

function fixture(overrides = {}) {
  const store = overrides.store ?? new KeyStore();
  const handler = createApiHandler({
    store,
    verifyEntitlement: async () => ({ eligible: true }),
    publicOrigin: "https://pirate.example",
    adminToken: ADMIN_TOKEN,
    ...overrides,
  });
  return { store, handler, close: () => store.close() };
}

async function request(handler, path, {
  method = "POST",
  body,
  rawBody,
  headers = {},
  remoteAddress = "127.0.0.1",
} = {}) {
  const payload = rawBody ?? (body === undefined ? "" : JSON.stringify(body));
  const input = Readable.from(payload ? [Buffer.from(payload)] : []);
  input.method = method;
  input.url = path;
  input.headers = { "content-type": "application/json", ...headers };
  input.socket = { remoteAddress };
  const response = {
    status: 0,
    headers: {},
    chunks: [],
    writeHead(status, responseHeaders = {}) {
      this.status = status;
      this.headers = responseHeaders;
      return this;
    },
    end(chunk = "") {
      if (chunk) this.chunks.push(Buffer.from(chunk));
    },
  };
  const handled = await handler(input, response);
  const text = Buffer.concat(response.chunks).toString("utf8");
  return { handled, status: response.status, body: text ? JSON.parse(text) : null };
}

async function challenge(app, wallet) {
  return request(app.handler, "/api/auth/challenge", {
    body: { address: wallet.address },
  });
}

test("API startup rejects an administrator token that is too short", () => {
  const store = new KeyStore();
  try {
    assert.throws(
      () => createApiHandler({
        store,
        verifyEntitlement: async () => ({ eligible: true }),
        publicOrigin: "https://pirate.example",
        adminToken: "short",
      }),
      /at least 32 characters/,
    );
  } finally {
    store.close();
  }
});

test("liveness and readiness requests are handled and unknown routes fall through", async () => {
  const app = fixture();
  try {
    const live = await request(app.handler, "/api/live", { method: "GET" });
    assert.equal(live.handled, true);
    assert.equal(live.status, 200);
    assert.deepEqual(live.body, { ok: true });

    const health = await request(app.handler, "/api/health", { method: "GET" });
    assert.equal(health.handled, true);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true });

    const unknown = await request(app.handler, "/api/missing", { method: "GET" });
    assert.equal(unknown.handled, false);
    assert.equal(unknown.status, 0);
  } finally {
    app.close();
  }
});

test("malformed and oversized JSON bodies receive bounded client errors", async () => {
  const app = fixture();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const malformed = await request(app.handler, "/api/auth/challenge", { rawBody: "{" });
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.error, /valid JSON/);

    const oversized = await request(app.handler, "/api/auth/challenge", {
      rawBody: JSON.stringify({ padding: "x".repeat(33 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.match(oversized.body.error, /too large/);
  } finally {
    console.error = originalConsoleError;
    app.close();
  }
});

test("challenge creation rejects an invalid wallet address", async () => {
  const app = fixture();
  try {
    const result = await request(app.handler, "/api/auth/challenge", {
      body: { address: "not-an-address" },
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /wallet address is invalid/);
  } finally {
    app.close();
  }
});

test("expired challenges cannot be redeemed", async () => {
  let clock = 1_000;
  const app = fixture({ challengeTtlMs: 50, now: () => clock });
  const wallet = Wallet.createRandom();
  try {
    const issued = await challenge(app, wallet);
    const signature = await wallet.signMessage(issued.body.message);
    clock = 1_051;
    const result = await request(app.handler, "/api/keys/redeem", {
      body: { challengeId: issued.body.challengeId, address: wallet.address, signature },
    });
    assert.equal(result.status, 401);
    assert.match(result.body.error, /expired or was already used/);
  } finally {
    app.close();
  }
});

test("invalid signatures and signatures from another wallet are rejected", async () => {
  const app = fixture();
  const wallet = Wallet.createRandom();
  const otherWallet = Wallet.createRandom();
  try {
    const invalidChallenge = await challenge(app, wallet);
    const invalid = await request(app.handler, "/api/keys/redeem", {
      body: {
        challengeId: invalidChallenge.body.challengeId,
        address: wallet.address,
        signature: "not-a-signature",
      },
    });
    assert.equal(invalid.status, 401);
    assert.match(invalid.body.error, /signature was invalid/);

    const issued = await challenge(app, wallet);
    const wrongSignature = await otherWallet.signMessage(issued.body.message);
    const wrongWallet = await request(app.handler, "/api/keys/redeem", {
      body: {
        challengeId: issued.body.challengeId,
        address: wallet.address,
        signature: wrongSignature,
      },
    });
    assert.equal(wrongWallet.status, 401);
    assert.match(wrongWallet.body.error, /different wallet/);
  } finally {
    app.close();
  }
});

test("a challenge lost to a concurrent redemption returns conflict", async () => {
  const app = fixture();
  const wallet = Wallet.createRandom();
  try {
    const issued = await challenge(app, wallet);
    const signature = await wallet.signMessage(issued.body.message);
    app.store.consumeChallenge = () => false;
    const result = await request(app.handler, "/api/keys/redeem", {
      body: { challengeId: issued.body.challengeId, address: wallet.address, signature },
    });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /already used/);
  } finally {
    app.close();
  }
});

test("a challenge is consumed before asynchronous entitlement verification", async () => {
  let releaseVerification;
  let verificationCalls = 0;
  const app = fixture({
    verifyEntitlement: async () => {
      verificationCalls += 1;
      return new Promise((resolve) => {
        releaseVerification = () => resolve({ eligible: true });
      });
    },
  });
  const wallet = Wallet.createRandom();
  try {
    const issued = await challenge(app, wallet);
    const signature = await wallet.signMessage(issued.body.message);
    const body = { challengeId: issued.body.challengeId, address: wallet.address, signature };

    const first = request(app.handler, "/api/keys/redeem", { body });
    await new Promise((resolve) => setImmediate(resolve));
    const replay = await request(app.handler, "/api/keys/redeem", { body });

    assert.equal(replay.status, 401);
    assert.equal(verificationCalls, 1);
    releaseVerification();
    await first;
  } finally {
    app.close();
  }
});

test("an eligible wallet receives a recoverable out-of-inventory response", async () => {
  const app = fixture();
  const wallet = Wallet.createRandom();
  try {
    const issued = await challenge(app, wallet);
    const signature = await wallet.signMessage(issued.body.message);
    const result = await request(app.handler, "/api/keys/redeem", {
      body: { challengeId: issued.body.challengeId, address: wallet.address, signature },
    });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /No product keys are available/);
  } finally {
    app.close();
  }
});

test("entitlement-provider failures are hidden behind a generic server error", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const app = fixture({
    verifyEntitlement: async () => {
      const error = new Error("private RPC credential appeared in provider error");
      error.status = 429;
      throw error;
    },
  });
  const wallet = Wallet.createRandom();
  try {
    const issued = await challenge(app, wallet);
    const signature = await wallet.signMessage(issued.body.message);
    const result = await request(app.handler, "/api/keys/redeem", {
      body: { challengeId: issued.body.challengeId, address: wallet.address, signature },
    });
    assert.equal(result.status, 500);
    assert.equal(
      result.body.error,
      "The product-key service could not complete the request. Try again shortly.",
    );
    assert.doesNotMatch(result.body.error, /credential|provider/);
  } finally {
    console.error = originalConsoleError;
    app.close();
  }
});

test("administrator inventory validates authorization, shape, and key length", async () => {
  const app = fixture();
  const authorized = { authorization: `Bearer ${ADMIN_TOKEN}` };
  try {
    assert.equal(
      (await request(app.handler, "/api/admin/keys", { body: { keys: ["A"] } })).status,
      401,
    );
    assert.equal(
      (await request(app.handler, "/api/admin/keys", { body: { keys: [] }, headers: authorized })).status,
      400,
    );
    assert.equal(
      (await request(app.handler, "/api/admin/keys", { body: null, headers: authorized })).status,
      400,
    );
    assert.equal(
      (await request(app.handler, "/api/admin/keys", {
        body: { keys: ["   "] },
        headers: authorized,
      })).status,
      400,
    );
    assert.equal(
      (await request(app.handler, "/api/admin/keys", {
        body: { keys: new Array(1_001).fill("A") },
        headers: authorized,
      })).status,
      400,
    );
    assert.equal(
      (await request(app.handler, "/api/admin/keys", {
        body: { keys: [42] },
        headers: authorized,
      })).status,
      400,
    );
    assert.equal(
      (await request(app.handler, "/api/admin/keys", {
        body: { keys: ["x".repeat(257)] },
        headers: authorized,
      })).status,
      400,
    );
  } finally {
    app.close();
  }
});

test("the in-process limiter rejects new clients when its bounded store is full", async () => {
  const app = fixture({ rateLimitMax: 10, rateLimitMaxClients: 1 });
  const first = Wallet.createRandom();
  const second = Wallet.createRandom();
  try {
    assert.equal(
      (await request(app.handler, "/api/auth/challenge", {
        body: { address: first.address },
        remoteAddress: "192.0.2.1",
      })).status,
      200,
    );
    assert.equal(
      (await request(app.handler, "/api/auth/challenge", {
        body: { address: second.address },
        remoteAddress: "192.0.2.2",
      })).status,
      429,
    );
  } finally {
    app.close();
  }
});

test("a trusted AWS proxy uses the appended client address for rate limiting", async () => {
  const app = fixture({ rateLimitMax: 1, trustProxy: true });
  const wallet = Wallet.createRandom();
  const send = (forwardedFor) => request(app.handler, "/api/auth/challenge", {
    body: { address: wallet.address },
    headers: { "x-forwarded-for": forwardedFor },
    remoteAddress: "10.0.0.12",
  });
  try {
    assert.equal((await send("198.51.100.11, 203.0.113.5")).status, 200);
    assert.equal(
      (await send("198.51.100.12, 203.0.113.5")).status,
      429,
      "a spoofed prefix must not create a new client bucket",
    );
    assert.equal((await send("198.51.100.11, 203.0.113.6")).status, 200);
  } finally {
    app.close();
  }
});

test("the in-process limiter throttles full-store cleanup sweeps", async () => {
  let clock = 1;
  const app = fixture({
    now: () => clock,
    rateLimitWindowMs: 10_000,
    rateLimitMax: 10,
    rateLimitMaxClients: 1,
  });
  const wallet = Wallet.createRandom();
  const send = (remoteAddress) => request(app.handler, "/api/auth/challenge", {
    body: { address: wallet.address },
    remoteAddress,
  });
  try {
    assert.equal((await send("192.0.2.1")).status, 200);
    clock = 5_000;
    assert.equal((await send("192.0.2.1")).status, 200);
    clock = 10_000;
    assert.equal((await send("192.0.2.1")).status, 200);
    clock = 10_002;
    assert.equal((await send("192.0.2.2")).status, 429);
    clock = 15_000;
    assert.equal((await send("192.0.2.2")).status, 200);
  } finally {
    app.close();
  }
});

test("wallet verification has bounded global concurrency and queue capacity", async () => {
  const releases = [];
  let verificationCalls = 0;
  const app = fixture({
    verificationMaxConcurrent: 1,
    verificationMaxQueued: 1,
    verifyEntitlement: async () => {
      verificationCalls += 1;
      return new Promise((resolve) => {
        releases.push(() => resolve({ eligible: true }));
      });
    },
  });
  const wallets = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()];
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const issued = await Promise.all(wallets.map((wallet) => challenge(app, wallet)));
    const signatures = await Promise.all(
      issued.map((result, index) => wallets[index].signMessage(result.body.message)),
    );
    const redeem = (index) => request(app.handler, "/api/keys/redeem", {
      body: {
        challengeId: issued[index].body.challengeId,
        address: wallets[index].address,
        signature: signatures[index],
      },
    });

    const first = redeem(0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(verificationCalls, 1);
    const second = redeem(1);
    await new Promise((resolve) => setImmediate(resolve));
    const overflow = await redeem(2);

    assert.equal(overflow.status, 503);
    assert.equal(verificationCalls, 1, "only one upstream verification runs at a time");

    releases.shift()();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(verificationCalls, 2, "one queued verification starts after capacity frees");
    releases.shift()();
    await second;
  } finally {
    console.error = originalConsoleError;
    app.close();
  }
});
