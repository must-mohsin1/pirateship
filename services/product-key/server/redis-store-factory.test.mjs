import assert from "node:assert/strict";
import test from "node:test";
import {
  GeneratedRedisKeyStore,
  RedisKeyStore,
} from "./redis-key-store.mjs";
import {
  createRedisProductKeyStore,
  productKeyMode,
} from "./redis-store-factory.mjs";

const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000001";

function environment(overrides = {}) {
  return {
    PRODUCT_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    PRODUCT_KEY_GENERATION_KEY: Buffer.alloc(32, 2).toString("base64"),
    ...overrides,
  };
}

test("the Redis factory keeps finite inventory as its compatibility default", () => {
  const store = createRedisProductKeyStore({
    environment: environment(),
    contractAddress: CONTRACT_ADDRESS,
    expectedChainId: 80_002,
    redis: {},
  });
  assert.equal(productKeyMode(environment()), "inventory");
  assert.equal(store instanceof RedisKeyStore, true);
  assert.equal(store instanceof GeneratedRedisKeyStore, false);
});

test("the Redis factory constructs deployment-bound unlimited licenses", () => {
  const store = createRedisProductKeyStore({
    environment: environment({ PRODUCT_KEY_MODE: "generated" }),
    contractAddress: CONTRACT_ADDRESS,
    expectedChainId: 137,
    redis: {},
  });
  assert.equal(store instanceof GeneratedRedisKeyStore, true);
  assert.equal(store.generationContext, `137:${CONTRACT_ADDRESS}`);
});

test("the Redis factory rejects unknown modes and missing generation secrets", () => {
  assert.throws(
    () => productKeyMode({ PRODUCT_KEY_MODE: "surprise" }),
    /PRODUCT_KEY_MODE must be one of/,
  );
  assert.throws(
    () => createRedisProductKeyStore({
      environment: environment({
        PRODUCT_KEY_MODE: "generated",
        PRODUCT_KEY_GENERATION_KEY: "",
      }),
      contractAddress: CONTRACT_ADDRESS,
      expectedChainId: 137,
      redis: {},
    }),
    /PRODUCT_KEY_GENERATION_KEY is required/,
  );
});
