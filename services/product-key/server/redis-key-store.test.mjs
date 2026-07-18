import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { RedisKeyStore } from "./redis-key-store.mjs";

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.lists = new Map();
    this.sets = new Map();
  }

  async ping() {
    return "PONG";
  }

  async set(key, value) {
    this.values.set(key, value);
    return "OK";
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async getdel(key) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }

  async scard(key) {
    return this.sets.get(key)?.size ?? 0;
  }

  async llen(key) {
    return this.lists.get(key)?.length ?? 0;
  }

  async eval(script, keys, args) {
    if (script.includes("SADD")) {
      const digests = this.sets.get(keys[0]) ?? new Set();
      this.sets.set(keys[0], digests);
      if (digests.has(args[0])) return 0;
      digests.add(args[0]);
      const inventory = this.lists.get(keys[1]) ?? [];
      this.lists.set(keys[1], inventory);
      inventory.push(args[1]);
      return 1;
    }
    if (script.includes("LPOP")) {
      const existing = this.values.get(keys[0]);
      if (existing) return [existing, "1"];
      const inventory = this.lists.get(keys[1]) ?? [];
      const candidate = inventory.shift();
      if (!candidate) return [];
      this.values.set(keys[0], candidate);
      this.values.set(keys[2], Number(this.values.get(keys[2]) ?? 0) + 1);
      return [candidate, "0"];
    }
    if (script.includes("PEXPIRE")) {
      const count = Number(this.values.get(keys[0]) ?? 0) + 1;
      this.values.set(keys[0], count);
      return count;
    }
    throw new Error("Unexpected test script.");
  }
}

function fixture() {
  const redis = new FakeRedis();
  const store = new RedisKeyStore({
    redis,
    encryptionKey: randomBytes(32).toString("base64"),
    prefix: "test:pirate",
  });
  return { redis, store };
}

test("Redis inventory is encrypted, deduplicated, and assigned stably", async () => {
  const { redis, store } = fixture();
  assert.equal(await store.addKeys(["PIRATE-ONE", "PIRATE-ONE", "PIRATE-TWO"]), 2);
  assert.deepEqual(await store.stats(), { total: 2, available: 2, assigned: 0 });

  const rawInventory = redis.lists.get("test:pirate:inventory:available");
  assert.equal(rawInventory.some((value) => value.includes("PIRATE-ONE")), false);

  const first = await store.assignKey("0xAABB");
  assert.equal(first.existing, false);
  assert.equal(first.productKey, "PIRATE-ONE");
  assert.deepEqual(await store.stats(), { total: 2, available: 1, assigned: 1 });

  const repeat = await store.assignKey("0xaabb");
  assert.deepEqual(repeat, { productKey: "PIRATE-ONE", existing: true });
  assert.deepEqual(await store.stats(), { total: 2, available: 1, assigned: 1 });
});

test("Redis challenges are one-use and shared rate limits are enforced", async () => {
  const { store } = fixture();
  await store.healthCheck();
  await store.putChallenge("challenge", "0xAABB", "message", 2_000, 1_000);
  assert.deepEqual(await store.getChallenge("challenge", "0xaabb"), {
    address: "0xAABB",
    message: "message",
    expiresAt: 2_000,
    used: false,
  });
  assert.equal(await store.consumeChallenge("challenge", "0xAABB", "message", 1_500), true);
  assert.equal(await store.consumeChallenge("challenge", "0xAABB", "message", 1_500), false);

  assert.equal(await store.takeRateLimit("192.0.2.1", 0, 60_000, 2), false);
  assert.equal(await store.takeRateLimit("192.0.2.1", 0, 60_000, 2), false);
  assert.equal(await store.takeRateLimit("192.0.2.1", 0, 60_000, 2), true);
});

test("Redis inventory rejects malformed encryption keys", () => {
  assert.throws(
    () => new RedisKeyStore({ redis: new FakeRedis(), encryptionKey: "short" }),
    /base64-encoded 32-byte key/,
  );
});
