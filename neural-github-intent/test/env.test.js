import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadDotEnv } from "../src/env.js";

test("loads GITHUB_TOKEN from a local .env file without overwriting existing env", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "neural-github-intent-env-"));
  const envPath = path.join(dir, ".env");
  const original = process.env.GITHUB_TOKEN;

  try {
    delete process.env.GITHUB_TOKEN;
    await writeFile(envPath, "GITHUB_TOKEN=from-file\n", "utf8");
    const loaded = await loadDotEnv(envPath);
    assert.equal(loaded, true);
    assert.equal(process.env.GITHUB_TOKEN, "from-file");

    process.env.GITHUB_TOKEN = "already-set";
    await writeFile(envPath, "GITHUB_TOKEN=should-not-overwrite\n", "utf8");
    await loadDotEnv(envPath);
    assert.equal(process.env.GITHUB_TOKEN, "already-set");
  } finally {
    if (original === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = original;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
