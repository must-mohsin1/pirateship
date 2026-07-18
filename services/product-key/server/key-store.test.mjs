import assert from "node:assert/strict";
import test from "node:test";
import { KeyStore } from "./key-store.mjs";

test("challenges are single-use and expire", () => {
  const store = new KeyStore();
  store.putChallenge("challenge-1", "0xabc", "message", 2_000, 1_000);
  assert.equal(store.getChallenge("challenge-1", "0xABC").message, "message");
  assert.equal(store.consumeChallenge("challenge-1", "0xabc", "message", 1_999), true);
  assert.equal(store.consumeChallenge("challenge-1", "0xabc", "message", 1_999), false);

  store.putChallenge("challenge-2", "0xabc", "new message", 3_000, 2_000);
  assert.equal(store.consumeChallenge("challenge-2", "0xabc", "new message", 3_001), false);
  store.close();
});

test("product keys are assigned atomically and remain stable per wallet", () => {
  const store = new KeyStore();
  assert.deepEqual(store.stats(), { total: 0, available: 0, assigned: 0 });
  assert.equal(store.addKeys(["HR-ONE", "HR-TWO", "HR-ONE"]), 2);
  assert.deepEqual(store.stats(), { total: 2, available: 2, assigned: 0 });

  assert.deepEqual(store.assignKey("0xaaa", 10), {
    productKey: "HR-ONE",
    existing: false,
  });
  assert.deepEqual(store.assignKey("0xAAA", 11), {
    productKey: "HR-ONE",
    existing: true,
  });
  assert.deepEqual(store.assignKey("0xbbb", 12), {
    productKey: "HR-TWO",
    existing: false,
  });
  assert.equal(store.assignKey("0xccc", 13), null);
  assert.deepEqual(store.stats(), { total: 2, available: 0, assigned: 2 });
  store.close();
});

test("challenge storage prunes consumed rows and enforces a hard size bound", () => {
  const store = new KeyStore(":memory:", 2);
  try {
    store.putChallenge("challenge-1", "0x1", "first", 2_000, 1_000);
    store.putChallenge("challenge-2", "0x2", "second", 3_000, 1_000);
    store.putChallenge("challenge-3", "0x3", "third", 4_000, 1_000);
    assert.equal(store.getChallenge("challenge-1", "0x1"), null);
    assert.ok(store.getChallenge("challenge-2", "0x2"));
    assert.ok(store.getChallenge("challenge-3", "0x3"));

    assert.equal(store.consumeChallenge("challenge-2", "0x2", "second", 1_000), true);
    store.putChallenge("challenge-4", "0x4", "fourth", 5_000, 1_000);
    assert.equal(store.getChallenge("challenge-2", "0x2"), null);
    assert.ok(store.getChallenge("challenge-4", "0x4"));
  } finally {
    store.close();
  }
});
