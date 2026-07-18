import { Contract, FetchRequest, JsonRpcProvider, getAddress } from "ethers";

const ABI = [
  "function minimumPledge() view returns (uint256)",
  "function supporters(address) view returns (uint256 amount, bool approved, bool refunded)",
];

export function createContractVerifier({ rpcUrl, contractAddress, timeoutMs = 10_000 }) {
  // Public Amoy providers often reject JSON-RPC batches. Keep entitlement
  // verification as individual requests so key redemption does not depend on
  // a provider-specific batch limit.
  const request = new FetchRequest(rpcUrl);
  request.timeout = timeoutMs;
  const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
  const contract = new Contract(getAddress(contractAddress), ABI, provider);
  let minimumPledgeRequest;

  function getMinimumPledge() {
    if (!minimumPledgeRequest) {
      minimumPledgeRequest = contract.minimumPledge().catch((error) => {
        minimumPledgeRequest = undefined;
        throw error;
      });
    }
    return minimumPledgeRequest;
  }

  return async (address) => {
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
}
