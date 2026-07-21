import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { keccak256 } from "ethers";
import { POLYGON_MAINNET_CHAIN_ID } from "./mainnet-preflight.mjs";

const DEFAULT_ATTEMPT_URL = new URL("../../../.mainnet-deployment-attempt.json", import.meta.url);

function normalizeHex(value) {
  return value?.toLowerCase();
}

function decodeAddress(word) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(word)) throw new Error("Invalid address response.");
  return `0x${word.slice(-40)}`;
}

function decodeUint(word) {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(word)) throw new Error("Invalid integer response.");
  return BigInt(word);
}

async function call(provider, contractAddress, data) {
  return provider.call({ to: contractAddress, data });
}

export async function verifyMinedDeployment({
  provider,
  config,
  transactionHash,
  confirmations = 20,
  timeoutMs = 10 * 60 * 1_000,
}) {
  const network = await provider.getNetwork();
  if (network.chainId !== POLYGON_MAINNET_CHAIN_ID) {
    throw new Error("The independent RPC is not Polygon mainnet.");
  }
  const receipt = await provider.waitForTransaction(transactionHash, confirmations, timeoutMs);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) {
    throw new Error("The independently observed deployment failed or was not confirmed.");
  }
  if (BigInt(receipt.blockNumber) < BigInt(config.minimumDeploymentBlock)) {
    throw new Error("The transaction predates this reviewed deployment handoff.");
  }
  const [transaction, block] = await Promise.all([
    provider.getTransaction(transactionHash),
    provider.getBlock(receipt.blockNumber),
  ]);
  if (!transaction || !block) throw new Error("The independent RPC returned incomplete data.");
  if (
    normalizeHex(receipt.hash) !== normalizeHex(transactionHash) ||
    normalizeHex(transaction.hash) !== normalizeHex(transactionHash) ||
    normalizeHex(transaction.from) !== normalizeHex(config.deployerAddress) ||
    transaction.to != null ||
    normalizeHex(transaction.data) !== normalizeHex(config.deploymentInitcode) ||
    keccak256(transaction.data) !== config.deploymentInitcodeKeccak256
  ) {
    throw new Error("The Polygon mainnet transaction does not match the reviewed payload.");
  }

  const contractAddress = receipt.contractAddress;
  const [owner, beneficiary, minimumPledge, deadline, phase, productReleased] =
    await Promise.all([
      call(provider, contractAddress, config.calls.owner),
      call(provider, contractAddress, config.calls.beneficiary),
      call(provider, contractAddress, config.calls.minimumPledge),
      call(provider, contractAddress, config.calls.deadline),
      call(provider, contractAddress, config.calls.phase),
      call(provider, contractAddress, config.calls.productReleased),
    ]);
  if (normalizeHex(decodeAddress(owner)) !== normalizeHex(config.deployerAddress)) {
    throw new Error("Deployed owner does not match the reviewed deployer.");
  }
  if (normalizeHex(decodeAddress(beneficiary)) !== normalizeHex(config.beneficiaryAddress)) {
    throw new Error("Deployed beneficiary does not match the reviewed beneficiary.");
  }
  if (decodeUint(minimumPledge).toString() !== config.minimumPledgeWei) {
    throw new Error("Deployed minimum pledge does not match the reviewed amount.");
  }
  const expectedDeadline = BigInt(block.timestamp) + BigInt(config.campaignDurationSeconds);
  if (decodeUint(deadline) !== expectedDeadline) {
    throw new Error("Deployed deadline is not exactly 30 days after the deployment block.");
  }
  if (decodeUint(phase) !== 0n || decodeUint(productReleased) !== 0n) {
    throw new Error("The new escrow is not in its expected unreleased Funding phase.");
  }

  return {
    transactionHash,
    contractAddress,
    deploymentBlock: receipt.blockNumber.toString(),
    confirmations,
    deadline: decodeUint(deadline).toString(),
    deploymentInitcodeKeccak256: config.deploymentInitcodeKeccak256,
  };
}

export function createFileAttemptJournal(fileUrl = DEFAULT_ATTEMPT_URL) {
  const controllerId = randomUUID();
  let pending = Promise.resolve();
  function serialize(operation) {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  }
  async function read() {
    return JSON.parse(await readFile(fileUrl, "utf8"));
  }
  async function write(value) {
    const temporaryUrl = new URL(`${fileUrl.href}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryUrl, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporaryUrl, fileUrl);
    } finally {
      await unlink(temporaryUrl).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return value;
  }
  return {
    async ensureClear() {
      try {
        await readFile(fileUrl, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      throw new Error("A prior mainnet deployment attempt must be reconciled first.");
    },
    async start({ fingerprint, startedAt }) {
      return serialize(() => writeFile(fileUrl, `${JSON.stringify({
        controllerId,
        fingerprint,
        startedAt,
        state: "submitted-or-unknown",
      }, null, 2)}\n`, { flag: "wx", mode: 0o600 }));
    },
    async recordTransactionHash(transactionHash) {
      return serialize(async () => {
        const current = await read();
        if (current.controllerId !== controllerId) {
          throw new Error("Only the controller that started this attempt may record its hash.");
        }
        if (current.transactionHash) {
          if (normalizeHex(current.transactionHash) === normalizeHex(transactionHash)) return current;
          throw new Error("The deployment attempt is already bound to another transaction hash.");
        }
        if (current.state !== "submitted-or-unknown") {
          throw new Error("The deployment attempt cannot accept a transaction hash in this state.");
        }
        return write({ ...current, transactionHash, state: "submitted" });
      });
    },
    async verifyTransaction(transactionHash, verifier) {
      return serialize(async () => {
        const current = await read();
        if (current.controllerId !== controllerId) {
          throw new Error("Only the controller that started this attempt may verify it.");
        }
        if (normalizeHex(current.transactionHash) !== normalizeHex(transactionHash)) {
          throw new Error("Verification must use the first recorded transaction hash.");
        }
        if (current.state === "mined-and-verified") return current;
        if (current.state !== "submitted") {
          throw new Error("The deployment attempt is not ready for verification.");
        }
        const result = await verifier();
        if (normalizeHex(result.transactionHash) !== normalizeHex(transactionHash)) {
          throw new Error("Independent verification returned a different transaction hash.");
        }
        await write({ ...current, ...result, state: "mined-and-verified" });
        return result;
      });
    },
  };
}
