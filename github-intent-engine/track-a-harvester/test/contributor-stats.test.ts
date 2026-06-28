import { describe, expect, test } from "vitest";
import { buildContributorStats } from "../src/contributor-stats.js";

describe("buildContributorStats", () => {
  test("aggregates activity strength by login and repo", () => {
    const stats = buildContributorStats({
      pullRequests: [
        {
          id: 1,
          repo: "owner/repo",
          number: 1,
          title: "PR",
          body: null,
          author_login: "jane",
          state: "closed",
          merged: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-02T00:00:00Z",
          merged_at: "2026-06-03T00:00:00Z",
          changed_files: [],
          url: "https://github.com/owner/repo/pull/1"
        }
      ],
      issues: [],
      comments: [],
      commits: [
        {
          sha: "abc",
          repo: "owner/repo",
          author_login: "jane",
          message: "commit",
          committed_at: "2026-06-04T00:00:00Z",
          changed_files: [],
          url: "https://github.com/owner/repo/commit/abc"
        }
      ],
      pullRequestReviews: [
        {
          id: 2,
          repo: "owner/repo",
          pull_number: 1,
          author_login: "jane",
          state: "APPROVED",
          body: null,
          submitted_at: "2026-06-05T00:00:00Z",
          url: "https://github.com/owner/repo/pull/1#pullrequestreview-2"
        }
      ],
      pullRequestReviewComments: [],
      workflowRuns: [
        {
          id: 3,
          repo: "owner/repo",
          name: "CI",
          event: "push",
          status: "completed",
          conclusion: "failure",
          actor_login: "jane",
          created_at: "2026-06-06T00:00:00Z",
          updated_at: "2026-06-06T00:01:00Z",
          url: "https://github.com/owner/repo/actions/runs/3"
        }
      ]
    });

    expect(stats).toEqual([
      {
        login: "jane",
        repo: "owner/repo",
        pull_request_count: 1,
        merged_pull_request_count: 1,
        commit_count: 1,
        issue_count: 0,
        comment_count: 0,
        review_count: 1,
        review_comment_count: 0,
        failed_workflow_count: 1,
        repos_touched: ["owner/repo"],
        last_active_at: "2026-06-06T00:01:00Z"
      }
    ]);
  });
});
