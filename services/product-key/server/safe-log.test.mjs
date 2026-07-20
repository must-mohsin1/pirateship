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
