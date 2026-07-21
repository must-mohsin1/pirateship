import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ganache from "ganache";
import solc from "solc";
import { BrowserProvider, ContractFactory, Interface, ZeroAddress, parseEther } from "ethers";

const source = await readFile(
  new URL("../../../contracts/RefundableProductEscrow.sol", import.meta.url),
  "utf8",
);

const auditHelperSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrow {
    function contribute() external payable;
    function claimRefund() external;
}

contract ReentrantSupporter {
    IEscrow public immutable escrow;
    bool public attempted;

    constructor(address escrow_) { escrow = IEscrow(escrow_); }

    function fund() external payable { escrow.contribute{value: msg.value}(); }
    function refund() external { escrow.claimRefund(); }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            try escrow.claimRefund() {} catch {}
        }
    }
}

contract RevertingSupporter {
    IEscrow public immutable escrow;
    bool public reject = true;

    constructor(address escrow_) { escrow = IEscrow(escrow_); }

    function fund() external payable { escrow.contribute{value: msg.value}(); }
    function refund() external { escrow.claimRefund(); }
    function allowRefund() external { reject = false; }

    receive() external payable {
        if (reject) revert("reject");
    }
}

contract ForceSend {
    constructor() payable {}
    function force(address payable target) external { selfdestruct(target); }
}
`;

const compiled = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: {
        "RefundableProductEscrow.sol": { content: source },
        "AuditHelpers.sol": { content: auditHelperSource },
      },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "paris",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);

const errors = (compiled.errors ?? []).filter(({ severity }) => severity === "error");
assert.deepEqual(errors, [], errors.map(({ formattedMessage }) => formattedMessage).join("\n"));

const artifact = compiled.contracts["RefundableProductEscrow.sol"].RefundableProductEscrow;
const auditHelperArtifacts = compiled.contracts["AuditHelpers.sol"];
const escrowInterface = new Interface(artifact.abi);
const DAY = 24 * 60 * 60;
const MINIMUM_PLEDGE = parseEther("1");

async function fixture() {
  const eip1193 = ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 6, defaultBalance: 100 },
  });
  const provider = new BrowserProvider(eip1193);
  const owner = await provider.getSigner(0);
  const beneficiary = await provider.getSigner(1);
  const supporterA = await provider.getSigner(2);
  const supporterB = await provider.getSigner(3);
  const processor = await provider.getSigner(4);
  const attacker = await provider.getSigner(5);
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner);
  const contract = await factory.deploy(await beneficiary.getAddress(), MINIMUM_PLEDGE);
  await contract.waitForDeployment();

  return {
    eip1193,
    provider,
    contract,
    owner,
    beneficiary,
    supporterA,
    supporterB,
    processor,
    attacker,
  };
}

async function movePastDeadline(eip1193) {
  await eip1193.request({ method: "evm_increaseTime", params: [30 * DAY + 1] });
  await eip1193.request({ method: "evm_mine", params: [] });
}

async function moveToExactDeadline(eip1193, contract) {
  const deadline = Number(await contract.deadline());
  const latest = await eip1193.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  });
  const secondsUntilDeadline = deadline - Number(BigInt(latest.timestamp));
  await eip1193.request({ method: "evm_increaseTime", params: [secondsUntilDeadline] });
  await eip1193.request({ method: "evm_mine", params: [] });
  const atDeadline = await eip1193.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  });
  assert.equal(Number(BigInt(atDeadline.timestamp)), deadline);
}

async function deployAuditHelper(name, signer, args = [], overrides = {}) {
  const helperArtifact = auditHelperArtifacts[name];
  const factory = new ContractFactory(
    helperArtifact.abi,
    helperArtifact.evm.bytecode.object,
    signer,
  );
  const helper = await factory.deploy(...args, overrides);
  await helper.waitForDeployment();
  return helper;
}

function revertDataCandidates(error) {
  return [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.result,
    error?.cause?.data,
  ].filter((candidate) => typeof candidate === "string");
}

async function assertCustomError(promise, errorName) {
  const selector = escrowInterface.getError(errorName).selector.toLowerCase();
  await assert.rejects(promise, (error) =>
    revertDataCandidates(error).some((data) => data.toLowerCase().startsWith(selector)),
  );
}

async function rawBalance(eip1193, address) {
  return BigInt(
    await eip1193.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  );
}

test("sets immutable campaign terms and enforces the minimum first pledge", async () => {
  const { contract, supporterA } = await fixture();
  await assert.rejects(
    contract.connect(supporterA).contribute({ value: parseEther("0.999") }),
  );
  await (await contract.connect(supporterA).contribute({ value: parseEther("1") })).wait();
  await (await contract.connect(supporterA).contribute({ value: parseEther("0.5") })).wait();

  const record = await contract.supporters(await supporterA.getAddress());
  assert.equal(record.amount, parseEther("1.5"));
  assert.equal(await contract.totalPledged(), parseEther("1.5"));
  assert.equal(await contract.CAMPAIGN_DURATION(), BigInt(30 * DAY));
  assert.equal(await contract.minimumPledge(), MINIMUM_PLEDGE);
});

test("only the owner can declare release and funding closes after release", async () => {
  const { contract, supporterA } = await fixture();
  await assert.rejects(contract.connect(supporterA).markProductReleased("ipfs://release"));
  await (await contract.markProductReleased("ipfs://release")).wait();
  assert.equal(await contract.productReleased(), true);
  assert.equal(await contract.productReleaseProof(), "ipfs://release");
  await assert.rejects(
    contract.connect(supporterA).contribute({ value: parseEther("1") }),
  );
});

test("a supporter cannot approve before objective release evidence exists", async () => {
  const { contract, supporterA } = await fixture();
  await (await contract.connect(supporterA).contribute({ value: parseEther("1") })).wait();
  await assert.rejects(contract.connect(supporterA).approveProduct());
});

test("individual approval creates key eligibility and only approved funds are withdrawable", async () => {
  const { contract, supporterA, supporterB, beneficiary, processor, eip1193 } = await fixture();
  await (await contract.connect(supporterA).contribute({ value: parseEther("1") })).wait();
  await (await contract.connect(supporterB).contribute({ value: parseEther("2") })).wait();
  await (await contract.markProductReleased("https://product.example/release")).wait();
  await (await contract.connect(supporterA).approveProduct()).wait();

  assert.equal(await contract.isKeyEligible(await supporterA.getAddress()), true);
  assert.equal(await contract.isKeyEligible(await supporterB.getAddress()), false);
  assert.equal(await contract.withdrawableApproved(), parseEther("1"));
  assert.equal(
    await rawBalance(eip1193, await contract.getAddress()),
    parseEther("3"),
  );
  await assertCustomError(
    contract.connect(processor).withdrawApprovedFunds.staticCall(),
    "NotBeneficiary",
  );

  await (await contract.connect(beneficiary).withdrawApprovedFunds()).wait();
  assert.equal(await contract.withdrawableApproved(), 0n);
  assert.equal(
    await rawBalance(eip1193, await contract.getAddress()),
    parseEther("2"),
    "the unapproved supporter's funds must remain escrowed",
  );
});

test("unapproved supporters can claim a full refund after 30 days", async () => {
  const { contract, supporterA, eip1193 } = await fixture();
  await (await contract.connect(supporterA).contribute({ value: parseEther("1") })).wait();
  await assert.rejects(contract.connect(supporterA).claimRefund());
  await movePastDeadline(eip1193);

  await (await contract.connect(supporterA).claimRefund({ gasLimit: 500_000 })).wait();
  const record = await contract.supporters(await supporterA.getAddress());
  assert.equal(record.refunded, true);
  assert.equal(await contract.totalRefunded(), parseEther("1"));
  assert.equal(await rawBalance(eip1193, await contract.getAddress()), 0n);
  await assert.rejects(contract.connect(supporterA).claimRefund());
});

test("any account can process a refund, but funds always go to the supporter", async () => {
  const { contract, supporterA, processor, eip1193 } = await fixture();
  const supporterAddress = await supporterA.getAddress();
  await (await contract.connect(supporterA).contribute({ value: parseEther("1") })).wait();
  const afterPledge = await rawBalance(eip1193, supporterAddress);
  await movePastDeadline(eip1193);

  await (await contract.connect(processor).processRefund(supporterAddress)).wait();
  const after = await rawBalance(eip1193, supporterAddress);
  assert.equal(
    after,
    afterPledge + parseEther("1"),
    "the supporter receives the full pledge without paying refund gas",
  );
});

test("approved supporters cannot refund and unapproved funds cannot be withdrawn", async () => {
  const { contract, supporterA, supporterB, beneficiary, eip1193 } = await fixture();
  await (await contract.connect(supporterA).contribute({ value: parseEther("1") })).wait();
  await (await contract.connect(supporterB).contribute({ value: parseEther("2") })).wait();
  await (await contract.markProductReleased("ipfs://release")).wait();
  await (await contract.connect(supporterA).approveProduct()).wait();
  await movePastDeadline(eip1193);

  await assert.rejects(contract.connect(supporterA).claimRefund());
  await (await contract.connect(beneficiary).withdrawApprovedFunds()).wait();
  assert.equal(await rawBalance(eip1193, await contract.getAddress()), parseEther("2"));
  await (await contract.connect(supporterB).claimRefund({ gasLimit: 500_000 })).wait();
  assert.equal(await rawBalance(eip1193, await contract.getAddress()), 0n);
});

test("release and approval both close at the deadline", async () => {
  const { contract, supporterA, eip1193 } = await fixture();
  await (await contract.connect(supporterA).contribute({ value: parseEther("1") })).wait();
  await movePastDeadline(eip1193);
  await assert.rejects(contract.markProductReleased("ipfs://late"));
  await assert.rejects(contract.connect(supporterA).approveProduct());
});

test("release and approval close while refunds open at the exact deadline", async () => {
  const { contract, supporterA, eip1193 } = await fixture();
  await (await contract.connect(supporterA).contribute({ value: MINIMUM_PLEDGE })).wait();
  await moveToExactDeadline(eip1193, contract);

  await assertCustomError(
    contract.markProductReleased.staticCall("https://product.example/release"),
    "CampaignClosed",
  );
  await assertCustomError(contract.connect(supporterA).approveProduct.staticCall(), "ApprovalClosed");
  await (await contract.connect(supporterA).claimRefund({ gasLimit: 500_000 })).wait();
  assert.equal((await contract.supporters(await supporterA.getAddress())).refunded, true);
});

test("a malicious refund receiver cannot reenter for a second payment", async () => {
  const { contract, attacker, eip1193 } = await fixture();
  const helper = await deployAuditHelper(
    "ReentrantSupporter",
    attacker,
    [await contract.getAddress()],
  );
  await (await helper.fund({ value: MINIMUM_PLEDGE })).wait();
  await movePastDeadline(eip1193);

  await (await helper.refund({ gasLimit: 700_000 })).wait();

  const record = await contract.supporters(await helper.getAddress());
  assert.equal(record.refunded, true);
  assert.equal(await rawBalance(eip1193, await helper.getAddress()), MINIMUM_PLEDGE);
  assert.equal(await contract.totalRefunded(), MINIMUM_PLEDGE);
  assert.equal(await rawBalance(eip1193, await contract.getAddress()), 0n);
});

test("a reverting refund receiver rolls accounting back and can retry", async () => {
  const { contract, attacker, eip1193 } = await fixture();
  const helper = await deployAuditHelper(
    "RevertingSupporter",
    attacker,
    [await contract.getAddress()],
  );
  await (await helper.fund({ value: MINIMUM_PLEDGE })).wait();
  await movePastDeadline(eip1193);

  await assert.rejects(async () => {
    await (await helper.refund({ gasLimit: 700_000 })).wait();
  });
  assert.equal((await contract.supporters(await helper.getAddress())).refunded, false);
  assert.equal(await contract.totalRefunded(), 0n);

  await (await helper.allowRefund()).wait();
  await (await helper.refund({ gasLimit: 700_000 })).wait();
  assert.equal((await contract.supporters(await helper.getAddress())).refunded, true);
  assert.equal(await rawBalance(eip1193, await helper.getAddress()), MINIMUM_PLEDGE);
});

test("forced POL cannot inflate supporter or beneficiary accounting", async () => {
  const { contract, owner, supporterA, eip1193 } = await fixture();
  await (await contract.connect(supporterA).contribute({ value: MINIMUM_PLEDGE })).wait();
  const forceSend = await deployAuditHelper(
    "ForceSend",
    owner,
    [],
    { value: parseEther("0.4") },
  );
  await (await forceSend.force(await contract.getAddress())).wait();
  assert.equal(await rawBalance(eip1193, await contract.getAddress()), parseEther("1.4"));

  await movePastDeadline(eip1193);
  await (await contract.connect(supporterA).claimRefund({ gasLimit: 500_000 })).wait();

  assert.equal(await contract.totalPledged(), MINIMUM_PLEDGE);
  assert.equal(await contract.totalRefunded(), MINIMUM_PLEDGE);
  assert.equal(await contract.withdrawableApproved(), 0n);
  assert.equal(await rawBalance(eip1193, await contract.getAddress()), parseEther("0.4"));
});

test("constructor, funding, and release guards reject invalid state transitions", async () => {
  const eip1193 = ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 2, defaultBalance: 100 },
  });
  const provider = new BrowserProvider(eip1193);
  const owner = await provider.getSigner(0);
  const beneficiary = await provider.getSigner(1);
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner);

  await assert.rejects(factory.deploy(ZeroAddress, MINIMUM_PLEDGE));
  await assert.rejects(factory.deploy(await beneficiary.getAddress(), 0));

  const { contract, supporterA } = await fixture();
  assert.equal(await contract.phase(), 0n);
  await assert.rejects(contract.connect(supporterA).contribute({ value: 0 }));
  await assert.rejects(contract.markProductReleased(""));
  await (await contract.markProductReleased("https://product.example/release")).wait();
  assert.equal(await contract.phase(), 1n);
  await assert.rejects(contract.markProductReleased("https://product.example/release-2"));
});

test("receive, approval, withdrawal, and refundable views preserve per-wallet accounting", async () => {
  const { contract, supporterA, supporterB, beneficiary, processor, eip1193 } = await fixture();
  const contractAddress = await contract.getAddress();
  const supporterAAddress = await supporterA.getAddress();
  const supporterBAddress = await supporterB.getAddress();

  await (await supporterA.sendTransaction({ to: contractAddress, value: MINIMUM_PLEDGE })).wait();
  await (await contract.connect(supporterB).contribute({ value: parseEther("2") })).wait();
  assert.equal((await contract.supporters(supporterAAddress)).amount, MINIMUM_PLEDGE);
  assert.equal(await contract.refundableAmount(supporterBAddress), 0n);
  await assert.rejects(contract.connect(processor).withdrawApprovedFunds());
  await assert.rejects(contract.connect(beneficiary).withdrawApprovedFunds());

  await (await contract.markProductReleased("https://product.example/release")).wait();
  await assert.rejects(contract.connect(processor).approveProduct());
  await (await contract.connect(supporterA).approveProduct()).wait();
  await assert.rejects(async () => {
    await (await contract.connect(supporterA).approveProduct({ gasLimit: 500_000 })).wait();
  });
  await (await contract.connect(beneficiary).withdrawApprovedFunds({ gasLimit: 500_000 })).wait();
  await assert.rejects(async () => {
    await (await contract.connect(beneficiary).withdrawApprovedFunds({ gasLimit: 500_000 })).wait();
  });

  await movePastDeadline(eip1193);
  assert.equal(await contract.phase(), 2n);
  assert.equal(await contract.refundableAmount(supporterAAddress), 0n);
  assert.equal(await contract.refundableAmount(supporterBAddress), parseEther("2"));
  await (await contract.connect(processor).processRefund(supporterBAddress)).wait();
  assert.equal(await contract.refundableAmount(supporterBAddress), 0n);
});
