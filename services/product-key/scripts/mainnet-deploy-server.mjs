import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { id, JsonRpcProvider, keccak256 } from "ethers";
import {
  prepareEscrowDeployment,
  readContractSourceAtCommit,
  runMainnetPreflight,
} from "./mainnet-preflight.mjs";
import {
  createFileAttemptJournal,
  verifyMinedDeployment,
} from "./mainnet-deployment-verifier.mjs";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 4_096;
const pageUrl = new URL("./mainnet-deploy.html", import.meta.url);
const browserScriptUrl = new URL("./mainnet-deploy.js", import.meta.url);

function selector(signature) {
  return id(signature).slice(0, 10);
}

export function buildDeploymentConfig({ preflight, prepared }) {
  if (preflight.status !== "READY_FOR_MANUAL_DEPLOYMENT_REVIEW") {
    throw new Error(`Mainnet preflight is blocked: ${preflight.blockers.join("; ")}`);
  }
  const actualHash = keccak256(prepared.deploymentInitcode);
  if (actualHash !== preflight.contractBuild.deploymentInitcodeKeccak256) {
    throw new Error("Prepared deployment data does not match the reviewed initcode fingerprint.");
  }

  return {
    chainIdHex: "0x89",
    chainId: "137",
    chainName: "Polygon Mainnet",
    deployerAddress: preflight.campaign.ownerAndDeployer,
    beneficiaryAddress: preflight.campaign.beneficiary,
    minimumPledgePol: preflight.campaign.minimumPledgePol,
    minimumPledgeWei: preflight.campaign.minimumPledgeWei,
    confirmationText: `DEPLOY ${preflight.campaign.minimumPledgePol} POL ESCROW`,
    confirmations: 20,
    minimumDeploymentBlock: preflight.network.blockNumber,
    sourceCommit: preflight.review.sourceCommit,
    deploymentInitcode: prepared.deploymentInitcode,
    deploymentInitcodeBytes: preflight.contractBuild.deploymentInitcodeBytes,
    deploymentInitcodeKeccak256: preflight.contractBuild.deploymentInitcodeKeccak256,
    campaignDurationSeconds: 30 * 24 * 60 * 60,
    calls: {
      owner: selector("owner()"),
      beneficiary: selector("beneficiary()"),
      minimumPledge: selector("minimumPledge()"),
      deadline: selector("deadline()"),
      phase: selector("phase()"),
      productReleased: selector("productReleased()"),
    },
  };
}

function securityHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function writeResponse(response, status, contentType, body, headOnly) {
  response.writeHead(status, securityHeaders(contentType));
  response.end(headOnly ? undefined : body);
}

export function isAllowedLocalHost(requestHost, port, hostname) {
  return requestHost?.toLowerCase() === `${hostname}:${port}`.toLowerCase();
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (error) {
    if (error.message === "REQUEST_TOO_LARGE") throw error;
    throw new Error("INVALID_JSON");
  }
}

