import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createStandardRedisClient,
  StandardRedisClient,
  validateStandardRedisUrl,
} from "./standard-redis-client.mjs";

class FakeRedisClient extends EventEmitter {
  constructor() {
    super();
    this.isOpen = false;
    this.isReady = false;
    this.connectCalls = 0;
    this.closeCalls = 0;
    this.destroyCalls = 0;
    this.calls = [];
  }

  async connect() {
    this.connectCalls += 1;
    this.isOpen = true;
    await Promise.resolve();
    this.isReady = true;
  }

  async close() {
    this.closeCalls += 1;
    this.isOpen = false;
    this.isReady = false;
  }

  destroy() {
    this.destroyCalls += 1;
    this.isOpen = false;
    this.isReady = false;
  }

  async get(key) {
    this.calls.push(["get", key]);
    return `value:${key}`;
  }

  async set(key, value, options) {
    this.calls.push(["set", key, value, options]);
    return "OK";
  }

  async getDel(key) {
    this.calls.push(["getDel", key]);
    return `deleted:${key}`;
  }

  async lLen(key) {
    this.calls.push(["lLen", key]);
    return 2;
  }

  async ping() {
    this.calls.push(["ping"]);
    return "PONG";
  }

  async sCard(key) {
    this.calls.push(["sCard", key]);
    return 3;
  }

  async eval(script, options) {
    this.calls.push(["eval", script, options]);
    return options.arguments[0];
  }
}

test("standard Redis validates TLS and authentication for production", () => {
  assert.equal(
    validateStandardRedisUrl("rediss://default:secret@redis.example:6379", true),
    "rediss://default:secret@redis.example:6379",
  );
  assert.equal(
    validateStandardRedisUrl("redis://127.0.0.1:6379", false),
    "redis://127.0.0.1:6379",
  );
  assert.throws(
    () => validateStandardRedisUrl("https://redis.example", false),
    /redis:\/\/ or rediss:\/\//,
  );
  assert.throws(
    () => validateStandardRedisUrl("not a URL", false),
    /valid Redis connection URL/,
  );
  assert.throws(
    () => validateStandardRedisUrl("redis://:secret@redis.example:6379", true),
    /rediss:\/\/ TLS/,
  );
  assert.throws(
    () => validateStandardRedisUrl("rediss://redis.example:6379", true),
    /include Redis authentication/,
  );
});

test("standard Redis connects lazily and normalizes commands", async () => {
  const fake = new FakeRedisClient();
  let clientOptions;
  const redis = createStandardRedisClient({
    url: "redis://127.0.0.1:6379",
    timeoutMs: 4_321,
    clientFactory(options) {
      clientOptions = options;
      return fake;
    },
  });

  assert.equal(redis instanceof StandardRedisClient, true);
  assert.deepEqual(clientOptions, {
    url: "redis://127.0.0.1:6379",
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 4_321,
      socketTimeout: 4_321,
      reconnectStrategy: false,
    },
  });
  assert.equal(await redis.get("alpha"), "value:alpha");
  assert.equal(await redis.set("beta", "two", { nx: true, px: 500 }), "OK");
  assert.equal(await redis.set("gamma", "three"), "OK");
  assert.equal(await redis.getdel("challenge"), "deleted:challenge");
  assert.equal(await redis.llen("inventory"), 2);
  assert.equal(await redis.ping(), "PONG");
  assert.equal(await redis.scard("digests"), 3);
  assert.equal(fake.connectCalls, 1);
  assert.deepEqual(fake.calls, [
    ["get", "alpha"],
    [
      "set",
      "beta",
      "two",
      {
        expiration: { type: "PX", value: 500 },
        condition: "NX",
      },
    ],
    ["set", "gamma", "three", {}],
    ["getDel", "challenge"],
    ["lLen", "inventory"],
    ["ping"],
    ["sCard", "digests"],
  ]);

  await redis.close();
  assert.equal(fake.closeCalls, 1);
});

