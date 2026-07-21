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
  const [dockerfile, server, keyStore, landingPage, releaseCriteria] = await Promise.all([
    readRootFile("Dockerfile"),
    readRootFile("services/product-key/server/index.mjs"),
    readRootFile("services/product-key/server/key-store.mjs"),
    readRootFile("pirate-network-blog.html"),
    readRootFile("mainnet-release-criteria.html"),
  ]);

  assert.match(dockerfile, /FROM node:22-bookworm-slim AS dependencies/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /DATABASE_PATH=\/data\/product-keys\.db/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /VOLUME \["\/data"\]/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/live/);
  assert.match(dockerfile, /CMD \["node", "services\/product-key\/server\/index\.mjs"\]/);
  assert.match(dockerfile, /COPY pirate-network-blog\.html mainnet-release-criteria\.html/);
  assert.doesNotMatch(dockerfile, /ADMIN_TOKEN\s*=/);
  assert.doesNotMatch(dockerfile, /RPC_URL\s*=/);
  assert.match(keyStore, /PRAGMA journal_mode = DELETE/);
  assert.doesNotMatch(keyStore, /PRAGMA journal_mode = WAL/);
  assert.match(server, /style-src[^"\n]*https:\/\/fonts\.googleapis\.com/);
  assert.match(server, /font-src[^"\n]*https:\/\/fonts\.gstatic\.com/);
  assert.match(server, /script-src[^"\n]*https:\/\/static\.cloudflareinsights\.com/);
  assert.match(
    server,
    /connect-src 'self' " \+ publicEscrowConfig\.rpcUrls\.join\(" "\) \+ " https:\/\/cloudflareinsights\.com/,
  );
  assert.doesNotMatch(server, /connect-src 'self' https:;/);
  assert.match(
    landingPage,
    /@media \(max-width:560px\)\{[\s\S]*?\.punch::before \{ inset-inline:-22px; \}/,
  );
  assert.match(landingPage, /href="\/mainnet-release-criteria\.html"/);
  assert.match(landingPage, /Founding campaign · Polygon mainnet/);
  assert.match(landingPage, /The first pre-order requires at least 300 POL/);
  assert.doesNotMatch(landingPage, /This is a Polygon Amoy testnet rehearsal/);
  assert.doesNotMatch(landingPage, /The mainnet campaign is not open yet/);
  assert.match(releaseCriteria, /300 POL/);
  assert.match(releaseCriteria, /Approval is optional and permanent/);
  assert.match(releaseCriteria, /A refund still requires an on-chain transaction/);
  assert.match(releaseCriteria, /0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff/);
  assert.match(releaseCriteria, /20 August 2026 at 20:15:52 UTC/);
  assert.match(releaseCriteria, /exact Sourcify creation and runtime match/);
});

test("the historical AWS Amoy sample remains secret-free", async () => {
  const [environmentSource, dockerignore] = await Promise.all([
    readRootFile(".env.aws.example"),
    readRootFile(".dockerignore"),
  ]);
  const environment = parseEnvironment(environmentSource);

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

test("the AWS mainnet sample selects unlimited Redis without embedding secrets", async () => {
  const environment = parseEnvironment(await readRootFile(".env.aws-mainnet.example"));

  assert.deepEqual(
    assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      environment.CONTRACT_ADDRESS,
      Number(environment.EXPECTED_CHAIN_ID),
    ),
    {
      contractAddress: environment.CONTRACT_ADDRESS,
      chainId: 137,
    },
  );
  assert.equal(environment.CONTRACT_ADDRESS, "0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff");
  assert.equal(environment.EXPECTED_CHAIN_ID, "137");
  assert.equal(environment.PUBLIC_ORIGIN, "https://pirateship.must.company");
  assert.equal(environment.PRODUCT_KEY_MODE, "generated");
  assert.equal(environment.PRODUCT_KEY_LICENSE_PREFIX, "PIRATE-POL");
  assert.equal(environment.PRODUCT_KEY_REDIS_PREFIX, "");
  assert.equal(environment.REDIS_URL, "");
  assert.equal(environment.REDIS_CLUSTER_MODE, "false");
  assert.equal(environment.UPSTASH_REDIS_REST_URL, undefined);
  assert.equal(environment.UPSTASH_REDIS_REST_TOKEN, undefined);
  assert.equal(environment.PRODUCT_KEY_ENCRYPTION_KEY, "");
  assert.equal(environment.PRODUCT_KEY_GENERATION_KEY, "");
  assert.equal(environment.DATABASE_PATH, undefined);
  assert.equal(environment.TRUST_PROXY, "true");
});

test("the Vercel fallback pins the public mainnet deployment and generated licenses", async () => {
  const environment = parseEnvironment(await readRootFile(".env.vercel.example"));
  assert.deepEqual(
    assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      environment.CONTRACT_ADDRESS,
      Number(environment.EXPECTED_CHAIN_ID),
    ),
    {
      contractAddress: environment.CONTRACT_ADDRESS,
      chainId: 137,
    },
  );
  assert.equal(environment.PRODUCT_KEY_MODE, "generated");
  assert.equal(environment.PRODUCT_KEY_LICENSE_PREFIX, "PIRATE-POL");
  assert.equal(environment.PRODUCT_KEY_GENERATION_KEY, "");
  assert.equal(environment.REDIS_TIMEOUT_MS, "5000");
  assert.equal(environment.PRODUCT_KEY_REDIS_PREFIX, "");
});
