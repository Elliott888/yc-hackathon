import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("CLI E2E writes Track 1 artifacts from fixture data and validates scored leads", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "neural-github-intent-"));

  try {
    const run = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "run",
        "--recipe",
        "recipes/convex.yaml",
        "--fixture",
        "test/fixtures/convex-github.json",
        "--out",
        outDir,
        "--days",
        "90"
      ],
      { encoding: "utf8" }
    );

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /scored_leads\.ndjson/);

    const validate = spawnSync(
      process.execPath,
      ["src/cli.js", "validate", "--leads", path.join(outDir, "scored_leads.ndjson"), "--days", "90"],
      { encoding: "utf8" }
    );

    assert.equal(validate.status, 0, validate.stderr);
    assert.match(validate.stdout, /Validation passed/);

    const lines = (await readFile(path.join(outDir, "scored_leads.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const embeddings = (await readFile(path.join(outDir, "profile_embeddings.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const trainingExamples = (await readFile(path.join(outDir, "training_examples.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(lines[0].engineer_login, "jane-sync");
    assert.ok(lines[0].why_relevant.includes("live query"));
    assert.ok(lines[0].answer_context.problem_signals.includes("live query"));
    assert.ok(lines[0].recent_activity.length >= 2);
    assert.ok(lines[0].evidence_links.length >= 2);
    assert.ok(embeddings.some((embedding) => embedding.engineer_login === "jane-sync"));
    assert.ok(trainingExamples.some((example) => example.engineer_login === "jane-sync"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
