import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeRawHarvest } from "../src/writer.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "github-intent-writer-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeRawHarvest", () => {
  test("writes all raw JSONL files and report atomically", async () => {
    await writeRawHarvest(dir, {
      data: {
        repos: [
          {
            id: 1,
            full_name: "owner/repo",
            owner_login: "owner",
            owner_type: "Organization",
            description: null,
            topics: [],
            stars: 1,
            forks: 0,
            primary_language: null,
            default_branch: "main",
            is_fork: false,
            is_archived: false,
            pushed_at: null,
            readme_text: null,
            url: "https://github.com/owner/repo"
          }
        ],
        pullRequests: [],
        issues: [],
        comments: [],
        commits: [],
        manifests: [],
        pullRequestReviews: [],
        pullRequestReviewComments: [],
        workflowRuns: [],
        contributorStats: [],
        repoExpansions: [],
        users: []
      },
      report: {
        started_at: "2026-06-01T00:00:00Z",
        finished_at: "2026-06-01T00:01:00Z",
        days: 90,
        seed_repo_count: 1,
        expanded_repo_count: 0,
        fetched_repo_count: 1,
        raw_pull_request_count: 0,
        raw_issue_count: 0,
        raw_comment_count: 0,
        raw_commit_count: 0,
        raw_manifest_count: 0,
        raw_pull_request_review_count: 0,
        raw_pull_request_review_comment_count: 0,
        raw_workflow_run_count: 0,
        raw_contributor_stat_count: 0,
        raw_user_count: 0,
        skipped_repo_count: 0,
        failed_request_count: 0,
        request_count: 1,
        rate_limit_remaining: 4999,
        rate_limit_reset_at: "2026-06-01T01:00:00Z",
        invalid_seed_repos: [],
        duplicate_seed_repos: [],
        failures: []
      }
    });

    await expect(readFile(join(dir, "raw_repos.jsonl"), "utf8")).resolves.toContain(
      '"full_name":"owner/repo"'
    );
    await expect(readFile(join(dir, "harvest_report.json"), "utf8")).resolves.toContain(
      '"fetched_repo_count": 1'
    );
    await expect(readFile(join(dir, "raw_manifests.jsonl"), "utf8")).resolves.toBe("");
  });
});