test("standard Redis pipelines Lua commands using the shared connection", async () => {
  const fake = new FakeRedisClient();
  const redis = new StandardRedisClient(fake);
  const pipeline = redis.pipeline();
  pipeline.eval("return ARGV[1]", ["one"], [1]);
  pipeline.eval("return ARGV[1]", ["two"], [2]);

  assert.deepEqual(await pipeline.exec(), ["1", "2"]);
  assert.equal(fake.connectCalls, 1);
  assert.deepEqual(fake.calls, [
    [
      "eval",
      "return ARGV[1]",
      { keys: ["one"], arguments: ["1"] },
    ],
    [
      "eval",
      "return ARGV[1]",
      { keys: ["two"], arguments: ["2"] },
    ],
  ]);
  await assert.rejects(pipeline.exec(), /already executed/);
  assert.throws(
    () => pipeline.eval("return 3"),
    /already executed/,
  );
});

test("standard Redis fails fast while the client is reconnecting", async () => {
  const fake = new FakeRedisClient();
  fake.isOpen = true;
  const redis = new StandardRedisClient(fake);

  await assert.rejects(
    redis.get("alpha"),
    /temporarily unavailable/,
  );
  assert.equal(fake.connectCalls, 0);
});

test("standard Redis waits for an in-flight connection before closing", async () => {
  const fake = new FakeRedisClient();
  let finishConnecting;
  fake.connect = async function connect() {
    this.connectCalls += 1;
    this.isOpen = true;
    await new Promise((resolve) => {
      finishConnecting = resolve;
    });
    this.isReady = true;
  };
  const redis = new StandardRedisClient(fake);

  const pendingGet = redis.get("alpha");
  await Promise.resolve();
  const pendingClose = redis.close();
  finishConnecting();

  assert.equal(await pendingGet, "value:alpha");
  await pendingClose;
  assert.equal(fake.closeCalls, 1);
});

test("standard Redis force-closes when graceful shutdown stalls", async () => {
  const fake = new FakeRedisClient();
  fake.isOpen = true;
  fake.isReady = true;
  fake.close = async function close() {
    this.closeCalls += 1;
    await new Promise(() => {});
  };
  const redis = new StandardRedisClient(fake, 10);

  await redis.close();

  assert.equal(fake.closeCalls, 1);
  assert.equal(fake.destroyCalls, 1);
  assert.equal(fake.isOpen, false);
});

test("standard Redis shares a pending connection across concurrent commands", async () => {
  const fake = new FakeRedisClient();
  let finishConnecting;
  fake.connect = async function connect() {
    this.connectCalls += 1;
    this.isOpen = true;
    await new Promise((resolve) => {
      finishConnecting = resolve;
    });
    this.isReady = true;
  };
  const redis = new StandardRedisClient(fake);

  const first = redis.get("alpha");
  const second = redis.get("beta");
  await Promise.resolve();
  assert.equal(fake.connectCalls, 1);
  finishConnecting();

  assert.deepEqual(await Promise.all([first, second]), ["value:alpha", "value:beta"]);
});

test("standard Redis retries after an initial connection failure", async () => {
  const fake = new FakeRedisClient();
  fake.connect = async function connect() {
    this.connectCalls += 1;
    this.isOpen = true;
    if (this.connectCalls === 1) {
      this.isOpen = false;
      throw new Error("connection failed");
    }
    this.isReady = true;
  };
  const redis = new StandardRedisClient(fake);

  await assert.rejects(redis.get("alpha"), /connection failed/);
  assert.equal(await redis.get("alpha"), "value:alpha");
  assert.equal(fake.connectCalls, 2);
});

test("standard Redis reports connection errors without logging secrets", () => {
  const fake = new FakeRedisClient();
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    createStandardRedisClient({
      url: "redis://127.0.0.1:6379",
      timeoutMs: 5_000,
      clientFactory: () => fake,
    });
    const error = new Error("rediss://default:secret@redis.example:6379");
    error.code = "ECONNRESET";
    fake.emit("error", error);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(logged, [
    [
      "Redis client error.",
      { name: "Error", code: "ECONNRESET", status: undefined },
    ],
  ]);
  assert.doesNotMatch(JSON.stringify(logged), /secret@redis/);
});
