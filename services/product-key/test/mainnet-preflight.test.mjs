import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AbiCoder } from "ethers";
import {
  compileEscrowFingerprint,
  parseMainnetPreflightEnvironment,
  readContractSourceAtCommit,
  readGitState,
  runMainnetPreflight,
} from "../scripts/mainnet-preflight.mjs";

const DEPLOYER = "0xcF9178cA7360066B25de9c142A4c155abf151D6f";
const BENEFICIARY = DEPLOYER;
const ALTERNATE_BENEFICIARY = "0x0000000000000000000000000000000000000002";
const APPROVED_BENEFICIARY = "0xcF9178cA7360066B25de9c142A4c155abf151D6f";
const APPROVED_MINIMUM_PLEDGE = 300_000_000_000_000_000_000n;
const EXPECTED_CREATION_BYTECODE_KECCAK256 =
  "0x36e443390e90ae7c9162961873b9fea1c655926767021360d267da0ecaf74bd6";
const EXPECTED_CREATION_BYTECODE_SHA256 =
  "0xdbba12df303fc3a04c83fd8c64c25be01283de079c89a0d8051a64e8f576d0a6";
const EXPECTED_DEPLOYMENT_INITCODE_KECCAK256 =
  "0x8bc7eee692572585c17f69febde2b84ef02ca80ea562bc15d22de860bd561f94";
const EXPECTED_DEPLOYMENT_INITCODE_SHA256 =
  "0x3467325d97e41fd34ff2737ec51111716482d0a0621b8c507e3bab81b9b4ade5";
const environment = {
  RPC_URL: "https://polygon.example/rpc",
  DEPLOYER_ADDRESS: DEPLOYER,
  BENEFICIARY_ADDRESS: BENEFICIARY,
  MINIMUM_PLEDGE_POL: "300",
  OWNER_CUSTODY_MODE: "hardware-wallet",
  HOT_WALLET_RISK_ACCEPTED: "no",
  WALLET_RECOVERY_BACKUP_CONFIRMED: "no",
  SECURITY_AUDIT_COMPLETE: "yes",
  AUDIT_REPORT_URL: "https://example.com/security-audit.pdf",
  PRICE_REVIEW_COMPLETE: "yes",
  RELEASE_CRITERIA_URL: "https://example.com/release-criteria",
  SOURCE_COMMIT: "a".repeat(40),
};
const contractSource = await readFile(
  new URL("../../../contracts/RefundableProductEscrow.sol", import.meta.url),
  "utf8",
);
const cleanGitState = async () => ({ head: environment.SOURCE_COMMIT, clean: true });

function runPreflight(options) {
  return runMainnetPreflight({
    contractSourceReader: async () => contractSource,
    ...options,
  });
}

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
  assert.equal(parsed.minimumPledgeWei, APPROVED_MINIMUM_PLEDGE);
  assert.equal(parsed.deployerAddress, DEPLOYER);
  assert.equal(parsed.beneficiaryAddress, BENEFICIARY);
  assert.equal("PRIVATE_KEY" in parsed, false);
});

test("defaults omitted Trust Wallet attestations to false for other custody modes", () => {
  const {
    HOT_WALLET_RISK_ACCEPTED: _hotWalletRiskAccepted,
    WALLET_RECOVERY_BACKUP_CONFIRMED: _walletRecoveryBackupConfirmed,
    ...hardwareWalletEnvironment
  } = environment;
  const parsed = parseMainnetPreflightEnvironment(hardwareWalletEnvironment);
  assert.equal(parsed.hotWalletRiskAccepted, false);
  assert.equal(parsed.walletRecoveryBackupConfirmed, false);
});

test("refuses invalid production configuration", () => {
  assert.throws(
    () => parseMainnetPreflightEnvironment({ ...environment, RPC_URL: "http://polygon.example" }),
    /RPC_URL must use HTTPS/,
  );
  assert.throws(
    () => parseMainnetPreflightEnvironment({ ...environment, MINIMUM_PLEDGE_POL: "0" }),
    /greater than zero/,
  );
  assert.throws(
    () => parseMainnetPreflightEnvironment({ ...environment, OWNER_CUSTODY_MODE: "browser-extension" }),
    /OWNER_CUSTODY_MODE/,
  );
  assert.throws(
    () => parseMainnetPreflightEnvironment({ ...environment, AUDIT_REPORT_URL: "http://example.com" }),
    /HTTPS/,
  );
});

