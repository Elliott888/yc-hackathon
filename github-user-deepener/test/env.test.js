import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadEnvFiles } from "../src/env.js";

test("loadEnvFiles loads GITHUB_TOKEN from a local env file without overriding an existing env var", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "github-user-deepener-env-"));
  await writeFile(
    path.join(cwd, ".env.local"),
    [
      "GITHUB_TOKEN=file-token",
      "GH_TOKEN='quoted-token'",
      "IGNORED_LINE",
      "# comment"
    ].join("\n")
  );

  const env = {
    GITHUB_TOKEN: "existing-token"
  };
  const result = await loadEnvFiles({
    cwd,
    env,
    files: [".env.local"]
  });

  assert.equal(env.GITHUB_TOKEN, "existing-token");
  assert.equal(env.GH_TOKEN, "quoted-token");
  assert.deepEqual(result.loaded_files, [path.join(cwd, ".env.local")]);
  assert.deepEqual(result.loaded_keys.sort(), ["GH_TOKEN"]);
});

test("loadEnvFiles supports double-quoted values and missing optional files", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "github-user-deepener-env-"));
  await writeFile(path.join(cwd, ".env"), 'GITHUB_TOKEN="abc 123"\n');

  const env = {};
  const result = await loadEnvFiles({
    cwd,
    env,
    files: [".env.local", ".env"]
  });

  assert.equal(env.GITHUB_TOKEN, "abc 123");
  assert.deepEqual(result.loaded_files, [path.join(cwd, ".env")]);
  assert.deepEqual(result.loaded_keys, ["GITHUB_TOKEN"]);
});
