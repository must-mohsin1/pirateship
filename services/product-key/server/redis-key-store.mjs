import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

const ENCRYPTION_AAD = Buffer.from("pirate-product-key-v1", "utf8");

const ADD_KEY_SCRIPT = `
  if redis.call("SADD", KEYS[1], ARGV[1]) == 0 then
    return 0
  end
  redis.call("RPUSH", KEYS[2], ARGV[2])
  return 1
`;

const ASSIGN_KEY_SCRIPT = `
  local existing = redis.call("GET", KEYS[1])
  if existing then
    return {existing, "1"}
  end

  local candidate = redis.call("LPOP", KEYS[2])
  if not candidate then
    return {}
  end

  redis.call("SET", KEYS[1], candidate)
  redis.call("INCR", KEYS[3])
  return {candidate, "0"}
`;

const RATE_LIMIT_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
  end
  return count
`;

function parseEncryptionKey(value) {
  const key = Buffer.from(value || "", "base64");
  if (key.length !== 32) {
    throw new Error("PRODUCT_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function parseStoredJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

export class RedisKeyStore {
  constructor({ redis, encryptionKey, prefix = "pirate:product-key" }) {
    if (!redis) throw new Error("A Redis client is required.");
    this.redis = redis;
    this.encryptionKey = parseEncryptionKey(encryptionKey);
    this.prefix = prefix.replace(/:+$/, "");
  }

  key(name) {
    return `${this.prefix}:${name}`;
  }

  async healthCheck() {
    const response = await this.redis.ping();
    if (response !== "PONG") throw new Error("Redis health check failed.");
  }

  encryptProductKey(productKey) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(ENCRYPTION_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(productKey, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  decryptProductKey(payload) {
    const bytes = Buffer.from(payload, "base64");
    if (bytes.length < 29) throw new Error("Encrypted product-key inventory is corrupted.");
    const iv = bytes.subarray(0, 12);
    const authTag = bytes.subarray(12, 28);
    const ciphertext = bytes.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAAD(ENCRYPTION_AAD);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  productKeyDigest(productKey) {
    return createHmac("sha256", this.encryptionKey)
      .update(productKey, "utf8")
      .digest("base64url");
  }

  async putChallenge(challengeId, address, message, expiresAt, now = Date.now()) {
    const ttl = Math.max(1, expiresAt - now);
    const payload = JSON.stringify({ address, message, expiresAt });
    await this.redis.set(this.key(`challenge:${challengeId}`), payload, { px: ttl });
  }

  async getChallenge(challengeId, address) {
    const payload = parseStoredJson(
      await this.redis.get(this.key(`challenge:${challengeId}`)),
    );
    if (!payload || payload.address.toLowerCase() !== address.toLowerCase()) return null;
    return { ...payload, used: false };
  }

  async consumeChallenge(challengeId, address, message, now = Date.now()) {
    const payload = parseStoredJson(
      await this.redis.getdel(this.key(`challenge:${challengeId}`)),
    );
    return Boolean(
      payload &&
      payload.address.toLowerCase() === address.toLowerCase() &&
      payload.message === message &&
      payload.expiresAt >= now,
    );
  }

  async addKeys(keys) {
    const normalized = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
    let inserted = 0;
    for (const productKey of normalized) {
      inserted += Number(await this.redis.eval(
        ADD_KEY_SCRIPT,
        [this.key("inventory:digests"), this.key("inventory:available")],
        [this.productKeyDigest(productKey), this.encryptProductKey(productKey)],
      ));
    }
    return inserted;
  }

  async assignKey(address) {
    const normalizedAddress = address.toLowerCase();
    const result = await this.redis.eval(
      ASSIGN_KEY_SCRIPT,
      [
        this.key(`assignment:${normalizedAddress}`),
        this.key("inventory:available"),
        this.key("inventory:assigned-count"),
      ],
      [],
    );
    if (!Array.isArray(result) || result.length < 2) return null;
    return {
      productKey: this.decryptProductKey(String(result[0])),
      existing: String(result[1]) === "1",
    };
  }

  async stats() {
    const [total, available, assigned] = await Promise.all([
      this.redis.scard(this.key("inventory:digests")),
      this.redis.llen(this.key("inventory:available")),
      this.redis.get(this.key("inventory:assigned-count")),
    ]);
    return {
      total: Number(total ?? 0),
      available: Number(available ?? 0),
      assigned: Number(assigned ?? 0),
    };
  }

  async takeRateLimit(clientKey, _now, windowMs, maxRequests) {
    const digest = createHash("sha256").update(clientKey, "utf8").digest("base64url");
    const count = await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      [this.key(`rate-limit:${digest}`)],
      [String(windowMs)],
    );
    return Number(count) > maxRequests;
  }
}
