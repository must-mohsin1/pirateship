import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "../../../escrow-config.js";
import { assertPublicDeploymentMatches } from "./config-consistency.mjs";

const environment = await readFile(new URL("../../../.env.aws-mainnet.example", import.meta.url), "utf8");
const landingPage = await readFile(
  new URL("../../../pirate-network-blog.html", import.meta.url),
  "utf8",
);
const MAINNET_ADDRESS = "0xd92848868a70CCA3706EFa6bA3D2B68F18F211Ff";

test("the public escrow and entitlement verifier cannot silently use different contracts", () => {
  assert.deepEqual(
    assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      MAINNET_ADDRESS,
      137,
    ),
    { contractAddress: MAINNET_ADDRESS, chainId: 137 },
  );
  assert.throws(
    () => assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      "0x0000000000000000000000000000000000000001",
      137,
    ),
    /differ/,
  );
});

test("the mainnet service example matches public config and HTML has no copied address", () => {
  assert.match(environment, new RegExp(`^CONTRACT_ADDRESS=${MAINNET_ADDRESS}$`, "m"));
  assert.doesNotMatch(landingPage, new RegExp(MAINNET_ADDRESS, "i"));
  assert.deepEqual(globalThis.PIRATE_ESCROW_CONFIG.rpcUrls, [
    "https://polygon.drpc.org",
  ]);
  assert.doesNotMatch(
    globalThis.PIRATE_ESCROW_CONFIG.rpcUrls.join("\n"),
    /polygon-rpc\.com/,
  );
});

test("the backend deployment must match the public contract and chain", () => {
  const config = { contractAddress: MAINNET_ADDRESS, chainId: "0x89" };
  assert.deepEqual(assertPublicDeploymentMatches(config, MAINNET_ADDRESS, 137), {
    contractAddress: MAINNET_ADDRESS,
    chainId: 137,
  });
  assert.throws(
    () => assertPublicDeploymentMatches(config, MAINNET_ADDRESS, 80_002),
    /chain IDs differ/,
  );
  assert.throws(
    () => assertPublicDeploymentMatches(
      { ...config, chainId: "invalid" },
      MAINNET_ADDRESS,
      137,
    ),
    /valid positive chainId/,
  );
  assert.throws(
    () => assertPublicDeploymentMatches(
      { chainId: "0x89" },
      MAINNET_ADDRESS,
      137,
    ),
    /valid public contractAddress/,
  );
});
