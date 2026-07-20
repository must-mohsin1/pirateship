import assert from "node:assert/strict";
import test from "node:test";
import {
  compileEscrowFingerprint,
  parseMainnetPreflightEnvironment,
  runMainnetPreflight,
} from "../scripts/mainnet-preflight.mjs";

const DEPLOYER = "0x0000000000000000000000000000000000000001";
const BENEFICIARY = "0x0000000000000000000000000000000000000002";
const environment = {
  RPC_URL: "https://polygon.example/rpc",
  DEPLOYER_ADDRESS: DEPLOYER,
  BENEFICIARY_ADDRESS: BENEFICIARY,
  MINIMUM_PLEDGE_POL: "250",
  OWNER_CUSTODY_MODE: "hardware-wallet",
  SECURITY_AUDIT_COMPLETE: "yes",
  AUDIT_REPORT_URL: "https://example.com/security-audit.pdf",
  PRICE_REVIEW_COMPLETE: "yes",
  RELEASE_CRITERIA_URL: "https://example.com/release-criteria",
  SOURCE_COMMIT: "a".repeat(40),
};
const cleanGitState = async () => ({ head: environment.SOURCE_COMMIT, clean: true });

function provider(overrides = {}) {
  return {
    getNetwork: async () => ({ name: "matic", chainId: 137n }),
    getBlockNumber: async () => 70_000_000,
    getBalance: async () => 1_000_000_000_000_000_000n,
    getCode: async () => "0x",
    ...overrides,
  };
}

test("parses immutable campaign terms without accepting secrets", () => {
  const parsed = parseMainnetPreflightEnvironment(environment);
  assert.equal(parsed.minimumPledgeWei, 250_000_000_000_000_000_000n);
  assert.equal(parsed.deployerAddress, DEPLOYER);
  assert.equal(parsed.beneficiaryAddress, BENEFICIARY);
  assert.equal("PRIVATE_KEY" in parsed, false);
});

test("refuses invalid production configuration", () => {
  assert.throws(
    () => parseMainnetPreflightEnvironment({ ...environment, MINIMUM_PLEDGE_POL: "0" }),
    /greater than zero/,
  );
  assert.throws(
    () => parseMainnetPreflightEnvironment({ ...environment, OWNER_CUSTODY_MODE: "hot-wallet" }),
    /OWNER_CUSTODY_MODE/,
  );
  assert.throws(
    () => parseMainnetPreflightEnvironment({ ...environment, AUDIT_REPORT_URL: "http://example.com" }),
    /HTTPS/,
  );
});

test("checks Polygon mainnet and reports a ready read-only summary", async () => {
  const result = await runMainnetPreflight({
    environment,
    providerFactory: () => provider(),
    gitStateReader: cleanGitState,
  });
  assert.equal(result.status, "READY_FOR_MANUAL_DEPLOYMENT_REVIEW");
  assert.equal(result.readOnly, true);
  assert.equal(result.network.chainId, "137");
  assert.deepEqual(result.blockers, []);
  assert.match(result.contractBuild.compiler, /^0\.8\.30/);
  assert.match(result.contractBuild.creationBytecodeHash, /^0x[0-9a-f]{64}$/);
});

test("blocks wrong networks, missing reviews, empty gas wallets, and custody mismatches", async () => {
  await assert.rejects(
    runMainnetPreflight({
      environment,
      providerFactory: () => provider({ getNetwork: async () => ({ name: "amoy", chainId: 80002n }) }),
      gitStateReader: cleanGitState,
    }),
    /expected Polygon mainnet chain ID 137/,
  );

  const result = await runMainnetPreflight({
    environment: {
      ...environment,
      SECURITY_AUDIT_COMPLETE: "no",
      PRICE_REVIEW_COMPLETE: "no",
      OWNER_CUSTODY_MODE: "multisig-direct-deployer",
    },
    providerFactory: () => provider({ getBalance: async () => 0n }),
    gitStateReader: cleanGitState,
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockers.length, 4);
});

test("blocks a different approved commit or a dirty deployment worktree", async () => {
  const result = await runMainnetPreflight({
    environment,
    providerFactory: () => provider(),
    gitStateReader: async () => ({ head: "b".repeat(40), clean: false }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join("\n"), /SOURCE_COMMIT/);
  assert.match(result.blockers.join("\n"), /not clean/);
});
