import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExpectedChain,
  createContractVerifier,
} from "./contract-verifier.mjs";

const CONTRACT_ADDRESS = "0x6bF097816997C242F3447A470d1cc3d170cbcB98";
const ADDRESSES = [1, 2, 3, 4].map(
  (value) => `0x${value.toString(16).padStart(40, "0")}`,
);

function verifierFixture({ getNetwork, minimumPledge } = {}) {
  let networkCalls = 0;
  let minimumCalls = 0;
  let supporterCalls = 0;
  const records = new Map([
    [ADDRESSES[0], { amount: 100n, approved: true, refunded: false }],
    [ADDRESSES[1], { amount: 99n, approved: true, refunded: false }],
    [ADDRESSES[2], { amount: 100n, approved: false, refunded: false }],
    [ADDRESSES[3], { amount: 100n, approved: true, refunded: true }],
  ]);
  const provider = {
    getNetwork: async () => {
      networkCalls += 1;
      return getNetwork ? getNetwork(networkCalls) : { chainId: 80_002n };
    },
  };
  const contract = {
    minimumPledge: async () => {
      minimumCalls += 1;
      return minimumPledge ? minimumPledge(minimumCalls) : 100n;
    },
    supporters: async (address) => {
      supporterCalls += 1;
      return records.get(address);
    },
  };
  const verifier = createContractVerifier({
    rpcUrl: "https://unused.example",
    contractAddress: CONTRACT_ADDRESS,
    expectedChainId: 80_002,
    provider,
    contract,
  });
  return {
    verifier,
    calls: () => ({ networkCalls, minimumCalls, supporterCalls }),
  };
}

test("the RPC network must match the configured Polygon chain", async () => {
  const provider = {
    getNetwork: async () => ({ chainId: 80_002n }),
  };
  assert.equal((await assertExpectedChain(provider, 80_002)).chainId, 80_002n);
  await assert.rejects(
    () => assertExpectedChain(provider, 137),
    /does not match expected chain ID 137/,
  );
});

test("the contract verifier rejects invalid network and timeout settings", () => {
  const options = {
    rpcUrl: "https://polygon-amoy.example/rpc",
    contractAddress: CONTRACT_ADDRESS,
    expectedChainId: 80_002,
  };
  assert.throws(
    () => createContractVerifier({ ...options, expectedChainId: Number.NaN }),
    /EXPECTED_CHAIN_ID must be a positive integer/,
  );
  assert.throws(
    () => createContractVerifier({ ...options, timeoutMs: 0 }),
    /RPC_TIMEOUT_MS must be a positive integer/,
  );
});

test("the verifier enforces every entitlement state and caches stable reads", async () => {
  const { verifier, calls } = verifierFixture();

  assert.equal((await verifier(ADDRESSES[0])).eligible, true);
  assert.equal((await verifier(ADDRESSES[1])).eligible, false);
  assert.equal((await verifier(ADDRESSES[2])).eligible, false);
  assert.equal((await verifier(ADDRESSES[3])).eligible, false);
  assert.deepEqual(calls(), {
    networkCalls: 1,
    minimumCalls: 1,
    supporterCalls: 4,
  });

  await verifier.healthCheck();
  assert.deepEqual(calls(), {
    networkCalls: 2,
    minimumCalls: 2,
    supporterCalls: 4,
  });
});

test("the verifier rejects a wrong RPC chain before reading supporter state", async () => {
  const { verifier, calls } = verifierFixture({
    getNetwork: async () => ({ chainId: 137n }),
  });

  await assert.rejects(() => verifier(ADDRESSES[0]), /does not match/);
  assert.deepEqual(calls(), {
    networkCalls: 1,
    minimumCalls: 0,
    supporterCalls: 0,
  });
});

test("a failed network or contract check can be retried", async () => {
  const { verifier, calls } = verifierFixture({
    getNetwork: async (call) => {
      if (call === 1) throw new Error("temporary RPC failure");
      return { chainId: 80_002n };
    },
  });

  await assert.rejects(() => verifier.healthCheck(), /temporary RPC failure/);
  await verifier.healthCheck();
  assert.deepEqual(calls(), {
    networkCalls: 2,
    minimumCalls: 1,
    supporterCalls: 0,
  });

  const contractFailure = verifierFixture({
    minimumPledge: async (call) => {
      if (call === 1) throw new Error("temporary contract failure");
      return 100n;
    },
  });
  await assert.rejects(
    () => contractFailure.verifier.healthCheck(),
    /temporary contract failure/,
  );
  await contractFailure.verifier.healthCheck();
  assert.deepEqual(contractFailure.calls(), {
    networkCalls: 2,
    minimumCalls: 2,
    supporterCalls: 0,
  });
});
