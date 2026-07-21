import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { keccak256 } from "ethers";
import {
  buildDeploymentConfig,
  isAllowedLocalHost,
  startLocalDeploymentServer,
} from "../scripts/mainnet-deploy-server.mjs";
import {
  DEPLOYMENT_LOCK_KEY,
  discoverTrustWallet,
  initializePage,
  isWalletSubmissionRejected,
  readDeploymentLock,
  recordDeploymentAttempt,
  recordDeploymentTransactionHash,
  recordVerifiedDeployment,
  submitAndVerifyDeployment,
} from "../scripts/mainnet-deploy.js";
import {
  createFileAttemptJournal,
  verifyMinedDeployment,
} from "../scripts/mainnet-deployment-verifier.mjs";

const DEPLOYER = "0x0000000000000000000000000000000000000001";
const BENEFICIARY = "0x0000000000000000000000000000000000000002";
const CONTRACT = "0x00000000000000000000000000000000000000aa";
const TRANSACTION_HASH = `0x${"ab".repeat(32)}`;
const DEPLOYMENT_INITCODE = "0x6000600055";
const MINIMUM_PLEDGE_WEI = "300000000000000000000";

function word(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function addressWord(address) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function readyPreflight() {
  return {
    status: "READY_FOR_MANUAL_DEPLOYMENT_REVIEW",
    blockers: [],
    campaign: {
      ownerAndDeployer: DEPLOYER,
      beneficiary: BENEFICIARY,
      minimumPledgePol: "300",
      minimumPledgeWei: MINIMUM_PLEDGE_WEI,
    },
    review: { sourceCommit: "a".repeat(40) },
    network: { blockNumber: 290 },
    contractBuild: {
      deploymentInitcodeBytes: (DEPLOYMENT_INITCODE.length - 2) / 2,
      deploymentInitcodeKeccak256: keccak256(DEPLOYMENT_INITCODE),
    },
  };
}

function deploymentConfig() {
  return buildDeploymentConfig({
    preflight: readyPreflight(),
    prepared: { deploymentInitcode: DEPLOYMENT_INITCODE },
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function requestLocal({ port, host, method = "GET", path = "/", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: { ...headers, Host: host },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode,
          headers: { get: (name) => response.headers[name.toLowerCase()] ?? null },
          text: async () => responseBody,
          json: async () => JSON.parse(responseBody),
        });
      });
    });
    request.once("error", reject);
    request.end(body);
  });
}

function browserProvider({ chains = ["0x89", "0x89", "0x89"], accounts, send } = {}) {
  const sentTransactions = [];
  let chainRead = 0;
  let accountRead = 0;
  const accountValues = accounts ?? [[DEPLOYER], [DEPLOYER]];
  return {
    sentTransactions,
    request: async ({ method, params }) => {
      if (method === "eth_chainId") return chains[Math.min(chainRead++, chains.length - 1)];
      if (method === "eth_accounts") {
        return accountValues[Math.min(accountRead++, accountValues.length - 1)];
      }
      if (method === "eth_sendTransaction") {
        sentTransactions.push(params[0]);
        if (send instanceof Error) throw send;
        return send ?? TRANSACTION_HASH;
      }
      throw new Error(`Unexpected browser provider method: ${method}`);
    },
  };
}

function independentProvider(
  config,
  {
    chainId = 137n,
    receipt = { hash: TRANSACTION_HASH, status: 1, contractAddress: CONTRACT, blockNumber: 291 },
    transaction = { hash: TRANSACTION_HASH, from: DEPLOYER, to: null, data: DEPLOYMENT_INITCODE },
    block = { timestamp: 1_800_000_000 },
    callOverrides = {},
  } = {},
) {
  const waits = [];
  const deadline = BigInt(block?.timestamp ?? 0) + BigInt(config.campaignDurationSeconds);
  return {
    waits,
    getNetwork: async () => ({ chainId }),
    waitForTransaction: async (hash, confirmations, timeoutMs) => {
      waits.push({ hash, confirmations, timeoutMs });
      return receipt;
    },
    getTransaction: async () => transaction,
    getBlock: async () => block,
    call: async ({ data }) => {
      if (Object.hasOwn(callOverrides, data)) return callOverrides[data];
      if (data === config.calls.owner) return addressWord(DEPLOYER);
      if (data === config.calls.beneficiary) return addressWord(BENEFICIARY);
      if (data === config.calls.minimumPledge) return word(MINIMUM_PLEDGE_WEI);
      if (data === config.calls.deadline) return word(deadline);
      if (data === config.calls.phase || data === config.calls.productReleased) return word(0);
      throw new Error("Unexpected contract call.");
    },
  };
}

