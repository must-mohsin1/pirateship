(function () {
  "use strict";

  var root = document.getElementById("preorder");
  if (!root) return;

  var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  var PENDING_STORAGE_SLOT = "pirate-escrow-pending-v1";
  var SELECTORS = {
    owner: "0x8da5cb5b",
    deadline: "0x29dcb0cf",
    minimumPledge: "0x2e3dbde0",
    phase: "0xb1c9fe6e",
    productReleased: "0x68365d9b",
    productReleaseProof: "0x0e21efe8",
    totalPledged: "0x55468ba4",
    totalApproved: "0xcba09cc8",
    supporters: "0x647c75e2",
    markProductReleased: "0x63a551de",
    contribute: "0xd7bb99ba",
    approveProduct: "0x55c6755c",
    claimRefund: "0xb5545a3c"
  };
  var defaults = {
    contractAddress: "",
    chainId: "0x89",
    chainName: "Polygon Mainnet",
    nativeSymbol: "POL",
    rpcUrls: ["https://polygon.drpc.org"],
    explorerUrl: "https://polygonscan.com",
    keyApiBase: ""
  };
  var config = Object.assign({}, defaults, window.PIRATE_ESCROW_CONFIG || {});
  var rpcUrls = Array.isArray(config.rpcUrls)
    ? config.rpcUrls.filter(function (url) { return typeof url === "string" && url.length > 0; })
    : [];
  if (!rpcUrls.length) rpcUrls = defaults.rpcUrls.slice();
  var configured = /^0x[0-9a-fA-F]{40}$/.test(config.contractAddress) &&
    config.contractAddress.toLowerCase() !== ZERO_ADDRESS;
  var rpcId = 1;
  var rpcUrlIndex = 0;

  function byId(id) { return document.getElementById(id); }
  var elements = {
    contractLink: byId("escrow-contract-link"),
    copyAddress: byId("escrow-copy-address"),
    configuration: byId("escrow-configuration"),
    phase: byId("escrow-phase"),
    deadline: byId("escrow-deadline"),
    countdown: byId("escrow-countdown"),
    minimum: byId("escrow-minimum"),
    total: byId("escrow-total"),
    approved: byId("escrow-approved"),
    proof: byId("escrow-proof"),
    proofLink: byId("escrow-proof-link"),
    workflow: byId("escrow-workflow"),
    connect: byId("escrow-connect"),
    wallet: byId("escrow-wallet"),
    supporterAmount: byId("escrow-supporter-amount"),
    supporterDecision: byId("escrow-supporter-decision"),
    pledgeForm: byId("escrow-pledge-form"),
    amountField: byId("escrow-amount-field"),
    amountInput: byId("escrow-amount"),
    amountHelper: byId("escrow-amount-helper"),
    pledge: byId("escrow-pledge"),
    approve: byId("escrow-approve"),
    refund: byId("escrow-refund"),
    ownerPanel: byId("escrow-owner-panel"),
    releaseField: byId("escrow-release-field"),
    releaseProof: byId("escrow-release-proof"),
    releaseHelper: byId("escrow-release-helper"),
    release: byId("escrow-release"),
    keyPanel: byId("escrow-key-panel"),
    key: byId("escrow-key"),
    keyResult: byId("escrow-key-result"),
    keyValue: byId("escrow-key-value"),
    copyKey: byId("escrow-copy-key"),
    status: byId("escrow-status")
  };

  var state = {
    account: null,
    busy: false,
    pendingTransaction: null,
    keyOwner: null,
    amountTouched: false,
    campaign: {
      owner: ZERO_ADDRESS,
      deadline: 0,
      minimumPledge: config.chainId.toLowerCase() === "0x13882"
        ? 10000000000000000n
        : 250000000000000000000n,
      phase: null,
      productReleased: false,
      proof: "",
      totalPledged: 0n,
      totalApproved: 0n
    },
    supporter: {
      amount: 0n,
      approved: false,
      refunded: false
    }
  };

  function pendingButton(action) {
    return action === "pledge"
      ? elements.pledge
      : action === "approve"
        ? elements.approve
        : action === "refund"
          ? elements.refund
          : elements.release;
  }

  function savePendingTransaction(pending) {
    state.pendingTransaction = pending;
    try {
      window.localStorage.setItem(PENDING_STORAGE_SLOT, JSON.stringify(pending));
    } catch (_) {}
  }

  function clearPendingTransaction() {
    state.pendingTransaction = null;
    try {
      window.localStorage.removeItem(PENDING_STORAGE_SLOT);
    } catch (_) {}
  }

  function restorePendingTransaction() {
    if (!state.account) return;
    try {
      var pending = JSON.parse(window.localStorage.getItem(PENDING_STORAGE_SLOT) || "null");
      if (
        pending &&
        pending.account &&
        pending.account.toLowerCase() === state.account.toLowerCase() &&
        pending.contractAddress === config.contractAddress.toLowerCase() &&
        pending.chainId === config.chainId.toLowerCase()
      ) {
        state.pendingTransaction = pending;
      }
    } catch (_) {}
  }

  function pendingIsConfirmed(pending) {
    if (!pending) return false;
    if (pending.action === "pledge") {
      return state.supporter.amount >= BigInt(pending.expectedAmount || "0");
    }
    if (pending.action === "approve") return state.supporter.approved;
    if (pending.action === "refund") return state.supporter.refunded;
    if (pending.action === "release") return state.campaign.productReleased;
    return false;
  }

  function pendingRecord(options, extra) {
    return Object.assign({
      account: state.account,
      action: options.action,
      expectedAmount: options.expectedAmount || null,
      contractAddress: config.contractAddress.toLowerCase(),
      chainId: config.chainId.toLowerCase(),
      createdAt: Date.now()
    }, extra || {});
  }

  function shortAddress(address) {
    return address.slice(0, 6) + "…" + address.slice(-4);
  }

  function toQuantity(value) {
    return "0x" + value.toString(16);
  }

  function parsePol(value) {
    var normalized = String(value || "").trim();
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{0,18})?$/.test(normalized)) {
      throw new Error("Enter a POL amount with no more than 18 decimal places.");
    }
    var parts = normalized.split(".");
    var whole = BigInt(parts[0]);
    var fraction = (parts[1] || "").padEnd(18, "0");
    var amount = (whole * 1000000000000000000n) + BigInt(fraction || "0");
    if (amount <= 0n) throw new Error("Enter a POL amount greater than zero.");
    return amount;
  }

  function formatPol(value) {
    var whole = value / 1000000000000000000n;
    var fraction = (value % 1000000000000000000n).toString().padStart(18, "0");
    var shortFraction = fraction.slice(0, 4).replace(/0+$/, "");
    var display = Number(whole).toLocaleString();
    if (shortFraction) display += "." + shortFraction;
    return display + " " + config.nativeSymbol;
  }

  function word(data, index) {
    var hex = String(data || "0x").slice(2);
    var chunk = hex.slice(index * 64, (index + 1) * 64) || "0";
    return BigInt("0x" + chunk);
  }

  function decodeString(data) {
    try {
      var hex = String(data || "0x").slice(2);
      var offset = Number(word(data, 0)) * 2;
      var lengthHex = hex.slice(offset, offset + 64);
      var length = Number(BigInt("0x" + lengthHex));
      var payload = hex.slice(offset + 64, offset + 64 + (length * 2));
      var bytes = new Uint8Array(payload.match(/.{1,2}/g).map(function (byte) {
        return parseInt(byte, 16);
      }));
      return new TextDecoder().decode(bytes);
    } catch (_) {
      return "";
    }
  }

  function decodeAddress(data) {
    var hex = String(data || "0x").replace(/^0x/, "");
    if (hex.length < 40) return ZERO_ADDRESS;
    return "0x" + hex.slice(-40);
  }

  function encodeStringArgument(value) {
    var bytes = new TextEncoder().encode(value);
    var payload = Array.from(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
    var paddedLength = Math.ceil(payload.length / 64) * 64;
    return 32n.toString(16).padStart(64, "0") +
      BigInt(bytes.length).toString(16).padStart(64, "0") +
      payload.padEnd(paddedLength, "0");
  }

  async function rpc(method, params) {
    var lastError;
    for (var attempt = 0; attempt < rpcUrls.length; attempt += 1) {
      var index = (rpcUrlIndex + attempt) % rpcUrls.length;
      try {
        var response = await fetch(rpcUrls[index], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: method, params: params })
        });
        if (!response.ok) throw new Error("Polygon RPC returned " + response.status + ".");
        var body = await response.json();
        if (body.error) throw new Error(body.error.message || "Polygon RPC request failed.");
        rpcUrlIndex = index;
        return body.result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Polygon RPC request failed.");
  }

  function call(data) {
    return rpc("eth_call", [{ to: config.contractAddress, data: data }, "latest"]);
  }

  function addressArgument(address) {
    return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  function currentPhase() {
    if (state.campaign.deadline && Date.now() >= state.campaign.deadline * 1000) return 2;
    return state.campaign.phase;
  }

  function setStatus(message, tone) {
    elements.status.textContent = message;
    elements.status.dataset.state = tone || "default";
  }

  function setButton(button, status, label) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent.trim();
    button.dataset.state = status || "default";
    button.setAttribute("aria-busy", status === "loading" ? "true" : "false");
    button.textContent = label || button.dataset.idleLabel;
  }

  function friendlyError(error) {
    var message = String(error && (error.shortMessage || error.reason || error.message) || "");
    if (error && (error.code === 4001 || error.code === "ACTION_REJECTED") || /denied|rejected/i.test(message)) {
      return "The wallet request was declined. Review it and try again when ready.";
    }
    if (/insufficient funds/i.test(message)) {
      return "This wallet needs more POL for the pre-order and Polygon network fee.";
    }
    if (/No Polygon-compatible wallet/i.test(message)) return message;
    if (/minimum|below/i.test(message)) {
      return "The first pre-order must meet the contract’s minimum pledge.";
    }
    if (/contract owner/i.test(message)) return "Only the contract owner can record release evidence.";
    if (/release evidence|HTTPS URL/i.test(message)) return message;
    if (/POL amount|greater than zero/i.test(message)) return message;
    if (/RPC|fetch|network/i.test(message)) {
      return "Polygon could not be reached. Check the network connection and try again.";
    }
    return "The action did not complete. Check the campaign state in your wallet, then try again.";
  }

  function renderCountdown() {
    if (!state.campaign.deadline) {
      elements.countdown.textContent = configured ? "Loading…" : "Starts after deployment";
      return;
    }
    var remaining = Math.max(0, (state.campaign.deadline * 1000) - Date.now());
    if (!remaining) {
      elements.countdown.textContent = "Refund window open";
      render();
      return;
    }
    var seconds = Math.floor(remaining / 1000);
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    elements.countdown.textContent = days + "d " + hours + "h " + minutes + "m";
  }

  function renderWorkflow() {
    var phase = currentPhase();
    var released = state.campaign.productReleased;
    var supporter = state.supporter;
    var steps = {
      pledge: supporter.amount > 0n ? ["complete", "Recorded"] : phase === 0 ? ["current", "Open"] : ["closed", "Closed"],
      release: released ? ["complete", "Published"] : phase === 2 ? ["closed", "Missed"] : ["waiting", "Waiting"],
      decision: supporter.approved ? ["complete", "Approved"] : supporter.refunded ? ["complete", "Refunded"] : phase === 1 && supporter.amount > 0n ? ["current", "Your choice"] : ["waiting", "Waiting"],
      resolve: supporter.approved ? ["complete", "Key eligible"] : supporter.refunded ? ["complete", "Returned"] : phase === 2 && supporter.amount > 0n ? ["current", "Refund ready"] : ["waiting", "Waiting"]
    };
    Object.keys(steps).forEach(function (name) {
      var item = elements.workflow.querySelector('[data-step="' + name + '"]');
      if (!item) return;
      item.dataset.status = steps[name][0];
      item.querySelector(".escrow-step-state").textContent = steps[name][1];
    });
  }

  function render() {
    var phase = currentPhase();
    var phaseLabels = ["Funding", "Product released", "Refunds open"];
    elements.phase.textContent = phaseLabels[phase] || (configured ? "Loading…" : "Deployment pending");
    elements.phase.dataset.phase = phase === 0 ? "funding" : phase === 1 ? "released" : phase === 2 ? "refunds" : "pending";
    elements.minimum.textContent = formatPol(state.campaign.minimumPledge);

    if (state.campaign.deadline) {
      elements.deadline.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(state.campaign.deadline * 1000));
      elements.total.textContent = formatPol(state.campaign.totalPledged);
      elements.approved.textContent = formatPol(state.campaign.totalApproved);
    }

    elements.wallet.textContent = state.account ? shortAddress(state.account) : "Not connected";
    elements.supporterAmount.textContent = formatPol(state.supporter.amount);
    elements.supporterDecision.textContent = state.supporter.refunded
      ? "Refunded"
      : state.supporter.approved
        ? "Product approved"
        : state.supporter.amount > 0n
          ? "Awaiting your decision"
          : "No pre-order found";
    elements.connect.textContent = state.account ? shortAddress(state.account) : "Connect wallet";
    elements.connect.dataset.connected = state.account ? "true" : "false";

    var transactionBlocked = state.busy || Boolean(
      state.pendingTransaction &&
      state.pendingTransaction.account.toLowerCase() === String(state.account || "").toLowerCase()
    );
    var canPledge = configured && state.account && phase === 0 && !transactionBlocked;
    var canApprove = configured && state.account && phase === 1 &&
      state.supporter.amount >= state.campaign.minimumPledge &&
      !state.supporter.approved && !state.supporter.refunded && !transactionBlocked;
    var canRefund = configured && state.account && phase === 2 && state.supporter.amount > 0n &&
      !state.supporter.approved && !state.supporter.refunded && !transactionBlocked;
    var isOwner = configured && state.account && state.campaign.owner !== ZERO_ADDRESS &&
      state.account.toLowerCase() === state.campaign.owner.toLowerCase();
    var canRelease = isOwner && phase === 0 && !state.campaign.productReleased && !transactionBlocked;
    var canGetKey = configured && state.account && state.supporter.approved && !transactionBlocked;

    if (!state.account || !state.keyOwner || state.keyOwner.toLowerCase() !== state.account.toLowerCase()) {
      elements.keyResult.hidden = true;
      elements.keyValue.textContent = "";
    }
    elements.ownerPanel.hidden = !(isOwner && phase === 0 && !state.campaign.productReleased);
    elements.keyPanel.hidden = !(configured && state.account && state.supporter.approved);

    elements.amountInput.disabled = !canPledge;
    elements.pledge.disabled = !canPledge;
    elements.approve.disabled = !canApprove;
    elements.refund.disabled = !canRefund;
    elements.releaseProof.disabled = !canRelease;
    elements.release.disabled = !canRelease;
    elements.key.disabled = !canGetKey;
    renderWorkflow();
  }

  async function loadCampaign() {
    if (!configured) return;
    var reads = await Promise.all([
      call(SELECTORS.owner),
      call(SELECTORS.deadline),
      call(SELECTORS.phase),
      call(SELECTORS.productReleased),
      call(SELECTORS.productReleaseProof),
      call(SELECTORS.totalPledged),
      call(SELECTORS.totalApproved),
      call(SELECTORS.minimumPledge)
    ]);
    state.campaign = {
      owner: decodeAddress(reads[0]),
      deadline: Number(word(reads[1], 0)),
      phase: Number(word(reads[2], 0)),
      productReleased: word(reads[3], 0) !== 0n,
      proof: decodeString(reads[4]),
      totalPledged: word(reads[5], 0),
      totalApproved: word(reads[6], 0),
      minimumPledge: word(reads[7], 0)
    };

    if (state.account) {
      var record = await call(SELECTORS.supporters + addressArgument(state.account));
      state.supporter = {
        amount: word(record, 0),
        approved: word(record, 1) !== 0n,
        refunded: word(record, 2) !== 0n
      };
    } else {
      state.supporter = { amount: 0n, approved: false, refunded: false };
    }

    if (state.campaign.proof) {
      elements.proof.hidden = false;
      elements.proofLink.textContent = "View release evidence";
      try {
        var proofUrl = new URL(state.campaign.proof);
        if (proofUrl.protocol === "https:" || proofUrl.protocol === "http:") {
          elements.proofLink.href = proofUrl.href;
          elements.proofLink.target = "_blank";
          elements.proofLink.rel = "noreferrer";
        }
      } catch (_) {
        elements.proofLink.removeAttribute("href");
        elements.proofLink.textContent = state.campaign.proof;
      }
    }
    renderCountdown();
    if (!state.amountTouched) {
      elements.amountInput.placeholder = formatPol(state.campaign.minimumPledge).replace(" " + config.nativeSymbol, "");
      elements.amountHelper.textContent = "The first pre-order requires at least " + formatPol(state.campaign.minimumPledge) + ". New pledges close at release or the deadline.";
    }
    render();
  }

  async function switchToPolygon() {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: config.chainId }]
      });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: config.chainId,
          chainName: config.chainName,
          nativeCurrency: { name: "POL", symbol: config.nativeSymbol, decimals: 18 },
          rpcUrls: [rpcUrls[0]],
          blockExplorerUrls: [config.explorerUrl]
        }]
      });
    }
  }

  async function connectWallet() {
    if (!window.ethereum) throw new Error("No Polygon-compatible wallet was detected. Install or open one, then try again.");
    setButton(elements.connect, "loading", "Opening wallet");
    elements.connect.disabled = true;
    try {
      var chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (String(chainId).toLowerCase() !== config.chainId.toLowerCase()) await switchToPolygon();
      var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      state.account = accounts[0] || null;
      restorePendingTransaction();
      setStatus("Wallet connected on " + config.chainName + ".", "success");
      await loadCampaign();
      if (state.pendingTransaction) {
        if (pendingIsConfirmed(state.pendingTransaction)) {
          clearPendingTransaction();
          setStatus("Your previously submitted transaction is confirmed.", "success");
        } else {
          setButton(pendingButton(state.pendingTransaction.action), "error", "Check wallet");
          setStatus(
            "A previous transaction may still be pending. Do not submit it again. Check this wallet’s Polygon activity, then reconnect after it resolves.",
            "error"
          );
        }
      }
    } finally {
      elements.connect.disabled = false;
      setButton(elements.connect, "default");
      render();
    }
  }

  async function ensureWallet() {
    if (state.account) return true;
    try {
      await connectWallet();
      return Boolean(state.account);
    } catch (error) {
      setStatus(friendlyError(error), "error");
      return false;
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function waitForReceipt(hash) {
    for (var attempt = 0; attempt < 150; attempt += 1) {
      var receipt = await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [hash]
      });
      if (receipt) {
        if (receipt.status === "0x0") throw new Error("The Polygon transaction reverted.");
        return receipt;
      }
      await delay(1200);
    }
    throw new Error("Polygon confirmation is taking longer than expected. Check the transaction in Polygonscan.");
  }

  function isExplicitlyUnsubmitted(error) {
    var message = String(error && (error.shortMessage || error.message) || "");
    return Boolean(
      error && (error.code === 4001 || error.code === "ACTION_REJECTED") ||
      /denied|rejected|insufficient funds|execution reverted|user cancelled/i.test(message)
    );
  }

  async function sendTransaction(data, value) {
    var transaction = { from: state.account, to: config.contractAddress, data: data };
    if (typeof value === "bigint") transaction.value = toQuantity(value);
    var nonce = null;
    try {
      nonce = await window.ethereum.request({
        method: "eth_getTransactionCount",
        params: [state.account, "pending"]
      });
    } catch (_) {}
    var hash;
    try {
      hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [transaction]
      });
    } catch (error) {
      if (!isExplicitlyUnsubmitted(error)) {
        error.submissionAmbiguous = true;
        error.transactionNonce = nonce;
      }
      throw error;
    }
    setStatus("Transaction submitted. Waiting for Polygon confirmation.", "default");
    try {
      await waitForReceipt(hash);
    } catch (error) {
      if (!/transaction reverted/i.test(String(error && error.message || ""))) {
        error.transactionHash = hash;
      }
      throw error;
    }
    return hash;
  }

  async function runTransaction(options) {
    if (!(await ensureWallet())) return;
    state.busy = true;
    setButton(options.button, "loading", options.pendingLabel);
    render();
    try {
      var confirmedHash = await options.send();
      setButton(options.button, "success", "Confirmed");
      setStatus(options.successMessage, "success");
      try {
        await loadCampaign();
        clearPendingTransaction();
      } catch (_) {
        savePendingTransaction(pendingRecord(options, { hash: confirmedHash, confirmed: true }));
        setStatus(
          "The transaction is confirmed, but the page could not refresh its Polygon state. Do not submit it again. Reload after the RPC connection recovers.",
          "error"
        );
      }
    } catch (error) {
      if (error.transactionHash || error.submissionAmbiguous) {
        savePendingTransaction(pendingRecord(options, {
          hash: error.transactionHash || null,
          nonce: error.transactionNonce || null
        }));
        try {
          await loadCampaign();
          if (options.isConfirmed && options.isConfirmed()) {
            clearPendingTransaction();
            setButton(options.button, "success", "Confirmed");
            setStatus(options.successMessage, "success");
          }
        } catch (_) {}
        if (state.pendingTransaction) {
          if (error.transactionHash) {
            setButton(options.button, "error", "Check Polygonscan");
            setStatus(
              "The transaction was submitted, but confirmation could not be verified. Do not submit it again. Check transaction " +
                shortAddress(error.transactionHash) + " in Polygonscan, then reload this page after it resolves.",
              "error"
            );
          } else {
            setButton(options.button, "error", "Check wallet");
            setStatus(
              "The wallet response was interrupted after submission may have started. Do not submit it again. Check this wallet’s Polygon activity, then reconnect after it resolves.",
              "error"
            );
          }
        }
      } else {
        setButton(options.button, "error", "Try again");
        setStatus(friendlyError(error), "error");
      }
    } finally {
      state.busy = false;
      render();
      setTimeout(function () {
        if (!state.pendingTransaction) setButton(options.button, "default");
        render();
      }, 2500);
    }
  }

  function validateAmount() {
    try {
      var amount = parsePol(elements.amountInput.value);
      if (state.supporter.amount === 0n && amount < state.campaign.minimumPledge) {
        throw new Error("Enter at least " + formatPol(state.campaign.minimumPledge) + " for the first pre-order.");
      }
      elements.amountField.dataset.state = "success";
      elements.amountInput.setAttribute("aria-invalid", "false");
      elements.amountHelper.textContent = "Your wallet will show the pre-order and Polygon network fee separately.";
      return true;
    } catch (error) {
      elements.amountField.dataset.state = "error";
      elements.amountInput.setAttribute("aria-invalid", "true");
      elements.amountHelper.textContent = error.message;
      return false;
    }
  }

  function validateReleaseProof() {
    var value = elements.releaseProof.value.trim();
    try {
      var url = new URL(value);
      if (url.protocol !== "https:") throw new Error();
      if (value.length > 2048) throw new Error();
      elements.releaseField.dataset.state = "success";
      elements.releaseProof.setAttribute("aria-invalid", "false");
      elements.releaseHelper.textContent = "Trust Wallet will ask the owner to record this URL permanently and close funding.";
      return url.href;
    } catch (_) {
      elements.releaseField.dataset.state = "error";
      elements.releaseProof.setAttribute("aria-invalid", "true");
      elements.releaseHelper.textContent = "Enter a public HTTPS URL for the released product or its launch evidence.";
      return "";
    }
  }

  async function fetchJson(path, options) {
    var base = String(config.keyApiBase || "").replace(/\/$/, "");
    var response = await fetch(base + path, options);
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || "The product-key service rejected the request.");
    return body;
  }

  async function retrieveKey() {
    if (!(await ensureWallet())) return;
    state.busy = true;
    setButton(elements.key, "loading", "Verify wallet");
    render();
    try {
      var challenge = await fetchJson("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: state.account })
      });
      var signature;
      try {
        signature = await window.ethereum.request({
          method: "personal_sign",
          params: [challenge.message, state.account]
        });
      } catch (firstError) {
        if (firstError.code === 4001) throw firstError;
        signature = await window.ethereum.request({
          method: "personal_sign",
          params: [state.account, challenge.message]
        });
      }
      var result = await fetchJson("/api/keys/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          address: state.account,
          signature: signature
        })
      });
      elements.keyValue.textContent = result.productKey;
      state.keyOwner = state.account;
      elements.keyResult.hidden = false;
      setButton(elements.key, "success", "Key verified");
      setStatus(result.existing ? "Your existing product key was restored." : "A product key was assigned to this approved wallet.", "success");
    } catch (error) {
      setButton(elements.key, "error", "Try again");
      setStatus(friendlyError(error), "error");
    } finally {
      state.busy = false;
      render();
      setTimeout(function () {
        setButton(elements.key, "default");
        render();
      }, 2500);
    }
  }

  async function copyText(button, value) {
    try {
      await navigator.clipboard.writeText(value);
      var previous = button.textContent;
      button.textContent = "Copied";
      button.dataset.state = "success";
      setTimeout(function () {
        button.textContent = previous;
        button.dataset.state = "default";
      }, 2500);
    } catch (_) {
      setStatus("Clipboard access was blocked. Select and copy the value manually.", "error");
    }
  }

  function setupConfiguration() {
    if (!configured) {
      elements.contractLink.textContent = "Address pending";
      elements.configuration.textContent = "The contract is ready for Polygon mainnet. Add its deployed address in escrow-config.js to open pre-orders.";
      return;
    }
    elements.contractLink.textContent = shortAddress(config.contractAddress);
    elements.contractLink.href = config.explorerUrl.replace(/\/$/, "") + "/address/" + config.contractAddress;
    elements.contractLink.target = "_blank";
    elements.contractLink.rel = "noreferrer";
    elements.copyAddress.disabled = false;
    elements.configuration.textContent = config.chainName + " · chain ID " +
      parseInt(config.chainId, 16) + " · native token " + config.nativeSymbol;
  }

  elements.connect.addEventListener("click", function () {
    connectWallet().catch(function (error) {
      setButton(elements.connect, "error", "Try again");
      setStatus(friendlyError(error), "error");
      setTimeout(function () { setButton(elements.connect, "default"); render(); }, 2500);
    });
  });
  elements.amountInput.addEventListener("blur", function () {
    state.amountTouched = true;
    validateAmount();
  });
  elements.amountInput.addEventListener("input", function () {
    if (state.amountTouched) validateAmount();
  });
  elements.pledgeForm.addEventListener("submit", function (event) {
    event.preventDefault();
    state.amountTouched = true;
    if (!validateAmount()) return;
    var amount = parsePol(elements.amountInput.value);
    var expectedAmount = state.supporter.amount + amount;
    runTransaction({
      action: "pledge",
      expectedAmount: expectedAmount.toString(),
      button: elements.pledge,
      pendingLabel: "Confirm pre-order",
      successMessage: "Your pre-order is recorded. It stays refundable unless this wallet approves the release.",
      send: function () { return sendTransaction(SELECTORS.contribute, amount); },
      isConfirmed: function () { return state.supporter.amount >= expectedAmount; }
    });
  });
  elements.approve.addEventListener("click", function () {
    runTransaction({
      action: "approve",
      button: elements.approve,
      pendingLabel: "Confirm approval",
      successMessage: "Approval is recorded. This pre-order is now product-key eligible.",
      send: function () { return sendTransaction(SELECTORS.approveProduct); },
      isConfirmed: function () { return state.supporter.approved; }
    });
  });
  elements.refund.addEventListener("click", function () {
    runTransaction({
      action: "refund",
      button: elements.refund,
      pendingLabel: "Confirm refund",
      successMessage: "The unapproved pre-order was returned to this wallet.",
      send: function () { return sendTransaction(SELECTORS.claimRefund); },
      isConfirmed: function () { return state.supporter.refunded; }
    });
  });
  elements.releaseProof.addEventListener("blur", validateReleaseProof);
  elements.release.addEventListener("click", function () {
    var proof = validateReleaseProof();
    if (!proof) return;
    runTransaction({
      action: "release",
      button: elements.release,
      pendingLabel: "Confirm release",
      successMessage: "Release evidence is recorded. Funding is closed and supporters can now approve the product.",
      send: function () {
        if (!state.account || state.account.toLowerCase() !== state.campaign.owner.toLowerCase()) {
          throw new Error("Only the contract owner can record release evidence.");
        }
        return sendTransaction(SELECTORS.markProductReleased + encodeStringArgument(proof));
      },
      isConfirmed: function () { return state.campaign.productReleased; }
    });
  });
  elements.key.addEventListener("click", retrieveKey);
  elements.copyAddress.addEventListener("click", function () {
    if (configured) copyText(elements.copyAddress, config.contractAddress);
  });
  elements.copyKey.addEventListener("click", function () {
    copyText(elements.copyKey, elements.keyValue.textContent);
  });

  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", function (accounts) {
      state.keyOwner = null;
      elements.keyResult.hidden = true;
      elements.keyValue.textContent = "";
      state.account = accounts[0] || null;
      loadCampaign().catch(function () {});
      render();
    });
    window.ethereum.on("chainChanged", function (chainId) {
      if (String(chainId).toLowerCase() !== config.chainId.toLowerCase()) {
        state.account = null;
        setStatus("The wallet left " + config.chainName + ". Reconnect to continue.", "error");
      } else {
        loadCampaign().catch(function () {});
      }
      render();
    });
  }

  setupConfiguration();
  render();
  renderCountdown();
  setInterval(renderCountdown, 1000);
  if (configured) {
    loadCampaign().catch(function () {
      elements.phase.textContent = "RPC unavailable";
      setStatus("The contract is configured, but its Polygon state could not be read. Check the RPC endpoint.", "error");
    });
  }
}());
