import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  ContractFactory,
  JsonRpcProvider,
  ZeroAddress,
  formatEther,
  getAddress,
  keccak256,
  parseEther,
} from "ethers";
import solc from "solc";

export const POLYGON_MAINNET_CHAIN_ID = 137n;
export const APPROVED_MAINNET_DEPLOYER = "0xcF9178cA7360066B25de9c142A4c155abf151D6f";
export const APPROVED_MAINNET_BENEFICIARY = APPROVED_MAINNET_DEPLOYER;
export const APPROVED_MAINNET_MINIMUM_PLEDGE_WEI = 300_000_000_000_000_000_000n;
export const APPROVED_MAINNET_INITCODE_KECCAK256 =
  "0x8bc7eee692572585c17f69febde2b84ef02ca80ea562bc15d22de860bd561f94";
export const SUPPORTED_CUSTODY_MODES = new Set([
  "hardware-wallet",
  "multisig-direct-deployer",
  "trust-wallet-eoa",
]);
const execFile = promisify(execFileCallback);

function sha256Hex(hexData) {
  return `0x${createHash("sha256").update(Buffer.from(hexData.slice(2), "hex")).digest("hex")}`;
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function address(environment, name) {
  const value = getAddress(required(environment, name));
  if (value === ZeroAddress) throw new Error(`${name} cannot be the zero address.`);
  return value;
}

function httpsUrl(environment, name) {
  const value = required(environment, name);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  return value;
}

export function parseMainnetPreflightEnvironment(environment) {
  const minimumPledgeText = required(environment, "MINIMUM_PLEDGE_POL");
  const minimumPledgeWei = parseEther(minimumPledgeText);
  if (minimumPledgeWei <= 0n) throw new Error("MINIMUM_PLEDGE_POL must be greater than zero.");

  const custodyMode = required(environment, "OWNER_CUSTODY_MODE");
  if (!SUPPORTED_CUSTODY_MODES.has(custodyMode)) {
    throw new Error(
      `OWNER_CUSTODY_MODE must be one of: ${[...SUPPORTED_CUSTODY_MODES].join(", ")}.`,
    );
  }

  const sourceCommit = required(environment, "SOURCE_COMMIT").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("SOURCE_COMMIT must be a full 40-character Git commit hash.");
  }

  return {
    rpcUrl: httpsUrl(environment, "RPC_URL"),
    deployerAddress: address(environment, "DEPLOYER_ADDRESS"),
    beneficiaryAddress: address(environment, "BENEFICIARY_ADDRESS"),
    minimumPledgeText,
    minimumPledgeWei,
    custodyMode,
    hotWalletRiskAccepted:
      environment.HOT_WALLET_RISK_ACCEPTED?.trim()?.toLowerCase() === "yes",
    walletRecoveryBackupConfirmed:
      environment.WALLET_RECOVERY_BACKUP_CONFIRMED?.trim()?.toLowerCase() === "yes",
    securityAuditComplete: environment.SECURITY_AUDIT_COMPLETE?.trim().toLowerCase() === "yes",
    auditReportUrl: httpsUrl(environment, "AUDIT_REPORT_URL"),
    priceReviewComplete: environment.PRICE_REVIEW_COMPLETE?.trim().toLowerCase() === "yes",
    releaseCriteriaUrl: httpsUrl(environment, "RELEASE_CRITERIA_URL"),
    sourceCommit,
  };
}

export async function prepareEscrowDeployment({ beneficiaryAddress, minimumPledgeWei, source }) {
  const contractSource =
    source ??
    (await readFile(
      new URL("../../../contracts/RefundableProductEscrow.sol", import.meta.url),
      "utf8",
    ));
  const compiled = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "RefundableProductEscrow.sol": { content: contractSource } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  const errors = (compiled.errors ?? []).filter(({ severity }) => severity === "error");
  if (errors.length) {
    throw new Error(errors.map(({ formattedMessage }) => formattedMessage).join("\n"));
  }
  const artifact = compiled.contracts["RefundableProductEscrow.sol"].RefundableProductEscrow;
  const creationBytecode = `0x${artifact.evm.bytecode.object}`;
  const factory = new ContractFactory(artifact.abi, creationBytecode);
  const deployment = await factory.getDeployTransaction(beneficiaryAddress, minimumPledgeWei);
  const deploymentInitcode = deployment.data;
  if (typeof deploymentInitcode !== "string") {
    throw new Error("Could not construct the escrow deployment initcode.");
  }
  const compiler = solc.version();
  if (!compiler.startsWith("0.8.30+")) {
    throw new Error(`Expected pinned Solidity 0.8.30, but loaded ${compiler}.`);
  }
  const fingerprint = {
    compiler,
    optimizerRuns: 200,
    evmVersion: "paris",
    creationBytecodeBytes: (creationBytecode.length - 2) / 2,
    creationBytecodeKeccak256: keccak256(creationBytecode),
    creationBytecodeSha256: sha256Hex(creationBytecode),
    constructorArguments: `0x${deploymentInitcode.slice(creationBytecode.length)}`,
    deploymentInitcodeBytes: (deploymentInitcode.length - 2) / 2,
    deploymentInitcodeKeccak256: keccak256(deploymentInitcode),
    deploymentInitcodeSha256: sha256Hex(deploymentInitcode),
  };
  return { deploymentInitcode, fingerprint };
}

export async function compileEscrowFingerprint(deploymentInputs) {
  return (await prepareEscrowDeployment(deploymentInputs)).fingerprint;
}

