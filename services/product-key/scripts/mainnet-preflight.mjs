import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  JsonRpcProvider,
  ZeroAddress,
  formatEther,
  getAddress,
  keccak256,
  parseEther,
} from "ethers";
import solc from "solc";

export const POLYGON_MAINNET_CHAIN_ID = 137n;
export const SUPPORTED_CUSTODY_MODES = new Set(["hardware-wallet", "multisig-direct-deployer"]);
const execFile = promisify(execFileCallback);

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
    rpcUrl: required(environment, "RPC_URL"),
    deployerAddress: address(environment, "DEPLOYER_ADDRESS"),
    beneficiaryAddress: address(environment, "BENEFICIARY_ADDRESS"),
    minimumPledgeText,
    minimumPledgeWei,
    custodyMode,
    securityAuditComplete: environment.SECURITY_AUDIT_COMPLETE?.trim().toLowerCase() === "yes",
    auditReportUrl: httpsUrl(environment, "AUDIT_REPORT_URL"),
    priceReviewComplete: environment.PRICE_REVIEW_COMPLETE?.trim().toLowerCase() === "yes",
    releaseCriteriaUrl: httpsUrl(environment, "RELEASE_CRITERIA_URL"),
    sourceCommit,
  };
}

export async function compileEscrowFingerprint() {
  const contractUrl = new URL("../../../contracts/RefundableProductEscrow.sol", import.meta.url);
  const source = await readFile(contractUrl, "utf8");
  const compiled = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "RefundableProductEscrow.sol": { content: source } },
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
  const bytecode =
    compiled.contracts["RefundableProductEscrow.sol"].RefundableProductEscrow.evm.bytecode.object;
  const compiler = solc.version();
  if (!compiler.startsWith("0.8.30+")) {
    throw new Error(`Expected pinned Solidity 0.8.30, but loaded ${compiler}.`);
  }
  return {
    compiler,
    optimizerRuns: 200,
    evmVersion: "paris",
    creationBytecodeHash: keccak256(`0x${bytecode}`),
  };
}

export async function readGitState() {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    execFile("git", ["status", "--porcelain"], { cwd: repositoryRoot }),
  ]);
  return { head: head.trim().toLowerCase(), clean: status.trim() === "" };
}

export async function runMainnetPreflight({
  environment = process.env,
  providerFactory = (rpcUrl) => new JsonRpcProvider(rpcUrl),
  gitStateReader = readGitState,
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
      compileEscrowFingerprint(),
      gitStateReader(),
    ]);

  const blockers = [];
  if (!config.securityAuditComplete) blockers.push("SECURITY_AUDIT_COMPLETE is not yes.");
  if (!config.priceReviewComplete) blockers.push("PRICE_REVIEW_COMPLETE is not yes.");
  if (gitState.head !== config.sourceCommit) {
    blockers.push("SOURCE_COMMIT does not match the checked-out Git commit.");
  }
  if (!gitState.clean) blockers.push("The Git worktree is not clean.");
  if (deployerBalance === 0n) blockers.push("The deployment wallet has no mainnet POL for gas.");
  if (config.custodyMode === "hardware-wallet" && deployerCode !== "0x") {
    blockers.push("The hardware-wallet deployment address is a contract, not an EOA.");
  }
  if (config.custodyMode === "multisig-direct-deployer" && deployerCode === "0x") {
    blockers.push("The multisig deployment address has no contract code.");
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
  } catch (error) {
    console.error(`Mainnet preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
