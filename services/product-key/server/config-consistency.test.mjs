import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "../../../escrow-config.js";
import { assertPublicDeploymentMatches } from "./config-consistency.mjs";

const environment = await readFile(new URL("../../../.env.amoy.example", import.meta.url), "utf8");
const landingPage = await readFile(
  new URL("../../../pirate-network-blog.html", import.meta.url),
  "utf8",
);
const AMOY_ADDRESS = "0x6bF097816997C242F3447A470d1cc3d170cbcB98";

test("the public escrow and entitlement verifier cannot silently use different contracts", () => {
  assert.deepEqual(
    assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      AMOY_ADDRESS,
      80_002,
    ),
    { contractAddress: AMOY_ADDRESS, chainId: 80_002 },
  );
  assert.throws(
    () => assertPublicDeploymentMatches(
      globalThis.PIRATE_ESCROW_CONFIG,
      "0x0000000000000000000000000000000000000001",
      80_002,
    ),
    /differ/,
  );
});

test("the Amoy service example matches public config and HTML has no copied address", () => {
  assert.match(environment, new RegExp(`^CONTRACT_ADDRESS=${AMOY_ADDRESS}$`, "m"));
  assert.doesNotMatch(landingPage, new RegExp(AMOY_ADDRESS, "i"));
  assert.deepEqual(globalThis.PIRATE_ESCROW_CONFIG.rpcUrls, [
    "https://polygon-amoy.drpc.org",
  ]);
  assert.doesNotMatch(
    globalThis.PIRATE_ESCROW_CONFIG.rpcUrls.join("\n"),
    /rpc-amoy\.polygon\.technology/,
  );
});

test("the backend deployment must match the public contract and chain", () => {
  const config = { contractAddress: AMOY_ADDRESS, chainId: "0x13882" };
  assert.deepEqual(assertPublicDeploymentMatches(config, AMOY_ADDRESS, 80_002), {
    contractAddress: AMOY_ADDRESS,
    chainId: 80_002,
  });
  assert.throws(
    () => assertPublicDeploymentMatches(config, AMOY_ADDRESS, 137),
    /chain IDs differ/,
  );
  assert.throws(
    () => assertPublicDeploymentMatches(
      { ...config, chainId: "invalid" },
      AMOY_ADDRESS,
      80_002,
    ),
    /valid positive chainId/,
  );
  assert.throws(
    () => assertPublicDeploymentMatches(
      { chainId: "0x13882" },
      AMOY_ADDRESS,
      80_002,
    ),
    /valid public contractAddress/,
  );
});
