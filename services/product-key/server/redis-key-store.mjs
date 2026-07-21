import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENCRYPTION_AAD = Buffer.from("pirate-product-key-v1", "utf8");
const ENCRYPTION_VERSION = "v1";
const MAX_ASSIGNMENT_ATTEMPTS = 16;
const GENERATED_LICENSE_VERSION = "v1";

const ADD_KEY_SCRIPT = `
  if redis.call("SADD", KEYS[1], ARGV[1]) == 0 then
    return 0
  end
  redis.call("RPUSH", KEYS[2], ARGV[2])
  redis.call("HSET", KEYS[3], ARGV[2], ARGV[1])
  return 1
`;

const PEEK_KEY_SCRIPT = `
  local existing = redis.call("GET", KEYS[1])
  if existing then
    return {existing, "1"}
  end

  local candidate = redis.call("LINDEX", KEYS[2], 0)
  if not candidate then
    return {}
  end

  return {candidate, "0"}
`;

const CLAIM_KEY_SCRIPT = `
  local existing = redis.call("GET", KEYS[1])
  if existing then
    return {existing, "1"}
  end

  local candidate = redis.call("LINDEX", KEYS[2], 0)
  if not candidate then
    return {}
  end
  if candidate ~= ARGV[1] then
    return {"", "2"}
  end

  redis.call("LPOP", KEYS[2])
  redis.call("SET", KEYS[1], candidate)
  redis.call("INCR", KEYS[3])
  redis.call("HDEL", KEYS[4], candidate)
  return {candidate, "0"}
`;

const QUARANTINE_KEY_SCRIPT = `
  local candidate = redis.call("LINDEX", KEYS[1], 0)
  if not candidate or candidate ~= ARGV[1] then
    return 0
  end
  redis.call("LPOP", KEYS[1])
  redis.call("RPUSH", KEYS[2], candidate)
  local digest = redis.call("HGET", KEYS[4], candidate)
  if digest then
    redis.call("SREM", KEYS[3], digest)
  end
  redis.call("HDEL", KEYS[4], candidate)
  return 1
`;

const RATE_LIMIT_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
  end
  return count
`;

const ASSIGN_GENERATED_KEY_SCRIPT = `
  local existing = redis.call("GET", KEYS[1])
  if existing then
    return {existing, "1"}
  end

  redis.call("SET", KEYS[1], ARGV[1])
  redis.call("INCR", KEYS[2])
  return {ARGV[1], "0"}
