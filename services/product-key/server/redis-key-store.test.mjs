import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  GeneratedRedisKeyStore,
  RedisKeyStore,
} from "./redis-key-store.mjs";

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.lists = new Map();
    this.sets = new Map();
    this.hashes = new Map();
    this.expirations = new Map();
    this.now = 0;
    this.pipelineExecutions = 0;
    this.pipelineCommandCounts = [];
  }

  async ping() {
    return "PONG";
  }

  advance(milliseconds) {
    this.now += milliseconds;
  }

  expireIfNeeded(key) {
    const expiresAt = this.expirations.get(key);
    if (expiresAt !== undefined && expiresAt <= this.now) {
      this.values.delete(key);
      this.expirations.delete(key);
    }
  }

  async set(key, value, options = {}) {
    this.expireIfNeeded(key);
    if (options.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    if (options.px) this.expirations.set(key, this.now + Number(options.px));
    return "OK";
  }

  async get(key) {
    this.expireIfNeeded(key);
    return this.values.get(key) ?? null;
  }

  async getdel(key) {
    const value = await this.get(key);
    this.values.delete(key);
    this.expirations.delete(key);
    return value;
  }

  async scard(key) {
    return this.sets.get(key)?.size ?? 0;
  }

  async llen(key) {
    return this.lists.get(key)?.length ?? 0;
  }

  pipeline() {
    const commands = [];
    const pipeline = {
      eval: (script, keys, args) => {
        commands.push([script, keys, args]);
        return pipeline;
      },
      exec: async () => {
        this.pipelineExecutions += 1;
        this.pipelineCommandCounts.push(commands.length);
        return Promise.all(commands.map((command) => this.eval(...command)));
      },
    };
    return pipeline;
  }

  async eval(script, keys, args) {
    if (script.includes('return {ARGV[1], "0"}')) {
      const existing = this.values.get(keys[0]);
      if (existing) return [existing, "1"];
      this.values.set(keys[0], args[0]);
      this.values.set(keys[1], Number(this.values.get(keys[1]) ?? 0) + 1);
      return [args[0], "0"];
    }
    if (script.includes("SADD")) {
      const digests = this.sets.get(keys[0]) ?? new Set();
      this.sets.set(keys[0], digests);
      if (digests.has(args[0])) return 0;
      digests.add(args[0]);
      const inventory = this.lists.get(keys[1]) ?? [];
      this.lists.set(keys[1], inventory);
      inventory.push(args[1]);
      const payloadDigests = this.hashes.get(keys[2]) ?? new Map();
      this.hashes.set(keys[2], payloadDigests);
      payloadDigests.set(args[1], args[0]);
      return 1;
    }
    if (script.includes("candidate ~= ARGV[1]") && script.includes("INCR")) {
      const existing = this.values.get(keys[0]);
      if (existing) return [existing, "1"];
      const inventory = this.lists.get(keys[1]) ?? [];
      const candidate = inventory[0];
      if (!candidate) return [];
      if (candidate !== args[0]) return ["", "2"];
      inventory.shift();
      this.values.set(keys[0], candidate);
      this.values.set(keys[2], Number(this.values.get(keys[2]) ?? 0) + 1);
      this.hashes.get(keys[3])?.delete(candidate);
      return [candidate, "0"];
    }
    if (script.includes("RPUSH")) {
      const inventory = this.lists.get(keys[0]) ?? [];
      const candidate = inventory[0];
      if (!candidate || candidate !== args[0]) return 0;
      inventory.shift();
      const quarantined = this.lists.get(keys[1]) ?? [];
      this.lists.set(keys[1], quarantined);
      quarantined.push(candidate);
      const digest = this.hashes.get(keys[3])?.get(candidate);
      if (digest) this.sets.get(keys[2])?.delete(digest);
      this.hashes.get(keys[3])?.delete(candidate);
      return 1;
    }
    if (script.includes("LINDEX")) {
      const existing = this.values.get(keys[0]);
      if (existing) return [existing, "1"];
      const candidate = this.lists.get(keys[1])?.[0];
      return candidate ? [candidate, "0"] : [];
    }
    if (script.includes("PEXPIRE")) {
      const count = Number((await this.get(keys[0])) ?? 0) + 1;
      this.values.set(keys[0], count);
      if (count === 1) this.expirations.set(keys[0], this.now + Number(args[0]));
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

function generatedFixture(overrides = {}) {
  const redis = overrides.redis ?? new FakeRedis();
  const store = new GeneratedRedisKeyStore({
    redis,
    encryptionKey: overrides.encryptionKey ?? Buffer.alloc(32, 1).toString("base64"),
    generationKey: overrides.generationKey ?? Buffer.alloc(32, 2).toString("base64"),
    generationContext: overrides.generationContext ??
      "137:0x0000000000000000000000000000000000000001",
    prefix: "test:generated",
    licensePrefix: "PIRATE-POL",
  });
  return { redis, store };
}

test("Redis inventory is encrypted, deduplicated, and assigned stably", async () => {
  const { redis, store } = fixture();
  assert.equal(await store.addKeys(["PIRATE-ONE", "PIRATE-ONE", "PIRATE-TWO"]), 2);
  assert.equal(redis.pipelineExecutions, 1);
  assert.deepEqual(redis.pipelineCommandCounts, [2]);
  assert.deepEqual(await store.stats(), {
    total: 2,
    available: 2,
    assigned: 0,
    quarantined: 0,
  });

  const rawInventory = redis.lists.get("test:pirate:inventory:available");
  assert.equal(rawInventory.some((value) => value.includes("PIRATE-ONE")), false);

  const first = await store.assignKey("0xAABB");
  assert.equal(first.existing, false);
  assert.equal(first.productKey, "PIRATE-ONE");
  assert.deepEqual(await store.stats(), {
    total: 2,
    available: 1,
    assigned: 1,
    quarantined: 0,
  });

  const repeat = await store.assignKey("0xaabb");
  assert.deepEqual(repeat, { productKey: "PIRATE-ONE", existing: true });
  assert.deepEqual(await store.stats(), {
    total: 2,
    available: 1,
    assigned: 1,
    quarantined: 0,
  });
});

test("Redis imports the endpoint maximum in one pipeline roundtrip", async () => {
  const { redis, store } = fixture();
  const keys = Array.from({ length: 1_000 }, (_, index) => `PIRATE-${index}`);

  assert.equal(await store.addKeys(keys), 1_000);
  assert.equal(redis.pipelineExecutions, 1);
  assert.deepEqual(redis.pipelineCommandCounts, [1_000]);
  assert.deepEqual(await store.stats(), {
    total: 1_000,
    available: 1_000,
    assigned: 0,
    quarantined: 0,
  });

  assert.equal(await store.addKeys([]), 0);
  assert.equal(redis.pipelineExecutions, 1, "an empty import must not send a request");
});

test("Redis challenges are one-use and shared rate limits are enforced", async () => {
  const { redis, store } = fixture();
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

  await store.putChallenge("expired", "0xAABB", "message", 3_000, 2_000);
  redis.advance(1_001);
  assert.equal(await store.getChallenge("expired", "0xAABB"), null);

  assert.equal(await store.takeRateLimit("192.0.2.1", 0, 60_000, 2), false);
  assert.equal(await store.takeRateLimit("192.0.2.1", 0, 60_000, 2), false);
  assert.equal(await store.takeRateLimit("192.0.2.1", 0, 60_000, 2), true);
  redis.advance(60_001);
  assert.equal(await store.takeRateLimit("192.0.2.1", 60_001, 60_000, 2), false);
});

test("Redis inventory rejects malformed encryption keys", () => {
  assert.throws(
    () => new RedisKeyStore({ redis: new FakeRedis(), encryptionKey: "short" }),
    /base64-encoded 32-byte key/,
  );
});

test("Redis rejects a rotated encryption key before consuming inventory", async () => {
  const { redis, store } = fixture();
  await store.addKeys(["PIRATE-STAYS-AVAILABLE"]);
  const rotatedStore = new RedisKeyStore({
    redis,
    encryptionKey: randomBytes(32).toString("base64"),
    prefix: "test:pirate",
  });

  await assert.rejects(
    () => rotatedStore.assignKey("0xAABB"),
    /does not match this Redis inventory namespace/,
  );
  assert.deepEqual(await store.stats(), {
    total: 1,
    available: 1,
    assigned: 0,
    quarantined: 0,
  });
  assert.equal(redis.values.has("test:pirate:assignment:0xaabb"), false);
});

test("Redis revalidates its encryption fingerprint before every mutation", async () => {
  const { redis, store } = fixture();
  await store.addKeys(["PIRATE-STAYS-AVAILABLE"]);
  redis.values.delete("test:pirate:encryption-key-fingerprint");

  await assert.rejects(
    () => store.assignKey("0xAABB"),
    /exists without an encryption-key fingerprint/,
  );
  assert.equal(redis.values.has("test:pirate:assignment:0xaabb"), false);
});

test("Redis refuses legacy inventory without an encryption-key fingerprint", async () => {
  const { redis, store } = fixture();
  redis.sets.set("test:pirate:inventory:digests", new Set(["legacy-digest"]));
  redis.lists.set("test:pirate:inventory:available", ["legacy-ciphertext"]);

  await assert.rejects(
    () => store.healthCheck(),
    /exists without an encryption-key fingerprint/,
  );
  assert.deepEqual(redis.lists.get("test:pirate:inventory:available"), [
    "legacy-ciphertext",
  ]);
});

test("Redis quarantines corrupt inventory without blocking valid assignments", async () => {
  const { redis, store } = fixture();
  await store.healthCheck();
  redis.lists.set("test:pirate:inventory:available", ["corrupted-ciphertext"]);
  await store.addKeys(["PIRATE-RECOVERED"]);

  assert.deepEqual(await store.assignKey("0xAABB"), {
    productKey: "PIRATE-RECOVERED",
    existing: false,
  });
  assert.deepEqual(redis.lists.get("test:pirate:inventory:quarantined"), [
    "corrupted-ciphertext",
  ]);
  assert.deepEqual(await store.stats(), {
    total: 1,
    available: 0,
    assigned: 1,
    quarantined: 1,
  });
});

test("a quarantined encrypted key can be restored through normal inventory import", async () => {
  const { redis, store } = fixture();
  await store.addKeys(["PIRATE-RESTORABLE"]);
  const corruptedPayload = redis.lists.get("test:pirate:inventory:available")[0];
  redis.lists.set("test:pirate:inventory:available", [
    `${corruptedPayload.slice(0, -1)}!`,
  ]);
  const digest = [...redis.sets.get("test:pirate:inventory:digests")][0];
  redis.hashes.set(
    "test:pirate:inventory:payload-digests",
    new Map([[`${corruptedPayload.slice(0, -1)}!`, digest]]),
  );

  assert.equal(await store.assignKey("0xAABB"), null);
  assert.equal(await store.addKeys(["PIRATE-RESTORABLE"]), 1);
  assert.deepEqual(await store.assignKey("0xAABB"), {
    productKey: "PIRATE-RESTORABLE",
    existing: false,
  });
});

test("Redis assigns different keys during concurrent redemption", async () => {
  const { store } = fixture();
  await store.addKeys(["PIRATE-CONCURRENT-ONE", "PIRATE-CONCURRENT-TWO"]);

  const [first, second] = await Promise.all([
    store.assignKey("0xAAAA"),
    store.assignKey("0xBBBB"),
  ]);
  assert.deepEqual(
    new Set([first.productKey, second.productKey]),
    new Set(["PIRATE-CONCURRENT-ONE", "PIRATE-CONCURRENT-TWO"]),
  );
  assert.deepEqual(await store.stats(), {
    total: 2,
    available: 0,
    assigned: 2,
    quarantined: 0,
  });
});

test("unlimited Redis licenses are stable, distinct, and do not need inventory", async () => {
  const { store } = generatedFixture();
  await store.healthCheck();

  const first = await store.assignKey("0xAABB");
  assert.equal(first.existing, false);
  assert.match(first.productKey, /^PIRATE-POL-[A-F0-9]{32}$/);
  assert.deepEqual(await store.assignKey("0xaabb"), {
    productKey: first.productKey,
    existing: true,
  });
  const second = await store.assignKey("0xCCDD");
  assert.notEqual(second.productKey, first.productKey);
  assert.deepEqual(await store.stats(), {
    mode: "unlimited",
    total: null,
    available: null,
    assigned: 2,
    quarantined: 0,
  });
});

test("concurrent unlimited redemption creates one assignment for a wallet", async () => {
  const { store } = generatedFixture();
  const [first, second] = await Promise.all([
    store.assignKey("0xAABB"),
    store.assignKey("0xaabb"),
  ]);

  assert.equal(first.productKey, second.productKey);
  assert.deepEqual(new Set([first.existing, second.existing]), new Set([false, true]));
  assert.equal((await store.stats()).assigned, 1);
});

test("unlimited licenses are bound to the deployment context", async () => {
  const sharedGenerationKey = Buffer.alloc(32, 3).toString("base64");
  const first = generatedFixture({
    generationKey: sharedGenerationKey,
    generationContext: "137:0x0000000000000000000000000000000000000001",
  }).store.generatedProductKey("0xAABB");
  const second = generatedFixture({
    generationKey: sharedGenerationKey,
    generationContext: "80002:0x0000000000000000000000000000000000000001",
  }).store.generatedProductKey("0xAABB");

  assert.notEqual(first, second);
});

test("unlimited mode disables finite inventory imports", async () => {
  const { store } = generatedFixture();
  await assert.rejects(
    () => store.addKeys(["PIRATE-LEGACY"]),
    (error) => error.status === 409 && error.exposeToClient === true,
  );
});

test("unlimited mode rejects generation-key rotation before changing assignments", async () => {
  const { redis, store } = generatedFixture();
  const assignment = await store.assignKey("0xAABB");
  const rotated = generatedFixture({
    redis,
    generationKey: Buffer.alloc(32, 9).toString("base64"),
  }).store;

  await assert.rejects(
    () => rotated.assignKey("0xCCDD"),
    /GENERATION_KEY does not match/,
  );
  assert.deepEqual(await store.assignKey("0xAABB"), {
    productKey: assignment.productKey,
    existing: true,
  });
  assert.equal((await store.stats()).assigned, 1);
});

test("unlimited mode fails closed when its fingerprint is missing or inventory is mixed", async () => {
  const missing = generatedFixture();
  await missing.store.assignKey("0xAABB");
  missing.redis.values.delete("test:generated:generation-key-fingerprint");
  await assert.rejects(
    () => missing.store.assignKey("0xCCDD"),
    /assignments exist without complete generation fingerprints/,
  );

  const mixed = generatedFixture();
  mixed.redis.sets.set("test:generated:inventory:digests", new Set(["legacy"]));
  await assert.rejects(
    () => mixed.store.healthCheck(),
    /Finite Redis inventory exists/,
  );
});

test("unlimited mode rejects Redis namespaces from another chain or contract", async () => {
  const { redis, store } = generatedFixture();
  const original = await store.assignKey("0xAABB");
  const wrongDeployment = generatedFixture({
    redis,
    generationContext: "137:0x0000000000000000000000000000000000000002",
  }).store;

  await assert.rejects(
    () => wrongDeployment.assignKey("0xAABB"),
    /chain or escrow contract does not match/,
  );
  assert.deepEqual(await store.assignKey("0xAABB"), {
    productKey: original.productKey,
    existing: true,
  });
});

test("unlimited mode validates its generation secret and display prefix", () => {
  assert.throws(
    () => generatedFixture({ generationKey: "short" }),
    /PRODUCT_KEY_GENERATION_KEY must be a base64-encoded 32-byte key/,
  );
  assert.throws(
    () => new GeneratedRedisKeyStore({
      redis: new FakeRedis(),
      encryptionKey: Buffer.alloc(32, 1).toString("base64"),
      generationKey: Buffer.alloc(32, 2).toString("base64"),
      generationContext: "137:contract",
      licensePrefix: "PIRATE KEY",
    }),
    /PRODUCT_KEY_LICENSE_PREFIX/,
  );
});
