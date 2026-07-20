export type TaskSize = "MICRO" | "SMALL" | "MEDIUM" | "LARGE" | "XLARGE";

export const ECS_TASK_SPECS: Record<TaskSize, { cpu: number; memory: number }> = {
  MICRO: { cpu: 256, memory: 512 },
  SMALL: { cpu: 512, memory: 1024 },
  MEDIUM: { cpu: 1024, memory: 2048 },
  LARGE: { cpu: 2048, memory: 4096 },
  XLARGE: { cpu: 4096, memory: 8192 },
};

export const VARS = [
  // Domain & infrastructure
  "DOMAIN",
  "SERVER_URL",
  "PRIORITY",
  "NAME",
  "DEPLOY_ACCOUNT",
  "TAGS",
  "FOUNDATION_STACK",
  // Product-key service runtime (services/product-key)
  "CONTRACT_ADDRESS",
  "PUBLIC_ORIGIN",
  "CORS_ORIGIN",
  "TRUST_PROXY",
  "RPC_TIMEOUT_MS",
  "VERIFICATION_MAX_CONCURRENT",
  "VERIFICATION_MAX_QUEUED",
] as const;

export const SECRETS = [
  // Polygon RPC endpoint + admin auth token. Never commit values; ECS pulls
  // these from Secrets Manager at deploy time.
  "RPC_URL",
  "ADMIN_TOKEN",
] as const;
