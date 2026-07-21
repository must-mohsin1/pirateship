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
const MAINNET_ADDRESS = "0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff";

function productionEnvironment(overrides = {}) {
  return {
    RPC_URL: "https://polygon.example/rpc",
    CONTRACT_ADDRESS: MAINNET_ADDRESS,
    EXPECTED_CHAIN_ID: "137",
    PUBLIC_ORIGIN: "https://pirate.example",
    ADMIN_TOKEN,
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
    PRODUCT_KEY_MODE: "generated",
    PRODUCT_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    PRODUCT_KEY_GENERATION_KEY: Buffer.alloc(32, 8).toString("base64"),
    ...overrides,
  };
}

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

test("production setup accepts the checked-in mainnet deployment", () => {
  assert.equal(
    typeof createProductionProductKeyHandler(productionEnvironment()),
    "function",
  );
});

test("production setup accepts unlimited generated licenses only with a generation secret", () => {
  assert.throws(
    () => createProductionProductKeyHandler(productionEnvironment({
      PRODUCT_KEY_GENERATION_KEY: "",
    })),
    /PRODUCT_KEY_GENERATION_KEY is required/,
  );
  assert.equal(
    typeof createProductionProductKeyHandler(productionEnvironment()),
    "function",
  );
});

test("production setup rejects contract or chain drift from the landing page", () => {
  assert.throws(
    () => createProductionProductKeyHandler(productionEnvironment({
      CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    })),
    /contract addresses differ/,
  );
  assert.throws(
    () => createProductionProductKeyHandler(productionEnvironment({
      EXPECTED_CHAIN_ID: "80002",
    })),
    /chain IDs differ/,
  );
});

test("production setup validates numeric safety limits", () => {
  assert.throws(
    () => createProductionProductKeyHandler(productionEnvironment({
      RATE_LIMIT_MAX: "not-a-number",
    })),
    /RATE_LIMIT_MAX must be an integer/,
  );
  assert.throws(
    () => createProductionProductKeyHandler(productionEnvironment({
      REDIS_TIMEOUT_MS: "0",
    })),
    /REDIS_TIMEOUT_MS must be an integer/,
  );
  assert.throws(
    () => createProductionProductKeyHandler(productionEnvironment({
      PUBLIC_ORIGIN: "https://pirate.example/api",
    })),
    /PUBLIC_ORIGIN must contain only/,
  );
});

test("Vercel's trusted forwarding header selects the rate-limit client", async () => {
  let clientKey;
  const store = {
    takeRateLimit: async (key) => {
      clientKey = key;
      return false;
    },
  };
  const handler = createWebProductKeyHandler({
    store,
    verifyEntitlement: async () => ({ eligible: false }),
    publicOrigin: "https://pirate.example",
    adminToken: ADMIN_TOKEN,
  });
  const response = await handler(new Request("https://pirate.example/api/auth/challenge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.99",
      "x-vercel-forwarded-for": "198.51.100.25",
    },
    body: JSON.stringify({ address: "invalid" }),
  }));

  assert.equal(response.status, 400);
  assert.equal(clientKey, "198.51.100.25");
});

test("health checks include the entitlement verifier network check", async () => {
  const store = new KeyStore();
  const verifyEntitlement = async () => ({ eligible: true });
  let networkChecks = 0;
  let timestamp = 1_000;
  verifyEntitlement.healthCheck = async () => {
    networkChecks += 1;
  };
  const handler = createWebProductKeyHandler({
    store,
    verifyEntitlement,
    publicOrigin: "https://pirate.example",
    adminToken: ADMIN_TOKEN,
    healthCheckTtlMs: 1_000,
    now: () => timestamp,
  });
  try {
    const health = await handler(new Request("https://pirate.example/api/health"));
    assert.equal(health.status, 200);
    const cachedHealth = await handler(new Request("https://pirate.example/api/health"));
    assert.equal(cachedHealth.status, 200);
    assert.equal(networkChecks, 1);
    timestamp += 1_001;
    const refreshedHealth = await handler(
      new Request("https://pirate.example/api/health"),
    );
    assert.equal(refreshedHealth.status, 200);
    assert.equal(networkChecks, 2);
  } finally {
    store.close();
  }
});

test("failed readiness checks are briefly cached without exposing dependency errors", async () => {
  const store = new KeyStore();
  const verifyEntitlement = async () => ({ eligible: true });
  let healthChecks = 0;
  let timestamp = 1_000;
  let dependencyAvailable = false;
  verifyEntitlement.healthCheck = async () => {
    healthChecks += 1;
    if (!dependencyAvailable) {
      const error = new Error("https://rpc.example/private-token");
      error.status = 429;
      throw error;
    }
  };
  const handler = createWebProductKeyHandler({
    store,
    verifyEntitlement,
    publicOrigin: "https://pirate.example",
    adminToken: ADMIN_TOKEN,
    healthCheckTtlMs: 1_000,
    now: () => timestamp,
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const first = await handler(new Request("https://pirate.example/api/health"));
    const cached = await handler(new Request("https://pirate.example/api/health"));
    assert.equal(first.status, 500);
    assert.equal(cached.status, 500);
    assert.equal(healthChecks, 1);
    assert.doesNotMatch((await first.json()).error, /rpc|token/i);

    dependencyAvailable = true;
    timestamp += 1_001;
    const recovered = await handler(new Request("https://pirate.example/api/health"));
    assert.equal(recovered.status, 200);
    assert.equal(healthChecks, 2);
  } finally {
    console.error = originalConsoleError;
    store.close();
  }
});
