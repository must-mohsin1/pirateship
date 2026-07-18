import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { KeyStore } from "./key-store.mjs";
import {
  createProductionProductKeyHandler,
  createWebProductKeyHandler,
} from "./vercel-handler.mjs";

const routeModules = await Promise.all([
  import("../../../api/health.js"),
  import("../../../api/auth/challenge.js"),
  import("../../../api/keys/redeem.js"),
  import("../../../api/admin/keys.js"),
]);

const ADMIN_TOKEN = "test-admin-token-that-is-longer-than-32-characters";

test("every Vercel route exports the Web fetch handler", () => {
  for (const route of routeModules) assert.equal(typeof route.default.fetch, "function");
});

test("the Web handler serves health and the complete signed-key flow", async () => {
  const store = new KeyStore();
  const handler = createWebProductKeyHandler({
    store,
    verifyEntitlement: async () => ({ eligible: true }),
    publicOrigin: "https://pirate.example",
    adminToken: ADMIN_TOKEN,
  });
  const wallet = Wallet.createRandom();
  try {
    const health = await handler(new Request("https://pirate.example/api/health"));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const inventory = await handler(new Request("https://pirate.example/api/admin/keys", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ keys: ["PIRATE-VERCEL-ONE"] }),
    }));
    assert.equal(inventory.status, 200);

    const challenge = await handler(new Request("https://pirate.example/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.address }),
    }));
    assert.equal(challenge.status, 200);
    const challengeBody = await challenge.json();
    const signature = await wallet.signMessage(challengeBody.message);

    const redemption = await handler(new Request("https://pirate.example/api/keys/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challengeBody.challengeId,
        address: wallet.address,
        signature,
      }),
    }));
    assert.equal(redemption.status, 200);
    assert.deepEqual(await redemption.json(), {
      productKey: "PIRATE-VERCEL-ONE",
      existing: false,
    });
  } finally {
    store.close();
  }
});

test("production setup fails closed when required Vercel secrets are absent", () => {
  assert.throws(
    () => createProductionProductKeyHandler({}),
    /RPC_URL is required/,
  );
});
