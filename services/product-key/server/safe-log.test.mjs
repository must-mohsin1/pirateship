import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorMetadata } from "./safe-log.mjs";

test("production error metadata excludes messages, URLs, and upstream response data", () => {
  const error = new Error("request failed at https://polygon.example/v2/SECRET_RPC_KEY");
  error.name = "SERVER_ERROR";
  error.code = "SERVER_ERROR";
  error.info = {
    requestUrl: "https://polygon.example/v2/SECRET_RPC_KEY",
    responseBody: "private upstream response",
  };

  const serialized = JSON.stringify(safeErrorMetadata(error));
  assert.deepEqual(JSON.parse(serialized), {
    name: "SERVER_ERROR",
    code: "SERVER_ERROR",
  });
  assert.doesNotMatch(serialized, /SECRET_RPC_KEY|requestUrl|responseBody/);
});

test("SQLite logs include safe numeric diagnostics without file paths or SQL", () => {
  const error = new Error("database failure at /data/product-keys.db while running private SQL");
  error.code = "ERR_SQLITE_ERROR";
  error.errcode = 5;
  error.errstr = "database is locked";

  const serialized = JSON.stringify(safeErrorMetadata(error));
  assert.deepEqual(JSON.parse(serialized), {
    name: "Error",
    code: "ERR_SQLITE_ERROR",
    sqliteErrcode: 5,
    sqliteErrstr: "database is locked",
  });
  assert.doesNotMatch(serialized, /product-keys|private SQL|\/data/);
});

test("SQLite logs reject malformed diagnostic fields", () => {
  const error = new Error("private database failure");
  error.code = "ERR_SQLITE_ERROR";
  error.errcode = "5; SELECT secret";
  error.errstr = "locked at /data/product-keys.db; SELECT secret";

  assert.deepEqual(safeErrorMetadata(error), {
    name: "Error",
    code: "ERR_SQLITE_ERROR",
    status: undefined,
    sqliteErrcode: undefined,
    sqliteErrstr: undefined,
  });
});
