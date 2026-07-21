import { DatabaseSync } from "node:sqlite";

export class KeyStore {
  constructor(filename = ":memory:", maxChallenges = 10_000) {
    this.db = new DatabaseSync(filename);
    // EFS lock hand-off can take longer than local disk. Retry briefly before
    // surfacing SQLITE_BUSY so transient contention does not fail a request.
    this.db.exec("PRAGMA busy_timeout = 3000");
    // The AWS rehearsal stores this file on EFS. WAL requires shared memory and
    // is not supported on network filesystems, so use SQLite's rollback journal.
    let journalMode;
    try {
      journalMode = this.db.prepare("PRAGMA journal_mode = DELETE").get()?.journal_mode;
    } catch (error) {
      this.db.close();
      throw error;
    }
    if (filename !== ":memory:" && String(journalMode).toLowerCase() !== "delete") {
      this.db.close();
      const error = new Error("SQLite rollback journal mode is required for file-backed storage.");
      error.code = "ERR_SQLITE_ERROR";
      error.errstr = "rollback journal unavailable";
      throw error;
    }
    this.db.exec("PRAGMA foreign_keys = ON");
    const challengeColumns = this.db.prepare("PRAGMA table_info(challenges)").all();
    if (
      challengeColumns.length > 0 &&
      !challengeColumns.some(({ name }) => name === "challenge_id")
    ) {
      // Challenges are ephemeral. Replace the pre-ID rehearsal schema in place
      // without touching durable product-key inventory.
      this.db.exec("DROP TABLE challenges");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS challenges (
        challenge_id TEXT PRIMARY KEY,
        address TEXT NOT NULL COLLATE NOCASE,
        message TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS product_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_key TEXT NOT NULL UNIQUE,
        assigned_to TEXT UNIQUE COLLATE NOCASE,
        assigned_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS challenges_expires_at_idx
      ON challenges(expires_at);

      CREATE INDEX IF NOT EXISTS challenges_address_idx
      ON challenges(address);
    `);

    this.putChallengeStatement = this.db.prepare(`
      INSERT INTO challenges(challenge_id, address, message, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `);
    this.getChallengeStatement = this.db.prepare(`
      SELECT challenge_id AS challengeId, address, message, expires_at AS expiresAt, used
      FROM challenges
      WHERE challenge_id = ? AND address = ?
    `);
    this.pruneChallengesStatement = this.db.prepare(`
      DELETE FROM challenges
      WHERE used = 1 OR expires_at < ?
    `);
    this.pruneExcessChallengesStatement = this.db.prepare(`
      DELETE FROM challenges
      WHERE challenge_id IN (
        SELECT challenge_id
        FROM challenges
        ORDER BY expires_at ASC
        LIMIT MAX((SELECT COUNT(*) FROM challenges) - ?, 0)
      )
    `);
    this.consumeChallengeStatement = this.db.prepare(`
      UPDATE challenges
      SET used = 1
      WHERE challenge_id = ? AND address = ? AND message = ? AND used = 0 AND expires_at >= ?
    `);
    this.insertKeyStatement = this.db.prepare(`
      INSERT OR IGNORE INTO product_keys(product_key) VALUES (?)
    `);
    this.existingKeyStatement = this.db.prepare(`
      SELECT product_key AS productKey
      FROM product_keys
      WHERE assigned_to = ?
    `);
    this.availableKeyStatement = this.db.prepare(`
      SELECT id, product_key AS productKey
      FROM product_keys
      WHERE assigned_to IS NULL
      ORDER BY id
      LIMIT 1
    `);
    this.assignKeyStatement = this.db.prepare(`
      UPDATE product_keys
      SET assigned_to = ?, assigned_at = ?
      WHERE id = ? AND assigned_to IS NULL
    `);
    this.healthCheckStatement = this.db.prepare(`
      INSERT OR REPLACE INTO challenges(challenge_id, address, message, expires_at, used)
      VALUES ('__health_check__', '__health_check__', '__health_check__', ?, 1)
    `);
    this.maxChallenges = maxChallenges;
  }

  healthCheck(now = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Roll this write back so readiness verifies the real storage path without
      // accumulating probe rows or changing product-key inventory.
      this.healthCheckStatement.run(now);
      this.db.exec("ROLLBACK");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the storage error that caused readiness to fail.
      }
      throw error;
    }
  }

  putChallenge(challengeId, address, message, expiresAt, now = Date.now()) {
    this.pruneChallengesStatement.run(now);
    this.putChallengeStatement.run(challengeId, address, message, expiresAt);
    this.pruneExcessChallengesStatement.run(this.maxChallenges);
  }

  getChallenge(challengeId, address) {
    return this.getChallengeStatement.get(challengeId, address) ?? null;
  }

  consumeChallenge(challengeId, address, message, now = Date.now()) {
    return this.consumeChallengeStatement.run(challengeId, address, message, now).changes === 1;
  }

  addKeys(keys) {
    const normalized = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let inserted = 0;
      for (const key of normalized) {
        inserted += Number(this.insertKeyStatement.run(key).changes);
      }
      this.db.exec("COMMIT");
      return inserted;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  assignKey(address, now = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.existingKeyStatement.get(address);
      if (existing) {
        this.db.exec("COMMIT");
        return { ...existing, existing: true };
      }

      const available = this.availableKeyStatement.get();
      if (!available) {
        this.db.exec("COMMIT");
        return null;
      }

      const assignment = this.assignKeyStatement.run(address, now, available.id);
      if (assignment.changes !== 1) {
        throw new Error("Product key assignment lost an atomic update.");
      }

      this.db.exec("COMMIT");
      return { productKey: available.productKey, existing: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  stats() {
    const result = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END), 0) AS available,
          COALESCE(SUM(CASE WHEN assigned_to IS NOT NULL THEN 1 ELSE 0 END), 0) AS assigned
        FROM product_keys
      `)
      .get();
    return { ...result, quarantined: 0 };
  }

  close() {
    this.db.close();
  }
}