export async function readGitState() {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    execFile("git", ["status", "--porcelain"], { cwd: repositoryRoot }),
  ]);
  return { head: head.trim().toLowerCase(), clean: status.trim() === "" };
}

export async function readContractSourceAtCommit(sourceCommit) {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const { stdout } = await execFile(
    "git",
    ["show", `${sourceCommit}:contracts/RefundableProductEscrow.sol`],
    { cwd: repositoryRoot },
  );
  return stdout;
}

export async function runMainnetPreflight({
  environment = process.env,
  providerFactory = (rpcUrl) => new JsonRpcProvider(rpcUrl),
  gitStateReader = readGitState,
  contractSourceReader = readContractSourceAtCommit,
} = {}) {
  const config = parseMainnetPreflightEnvironment(environment);
  const provider = providerFactory(config.rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== POLYGON_MAINNET_CHAIN_ID) {
    throw new Error(
      `RPC_URL returned chain ID ${network.chainId}; expected Polygon mainnet chain ID 137.`,
    );
  }

  const [blockNumber, deployerBalance, deployerCode, beneficiaryCode, contractBuild, gitState] =
    await Promise.all([
      provider.getBlockNumber(),
      provider.getBalance(config.deployerAddress),
      provider.getCode(config.deployerAddress),
      provider.getCode(config.beneficiaryAddress),
      contractSourceReader(config.sourceCommit).then((source) =>
        compileEscrowFingerprint({
          beneficiaryAddress: config.beneficiaryAddress,
          minimumPledgeWei: config.minimumPledgeWei,
          source,
        }),
      ),
      gitStateReader(),
    ]);

  const blockers = [];
  if (config.deployerAddress !== APPROVED_MAINNET_DEPLOYER) {
    blockers.push("DEPLOYER_ADDRESS does not match the approved mainnet deployer.");
  }
  if (config.beneficiaryAddress !== APPROVED_MAINNET_BENEFICIARY) {
    blockers.push("BENEFICIARY_ADDRESS does not match the approved mainnet beneficiary.");
  }
  if (config.minimumPledgeWei !== APPROVED_MAINNET_MINIMUM_PLEDGE_WEI) {
    blockers.push("MINIMUM_PLEDGE_POL does not equal the approved 300 POL value.");
  }
  if (contractBuild.deploymentInitcodeKeccak256 !== APPROVED_MAINNET_INITCODE_KECCAK256) {
    blockers.push("The deployment initcode does not match the approved mainnet fingerprint.");
  }
  if (!config.securityAuditComplete) blockers.push("SECURITY_AUDIT_COMPLETE is not yes.");
  if (!config.priceReviewComplete) blockers.push("PRICE_REVIEW_COMPLETE is not yes.");
  if (gitState.head !== config.sourceCommit) {
    blockers.push("SOURCE_COMMIT does not match the checked-out Git commit.");
  }
  if (!gitState.clean) blockers.push("The Git worktree is not clean.");
  if (deployerBalance === 0n) blockers.push("The deployment wallet has no mainnet POL for gas.");
  if (
    (config.custodyMode === "hardware-wallet" || config.custodyMode === "trust-wallet-eoa") &&
    deployerCode !== "0x"
  ) {
    blockers.push("The selected EOA deployment address is a contract.");
  }
  if (config.custodyMode === "multisig-direct-deployer" && deployerCode === "0x") {
    blockers.push("The multisig deployment address has no contract code.");
  }
  if (config.custodyMode === "trust-wallet-eoa" && !config.hotWalletRiskAccepted) {
    blockers.push("HOT_WALLET_RISK_ACCEPTED is not yes for Trust Wallet custody.");
  }
  if (config.custodyMode === "trust-wallet-eoa" && !config.walletRecoveryBackupConfirmed) {
    blockers.push("WALLET_RECOVERY_BACKUP_CONFIRMED is not yes for Trust Wallet custody.");
  }

  return {
    status: blockers.length === 0 ? "READY_FOR_MANUAL_DEPLOYMENT_REVIEW" : "BLOCKED",
    readOnly: true,
    network: { name: network.name, chainId: network.chainId.toString(), blockNumber },
    campaign: {
      ownerAndDeployer: config.deployerAddress,
      beneficiary: config.beneficiaryAddress,
      beneficiaryKind: beneficiaryCode === "0x" ? "EOA" : "contract",
      minimumPledgePol: config.minimumPledgeText,
      minimumPledgeWei: config.minimumPledgeWei.toString(),
      releaseCriteriaUrl: config.releaseCriteriaUrl,
    },
    custody: {
      mode: config.custodyMode,
      deployerBalancePol: formatEther(deployerBalance),
      hotWalletRiskAccepted: config.hotWalletRiskAccepted,
      walletRecoveryBackupConfirmed: config.walletRecoveryBackupConfirmed,
    },
    review: {
      securityAuditComplete: config.securityAuditComplete,
      auditReportUrl: config.auditReportUrl,
      priceReviewComplete: config.priceReviewComplete,
      sourceCommit: config.sourceCommit,
      checkedOutCommit: gitState.head,
      cleanWorktree: gitState.clean,
    },
    contractBuild,
    blockers,
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const result = await runMainnetPreflight();
    console.log(JSON.stringify(result, null, 2));
    if (result.blockers.length) process.exitCode = 1;
  } catch {
    console.error("Mainnet preflight failed. Check the local configuration, Git state, and dedicated RPC without sharing its URL.");
    process.exitCode = 1;
  }
}
