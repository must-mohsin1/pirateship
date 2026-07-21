import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import test from "node:test";

test("the server supports in-memory SQLite without creating a database file", async (context) => {
  const memoryFile = new URL("../:memory:", import.meta.url);
  await assert.rejects(access(memoryFile));

  const child = spawn(process.execPath, ["index.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      ADMIN_TOKEN: "test-admin-token-that-is-longer-than-32-characters",
      CONTRACT_ADDRESS: "0x6bF097816997C242F3447A470d1cc3d170cbcB98",
      DATABASE_PATH: ":memory:",
      HOST: "127.0.0.1",
      PORT: "0",
      PUBLIC_ORIGIN: "http://127.0.0.1:0",
      RPC_URL: "http://127.0.0.1:9",
    },
  });
  context.after(() => child.kill("SIGKILL"));

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await Promise.race([
    new Promise((resolve) => {
      child.stdout.on("data", (chunk) => {
        if (chunk.includes("listening")) resolve();
      });
    }),
    once(child, "exit").then(([code]) => assert.fail(`server exited ${code}: ${stderr}`)),
  ]);

  child.kill("SIGTERM");
  await once(child, "exit");
  await assert.rejects(access(memoryFile));
});

test("the integrated server selects standard generated Redis without touching SQLite", async (context) => {
  const databaseFile = new URL("../generated-mode-must-not-create.db", import.meta.url);
  await assert.rejects(access(databaseFile));

  const child = spawn(process.execPath, ["index.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      ADMIN_TOKEN: "test-admin-token-that-is-longer-than-32-characters",
      CONTRACT_ADDRESS: "0x6bF097816997C242F3447A470d1cc3d170cbcB98",
      DATABASE_PATH: "generated-mode-must-not-create.db",
      HOST: "127.0.0.1",
      PORT: "0",
      PRODUCT_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      PRODUCT_KEY_GENERATION_KEY: Buffer.alloc(32, 2).toString("base64"),
      PRODUCT_KEY_MODE: "generated",
      PUBLIC_ORIGIN: "http://127.0.0.1:0",
      REDIS_CLUSTER_MODE: "false",
      REDIS_URL: "rediss://default:example@redis.example:6379",
      RPC_URL: "http://127.0.0.1:9",
    },
  });
  context.after(() => child.kill("SIGKILL"));

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await Promise.race([
    new Promise((resolve) => {
      child.stdout.on("data", (chunk) => {
        if (chunk.includes("listening")) resolve();
      });
    }),
    once(child, "exit").then(([code]) => assert.fail(`server exited ${code}: ${stderr}`)),
  ]);

  child.kill("SIGTERM");
  await once(child, "exit");
  await assert.rejects(access(databaseFile));
});
