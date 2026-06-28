import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { validateRawData } from "../src/validator.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "github-intent-validator-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("validateRawData", () => {
  test("fails malformed raw files with actionable errors", async () => {
    await writeFile(join(dir, "raw_repos.jsonl"), '{"id":1,"full_name":"owner/repo","url":"https://github.com/owner/repo"}\n');
    await writeFile(join(dir, "raw_pull_requests.jsonl"), '{"repo":"missing/repo","number":1,"url":"","created_at":"not-a-date"}\n');
    await writeFile(join(dir, "raw_issues.jsonl"), "");
    await writeFile(join(dir, "raw_comments.jsonl"), "");
    await writeFile(join(dir, "raw_commits.jsonl"), "");
    await writeFile(join(dir, "raw_manifests.jsonl"), "");
    await writeFile(join(dir, "raw_pull_request_reviews.jsonl"), "");
    await writeFile(join(dir, "raw_pull_request_review_comments.jsonl"), "");
    await writeFile(join(dir, "raw_workflow_runs.jsonl"), "");
    await writeFile(join(dir, "raw_contributor_stats.jsonl"), "");
    await writeFile(join(dir, "raw_repo_expansions.jsonl"), "");
    await writeFile(join(dir, "raw_users.jsonl"), '{"login":"user"}\n{"login":"user"}\n');

    const result = await validateRawData(dir);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("raw_pull_requests.jsonl line 1 missing required field: author_login");
    expect(result.errors).toContain("raw_pull_requests.jsonl line 1 has invalid URL in field: url");
    expect(result.errors).toContain("raw_pull_requests.jsonl line 1 has invalid timestamp in field: created_at");
    expect(result.errors).toContain("raw_pull_requests.jsonl line 1 references unknown repo: missing/repo");
    expect(result.errors).toContain("raw_users.jsonl has duplicate key: user");
  });
});
