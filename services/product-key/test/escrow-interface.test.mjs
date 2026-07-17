import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { id } from "ethers";

const browserSource = await readFile(new URL("../../../escrow.js", import.meta.url), "utf8");

const signatures = [
  "owner()",
  "deadline()",
  "minimumPledge()",
  "phase()",
  "productReleased()",
  "productReleaseProof()",
  "totalPledged()",
  "totalApproved()",
  "supporters(address)",
  "markProductReleased(string)",
  "contribute()",
  "approveProduct()",
  "claimRefund()",
];

test("browser transaction selectors stay synchronized with the Solidity interface", () => {
  for (const signature of signatures) {
    const selector = id(signature).slice(0, 10);
    assert.match(
      browserSource,
      new RegExp(`:\\s*["']${selector}["']`),
      `${signature} must use selector ${selector}`,
    );
  }
});