test("builds a pinned Trust Wallet handoff only from a ready matching preflight", () => {
  const preflight = readyPreflight();
  const config = deploymentConfig();
  assert.equal(config.chainIdHex, "0x89");
  assert.equal(config.chainId, "137");
  assert.equal(config.deployerAddress, DEPLOYER);
  assert.equal(config.beneficiaryAddress, BENEFICIARY);
  assert.equal(config.minimumPledgeWei, MINIMUM_PLEDGE_WEI);
  assert.equal(config.deploymentInitcode, DEPLOYMENT_INITCODE);
  assert.equal(config.confirmationText, "DEPLOY 300 POL ESCROW");
  assert.equal(config.confirmations, 20);
  assert.equal(config.minimumDeploymentBlock, 290);

  assert.throws(
    () => buildDeploymentConfig({
      preflight: { ...preflight, status: "BLOCKED", blockers: ["audit missing"] },
      prepared: { deploymentInitcode: DEPLOYMENT_INITCODE },
    }),
    /preflight is blocked/,
  );
  assert.throws(
    () => buildDeploymentConfig({
      preflight,
      prepared: { deploymentInitcode: "0x6001" },
    }),
    /does not match/,
  );
});

test("the localhost server rejects DNS-rebinding Host headers", () => {
  const hostname = "0123456789abcdef.localhost";
  assert.equal(isAllowedLocalHost(`${hostname}:4174`, 4174, hostname), true);
  assert.equal(isAllowedLocalHost(`${hostname.toUpperCase()}:4174`, 4174, hostname), true);
  assert.equal(isAllowedLocalHost("127.0.0.1:4174", 4174, hostname), false);
  assert.equal(isAllowedLocalHost("localhost:4174", 4174, hostname), false);
  assert.equal(isAllowedLocalHost("attacker.example:4174", 4174, hostname), false);
  assert.equal(isAllowedLocalHost(undefined, 4174, hostname), false);
});

test("submits exact reviewed initcode and delegates success to the independent verifier", async () => {
  const config = deploymentConfig();
  const provider = browserProvider();
  const events = [];
  const expected = { transactionHash: TRANSACTION_HASH, contractAddress: CONTRACT };
  const result = await submitAndVerifyDeployment({
    provider,
    config,
    onSubmissionAttempt: () => events.push("attempt"),
    submissionGuard: () => events.push("guard"),
    onTransactionHash: (hash) => events.push(`hash:${hash}`),
    independentVerifier: (hash) => {
      events.push(`verify:${hash}`);
      return expected;
    },
  });

  assert.deepEqual(provider.sentTransactions, [{
    from: DEPLOYER,
    data: DEPLOYMENT_INITCODE,
    value: "0x0",
  }]);
  assert.deepEqual(events, [
    "attempt",
    "guard",
    `hash:${TRANSACTION_HASH}`,
    `verify:${TRANSACTION_HASH}`,
  ]);
  assert.equal(result, expected);
});

test("rechecks wallet chain and account at every critical submission boundary", async (t) => {
  const config = deploymentConfig();
  const cases = [
    ["initial chain", browserProvider({ chains: ["0x13882"] }), /not connected/],
    ["initial account", browserProvider({ accounts: [[BENEFICIARY]] }), /not the reviewed deployer/],
    ["chain before send", browserProvider({ chains: ["0x89", "0x1"] }), /changed networks before/],
    ["account before send", browserProvider({ accounts: [[DEPLOYER], [BENEFICIARY]] }), /changed accounts before/],
    ["chain after send", browserProvider({ chains: ["0x89", "0x89", "0x1"] }), /changed networks during/],
  ];
  for (const [name, provider, pattern] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        submitAndVerifyDeployment({
          provider,
          config,
          independentVerifier: () => ({ ok: true }),
        }),
        pattern,
      );
    });
  }
});

