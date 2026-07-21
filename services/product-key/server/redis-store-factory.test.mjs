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
import { StandardRedisClient } from "./standard-redis-client.mjs";

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

test("Polygon mainnet refuses to start outside generated-key mode", () => {
  assert.throws(
    () => productKeyMode(environment(), 137),
    /PRODUCT_KEY_MODE=generated is required on Polygon mainnet/,
  );
  assert.throws(
    () => productKeyMode(environment({ PRODUCT_KEY_MODE: "inventory" }), 137),
    /PRODUCT_KEY_MODE=generated is required on Polygon mainnet/,
  );
  assert.equal(
    productKeyMode(environment({ PRODUCT_KEY_MODE: "generated" }), 137),
    "generated",
  );
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

test("the Redis factory selects a standard Redis connection URL", () => {
  const store = createRedisProductKeyStore({
    environment: environment({
      NODE_ENV: "production",
      PRODUCT_KEY_MODE: "generated",
      REDIS_CLUSTER_MODE: "false",
      REDIS_URL: "rediss://default:secret@redis.example:6379",
    }),
    contractAddress: CONTRACT_ADDRESS,
    expectedChainId: 137,
  });

  assert.equal(store.redis instanceof StandardRedisClient, true);
});

test("the Redis factory rejects ambiguous or clustered connections", () => {
  assert.throws(
    () => createRedisProductKeyStore({
      environment: environment({
        PRODUCT_KEY_MODE: "generated",
        REDIS_URL: "redis://127.0.0.1:6379",
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      }),
      contractAddress: CONTRACT_ADDRESS,
      expectedChainId: 137,
    }),
    /either REDIS_URL or the Upstash REST variables/,
  );
  assert.throws(
    () => createRedisProductKeyStore({
      environment: environment({
        PRODUCT_KEY_MODE: "generated",
        REDIS_CLUSTER_MODE: "true",
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
      contractAddress: CONTRACT_ADDRESS,
      expectedChainId: 137,
    }),
    /REDIS_CLUSTER_MODE=false is required/,
  );
});

test("the Redis factory requires TLS and authentication in production", () => {
  assert.throws(
    () => createRedisProductKeyStore({
      environment: environment({
        NODE_ENV: "production",
        PRODUCT_KEY_MODE: "generated",
        REDIS_URL: "rediss://default:secret@redis.example:6379",
      }),
      contractAddress: CONTRACT_ADDRESS,
      expectedChainId: 137,
    }),
    /REDIS_CLUSTER_MODE=false is required/,
  );
  assert.throws(
    () => createRedisProductKeyStore({
      environment: environment({
        NODE_ENV: "production",
        PRODUCT_KEY_MODE: "generated",
        REDIS_CLUSTER_MODE: "false",
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
      contractAddress: CONTRACT_ADDRESS,
      expectedChainId: 137,
    }),
    /rediss:\/\/ TLS/,
  );
  assert.throws(
    () => createRedisProductKeyStore({
      environment: environment({
        NODE_ENV: "production",
        PRODUCT_KEY_MODE: "generated",
        REDIS_CLUSTER_MODE: "false",
        REDIS_URL: "rediss://redis.example:6379",
      }),
      contractAddress: CONTRACT_ADDRESS,
      expectedChainId: 137,
    }),
    /include Redis authentication/,
  );
});
