export const DEPLOYMENT_LOCK_KEY = "pirateship-mainnet-deployment-lock";

export function readDeploymentLock(storage) {
  const value = storage.getItem(DEPLOYMENT_LOCK_KEY);
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { state: "unknown-existing-lock" };
  }
}

export function recordDeploymentAttempt(storage, fingerprint, startedAt = new Date()) {
  const lock = {
    fingerprint,
    startedAt: startedAt.toISOString(),
    state: "submitted-or-unknown",
  };
  storage.setItem(DEPLOYMENT_LOCK_KEY, JSON.stringify(lock));
  return lock;
}

export function recordVerifiedDeployment(storage, fingerprint, result, completedAt = new Date()) {
  const lock = {
    fingerprint,
    completedAt: completedAt.toISOString(),
    state: "mined-and-verified",
    ...result,
  };
  storage.setItem(DEPLOYMENT_LOCK_KEY, JSON.stringify(lock));
  return lock;
}

export function recordDeploymentTransactionHash(storage, transactionHash) {
  const current = readDeploymentLock(storage);
  const lock = { ...current, transactionHash, state: "submitted" };
  storage.setItem(DEPLOYMENT_LOCK_KEY, JSON.stringify(lock));
  return lock;
}

export function isWalletSubmissionRejected(error) {
  return error?.walletSubmissionRejected === true;
}

function normalizeHex(value) {
  return value?.toLowerCase();
}

export function discoverTrustWallet(windowObject = globalThis, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      windowObject.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(timer);
    };
    const onAnnounce = (event) => {
      if (event.detail?.info?.rdns !== "com.trustwallet.app") return;
      cleanup();
      resolve(event.detail.provider);
    };
    windowObject.addEventListener("eip6963:announceProvider", onAnnounce);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("Trust Wallet was not detected through EIP-6963."));
    }, timeoutMs);
    windowObject.dispatchEvent(new windowObject.Event("eip6963:requestProvider"));
  });
}

export async function submitAndVerifyDeployment({
  provider,
  config,
  onSubmissionAttempt = () => {},
  onTransactionHash = () => {},
  submissionGuard = () => {},
  independentVerifier,
}) {
  if (normalizeHex(await provider.request({ method: "eth_chainId" })) !== config.chainIdHex) {
    throw new Error("Trust Wallet is not connected to Polygon mainnet.");
  }
  const accounts = await provider.request({ method: "eth_accounts" });
  const selected = accounts?.[0];
  if (normalizeHex(selected) !== normalizeHex(config.deployerAddress)) {
    throw new Error("The selected Trust Wallet account is not the reviewed deployer.");
  }

  await onSubmissionAttempt();
  if (normalizeHex(await provider.request({ method: "eth_chainId" })) !== config.chainIdHex) {
    throw new Error("Trust Wallet changed networks before submission.");
  }
  const currentAccounts = await provider.request({ method: "eth_accounts" });
  if (normalizeHex(currentAccounts?.[0]) !== normalizeHex(config.deployerAddress)) {
    throw new Error("Trust Wallet changed accounts before submission.");
  }
  submissionGuard();
  let transactionHash;
  try {
    transactionHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: selected, data: config.deploymentInitcode, value: "0x0" }],
    });
  } catch (error) {
    if (error?.code === 4001) {
      const rejection = new Error("Trust Wallet rejected the transaction.");
      rejection.walletSubmissionRejected = true;
      throw rejection;
    }
    throw error;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new Error("Trust Wallet returned an invalid transaction hash.");
  }
  await onTransactionHash(transactionHash);
  if (normalizeHex(await provider.request({ method: "eth_chainId" })) !== config.chainIdHex) {
    throw new Error("Trust Wallet changed networks during submission. Keep the deployment locked.");
  }
  if (typeof independentVerifier !== "function") {
    throw new Error("Independent Polygon mainnet verification is unavailable.");
  }
  return independentVerifier(transactionHash);
}

async function loadConfig(fetchImpl = fetch) {
  const response = await fetchImpl("/deployment.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the reviewed deployment payload.");
  return response.json();
}