test("identifies only an explicit eth_sendTransaction rejection without clearing state", async () => {
  const config = deploymentConfig();
  const walletError = new Error("user rejected");
  walletError.code = 4001;
  await assert.rejects(
    submitAndVerifyDeployment({
      provider: browserProvider({ send: walletError }),
      config,
      independentVerifier: () => ({ ok: true }),
    }),
    (error) => isWalletSubmissionRejected(error),
  );

  const unrelated = new Error("journal refused");
  unrelated.code = 4001;
  await assert.rejects(
    submitAndVerifyDeployment({
      provider: browserProvider(),
      config,
      onSubmissionAttempt: () => { throw unrelated; },
      independentVerifier: () => ({ ok: true }),
    }),
    (error) => error === unrelated && !isWalletSubmissionRejected(error),
  );
});

test("revalidates the review immediately before calling the wallet", async () => {
  const provider = browserProvider();
  await assert.rejects(
    submitAndVerifyDeployment({
      provider,
      config: deploymentConfig(),
      submissionGuard: () => { throw new Error("review changed"); },
      independentVerifier: () => ({ ok: true }),
    }),
    /review changed/,
  );
  assert.deepEqual(provider.sentTransactions, []);
});

test("rejects invalid hashes and refuses to skip independent verification", async () => {
  const config = deploymentConfig();
  await assert.rejects(
    submitAndVerifyDeployment({
      provider: browserProvider({ send: "0x1234" }),
      config,
      independentVerifier: () => ({ ok: true }),
    }),
    /invalid transaction hash/,
  );
  await assert.rejects(
    submitAndVerifyDeployment({ provider: browserProvider(), config }),
    /Independent Polygon mainnet verification is unavailable/,
  );
});

test("keeps a returned transaction hash ambiguous when durable persistence fails", async () => {
  let verifierCalled = false;
  await assert.rejects(
    submitAndVerifyDeployment({
      provider: browserProvider(),
      config: deploymentConfig(),
      onTransactionHash: () => { throw new Error("controller unavailable"); },
      independentVerifier: () => { verifierCalled = true; },
    }),
    /controller unavailable/,
  );
  assert.equal(verifierCalled, false);
});

test("discovers only the Trust Wallet EIP-6963 provider", async () => {
  const windowObject = new EventTarget();
  windowObject.Event = Event;
  let requested = 0;
  windowObject.addEventListener("eip6963:requestProvider", () => { requested += 1; });
  const discovery = discoverTrustWallet(windowObject, 100);
  const other = new Event("eip6963:announceProvider");
  Object.defineProperty(other, "detail", {
    value: { info: { rdns: "io.metamask" }, provider: { name: "other" } },
  });
  windowObject.dispatchEvent(other);
  const trustProvider = { name: "trust" };
  const trust = new Event("eip6963:announceProvider");
  Object.defineProperty(trust, "detail", {
    value: { info: { rdns: "com.trustwallet.app" }, provider: trustProvider },
  });
  windowObject.dispatchEvent(trust);
  assert.equal(await discovery, trustProvider);
  assert.equal(requested, 1);

  await assert.rejects(discoverTrustWallet(windowObject, 1), /not detected/);
});

test("local page refuses a service-worker-controlled deployment origin", async () => {
  await assert.rejects(
    initializePage({
      documentObject: {},
      storage: memoryStorage(),
      windowObject: { navigator: { serviceWorker: { controller: {} } } },
      fetchImpl: async () => { throw new Error("must not fetch"); },
    }),
    /service worker controls/,
  );
});