function isTransactionHash(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function writeJson(response, status, value, headOnly = false) {
  writeResponse(
    response,
    status,
    "application/json; charset=utf-8",
    JSON.stringify(value),
    headOnly,
  );
}

export async function startLocalDeploymentServer({
  deploymentConfig,
  port = 0,
  verificationProvider,
  attemptJournal = createFileAttemptJournal(),
}) {
  if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65_535))) {
    throw new Error("The local deployment port must be zero or an integer from 1024 through 65535.");
  }
  if (!verificationProvider) throw new Error("An independent Polygon RPC provider is required.");
  await attemptJournal.ensureClear();
  const [page, browserScript] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(browserScriptUrl, "utf8"),
  ]);
  const attemptToken = randomBytes(32).toString("hex");
  // Trust Wallet's Chrome extension grants provider access to exact localhost,
  // but not to randomized *.localhost subdomains. The ephemeral port still
  // creates a fresh browser origin, and the Host check below prevents rebinding.
  const hostname = "localhost";
  const browserConfig = { ...deploymentConfig, attemptToken };
  const deploymentJson = JSON.stringify(browserConfig);
  const server = createServer(async (request, response) => {
    const headOnly = request.method === "HEAD";
    try {
      if (!isAllowedLocalHost(request.headers.host, request.socket.localPort, hostname)) {
        writeResponse(response, 403, "text/plain; charset=utf-8", "Invalid host", headOnly);
        return;
      }
      const pathname = new URL(request.url ?? "/", `http://${HOST}`).pathname;
      if (request.method === "POST") {
        if (request.headers["x-deployment-token"] !== attemptToken) {
          writeJson(response, 403, { error: "The local deployment token is invalid." });
          return;
        }
        const body = await readJsonBody(request);
        if (pathname === "/attempt/start") {
          if (body.fingerprint !== deploymentConfig.deploymentInitcodeKeccak256) {
            writeJson(response, 400, { error: "The reviewed deployment fingerprint changed." });
            return;
          }
          await attemptJournal.start({
            fingerprint: body.fingerprint,
            startedAt: new Date().toISOString(),
          });
          writeJson(response, 200, { ok: true });
          return;
        }
        if (pathname === "/attempt/hash") {
          if (!isTransactionHash(body.transactionHash)) {
            writeJson(response, 400, { error: "Trust Wallet returned an invalid transaction hash." });
            return;
          }
          await attemptJournal.recordTransactionHash(body.transactionHash);
          writeJson(response, 200, { ok: true });
          return;
        }
        if (pathname === "/verify") {
          if (!isTransactionHash(body.transactionHash)) {
            writeJson(response, 400, { error: "Trust Wallet returned an invalid transaction hash." });
            return;
          }
          const result = await attemptJournal.verifyTransaction(
            body.transactionHash,
            () => verifyMinedDeployment({
              provider: verificationProvider,
              config: deploymentConfig,
              transactionHash: body.transactionHash,
              confirmations: deploymentConfig.confirmations,
            }),
          );
          writeJson(response, 200, result);
          return;
        }
        writeJson(response, 404, { error: "Not found." });
        return;
      }
      if (request.method !== "GET" && !headOnly) {
        writeResponse(response, 405, "text/plain; charset=utf-8", "Method not allowed", headOnly);
        return;
      }
      if (pathname === "/" || pathname === "/mainnet-deploy.html") {
        writeResponse(response, 200, "text/html; charset=utf-8", page, headOnly);
        return;
      }
      if (pathname === "/mainnet-deploy.js") {
        writeResponse(response, 200, "text/javascript; charset=utf-8", browserScript, headOnly);
        return;
      }
      if (pathname === "/deployment.json") {
        writeResponse(response, 200, "application/json; charset=utf-8", deploymentJson, headOnly);
        return;
      }
      writeResponse(response, 404, "text/plain; charset=utf-8", "Not found", headOnly);
    } catch {
      if (!response.headersSent) {
        writeJson(response, 409, {
          error: "The local deployment controller refused the request. Reconcile any prior attempt before retrying.",
        });
      } else {
        response.destroy();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, resolve);
  });
  Object.defineProperty(server, "deploymentUrl", {
    value: `http://${hostname}:${server.address().port}/`,
  });
  return server;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const preflight = await runMainnetPreflight();
    if (preflight.status !== "READY_FOR_MANUAL_DEPLOYMENT_REVIEW") {
      throw new Error(preflight.blockers.join("; "));
    }
    const source = await readContractSourceAtCommit(preflight.review.sourceCommit);
    const prepared = await prepareEscrowDeployment({
      beneficiaryAddress: preflight.campaign.beneficiary,
      minimumPledgeWei: BigInt(preflight.campaign.minimumPledgeWei),
      source,
    });
    const deploymentConfig = buildDeploymentConfig({ preflight, prepared });
    const verificationProvider = new JsonRpcProvider(process.env.RPC_URL);
    const server = await startLocalDeploymentServer({ deploymentConfig, verificationProvider });
    console.log(`Reviewed deployment ready at ${server.deploymentUrl}`);
    console.log("Keep this terminal open, review every field, and use only the Trust Wallet prompt opened by that local page.");
    const close = () => server.close(() => process.exit(0));
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch {
    console.error("Mainnet deployment handoff refused to start. Check the reviewed environment, Git state, dedicated RPC, and .mainnet-deployment-attempt.json without sharing secrets.");
    process.exitCode = 1;
  }
}