async function postLocal(path, config, body, fetchImpl = fetch) {
  const response = await fetchImpl(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Deployment-Token": config.attemptToken,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "The local deployment controller refused the request.");
  return result;
}

function text(id, value, documentObject = document) {
  documentObject.getElementById(id).textContent = value;
}

export async function initializePage({
  documentObject = document,
  storage = localStorage,
  windowObject = globalThis,
  fetchImpl = fetch,
} = {}) {
  if (windowObject.navigator?.serviceWorker?.controller) {
    throw new Error("A service worker controls this deployment origin. Stop and restart the handoff.");
  }
  const status = documentObject.getElementById("status");
  const connectButton = documentObject.getElementById("connect-wallet");
  const deployButton = documentObject.getElementById("deploy-contract");
  const confirmation = documentObject.getElementById("confirmation");
  const acknowledge = documentObject.getElementById("acknowledge");
  const config = await loadConfig(fetchImpl);
  text("deployer", config.deployerAddress, documentObject);
  text("beneficiary", config.beneficiaryAddress, documentObject);
  text("minimum", `${config.minimumPledgePol} POL (${config.minimumPledgeWei} wei)`, documentObject);
  text("commit", config.sourceCommit, documentObject);
  text("fingerprint", config.deploymentInitcodeKeccak256, documentObject);
  text("payload-size", `${config.deploymentInitcodeBytes} bytes`, documentObject);
  text("confirmation-phrase", config.confirmationText, documentObject);
  text(
    "acknowledgement-text",
    `Two reviewers compared the owner, beneficiary, ${config.minimumPledgePol} POL minimum, source commit, and initcode fingerprint.`,
    documentObject,
  );

  let connected = false;
  let trustProvider;
  let locked = readDeploymentLock(storage) !== null;
  if (locked) {
    status.textContent = "A prior deployment attempt is locked. Reconcile Trust Wallet and PolygonScan before clearing this site's local data.";
  }
  const updateDeployState = () => {
    deployButton.disabled = !(
      !locked &&
      connected &&
      acknowledge.checked &&
      confirmation.value.trim() === config.confirmationText
    );
  };
  const reviewIsConfirmed = (reviewedConfig = config) =>
    acknowledge.checked && confirmation.value.trim() === reviewedConfig.confirmationText;
  const invalidateConnection = () => {
    connected = false;
    status.textContent = "Trust Wallet account or network changed. Reconnect before deployment.";
    updateDeployState();
  };
  acknowledge.addEventListener("change", updateDeployState);
  confirmation.addEventListener("input", updateDeployState);

  connectButton.addEventListener("click", async () => {
    try {
      trustProvider?.removeListener?.("accountsChanged", invalidateConnection);
      trustProvider?.removeListener?.("chainChanged", invalidateConnection);
      trustProvider = await discoverTrustWallet(windowObject);
      const accounts = await trustProvider.request({ method: "eth_requestAccounts" });
      if (normalizeHex(await trustProvider.request({ method: "eth_chainId" })) !== config.chainIdHex) {
        await trustProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: config.chainIdHex }],
        });
      }
      const currentAccounts = await trustProvider.request({ method: "eth_accounts" });
      if (
        normalizeHex(accounts?.[0]) !== normalizeHex(config.deployerAddress) ||
        normalizeHex(currentAccounts?.[0]) !== normalizeHex(config.deployerAddress)
      ) {
        throw new Error("Select the reviewed deployment account in Trust Wallet.");
      }
      trustProvider.on?.("accountsChanged", invalidateConnection);
      trustProvider.on?.("chainChanged", invalidateConnection);
      connected = true;
      status.textContent = "Reviewed deployer connected on Polygon mainnet.";
      updateDeployState();
    } catch (error) {
      connected = false;
      status.textContent = error.message;
      updateDeployState();
    }
  });

  deployButton.addEventListener("click", async () => {
    deployButton.disabled = true;
    try {
      if (!reviewIsConfirmed()) {
        throw new Error("The review acknowledgement and confirmation phrase are required.");
      }
      status.textContent = "Confirm the exact contract deployment in Trust Wallet. Only gas is sent.";
      const freshConfig = await loadConfig(fetchImpl);
      if (
        freshConfig.deploymentInitcodeKeccak256 !== config.deploymentInitcodeKeccak256 ||
        freshConfig.deploymentInitcode !== config.deploymentInitcode
      ) {
        throw new Error("The local reviewed payload changed. Stop and rerun preflight.");
      }
      if (!reviewIsConfirmed(freshConfig)) {
        throw new Error("The review acknowledgement or confirmation phrase changed.");
      }
      const result = await submitAndVerifyDeployment({
        provider: trustProvider,
        config: freshConfig,
        onSubmissionAttempt: async () => {
          if (!reviewIsConfirmed(freshConfig)) {
            throw new Error("The review acknowledgement or confirmation phrase changed.");
          }
          await postLocal("/attempt/start", freshConfig, {
            fingerprint: freshConfig.deploymentInitcodeKeccak256,
          }, fetchImpl);
          locked = true;
          recordDeploymentAttempt(storage, freshConfig.deploymentInitcodeKeccak256);
        },
        onTransactionHash: async (transactionHash) => {
          recordDeploymentTransactionHash(storage, transactionHash);
          text("result", JSON.stringify({ transactionHash, state: "submitted" }, null, 2), documentObject);
          await postLocal("/attempt/hash", freshConfig, { transactionHash }, fetchImpl);
        },
        submissionGuard: () => {
          if (!reviewIsConfirmed(freshConfig)) {
            throw new Error("The review acknowledgement or confirmation phrase changed.");
          }
        },
        independentVerifier: (transactionHash) =>
          postLocal("/verify", freshConfig, { transactionHash }, fetchImpl),
      });
      recordVerifiedDeployment(
        storage,
        freshConfig.deploymentInitcodeKeccak256,
        result,
      );
      status.textContent = "Deployment mined and verified. Do not publish it until the remaining launch gates pass.";
      text("result", JSON.stringify(result, null, 2), documentObject);
    } catch (error) {
      if (isWalletSubmissionRejected(error)) {
        status.textContent = "Trust Wallet reported rejection. The attempt remains locked until its nonce and Polygon history are independently reconciled.";
      } else if (locked) {
        status.textContent = `${error.message} Retry is locked until Trust Wallet and PolygonScan are reconciled.`;
      } else {
        status.textContent = error.message;
      }
      updateDeployState();
    }
  });
}

if (typeof document !== "undefined") {
  initializePage().catch((error) => {
    text("status", error.message, document);
  });
}
