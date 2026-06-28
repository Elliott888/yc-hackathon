import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FileCheckpointStore } from "../src/checkpoint.js";
import type { RepoHarvestData } from "../src/harvest.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "github-intent-checkpoint-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileCheckpointStore", () => {
  test("writes and reads per-repo harvest data", async () => {
    const store = new FileCheckpointStore(dir);
    const data: RepoHarvestData = {
      repo: {
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
      },
      pullRequests: [],
      issues: [],
      comments: [],
      commits: [],
      manifests: [],
      pullRequestReviews: [],
      pullRequestReviewComments: [],
      workflowRuns: []
    };

    await store.write("owner/repo", data);

    await expect(store.read("owner/repo")).resolves.toEqual(data);
    await expect(store.read("missing/repo")).resolves.toBeNull();
  });
});
