import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../../escrow.js", import.meta.url), "utf8");
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x2222222222222222222222222222222222222222";
const MINIMUM = 10_000_000_000_000_000n;

function abiWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function abiString(value) {
  const payload = Buffer.from(value, "utf8").toString("hex");
  return `0x${abiWord(32)}${abiWord(Buffer.byteLength(value))}${payload.padEnd(Math.ceil(payload.length / 64) * 64, "0")}`;
}

class FakeElement {
  constructor({ text = "", value = "" } = {}) {
    this.textContent = text;
    this.value = value;
    this.placeholder = "";
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      toggle: (name, enabled) => {
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  dispatch(name, event = {}) {
    return this.listeners.get(name)?.({ preventDefault() {}, target: this, ...event });
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function createElements() {
  const ids = [
    "preorder", "escrow-contract-link", "escrow-copy-address", "escrow-configuration",
    "escrow-phase", "escrow-deadline", "escrow-countdown", "escrow-minimum",
    "escrow-total", "escrow-approved", "escrow-proof", "escrow-proof-link",
    "escrow-connect", "escrow-wallet", "escrow-supporter-amount",
    "escrow-supporter-decision", "escrow-pledge-form", "escrow-amount-field",
    "escrow-amount", "escrow-amount-helper", "escrow-pledge", "escrow-approve",
    "escrow-refund", "escrow-owner-panel", "escrow-release-field",
    "escrow-release-proof", "escrow-release-helper", "escrow-release",
    "escrow-key-panel", "escrow-key", "escrow-key-result", "escrow-key-value",
    "escrow-copy-key", "escrow-status",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  Object.assign(elements["escrow-connect"], { textContent: "Connect wallet" });
  Object.assign(elements["escrow-pledge"], { textContent: "Pre-order" });
  Object.assign(elements["escrow-approve"], { textContent: "Approve product" });
  Object.assign(elements["escrow-refund"], { textContent: "Claim refund" });
  Object.assign(elements["escrow-release"], { textContent: "Record test release" });
  Object.assign(elements["escrow-key"], { textContent: "Get product key" });
  Object.assign(elements["escrow-copy-address"], { textContent: "Copy" });
  Object.assign(elements["escrow-copy-key"], { textContent: "Copy key" });
  elements["escrow-release-proof"].value = "https://github.com/must-aero/pirateship";

  const steps = Object.fromEntries(["pledge", "release", "decision", "resolve"].map((name) => {
    const state = new FakeElement();
    const item = new FakeElement();
    item.querySelector = (selector) => selector === ".escrow-step-state" ? state : null;
    return [name, { item, state }];
  }));
  elements["escrow-workflow"] = new FakeElement();
  elements["escrow-workflow"].querySelector = (selector) => {
    const name = selector.match(/data-step="([^"]+)"/)?.[1];
    return steps[name]?.item ?? null;
  };
  return { elements, steps };
}

function createHarness({
  withWallet = true,
  failFirstRpc = false,
  failAfterTransaction = false,
  failRefreshAfterReceipt = false,
  failSendResponseAfterBroadcast = false,
} = {}) {
  const { elements, steps } = createElements();
  const chain = {
    deadline: Math.floor(Date.now() / 1_000) + 30 * 24 * 60 * 60,
    phase: 0,
    released: false,
    proof: "",
    totalPledged: 0n,
    totalApproved: 0n,
    amount: 0n,
    approved: false,
    refunded: false,
  };
  const calls = { rpcUrls: [], wallet: [], api: [] };
  const walletListeners = new Map();
  let firstRpcFailed = false;
  let transactionSubmitted = false;

  const selectors = {
    owner: "0x8da5cb5b",
    deadline: "0x29dcb0cf",
    phase: "0xb1c9fe6e",
    productReleased: "0x68365d9b",
    productReleaseProof: "0x0e21efe8",
    totalPledged: "0x55468ba4",
    totalApproved: "0xcba09cc8",
    minimumPledge: "0x2e3dbde0",
    supporters: "0x647c75e2",
  };

  async function fetch(url, options = {}) {
    if (String(url).startsWith("http")) {
      calls.rpcUrls.push(String(url));
      if ((failAfterTransaction || failRefreshAfterReceipt) && transactionSubmitted) {
        return { ok: false, status: 429, json: async () => ({}) };
      }
      if (failFirstRpc && !firstRpcFailed) {
        firstRpcFailed = true;
        return { ok: false, status: 429, json: async () => ({}) };
      }
      const request = JSON.parse(options.body);
      const data = request.params[0].data;
      let result;
      if (data === selectors.owner) result = `0x${abiWord(ACCOUNT)}`;
      else if (data === selectors.deadline) result = `0x${abiWord(chain.deadline)}`;
      else if (data === selectors.phase) result = `0x${abiWord(chain.phase)}`;
      else if (data === selectors.productReleased) result = `0x${abiWord(chain.released ? 1 : 0)}`;
      else if (data === selectors.productReleaseProof) result = abiString(chain.proof);
      else if (data === selectors.totalPledged) result = `0x${abiWord(chain.totalPledged)}`;
      else if (data === selectors.totalApproved) result = `0x${abiWord(chain.totalApproved)}`;
      else if (data === selectors.minimumPledge) result = `0x${abiWord(MINIMUM)}`;
      else if (data.startsWith(selectors.supporters)) {
        result = `0x${abiWord(chain.amount)}${abiWord(chain.approved ? 1 : 0)}${abiWord(chain.refunded ? 1 : 0)}`;
      } else throw new Error(`Unhandled selector ${data}`);
      return { ok: true, json: async () => ({ result }) };
    }

    calls.api.push(String(url));
    if (url === "/api/auth/challenge") {
      return {
        ok: true,
        json: async () => ({
          challengeId: "0123456789abcdef0123456789abcdef0123",
          message: "Read this wallet verification challenge",
        }),
      };
    }
    if (url === "/api/keys/redeem") {
      return {
        ok: true,
        json: async () => ({ productKey: "PIRATE-AMOY-TEST", existing: false }),
      };
    }
    throw new Error(`Unhandled API URL ${url}`);
  }

  const ethereum = withWallet ? {
    on: (name, listener) => walletListeners.set(name, listener),
    request: async ({ method, params = [] }) => {
      calls.wallet.push({ method, params });
      if (method === "eth_chainId") return "0x13882";
      if (method === "eth_requestAccounts") return [ACCOUNT];
      if (method === "eth_getTransactionCount") return transactionSubmitted ? "0x1" : "0x0";
      if (method === "eth_getTransactionReceipt") {
        if (failAfterTransaction) throw new Error("wallet RPC returned 429");
        return { status: "0x1" };
      }
      if (method === "personal_sign") return "0xsigned";
      if (method === "eth_sendTransaction") {
        transactionSubmitted = true;
        const transaction = params[0];
        if (transaction.data.startsWith("0xd7bb99ba")) {
          chain.amount += BigInt(transaction.value);
          chain.totalPledged += BigInt(transaction.value);
        } else if (transaction.data.startsWith("0x63a551de")) {
          chain.released = true;
          chain.phase = 1;
          chain.proof = elements["escrow-release-proof"].value;
        } else if (transaction.data.startsWith("0x55c6755c")) {
          chain.approved = true;
          chain.totalApproved = chain.amount;
        } else if (transaction.data.startsWith("0xb5545a3c")) {
          chain.refunded = true;
        }
        if (failSendResponseAfterBroadcast) throw new Error("wallet connection closed after broadcast");
        return `0x${"a".repeat(64)}`;
      }
      throw new Error(`Unhandled wallet method ${method}`);
    },
  } : undefined;

  const document = { getElementById: (id) => elements[id] ?? null };
  const storage = new Map();
  const window = {
    PIRATE_ESCROW_CONFIG: {
      contractAddress: CONTRACT,
      chainId: "0x13882",
      chainName: "Polygon Amoy",
      nativeSymbol: "POL",
      rpcUrl: "https://rpc-one.example",
      rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
      explorerUrl: "https://amoy.polygonscan.com",
      keyApiBase: "",
    },
    ethereum,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  };

  vm.runInNewContext(source, {
    Array,
    BigInt,
    Date,
    Error,
    Intl,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    document,
    fetch,
    navigator: { clipboard: { writeText: async () => {} } },
    parseInt,
    setInterval: () => 1,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    window,
  });

  return { calls, chain, elements, steps, walletListeners, storage };
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("supporter and owner complete the mocked Amoy pledge-to-key journey", async () => {
  const page = createHarness();
  await flush();
  assert.equal(page.elements["escrow-phase"].textContent, "Funding");
  assert.equal(page.elements["escrow-minimum"].textContent, "0.01 POL");

  page.elements["escrow-connect"].dispatch("click");
  await flush();
  assert.equal(page.elements["escrow-wallet"].textContent, "0x1111…1111");
  assert.equal(page.elements["escrow-owner-panel"].hidden, false);

  page.elements["escrow-amount"].value = "0.001";
  page.elements["escrow-pledge-form"].dispatch("submit");
  await flush();
  assert.equal(page.elements["escrow-amount"].getAttribute("aria-invalid"), "true");
  assert.equal(page.calls.wallet.some(({ method }) => method === "eth_sendTransaction"), false);

  page.elements["escrow-amount"].value = "0.01";
  page.elements["escrow-pledge-form"].dispatch("submit");
  await flush();
  assert.equal(page.chain.amount, MINIMUM);
  assert.equal(page.elements["escrow-supporter-amount"].textContent, "0.01 POL");
  assert.equal(page.steps.pledge.item.dataset.status, "complete");

  page.elements["escrow-release"].dispatch("click");
  await flush();
  assert.equal(page.chain.released, true);
  assert.equal(page.elements["escrow-phase"].textContent, "Product released");
  assert.equal(page.elements["escrow-proof"].hidden, false);

  page.elements["escrow-approve"].dispatch("click");
  await flush();
  assert.equal(page.chain.approved, true);
  assert.equal(page.elements["escrow-key-panel"].hidden, false);

  page.elements["escrow-key"].dispatch("click");
  await flush();
  assert.equal(page.elements["escrow-key-result"].hidden, false);
  assert.equal(page.elements["escrow-key-value"].textContent, "PIRATE-AMOY-TEST");
  assert.deepEqual(page.calls.api, ["/api/auth/challenge", "/api/keys/redeem"]);
  assert.equal(page.calls.wallet.some(({ method }) => method === "personal_sign"), true);
});

test("RPC reads recover from a rate-limited primary endpoint", async () => {
  const page = createHarness({ failFirstRpc: true });
  await flush();
  assert.equal(page.elements["escrow-phase"].textContent, "Funding");
  assert.equal(page.calls.rpcUrls.includes("https://rpc-one.example"), true);
  assert.equal(page.calls.rpcUrls.includes("https://rpc-two.example"), true);
  assert.notEqual(page.elements["escrow-status"].dataset.state, "error");
});

test("a missing wallet and an invalid release URL fail safely without transactions", async () => {
  const noWallet = createHarness({ withWallet: false });
  await flush();
  noWallet.elements["escrow-connect"].dispatch("click");
  await flush();
  assert.equal(noWallet.elements["escrow-status"].dataset.state, "error");
  assert.match(noWallet.elements["escrow-status"].textContent, /No Polygon-compatible wallet/);

  const owner = createHarness();
  await flush();
  owner.elements["escrow-connect"].dispatch("click");
  await flush();
  owner.elements["escrow-release-proof"].value = "http://not-secure.example/release";
  owner.elements["escrow-release"].dispatch("click");
  await flush();
  assert.equal(owner.elements["escrow-release-proof"].getAttribute("aria-invalid"), "true");
  assert.equal(owner.chain.released, false);
});

test("an ambiguous post-submission failure blocks a duplicate paid pledge", async () => {
  const page = createHarness({ failAfterTransaction: true });
  await flush();
  page.elements["escrow-connect"].dispatch("click");
  await flush();
  page.elements["escrow-amount"].value = "0.01";
  page.elements["escrow-pledge-form"].dispatch("submit");
  await flush();

  const sends = page.calls.wallet.filter(({ method }) => method === "eth_sendTransaction");
  assert.equal(sends.length, 1);
  assert.equal(page.chain.amount, MINIMUM, "the submitted transaction may already be mined");
  assert.equal(page.elements["escrow-pledge"].disabled, true);
  assert.equal(page.elements["escrow-pledge"].textContent, "Check Polygonscan");
  assert.match(page.elements["escrow-status"].textContent, /Do not submit it again/);
});

test("an interrupted send response is persisted and blocks a duplicate pledge", async () => {
  const page = createHarness({
    failAfterTransaction: true,
    failSendResponseAfterBroadcast: true,
  });
  await flush();
  page.elements["escrow-connect"].dispatch("click");
  await flush();
  page.elements["escrow-amount"].value = "0.01";
  page.elements["escrow-pledge-form"].dispatch("submit");
  await flush();

  assert.equal(
    page.calls.wallet.filter(({ method }) => method === "eth_sendTransaction").length,
    1,
  );
  assert.equal(page.elements["escrow-pledge"].disabled, true);
  assert.equal(page.elements["escrow-pledge"].textContent, "Check wallet");
  assert.match(page.elements["escrow-status"].textContent, /Do not submit it again/);
  assert.match(page.storage.get("pirate-escrow-pending-v1"), /"action":"pledge"/);
});

test("a confirmed transaction with a failed state refresh remains locked", async () => {
  const page = createHarness({ failRefreshAfterReceipt: true });
  await flush();
  page.elements["escrow-connect"].dispatch("click");
  await flush();
  page.elements["escrow-amount"].value = "0.01";
  page.elements["escrow-pledge-form"].dispatch("submit");
  await flush();

  assert.equal(
    page.calls.wallet.filter(({ method }) => method === "eth_sendTransaction").length,
    1,
  );
  assert.equal(page.elements["escrow-pledge"].disabled, true);
  assert.equal(page.elements["escrow-pledge"].textContent, "Confirmed");
  assert.match(page.elements["escrow-status"].textContent, /confirmed.*Do not submit it again/i);
});