`;

function parseSecretKey(value, name) {
  const key = Buffer.from(value || "", "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must be a base64-encoded 32-byte key.`);
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
    this.encryptionKey = parseSecretKey(encryptionKey, "PRODUCT_KEY_ENCRYPTION_KEY");
    this.encryptionKeyFingerprint = createHash("sha256")
      .update(this.encryptionKey)
      .digest("base64url");
    this.prefix = prefix.replace(/:+$/, "");
  }

  key(name) {
    return `${this.prefix}:${name}`;
  }

  async ensureEncryptionKey() {
    const fingerprintKey = this.key("encryption-key-fingerprint");
    let storedFingerprint = await this.redis.get(fingerprintKey);
    if (!storedFingerprint) {
      const [total, available, assigned] = await Promise.all([
        this.redis.scard(this.key("inventory:digests")),
        this.redis.llen(this.key("inventory:available")),
        this.redis.get(this.key("inventory:assigned-count")),
      ]);
      if (
        Number(total ?? 0) > 0 ||
        Number(available ?? 0) > 0 ||
        Number(assigned ?? 0) > 0
      ) {
        throw new Error(
          "Redis inventory exists without an encryption-key fingerprint. Refusing to mutate it.",
        );
      }
      await this.redis.set(
        fingerprintKey,
        this.encryptionKeyFingerprint,
        { nx: true },
      );
      storedFingerprint = await this.redis.get(fingerprintKey);
    }

    const stored = Buffer.from(String(storedFingerprint));
    const expected = Buffer.from(this.encryptionKeyFingerprint);
    if (stored.length !== expected.length || !timingSafeEqual(stored, expected)) {
      throw new Error(
        "PRODUCT_KEY_ENCRYPTION_KEY does not match this Redis inventory namespace.",
      );
    }
  }

  async healthCheck() {
    const response = await this.redis.ping();
    if (response !== "PONG") throw new Error("Redis health check failed.");
    await this.ensureEncryptionKey();
  }

  encryptProductKey(productKey) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(ENCRYPTION_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(productKey, "utf8"),
      cipher.final(),
    ]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
    return `${ENCRYPTION_VERSION}:${payload}`;
  }

  decryptProductKey(payload) {
    const [version, encoded] = payload.split(":", 2);
    if (version !== ENCRYPTION_VERSION || !encoded) {
      throw new Error("Encrypted product-key inventory uses an unsupported format.");
    }
    const bytes = Buffer.from(encoded, "base64");
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
    if (normalized.length === 0) return 0;
    await this.ensureEncryptionKey();

    const pipeline = this.redis.pipeline();
    for (const productKey of normalized) {
      pipeline.eval(
        ADD_KEY_SCRIPT,
        [
          this.key("inventory:digests"),
          this.key("inventory:available"),
          this.key("inventory:payload-digests"),
        ],
        [this.productKeyDigest(productKey), this.encryptProductKey(productKey)],
      );
    }
    const results = await pipeline.exec();
    return results.reduce((inserted, result) => inserted + Number(result ?? 0), 0);
  }

  async assignKey(address) {
    await this.ensureEncryptionKey();
    const normalizedAddress = address.toLowerCase();
    const keys = [
      this.key(`assignment:${normalizedAddress}`),
      this.key("inventory:available"),
      this.key("inventory:assigned-count"),
      this.key("inventory:payload-digests"),
    ];

    for (let attempt = 0; attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt += 1) {
      const peeked = await this.redis.eval(PEEK_KEY_SCRIPT, keys.slice(0, 2), []);
      if (!Array.isArray(peeked) || peeked.length < 2) return null;

      const payload = String(peeked[0]);
      let productKey;
      try {
        productKey = this.decryptProductKey(payload);
      } catch (error) {
        if (String(peeked[1]) === "1") throw error;
        await this.redis.eval(
          QUARANTINE_KEY_SCRIPT,
          [
            this.key("inventory:available"),
            this.key("inventory:quarantined"),
            this.key("inventory:digests"),
            this.key("inventory:payload-digests"),
          ],
          [payload],
        );
        continue;
      }
      if (String(peeked[1]) === "1") {
        return { productKey, existing: true };
      }

      const claimed = await this.redis.eval(CLAIM_KEY_SCRIPT, keys, [payload]);
      if (!Array.isArray(claimed) || claimed.length < 2) continue;
      const state = String(claimed[1]);
      if (state === "2") continue;
      const claimedPayload = String(claimed[0]);
      return {
        productKey:
          claimedPayload === payload
            ? productKey
            : this.decryptProductKey(claimedPayload),
        existing: state === "1",
      };
    }

    const error = new Error("Product-key assignment is temporarily busy.");
    error.status = 503;
    error.safeStatus = true;
    throw error;
  }

  async stats() {
    const [total, available, assigned, quarantined] = await Promise.all([
      this.redis.scard(this.key("inventory:digests")),
      this.redis.llen(this.key("inventory:available")),
      this.redis.get(this.key("inventory:assigned-count")),
      this.redis.llen(this.key("inventory:quarantined")),
    ]);
    return {
      total: Number(total ?? 0),
      available: Number(available ?? 0),
      assigned: Number(assigned ?? 0),
      quarantined: Number(quarantined ?? 0),
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

export class GeneratedRedisKeyStore extends RedisKeyStore {
  constructor({
    redis,
    encryptionKey,
    generationKey,
    generationContext,
    prefix = "pirate:product-key",
    licensePrefix = "PIRATE-POL",
  }) {
    super({ redis, encryptionKey, prefix });
    this.generationKey = parseSecretKey(
      generationKey,
      "PRODUCT_KEY_GENERATION_KEY",
    );
    this.generationKeyFingerprint = createHash("sha256")
      .update(this.generationKey)
      .digest("base64url");
    this.generationContext = String(generationContext ?? "").trim();
    if (!this.generationContext) {
      throw new Error("A product-key generation context is required.");
    }
    this.generationContextFingerprint = createHash("sha256")
      .update(this.generationContext, "utf8")
      .digest("base64url");
    this.licensePrefix = String(licensePrefix).trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(this.licensePrefix)) {
      throw new Error(
        "PRODUCT_KEY_LICENSE_PREFIX must contain uppercase letters, numbers, and single hyphens only.",
      );
    }
  }

  async ensureGenerationKey() {
    const fingerprintKey = this.key("generation-key-fingerprint");
    const contextFingerprintKey = this.key("generation-context-fingerprint");
    const [
      initialFingerprint,
      initialContextFingerprint,
      finiteTotal,
      finiteAvailable,
      assigned,
    ] = await Promise.all([
        this.redis.get(fingerprintKey),
        this.redis.get(contextFingerprintKey),
        this.redis.scard(this.key("inventory:digests")),
        this.redis.llen(this.key("inventory:available")),
        this.redis.get(this.key("inventory:assigned-count")),
      ]);
    if (Number(finiteTotal ?? 0) > 0 || Number(finiteAvailable ?? 0) > 0) {
      throw new Error(
        "Finite Redis inventory exists in the unlimited-license namespace.",
      );
    }

    let storedFingerprint = initialFingerprint;
    let storedContextFingerprint = initialContextFingerprint;
    if (!storedFingerprint || !storedContextFingerprint) {
      if (Number(assigned ?? 0) > 0) {
        throw new Error(
          "Generated assignments exist without complete generation fingerprints. Refusing to mutate them.",
        );
      }
      await Promise.all([
        this.redis.set(
          fingerprintKey,
          this.generationKeyFingerprint,
          { nx: true },
        ),
        this.redis.set(
          contextFingerprintKey,
          this.generationContextFingerprint,
          { nx: true },
        ),
      ]);
      [storedFingerprint, storedContextFingerprint] = await Promise.all([
        this.redis.get(fingerprintKey),
        this.redis.get(contextFingerprintKey),
      ]);
    }

    const stored = Buffer.from(String(storedFingerprint));
    const expected = Buffer.from(this.generationKeyFingerprint);
    if (stored.length !== expected.length || !timingSafeEqual(stored, expected)) {
      throw new Error(
        "PRODUCT_KEY_GENERATION_KEY does not match this Redis assignment namespace.",
      );
    }
    const storedContext = Buffer.from(String(storedContextFingerprint));
    const expectedContext = Buffer.from(this.generationContextFingerprint);
    if (
      storedContext.length !== expectedContext.length ||
      !timingSafeEqual(storedContext, expectedContext)
    ) {
      throw new Error(
        "The chain or escrow contract does not match this Redis assignment namespace.",
      );
    }
  }

  async healthCheck() {
    const response = await this.redis.ping();
    if (response !== "PONG") throw new Error("Redis health check failed.");
    await this.ensureGenerationKey();
    await this.ensureEncryptionKey();
  }

  generatedProductKey(address) {
    const digest = createHmac("sha256", this.generationKey)
      .update(GENERATED_LICENSE_VERSION, "utf8")
      .update("\0", "utf8")
      .update(this.generationContext, "utf8")
      .update("\0", "utf8")
      .update(address.toLowerCase(), "utf8")
      .digest()
      .subarray(0, 16)
      .toString("hex")
      .toUpperCase();
    return `${this.licensePrefix}-${digest}`;
  }

  async addKeys() {
    const error = new Error(
      "This deployment generates one unlimited license per approved wallet; inventory imports are disabled.",
    );
    error.status = 409;
    error.exposeToClient = true;
    throw error;
  }

  async assignKey(address) {
    await this.ensureEncryptionKey();
    await this.ensureGenerationKey();
    const normalizedAddress = address.toLowerCase();
    const productKey = this.generatedProductKey(normalizedAddress);
    const encrypted = this.encryptProductKey(productKey);
    const assigned = await this.redis.eval(
      ASSIGN_GENERATED_KEY_SCRIPT,
      [
        this.key(`assignment:${normalizedAddress}`),
        this.key("inventory:assigned-count"),
      ],
      [encrypted],
    );
    if (!Array.isArray(assigned) || assigned.length < 2) {
      const error = new Error("Generated product-key assignment failed.");
      error.status = 503;
      error.safeStatus = true;
      throw error;
    }
    return {
      productKey: this.decryptProductKey(String(assigned[0])),
      existing: String(assigned[1]) === "1",
    };
  }

  async stats() {
    const assigned = await this.redis.get(this.key("inventory:assigned-count"));
    return {
      mode: "unlimited",
      total: null,
      available: null,
      assigned: Number(assigned ?? 0),
      quarantined: 0,
    };
  }
}
