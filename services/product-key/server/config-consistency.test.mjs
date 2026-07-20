import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPublicContractMatches } from "./config-consistency.mjs";

const source = await readFile(new URL("../../../escrow-config.js", import.meta.url), "utf8");
const environment = await readFile(new URL("../../../.env.amoy.example", import.meta.url), "utf8");
const landingPage = await readFile(
  new URL("../../../pirate-network-blog.html", import.meta.url),
  "utf8",
);
const AMOY_ADDRESS = "0x6bF097816997C242F3447A470d1cc3d170cbcB98";

test("the public escrow and entitlement verifier cannot silently use different contracts", () => {
  assert.equal(assertPublicContractMatches(source, AMOY_ADDRESS), AMOY_ADDRESS);
  assert.throws(
    () => assertPublicContractMatches(source, "0x0000000000000000000000000000000000000001"),
    /differ/,
  );
  assert.throws(() => assertPublicContractMatches("window.config = {};", AMOY_ADDRESS), /must contain/);
});

test("the Amoy service example matches public config and HTML has no copied address", () => {
  assert.match(environment, new RegExp(`^CONTRACT_ADDRESS=${AMOY_ADDRESS}$`, "m"));
  assert.doesNotMatch(landingPage, new RegExp(AMOY_ADDRESS, "i"));
});
