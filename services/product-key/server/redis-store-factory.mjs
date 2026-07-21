import { Redis } from "@upstash/redis";
import {
  GeneratedRedisKeyStore,
  RedisKeyStore,
} from "./redis-key-store.mjs";
import {
  integerEnvironment,
  requireEnvironment,
} from "./runtime-config.mjs";
import { createStandardRedisClient } from "./standard-redis-client.mjs";

export const PRODUCT_KEY_MODES = new Set(["inventory", "generated"]);

export function productKeyMode(environment, expectedChainId) {
  const mode = environment.PRODUCT_KEY_MODE?.trim().toLowerCase() || "inventory";
  if (!PRODUCT_KEY_MODES.has(mode)) {
    throw new Error(
      `PRODUCT_KEY_MODE must be one of: ${[...PRODUCT_KEY_MODES].join(", ")}.`,
    );
  }
  if (expectedChainId === 137 && mode !== "generated") {
    throw new Error(
      "PRODUCT_KEY_MODE=generated is required on Polygon mainnet.",
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
  const mode = productKeyMode(environment, expectedChainId);
  const redisTimeoutMs = integerEnvironment(
    environment,
    "REDIS_TIMEOUT_MS",
    "5000",
  );
  const standardRedisUrl = environment.REDIS_URL?.trim();
  const upstashUrl = environment.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = environment.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (standardRedisUrl && (upstashUrl || upstashToken)) {
    throw new Error(
      "Configure either REDIS_URL or the Upstash REST variables, not both.",
    );
  }
  const clusterMode = environment.REDIS_CLUSTER_MODE?.trim().toLowerCase();
  const clusterModeMustBeExplicit =
    environment.NODE_ENV === "production" || Boolean(clusterMode);
  if (
    standardRedisUrl &&
    clusterModeMustBeExplicit &&
    clusterMode !== "false"
  ) {
    throw new Error(
      "REDIS_CLUSTER_MODE=false is required for standard Redis; clustered endpoints are not supported.",
    );
  }
  const redis = suppliedRedis ?? (
    standardRedisUrl
      ? createStandardRedisClient({
          url: standardRedisUrl,
          timeoutMs: redisTimeoutMs,
          production: environment.NODE_ENV === "production",
        })
      : new Redis({
          url: requireEnvironment(environment, "UPSTASH_REDIS_REST_URL"),
          token: requireEnvironment(environment, "UPSTASH_REDIS_REST_TOKEN"),
          signal: () => AbortSignal.timeout(redisTimeoutMs),
        })
  );
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
