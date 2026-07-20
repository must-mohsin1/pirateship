import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "../../../escrow-config.js";
import { assertPublicDeploymentMatches } from "../server/config-consistency.mjs";

const repoRoot = new URL("../../../", import.meta.url);

async function readRootFile(name) {
  return readFile(new URL(name, repoRoot), "utf8");
}

function parseEnvironment(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

test("the production image installs only runtime dependencies and runs unprivileged", async () => {
  const dockerfile = await readRootFile("Dockerfile");

  assert.match(dockerfile, /FROM node:22-bookworm-slim AS dependencies/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /DATABASE_PATH=\/data\/product-keys\.db/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /VOLUME \["\/data"\]/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/live/);
  assert.match(dockerfile, /CMD \["node", "services\/product-key\/server\/index\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /ADMIN_TOKEN\s*=/);
  assert.doesNotMatch(dockerfile, /RPC_URL\s*=/);
});

test("the AWS sample is safe and matches the checked-in Amoy browser contract", async () => {
  const [environmentSource, dockerignore] = await Promise.all([
    readRootFile(".env.aws.example"),
    readRootFile(".dockerignore"),
  ]);
  const environment = parseEnvironment(environmentSource);

  assert.deepEqual(
    assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      environment.CONTRACT_ADDRESS,
      Number(environment.EXPECTED_CHAIN_ID),
    ),
    {
      contractAddress: environment.CONTRACT_ADDRESS,
      chainId: 80_002,
    },
  );
  assert.equal(environment.HOST, "0.0.0.0");
  assert.equal(environment.PORT, "4173");
  assert.equal(environment.DATABASE_PATH, "/data/product-keys.db");
  assert.equal(environment.EXPECTED_CHAIN_ID, "80002");
  assert.equal(environment.TRUST_PROXY, "true");
  assert.equal(environment.ADMIN_TOKEN, "");
  assert.match(environment.RPC_URL, /YOUR_DEDICATED_POLYGON_AMOY_RPC/);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^(?:\*\*\/|services\/product-key\/)node_modules$/m);
});

test("the Vercel sample pins the public Amoy deployment and request timeouts", async () => {
  const environment = parseEnvironment(await readRootFile(".env.vercel.example"));
  assert.deepEqual(
    assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      environment.CONTRACT_ADDRESS,
      Number(environment.EXPECTED_CHAIN_ID),
    ),
    {
      contractAddress: environment.CONTRACT_ADDRESS,
      chainId: 80_002,
    },
  );
  assert.equal(environment.REDIS_TIMEOUT_MS, "5000");
  assert.match(environment.PRODUCT_KEY_REDIS_PREFIX, /amoy/);
});