test("requires explicit Trust Wallet risk and recovery attestations", async () => {
  const trustWalletEnvironment = {
    ...environment,
    OWNER_CUSTODY_MODE: "trust-wallet-eoa",
    HOT_WALLET_RISK_ACCEPTED: "yes",
    WALLET_RECOVERY_BACKUP_CONFIRMED: "yes",
  };
  const ready = await runPreflight({
    environment: trustWalletEnvironment,
    providerFactory: () => provider(),
    gitStateReader: cleanGitState,
  });
  assert.equal(ready.status, "READY_FOR_MANUAL_DEPLOYMENT_REVIEW");
  assert.equal(ready.custody.mode, "trust-wallet-eoa");
  assert.equal(ready.custody.hotWalletRiskAccepted, true);
  assert.equal(ready.custody.walletRecoveryBackupConfirmed, true);

  const blocked = await runPreflight({
    environment: {
      ...trustWalletEnvironment,
      HOT_WALLET_RISK_ACCEPTED: "no",
      WALLET_RECOVERY_BACKUP_CONFIRMED: "no",
    },
    providerFactory: () => provider(),
    gitStateReader: cleanGitState,
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.match(blocked.blockers.join("\n"), /HOT_WALLET_RISK_ACCEPTED/);
  assert.match(blocked.blockers.join("\n"), /WALLET_RECOVERY_BACKUP_CONFIRMED/);
});

test("rejects contract code at a Trust Wallet EOA address", async () => {
  const result = await runPreflight({
    environment: {
      ...environment,
      OWNER_CUSTODY_MODE: "trust-wallet-eoa",
      HOT_WALLET_RISK_ACCEPTED: "yes",
      WALLET_RECOVERY_BACKUP_CONFIRMED: "yes",
    },
    providerFactory: () => provider({ getCode: async () => "0x1234" }),
    gitStateReader: cleanGitState,
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join("\n"), /selected EOA deployment address is a contract/);
});

test("checks Polygon mainnet and reports a ready read-only summary", async () => {
  const result = await runPreflight({
    environment,
    providerFactory: () => provider(),
    gitStateReader: cleanGitState,
  });
  assert.equal(result.status, "READY_FOR_MANUAL_DEPLOYMENT_REVIEW");
  assert.equal(result.readOnly, true);
  assert.equal(result.network.chainId, "137");
  assert.deepEqual(result.blockers, []);
  assert.match(result.contractBuild.compiler, /^0\.8\.30/);
  assert.match(result.contractBuild.creationBytecodeKeccak256, /^0x[0-9a-f]{64}$/);
  assert.match(result.contractBuild.creationBytecodeSha256, /^0x[0-9a-f]{64}$/);
  assert.match(result.contractBuild.deploymentInitcodeKeccak256, /^0x[0-9a-f]{64}$/);
  assert.match(result.contractBuild.deploymentInitcodeSha256, /^0x[0-9a-f]{64}$/);
  assert.equal(
    result.contractBuild.constructorArguments,
    AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [BENEFICIARY, APPROVED_MINIMUM_PLEDGE],
    ),
  );
});

test("fingerprints the contract source from the configured commit object", async () => {
  let requestedCommit;
  const result = await runPreflight({
    environment,
    providerFactory: () => provider(),
    gitStateReader: cleanGitState,
    contractSourceReader: async (sourceCommit) => {
      requestedCommit = sourceCommit;
      return contractSource;
    },
  });
  assert.equal(requestedCommit, environment.SOURCE_COMMIT);
  assert.equal(result.status, "READY_FOR_MANUAL_DEPLOYMENT_REVIEW");
});

test("reads the contract from a real Git object and rejects a missing commit", async () => {
  const gitState = await readGitState();
  assert.equal(await readContractSourceAtCommit(gitState.head), contractSource);
  await assert.rejects(readContractSourceAtCommit("f".repeat(40)));
});

test("pins the approved mainnet deployment initcode fingerprint", async () => {
  const fingerprint = await compileEscrowFingerprint({
    beneficiaryAddress: APPROVED_BENEFICIARY,
    minimumPledgeWei: APPROVED_MINIMUM_PLEDGE,
  });

  assert.equal(fingerprint.creationBytecodeBytes, 4_992);
  assert.equal(fingerprint.creationBytecodeKeccak256, EXPECTED_CREATION_BYTECODE_KECCAK256);
  assert.equal(fingerprint.creationBytecodeSha256, EXPECTED_CREATION_BYTECODE_SHA256);
  assert.equal(fingerprint.deploymentInitcodeBytes, 5_056);
  assert.equal(
    fingerprint.deploymentInitcodeKeccak256,
    EXPECTED_DEPLOYMENT_INITCODE_KECCAK256,
  );
  assert.equal(fingerprint.deploymentInitcodeSha256, EXPECTED_DEPLOYMENT_INITCODE_SHA256);
  assert.equal(
    fingerprint.constructorArguments,
    "0x000000000000000000000000cf9178ca7360066b25de9c142a4c155abf151d6f" +
      "00000000000000000000000000000000000000000000001043561a8829300000",
  );
});

test("deployment fingerprint changes with either immutable constructor input", async () => {
  const approved = await compileEscrowFingerprint({
    beneficiaryAddress: APPROVED_BENEFICIARY,
    minimumPledgeWei: APPROVED_MINIMUM_PLEDGE,
  });
  const differentBeneficiary = await compileEscrowFingerprint({
    beneficiaryAddress: ALTERNATE_BENEFICIARY,
    minimumPledgeWei: APPROVED_MINIMUM_PLEDGE,
  });
  const differentMinimum = await compileEscrowFingerprint({
    beneficiaryAddress: APPROVED_BENEFICIARY,
    minimumPledgeWei: APPROVED_MINIMUM_PLEDGE - 1n,
  });

  assert.equal(
    differentBeneficiary.creationBytecodeKeccak256,
    approved.creationBytecodeKeccak256,
  );
  assert.equal(differentMinimum.creationBytecodeKeccak256, approved.creationBytecodeKeccak256);
  assert.notEqual(
    differentBeneficiary.deploymentInitcodeKeccak256,
    approved.deploymentInitcodeKeccak256,
  );
  assert.notEqual(
    differentMinimum.deploymentInitcodeKeccak256,
    approved.deploymentInitcodeKeccak256,
  );
});

test("deployment-control documents match the pinned approved fingerprints", async () => {
  const documents = await Promise.all(
    ["polygon-mainnet-deployment-record.md", "security-audit-template.md"].map((name) =>
      readFile(new URL(`../../../docs/${name}`, import.meta.url), "utf8"),
    ),
  );
  const approvedValues = [
    APPROVED_BENEFICIARY,
    APPROVED_MINIMUM_PLEDGE.toString(),
    EXPECTED_CREATION_BYTECODE_KECCAK256,
    EXPECTED_CREATION_BYTECODE_SHA256,
    EXPECTED_DEPLOYMENT_INITCODE_KECCAK256,
    EXPECTED_DEPLOYMENT_INITCODE_SHA256,
  ];

  for (const document of documents) {
    for (const value of approvedValues) assert.ok(document.includes(value), `Missing ${value}`);
  }
});

test("blocks wrong networks, missing reviews, empty gas wallets, and custody mismatches", async () => {
  await assert.rejects(
    runPreflight({
      environment,
      providerFactory: () => provider({ getNetwork: async () => ({ name: "amoy", chainId: 80002n }) }),
      gitStateReader: cleanGitState,
    }),
    /expected Polygon mainnet chain ID 137/,
  );

  const result = await runPreflight({
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

test("blocks any drift from the approved mainnet owner, beneficiary, minimum, or initcode", async () => {
  const cases = [
    { DEPLOYER_ADDRESS: ALTERNATE_BENEFICIARY },
    { BENEFICIARY_ADDRESS: ALTERNATE_BENEFICIARY },
    { MINIMUM_PLEDGE_POL: "300.1" },
  ];
  for (const drift of cases) {
    const result = await runPreflight({
      environment: { ...environment, ...drift },
      providerFactory: () => provider(),
      gitStateReader: cleanGitState,
    });
    assert.equal(result.status, "BLOCKED");
    assert.match(result.blockers.join("\n"), /approved mainnet|approved 300 POL/);
  }

  const result = await runPreflight({
    environment,
    providerFactory: () => provider(),
    gitStateReader: cleanGitState,
    contractSourceReader: async () => contractSource.replace("30 days", "29 days"),
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join("\n"), /approved mainnet fingerprint/);
});

test("blocks a different approved commit or a dirty deployment worktree", async () => {
  const result = await runPreflight({
    environment,
    providerFactory: () => provider(),
    gitStateReader: async () => ({ head: "b".repeat(40), clean: false }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.blockers.join("\n"), /SOURCE_COMMIT/);
  assert.match(result.blockers.join("\n"), /not clean/);
});
