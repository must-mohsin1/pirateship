import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  assert.deepEqual(store.stats(), {
    total: 0,
    available: 0,
    assigned: 0,
    quarantined: 0,
  });
  assert.equal(store.addKeys(["HR-ONE", "HR-TWO", "HR-ONE"]), 2);
  assert.deepEqual(store.stats(), {
    total: 2,
    available: 2,
    assigned: 0,
    quarantined: 0,
  });

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
  assert.deepEqual(store.stats(), {
    total: 2,
    available: 0,
    assigned: 2,
    quarantined: 0,
  });
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

test("file-backed storage migrates WAL to a rollback journal without losing assignments", () => {
  const directory = mkdtempSync(join(tmpdir(), "pirate-key-store-"));
  const filename = join(directory, "product-keys.db");
  try {
    const legacy = new DatabaseSync(filename);
    try {
      legacy.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE challenges (
          challenge_id TEXT PRIMARY KEY,
          address TEXT NOT NULL COLLATE NOCASE,
          message TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
        );
        CREATE TABLE product_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_key TEXT NOT NULL UNIQUE,
          assigned_to TEXT UNIQUE COLLATE NOCASE,
          assigned_at INTEGER
        );
        INSERT INTO product_keys(product_key, assigned_to, assigned_at)
        VALUES ('PIRATE-AMOY-PERSISTED', '0xabc', 1000);
      `);
    } finally {
      legacy.close();
    }

    const store = new KeyStore(filename);
    try {
      assert.equal(store.db.prepare("PRAGMA busy_timeout").get().timeout, 3_000);
      assert.deepEqual(store.assignKey("0xABC", 1_500), {
        productKey: "PIRATE-AMOY-PERSISTED",
        existing: true,
      });
      const before = store.stats();
      store.healthCheck(2_000);
      assert.deepEqual(store.stats(), before, "readiness must not mutate inventory");
    } finally {
      store.close();
    }

    const inspector = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.equal(inspector.prepare("PRAGMA journal_mode").get().journal_mode, "delete");
      assert.equal(
        inspector.prepare("SELECT challenge_id FROM challenges WHERE challenge_id = '__health_check__'").get(),
        undefined,
        "readiness must roll back its probe row",
      );
    } finally {
      inspector.close();
    }

    const reopened = new KeyStore(filename);
    try {
      assert.deepEqual(reopened.assignKey("0xABC", 3_000), {
        productKey: "PIRATE-AMOY-PERSISTED",
        existing: true,
      });
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file-backed storage refuses startup while another connection blocks the WAL transition", () => {
  const directory = mkdtempSync(join(tmpdir(), "pirate-key-store-busy-"));
  const filename = join(directory, "product-keys.db");
  const holder = new DatabaseSync(filename);
  try {
    holder.exec("PRAGMA journal_mode = WAL; CREATE TABLE lock_test(value); INSERT INTO lock_test VALUES (1); BEGIN");
    holder.prepare("SELECT value FROM lock_test").all();

    assert.throws(
      () => new KeyStore(filename),
      (error) => error?.code === "ERR_SQLITE_ERROR" && error?.errcode === 5,
      "startup must fail instead of continuing in WAL mode",
    );
  } finally {
    holder.exec("ROLLBACK");
    holder.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
