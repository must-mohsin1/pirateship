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
    assert.deepEqual(app.store.stats(), { total: 1, available: 1, assigned: 0 });
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
