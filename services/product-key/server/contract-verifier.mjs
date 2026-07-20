import { Contract, FetchRequest, JsonRpcProvider, getAddress } from "ethers";

const ABI = [
  "function minimumPledge() view returns (uint256)",
  "function supporters(address) view returns (uint256 amount, bool approved, bool refunded)",
];

export async function assertExpectedChain(provider, expectedChainId) {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(expectedChainId)) {
    throw new Error(
      `Polygon RPC chain ID ${network.chainId} does not match expected chain ID ${expectedChainId}.`,
    );
  }
  return network;
}

export function createContractVerifier({
  rpcUrl,
  contractAddress,
  expectedChainId,
  timeoutMs = 10_000,
  provider: suppliedProvider,
  contract: suppliedContract,
}) {
  if (!Number.isInteger(expectedChainId) || expectedChainId < 1) {
    throw new Error("EXPECTED_CHAIN_ID must be a positive integer.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("RPC_TIMEOUT_MS must be a positive integer.");
  }
  // Public Amoy providers often reject JSON-RPC batches. Keep entitlement
  // verification as individual requests so key redemption does not depend on
  // a provider-specific batch limit.
  let provider = suppliedProvider;
  if (!provider) {
    const request = new FetchRequest(rpcUrl);
    request.timeout = timeoutMs;
    provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
  }
  const contract =
    suppliedContract ?? new Contract(getAddress(contractAddress), ABI, provider);
  let minimumPledgeRequest;
  let networkRequest;

  function verifyNetwork() {
    if (!networkRequest) {
      networkRequest = assertExpectedChain(provider, expectedChainId).catch((error) => {
        networkRequest = undefined;
        throw error;
      });
    }
    return networkRequest;
  }

  function getMinimumPledge() {
    if (!minimumPledgeRequest) {
      minimumPledgeRequest = contract.minimumPledge().catch((error) => {
        minimumPledgeRequest = undefined;
        throw error;
      });
    }
    return minimumPledgeRequest;
  }

  const verifyEntitlement = async (address) => {
    await verifyNetwork();
    const checksumAddress = getAddress(address);
    const [minimumPledge, record] = await Promise.all([
      getMinimumPledge(),
      contract.supporters(checksumAddress),
    ]);

    return {
      eligible: record.amount >= minimumPledge && record.approved && !record.refunded,
      amount: record.amount,
      approved: record.approved,
      refunded: record.refunded,
    };
  };
  verifyEntitlement.healthCheck = async () => {
    // Read both dependencies afresh when the outer readiness cache expires.
    // Entitlement requests can safely reuse immutable chain/config values, but
    // readiness must detect an RPC or contract outage after startup.
    await assertExpectedChain(provider, expectedChainId);
    await contract.minimumPledge();
  };
  return verifyEntitlement;
}
