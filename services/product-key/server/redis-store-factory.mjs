import { Redis } from "@upstash/redis";
import {
  GeneratedRedisKeyStore,
  RedisKeyStore,
} from "./redis-key-store.mjs";
import {
  integerEnvironment,
  requireEnvironment,
} from "./runtime-config.mjs";

export const PRODUCT_KEY_MODES = new Set(["inventory", "generated"]);

export function productKeyMode(environment) {
  const mode = environment.PRODUCT_KEY_MODE?.trim().toLowerCase() || "inventory";
  if (!PRODUCT_KEY_MODES.has(mode)) {
    throw new Error(
      `PRODUCT_KEY_MODE must be one of: ${[...PRODUCT_KEY_MODES].join(", ")}.`,
    );
  }
  return mode;
}

export function createRedisProductKeyStore({
  environment,
  contractAddress,
  expectedChainId,
  redis: suppliedRedis,
}) {
  const mode = productKeyMode(environment);
  const redisTimeoutMs = integerEnvironment(
    environment,
    "REDIS_TIMEOUT_MS",
    "5000",
  );
  const redis = suppliedRedis ?? new Redis({
    url: requireEnvironment(environment, "UPSTASH_REDIS_REST_URL"),
    token: requireEnvironment(environment, "UPSTASH_REDIS_REST_TOKEN"),
    signal: () => AbortSignal.timeout(redisTimeoutMs),
  });
  const encryptionKey = requireEnvironment(
    environment,
    "PRODUCT_KEY_ENCRYPTION_KEY",
  );
  const prefix =
    environment.PRODUCT_KEY_REDIS_PREFIX?.trim() ||
    `pirate:product-key:${contractAddress.toLowerCase()}`;

  if (mode === "generated") {
    return new GeneratedRedisKeyStore({
      redis,
      encryptionKey,
      generationKey: requireEnvironment(environment, "PRODUCT_KEY_GENERATION_KEY"),
      generationContext: `${expectedChainId}:${contractAddress.toLowerCase()}`,
      prefix,
      licensePrefix: environment.PRODUCT_KEY_LICENSE_PREFIX?.trim() || "PIRATE-POL",
    });
  }

  return new RedisKeyStore({ redis, encryptionKey, prefix });
}