test("local page connects Trust Wallet, enforces confirmation, and renders verified output", async () => {
  class FakeElement {
    constructor() {
      this.checked = false;
      this.disabled = false;
      this.textContent = "";
      this.value = "";
      this.listeners = new Map();
    }
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }
    async emit(name) {
      await this.listeners.get(name)?.();
    }
  }
  const ids = [
    "status", "connect-wallet", "deploy-contract", "confirmation", "acknowledge",
    "deployer", "beneficiary", "minimum", "commit", "fingerprint", "payload-size",
    "confirmation-phrase", "acknowledgement-text", "result",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const documentObject = { getElementById: (id) => elements.get(id) };
  const config = { ...deploymentConfig(), attemptToken: "local-token" };
  const providerListeners = new Map();
  const provider = {
    on: (name, listener) => {
      providerListeners.set(name, [...(providerListeners.get(name) ?? []), listener]);
    },
    removeListener: (name, listener) => {
      providerListeners.set(
        name,
        (providerListeners.get(name) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [DEPLOYER];
      if (method === "eth_chainId") return "0x89";
      if (method === "eth_sendTransaction") {
        assert.equal(params[0].data, DEPLOYMENT_INITCODE);
        return TRANSACTION_HASH;
      }
      throw new Error(`Unexpected page wallet method: ${method}`);
    },
  };
  const windowObject = new EventTarget();
  windowObject.Event = Event;
  windowObject.addEventListener("eip6963:requestProvider", () => {
    const announcement = new Event("eip6963:announceProvider");
    Object.defineProperty(announcement, "detail", {
      value: { info: { rdns: "com.trustwallet.app" }, provider },
    });
    windowObject.dispatchEvent(announcement);
  });
  const posts = [];
  const fetchImpl = async (path, options = {}) => {
    if (path === "/deployment.json") {
      return { ok: true, json: async () => config };
    }
    const body = JSON.parse(options.body);
    posts.push([path, body]);
    const result = path === "/verify"
      ? { transactionHash: TRANSACTION_HASH, contractAddress: CONTRACT }
      : { ok: true };
    return { ok: true, json: async () => result };
  };

  await initializePage({
    documentObject,
    storage: memoryStorage(),
    windowObject,
    fetchImpl,
  });
  assert.equal(elements.get("confirmation-phrase").textContent, "DEPLOY 300 POL ESCROW");
  elements.get("acknowledge").checked = true;
  elements.get("confirmation").value = config.confirmationText;
  await elements.get("acknowledge").emit("change");
  assert.equal(elements.get("deploy-contract").disabled, true);
  await elements.get("connect-wallet").emit("click");
  await elements.get("connect-wallet").emit("click");
  assert.equal(providerListeners.get("accountsChanged").length, 1);
  assert.equal(providerListeners.get("chainChanged").length, 1);
  assert.equal(elements.get("deploy-contract").disabled, false);
  await elements.get("deploy-contract").emit("click");
  assert.deepEqual(posts.map(([path]) => path), [
    "/attempt/start",
    "/attempt/hash",
    "/verify",
  ]);
  assert.match(elements.get("status").textContent, /mined and verified/);
  assert.match(elements.get("result").textContent, new RegExp(CONTRACT));
});

test("browser lock records attempt, transaction hash, and verified result", () => {
  const storage = memoryStorage();
  assert.equal(readDeploymentLock(storage), null);
  const attempt = recordDeploymentAttempt(
    storage,
    readyPreflight().contractBuild.deploymentInitcodeKeccak256,
    new Date("2026-07-21T00:00:00Z"),
  );
  assert.equal(attempt.state, "submitted-or-unknown");
  const submitted = recordDeploymentTransactionHash(storage, TRANSACTION_HASH);
  assert.equal(submitted.state, "submitted");
  assert.equal(readDeploymentLock(storage).transactionHash, TRANSACTION_HASH);
  recordVerifiedDeployment(
    storage,
    readyPreflight().contractBuild.deploymentInitcodeKeccak256,
    { transactionHash: TRANSACTION_HASH, contractAddress: CONTRACT },
    new Date("2026-07-21T00:01:00Z"),
  );
  assert.equal(readDeploymentLock(storage).state, "mined-and-verified");
  storage.setItem(DEPLOYMENT_LOCK_KEY, "not-json");
  assert.equal(readDeploymentLock(storage).state, "unknown-existing-lock");
});

test("independent RPC waits for finality and verifies transaction plus immutable state", async () => {
  const config = deploymentConfig();
  const provider = independentProvider(config);
  const result = await verifyMinedDeployment({
    provider,
    config,
    transactionHash: TRANSACTION_HASH,
  });
  assert.deepEqual(provider.waits, [{
    hash: TRANSACTION_HASH,
    confirmations: 20,
    timeoutMs: 600_000,
  }]);
  assert.equal(result.contractAddress, CONTRACT);
  assert.equal(result.deploymentBlock, "291");
  assert.equal(result.confirmations, 20);
  assert.equal(result.deadline, "1802592000");
});

test("independent verification rejects network, receipt, and transaction mismatches", async (t) => {
  const config = deploymentConfig();
  const cases = [
    ["wrong RPC chain", { chainId: 1n }, /not Polygon mainnet/],
    ["missing receipt", { receipt: null }, /failed or was not confirmed/],
    ["failed receipt", { receipt: { status: 0, contractAddress: CONTRACT, blockNumber: 291 } }, /failed or was not confirmed/],
    ["missing address", { receipt: { status: 1, contractAddress: null, blockNumber: 291 } }, /failed or was not confirmed/],
    ["transaction predates handoff", {
      receipt: { hash: TRANSACTION_HASH, status: 1, contractAddress: CONTRACT, blockNumber: 289 },
    }, /predates this reviewed deployment handoff/],
    ["wrong receipt hash", {
      receipt: { hash: `0x${"cd".repeat(32)}`, status: 1, contractAddress: CONTRACT, blockNumber: 291 },
    }, /does not match/],
    ["wrong transaction hash", {
      transaction: { hash: `0x${"cd".repeat(32)}`, from: DEPLOYER, to: null, data: DEPLOYMENT_INITCODE },
    }, /does not match/],
    ["wrong sender", { transaction: { from: BENEFICIARY, to: null, data: DEPLOYMENT_INITCODE } }, /does not match/],
    ["not creation", { transaction: { from: DEPLOYER, to: BENEFICIARY, data: DEPLOYMENT_INITCODE } }, /does not match/],
    ["wrong initcode", { transaction: { from: DEPLOYER, to: null, data: "0x6001" } }, /does not match/],
    ["missing transaction", { transaction: null }, /incomplete data/],
    ["missing block", { block: null }, /incomplete data/],
  ];
  for (const [name, overrides, pattern] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyMinedDeployment({
          provider: independentProvider(config, overrides),
          config,
          transactionHash: TRANSACTION_HASH,
        }),
        pattern,
      );
    });
  }
});

