import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { Wallet } from "ethers";
import { createApiHandler } from "./app.mjs";
import { KeyStore } from "./key-store.mjs";

const ADMIN_TOKEN = "test-admin-token-that-is-longer-than-32-characters";

async function fixture(eligible = true, overrides = {}) {
  const store = new KeyStore();
  const handler = createApiHandler({
    store,
    verifyEntitlement: async () => ({ eligible }),
    publicOrigin: "http://127.0.0.1",
    adminToken: ADMIN_TOKEN,
    ...overrides,
  });
  return {
    store,
    handler,
    close: () => store.close(),
  };
}

async function post(handler, path, body, token) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = "POST";
  request.url = path;
  request.headers = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const response = {
    status: 0,
    chunks: [],
    writeHead(status) {
      this.status = status;
      return this;
    },
    end(chunk = "") {
      if (chunk) this.chunks.push(Buffer.from(chunk));
    },
  };
  await handler(request, response);
  return {
    status: response.status,
    body: JSON.parse(Buffer.concat(response.chunks).toString("utf8")),
  };
}

test("an approved wallet signs a one-use challenge and receives one stable key", async () => {
  const app = await fixture(true);
  const wallet = Wallet.createRandom();
  try {
    assert.equal(
      (await post(app.handler, "/api/admin/keys", { keys: ["HR-PRO-001"] })).status,
      401,
    );
    const inventory = await post(
      app.handler,
      "/api/admin/keys",
      { keys: ["HR-PRO-001"] },
      ADMIN_TOKEN,
    );
    assert.equal(inventory.status, 200);
    assert.equal(inventory.body.inserted, 1);

    const challenge = await post(app.handler, "/api/auth/challenge", {
      address: wallet.address,
    });
    const signature = await wallet.signMessage(challenge.body.message);
    const redemption = await post(app.handler, "/api/keys/redeem", {
      challengeId: challenge.body.challengeId,
      address: wallet.address,
      signature,
    });
    assert.equal(redemption.status, 200);
    assert.equal(redemption.body.productKey, "HR-PRO-001");
    assert.equal(redemption.body.existing, false);

    const replay = await post(app.handler, "/api/keys/redeem", {
      challengeId: challenge.body.challengeId,
      address: wallet.address,
      signature,
    });
    assert.equal(replay.status, 401);

    const nextChallenge = await post(app.handler, "/api/auth/challenge", {
      address: wallet.address,
    });
    const nextSignature = await wallet.signMessage(nextChallenge.body.message);
    const repeat = await post(app.handler, "/api/keys/redeem", {
      challengeId: nextChallenge.body.challengeId,
      address: wallet.address,
      signature: nextSignature,
    });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.productKey, "HR-PRO-001");
    assert.equal(repeat.body.existing, true);
  } finally {
    app.close();
  }
});

test("an unapproved wallet cannot consume product-key inventory", async () => {
  const app = await fixture(false);
  const wallet = Wallet.createRandom();
  try {
    await post(app.handler, "/api/admin/keys", { keys: ["HR-PRO-002"] }, ADMIN_TOKEN);
    const challenge = await post(app.handler, "/api/auth/challenge", {
      address: wallet.address,
    });
    const signature = await wallet.signMessage(challenge.body.message);
    const redemption = await post(app.handler, "/api/keys/redeem", {
      challengeId: challenge.body.challengeId,
      address: wallet.address,
      signature,
    });
    assert.equal(redemption.status, 403);
    assert.deepEqual(app.store.stats(), {
      total: 1,
      available: 1,
      assigned: 0,
      quarantined: 0,
    });
  } finally {
    app.close();
  }
});

test("issuing a second challenge does not invalidate the first signed challenge", async () => {
  const app = await fixture(true);
  const wallet = Wallet.createRandom();
  try {
    await post(app.handler, "/api/admin/keys", { keys: ["HR-PRO-CONCURRENT"] }, ADMIN_TOKEN);
    const first = await post(app.handler, "/api/auth/challenge", { address: wallet.address });
    const second = await post(app.handler, "/api/auth/challenge", { address: wallet.address });
    assert.notEqual(first.body.challengeId, second.body.challengeId);

    const signature = await wallet.signMessage(first.body.message);
    const redemption = await post(app.handler, "/api/keys/redeem", {
      challengeId: first.body.challengeId,
      address: wallet.address,
      signature,
    });
    assert.equal(redemption.status, 200);
    assert.equal(redemption.body.productKey, "HR-PRO-CONCURRENT");
  } finally {
    app.close();
  }
});

test("wallet-verification endpoints are rate limited", async () => {
  const app = await fixture(true, { rateLimitMax: 2 });
  const wallet = Wallet.createRandom();
  try {
    assert.equal(
      (await post(app.handler, "/api/auth/challenge", { address: wallet.address })).status,
      200,
    );
    assert.equal(
      (await post(app.handler, "/api/auth/challenge", { address: wallet.address })).status,
      200,
    );
    assert.equal(
      (await post(app.handler, "/api/auth/challenge", { address: wallet.address })).status,
      429,
    );
  } finally {
    app.close();
  }
});

test("the administrator endpoint accepts its documented 1,000-key batch", async () => {
  const app = await fixture(true);
  const keys = Array.from(
    { length: 1_000 },
    (_, index) => `${String(index).padStart(4, "0")}${"é".repeat(252)}`,
  );
  assert.ok(Buffer.byteLength(JSON.stringify({ keys })) > 300 * 1024);

  try {
    const response = await post(
      app.handler,
      "/api/admin/keys",
      { keys },
      ADMIN_TOKEN,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.inserted, 1_000);
    assert.deepEqual(response.body.inventory, {
      total: 1_000,
      available: 1_000,
      assigned: 0,
      quarantined: 0,
    });
  } finally {
    app.close();
  }
});

test("generated mode keeps the administrator endpoint authenticated and rejects uploads", async () => {
  const store = new KeyStore();
  store.addKeys = async () => {
    const error = new Error(
      "This deployment generates one unlimited license per approved wallet; inventory imports are disabled.",
    );
    error.status = 409;
    error.exposeToClient = true;
    throw error;
  };
  const handler = createApiHandler({
    store,
    verifyEntitlement: async () => ({ eligible: true }),
    publicOrigin: "http://127.0.0.1",
    adminToken: ADMIN_TOKEN,
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(
      (await post(handler, "/api/admin/keys", { keys: ["PIRATE-LEGACY"] })).status,
      401,
    );
    const response = await post(
      handler,
      "/api/admin/keys",
      { keys: ["PIRATE-LEGACY"] },
      ADMIN_TOKEN,
    );
    assert.equal(response.status, 409);
    assert.match(response.body.error, /unlimited license/);
  } finally {
    console.error = originalConsoleError;
    store.close();
  }
});

test("invalid rate-limit configuration fails closed", () => {
  const store = new KeyStore();
  const options = {
    store,
    verifyEntitlement: async () => ({ eligible: true }),
    publicOrigin: "http://127.0.0.1",
    adminToken: ADMIN_TOKEN,
  };
  try {
    assert.throws(
      () => createApiHandler({ ...options, rateLimitMax: Number.NaN }),
      /RATE_LIMIT_MAX must be a positive integer/,
    );
    assert.throws(
      () => createApiHandler({ ...options, rateLimitWindowMs: 0 }),
      /RATE_LIMIT_WINDOW_MS must be a positive integer/,
    );
  } finally {
    store.close();
  }
});
