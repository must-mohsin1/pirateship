import { createClient } from "redis";
import { logServerError } from "./safe-log.mjs";

function standardSetOptions(options = {}) {
  const normalized = {};
  if (options.px !== undefined) {
    normalized.expiration = { type: "PX", value: options.px };
  }
  if (options.nx) normalized.condition = "NX";
  return normalized;
}

export function validateStandardRedisUrl(value, production = false) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("REDIS_URL must be a valid Redis connection URL.");
  }

  if (!parsed.hostname || !["redis:", "rediss:"].includes(parsed.protocol)) {
    throw new Error("REDIS_URL must use the redis:// or rediss:// scheme.");
  }
  if (production && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use rediss:// TLS in production.");
  }
  if (production && !parsed.password) {
    throw new Error("REDIS_URL must include Redis authentication in production.");
  }
  return value;
}

class StandardRedisPipeline {
  constructor(redis) {
    this.redis = redis;
    this.commands = [];
    this.executed = false;
  }

  eval(script, keys = [], args = []) {
    if (this.executed) throw new Error("This Redis pipeline was already executed.");
    this.commands.push([script, keys, args]);
    return this;
  }

  async exec() {
    if (this.executed) throw new Error("This Redis pipeline was already executed.");
    this.executed = true;
    await this.redis.ensureConnected();
    return Promise.all(
      this.commands.map(([script, keys, args]) =>
        this.redis.eval(script, keys, args),
      ),
    );
  }
}

export class StandardRedisClient {
  constructor(client, timeoutMs = 5_000) {
    this.client = client;
    this.timeoutMs = timeoutMs;
    this.connectPromise = undefined;
  }

  async ensureConnected() {
    if (this.client.isReady) return;
    if (!this.client.isOpen) {
      this.connectPromise ??= this.client.connect().finally(() => {
        this.connectPromise = undefined;
      });
    }
    if (this.connectPromise) await this.connectPromise;
    if (!this.client.isReady) {
      throw new Error("Redis is reconnecting and is temporarily unavailable.");
    }
  }

  async call(method, ...args) {
    await this.ensureConnected();
    return this.client[method](...args);
  }

  get(key) {
    return this.call("get", key);
  }

  getdel(key) {
    return this.call("getDel", key);
  }

  llen(key) {
    return this.call("lLen", key);
  }

  ping() {
    return this.call("ping");
  }

  scard(key) {
    return this.call("sCard", key);
  }

  set(key, value, options = {}) {
    return this.call("set", key, value, standardSetOptions(options));
  }

  eval(script, keys = [], args = []) {
    return this.call("eval", script, {
      keys,
      arguments: args.map(String),
    });
  }

  pipeline() {
    return new StandardRedisPipeline(this);
  }

  async close() {
    if (this.connectPromise) {
      await this.connectPromise.catch(() => undefined);
    }
    if (!this.client.isOpen) return;

    let timeout;
    const gracefulClose = this.client.close();
    const timedOut = await Promise.race([
      gracefulClose.then(() => false),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(true), this.timeoutMs);
      }),
    ]);
    clearTimeout(timeout);
    if (timedOut) this.client.destroy();
  }
}

export function createStandardRedisClient({
  url,
  timeoutMs,
  production = false,
  clientFactory = createClient,
}) {
  const redisUrl = validateStandardRedisUrl(url, production);
  const client = clientFactory({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: timeoutMs,
      socketTimeout: timeoutMs,
      reconnectStrategy: false,
    },
  });
  client.on("error", (error) => {
    logServerError("Redis client error.", error);
  });
  return new StandardRedisClient(client, timeoutMs);
}