test("independent verification rejects every immutable-state mismatch", async (t) => {
  const config = deploymentConfig();
  const deadline = 1_800_000_000n + BigInt(config.campaignDurationSeconds);
  const cases = [
    ["owner", config.calls.owner, addressWord(BENEFICIARY), /owner/],
    ["beneficiary", config.calls.beneficiary, addressWord(DEPLOYER), /beneficiary/],
    ["minimum", config.calls.minimumPledge, word(1), /minimum pledge/],
    ["deadline", config.calls.deadline, word(deadline + 1n), /deadline/],
    ["phase", config.calls.phase, word(1), /Funding phase/],
    ["release", config.calls.productReleased, word(1), /Funding phase/],
    ["malformed address", config.calls.owner, "0x1234", /Invalid address/],
    ["malformed integer", config.calls.minimumPledge, "not-hex", /Invalid integer/],
  ];
  for (const [name, selector, response, pattern] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyMinedDeployment({
          provider: independentProvider(config, { callOverrides: { [selector]: response } }),
          config,
          transactionHash: TRANSACTION_HASH,
        }),
        pattern,
      );
    });
  }
});

test("durable journal enforces started to first-hash to same-hash verified", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pirateship-mainnet-journal-"));
  const fileUrl = pathToFileURL(join(directory, "attempt.json"));
  const journal = createFileAttemptJournal(fileUrl);
  try {
    await journal.ensureClear();
    await journal.start({ fingerprint: "0xfingerprint", startedAt: "2026-07-21T00:00:00Z" });
    await assert.rejects(journal.ensureClear(), /must be reconciled/);
    await assert.rejects(
      journal.start({ fingerprint: "0xsecond", startedAt: "2026-07-21T00:00:01Z" }),
      (error) => error.code === "EEXIST",
    );
    await journal.recordTransactionHash(TRANSACTION_HASH);
    const submitted = JSON.parse(await readFile(fileUrl, "utf8"));
    assert.equal(submitted.state, "submitted");
    assert.equal(submitted.transactionHash, TRANSACTION_HASH);
    await journal.recordTransactionHash(TRANSACTION_HASH);
    await assert.rejects(
      journal.recordTransactionHash(`0x${"cd".repeat(32)}`),
      /already bound/,
    );
    await assert.rejects(
      journal.verifyTransaction(`0x${"cd".repeat(32)}`, async () => ({})),
      /first recorded/,
    );
    await assert.rejects(
      journal.verifyTransaction(TRANSACTION_HASH, async () => ({
        transactionHash: `0x${"cd".repeat(32)}`,
      })),
      /returned a different/,
    );
    await assert.rejects(
      journal.verifyTransaction(TRANSACTION_HASH, async () => {
        throw new Error("temporary RPC failure");
      }),
      /temporary RPC failure/,
    );
    assert.equal(
      JSON.parse(await readFile(fileUrl, "utf8")).state,
      "submitted",
      "a verification outage must remain retryable only for the same saved hash",
    );
    const result = await journal.verifyTransaction(TRANSACTION_HASH, async () => ({
      transactionHash: TRANSACTION_HASH,
      contractAddress: CONTRACT,
    }));
    assert.equal(result.contractAddress, CONTRACT);
    const verified = JSON.parse(await readFile(fileUrl, "utf8"));
    assert.equal(verified.state, "mined-and-verified");
    assert.equal(verified.transactionHash, TRANSACTION_HASH);
    await assert.rejects(
      journal.recordTransactionHash(`0x${"ef".repeat(32)}`),
      /already bound/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("durable journal keeps even a pre-hash wallet rejection for manual reconciliation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pirateship-mainnet-locked-"));
  const fileUrl = pathToFileURL(join(directory, "attempt.json"));
  const journal = createFileAttemptJournal(fileUrl);
  try {
    await journal.start({ fingerprint: "0xfingerprint", startedAt: "2026-07-21T00:00:00Z" });
    assert.equal(journal.rejected, undefined);
    await assert.rejects(journal.ensureClear(), /must be reconciled/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("durable journal serializes concurrent competing transaction hashes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pirateship-mainnet-concurrent-"));
  const fileUrl = pathToFileURL(join(directory, "attempt.json"));
  const journal = createFileAttemptJournal(fileUrl);
  const otherHash = `0x${"cd".repeat(32)}`;
  try {
    await journal.start({ fingerprint: "0xfingerprint", startedAt: "2026-07-21T00:00:00Z" });
    const outcomes = await Promise.allSettled([
      journal.recordTransactionHash(TRANSACTION_HASH),
      journal.recordTransactionHash(otherHash),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
    const saved = JSON.parse(await readFile(fileUrl, "utf8"));
    assert.ok([TRANSACTION_HASH, otherHash].includes(saved.transactionHash));
    assert.equal(saved.state, "submitted");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a second controller process cannot mutate the first controller's journal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pirateship-mainnet-two-controllers-"));
  const fileUrl = pathToFileURL(join(directory, "attempt.json"));
  const first = createFileAttemptJournal(fileUrl);
  const second = createFileAttemptJournal(fileUrl);
  try {
    await Promise.all([first.ensureClear(), second.ensureClear()]);
    await first.start({ fingerprint: "0xfingerprint", startedAt: "2026-07-21T00:00:00Z" });
    await assert.rejects(
      second.start({ fingerprint: "0xsecond", startedAt: "2026-07-21T00:00:01Z" }),
      (error) => error.code === "EEXIST",
    );
    await assert.rejects(second.recordTransactionHash(TRANSACTION_HASH), /Only the controller/);
    await first.recordTransactionHash(TRANSACTION_HASH);
    await assert.rejects(
      second.verifyTransaction(TRANSACTION_HASH, async () => ({})),
      /Only the controller/,
    );
    const saved = JSON.parse(await readFile(fileUrl, "utf8"));
    assert.equal(saved.transactionHash, TRANSACTION_HASH);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("localhost controller serves hardened assets and journals verification", async () => {
  const config = deploymentConfig();
  const directory = await mkdtemp(join(tmpdir(), "pirateship-mainnet-controller-"));
  const attemptJournal = createFileAttemptJournal(pathToFileURL(join(directory, "attempt.json")));
  const server = await startLocalDeploymentServer({
    deploymentConfig: config,
    port: 0,
    verificationProvider: independentProvider(config),
    attemptJournal,
  });
  const port = server.address().port;
  const host = new URL(server.deploymentUrl).host;
  const local = (path, options = {}) => requestLocal({ port, host, path, ...options });
  try {
    assert.match(server.deploymentUrl, /^http:\/\/[0-9a-f]{32}\.localhost:\d+\/$/);
    const page = await local("/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(await page.text(), /Sign only the deployment you reviewed/);
    assert.equal((await local("/mainnet-deploy.js")).status, 200);

    const browserConfig = await (await local("/deployment.json")).json();
    assert.equal(browserConfig.deploymentInitcode, DEPLOYMENT_INITCODE);
    assert.match(browserConfig.attemptToken, /^[0-9a-f]{64}$/);
    const headers = {
      "Content-Type": "application/json",
      "X-Deployment-Token": browserConfig.attemptToken,
    };
    assert.equal((await local("/attempt/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: config.deploymentInitcodeKeccak256 }),
    })).status, 403);
    assert.equal((await local("/attempt/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ fingerprint: "0xwrong" }),
    })).status, 400);
    assert.equal((await local("/attempt/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ fingerprint: config.deploymentInitcodeKeccak256 }),
    })).status, 200);
    assert.equal((await local("/attempt/hash", {
      method: "POST",
      headers,
      body: JSON.stringify({ transactionHash: "0x1234" }),
    })).status, 400);
    assert.equal((await local("/attempt/hash", {
      method: "POST",
      headers,
      body: JSON.stringify({ transactionHash: TRANSACTION_HASH }),
    })).status, 200);
    assert.equal((await local("/attempt/hash", {
      method: "POST",
      headers,
      body: JSON.stringify({ transactionHash: `0x${"cd".repeat(32)}` }),
    })).status, 409);
    assert.equal((await local("/verify", {
      method: "POST",
      headers,
      body: JSON.stringify({ transactionHash: `0x${"cd".repeat(32)}` }),
    })).status, 409);
    const verified = await local("/verify", {
      method: "POST",
      headers,
      body: JSON.stringify({ transactionHash: TRANSACTION_HASH }),
    });
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).contractAddress, CONTRACT);
    assert.equal((await local("/attempt/rejected", {
      method: "POST",
      headers,
      body: "{}",
    })).status, 404);
    assert.equal((await local("/missing")).status, 404);
    assert.equal((await local("/", { method: "PUT" })).status, 405);
    assert.equal((await local("/", { method: "HEAD" })).status, 200);
    assert.equal(
      (await requestLocal({
        port,
        path: "/deployment.json",
        host: `attacker.example:${port}`,
      })).status,
      403,
    );
    const durable = JSON.parse(await readFile(pathToFileURL(join(directory, "attempt.json")), "utf8"));
    assert.equal(durable.state, "mined-and-verified");
    assert.equal(durable.transactionHash, TRANSACTION_HASH);
    assert.equal(durable.contractAddress, CONTRACT);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("localhost controller does not expose independent RPC errors", async () => {
  const config = deploymentConfig();
  const secret = "sensitive-rpc-error-marker-do-not-expose";
  const server = await startLocalDeploymentServer({
    deploymentConfig: config,
    verificationProvider: {
      getNetwork: async () => { throw new Error(secret); },
    },
    attemptJournal: {
      ensureClear: async () => {},
      start: async () => {},
      recordTransactionHash: async () => {},
      verifyTransaction: async (_transactionHash, verifier) => verifier(),
    },
  });
  const port = server.address().port;
  const host = new URL(server.deploymentUrl).host;
  try {
    const browserConfig = await (await requestLocal({
      port,
      host,
      path: "/deployment.json",
    })).json();
    const response = await requestLocal({
      port,
      host,
      path: "/verify",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Deployment-Token": browserConfig.attemptToken,
      },
      body: JSON.stringify({ transactionHash: TRANSACTION_HASH }),
    });
    assert.equal(response.status, 409);
    const body = await response.text();
    assert.doesNotMatch(body, /sensitive-rpc-error-marker/);
    assert.match(body, /refused/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  await assert.rejects(
    startLocalDeploymentServer({
      deploymentConfig: config,
      port: 80,
      verificationProvider: independentProvider(config),
      attemptJournal: { ensureClear: async () => {} },
    }),
    /port must be zero/,
  );
  await assert.rejects(
    startLocalDeploymentServer({
      deploymentConfig: config,
      verificationProvider: independentProvider(config),
      attemptJournal: { ensureClear: async () => { throw new Error("prior attempt"); } },
    }),
    /prior attempt/,
  );
});
