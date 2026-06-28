import { describe, expect, test } from "vitest";
import { harvestData } from "../src/harvest.js";
import type { GitHubDataSource } from "../src/github-source.js";

describe("harvestData", () => {
  test("collects repo activity, fetches unique users, dedupes records, and records failures", async () => {
    const calls: string[] = [];
    const source: GitHubDataSource = {
      stats: {
        requestCount: 10,
        failedRequestCount: 1,
        rateLimitRemaining: 4000,
        rateLimitResetAt: "2026-06-28T00:00:00Z",
        failures: [{ scope: "repo", resource: "bad/repo", message: "Not Found", status: 404 }]
      },
      async fetchRepo(fullName) {
        calls.push(`repo:${fullName}`);
        if (fullName === "bad/repo") return null;
        return {
          id: 1,
          full_name: fullName,
          owner_login: "owner",
          owner_type: "Organization",
          description: null,
          topics: [],
          stars: 1,
          forks: 0,
          primary_language: "TypeScript",
          default_branch: "main",
          is_fork: false,
          is_archived: false,
          pushed_at: "2026-06-01T00:00:00Z",
          readme_text: null,
          url: `https://github.com/${fullName}`
        };
      },
      async fetchPullRequests(repo) {
        calls.push(`prs:${repo}`);
        return [
          {
            id: 10,
            repo,
            number: 1,
            title: "Fix sync",
            body: null,
            author_login: "jane",
            state: "closed",
            merged: true,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-02T00:00:00Z",
            merged_at: "2026-06-03T00:00:00Z",
            changed_files: [],
            url: `https://github.com/${repo}/pull/1`
          },
          {
            id: 10,
            repo,
            number: 1,
            title: "Duplicate",
            body: null,
            author_login: "jane",
            state: "closed",
            merged: true,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-02T00:00:00Z",
            merged_at: "2026-06-03T00:00:00Z",
            changed_files: [],
            url: `https://github.com/${repo}/pull/1`
          }
        ];
      },
      async fetchIssues(repo) {
        calls.push(`issues:${repo}`);
        return [];
      },
      async fetchIssueComments(repo) {
        calls.push(`comments:${repo}`);
        return [];
      },
      async fetchCommits(repo) {
        calls.push(`commits:${repo}`);
        return [
          {
            sha: "abc",
            repo,
            author_login: null,
            message: "anonymous commit",
            committed_at: "2026-06-04T00:00:00Z",
            changed_files: [],
            url: `https://github.com/${repo}/commit/abc`
          }
        ];
      },
      async fetchUser(login) {
        calls.push(`user:${login}`);
        return {
          id: 20,
          login,
          type: "User",
          name: null,
          company: null,
          location: null,
          blog: null,
          email: null,
          bio: null,
          public_repos: 1,
          followers: 0,
          created_at: "2020-01-01T00:00:00Z",
          url: `https://github.com/${login}`
        };
      }
    };

    const result = await harvestData({
      source,
      repos: ["owner/repo", "bad/repo"],
      since: new Date("2026-06-01T00:00:00Z")
    });

    expect(result.data.repos).toHaveLength(1);
    expect(result.data.pullRequests).toHaveLength(1);
    expect(result.data.users.map((user) => user.login)).toEqual(["owner", "jane"]);
    expect(result.report.fetched_repo_count).toBe(1);
    expect(result.report.skipped_repo_count).toBe(1);
    expect(result.report.raw_pull_request_count).toBe(1);
    expect(result.report.raw_user_count).toBe(2);
    expect(result.report.raw_contributor_stat_count).toBeGreaterThan(0);
    expect(result.report.failures).toHaveLength(1);
    expect(calls).toContain("user:owner");
    expect(calls).toContain("user:jane");
  });

  test("uses canonical repo full_name returned by GitHub for activity records", async () => {
    const calls: string[] = [];
    const source: GitHubDataSource = {
      stats: {
        requestCount: 1,
        failedRequestCount: 0,
        rateLimitRemaining: 4000,
        rateLimitResetAt: null,
        failures: []
      },
      async fetchRepo(fullName) {
        calls.push(`repo:${fullName}`);
        return {
          id: 1,
          full_name: "canonical/repo",
          owner_login: "canonical",
          owner_type: "Organization",
          description: null,
          topics: [],
          stars: 1,
          forks: 0,
          primary_language: "TypeScript",
          default_branch: "main",
          is_fork: false,
          is_archived: false,
          pushed_at: "2026-06-01T00:00:00Z",
          readme_text: null,
          url: "https://github.com/canonical/repo"
        };
      },
      async fetchPullRequests(repo) {
        calls.push(`prs:${repo}`);
        return [
          {
            id: 10,
            repo,
            number: 1,
            title: "Canonical PR",
            body: null,
            author_login: "jane",
            state: "open",
            merged: false,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-02T00:00:00Z",
            merged_at: null,
            changed_files: [],
            url: `https://github.com/${repo}/pull/1`
          }
        ];
      },
      async fetchIssues() {
        return [];
      },
      async fetchIssueComments() {
        return [];
      },
      async fetchCommits() {
        return [];
      },
      async fetchUser(login) {
        return {
          id: 20,
          login,
          type: "User",
          name: null,
          company: null,
          location: null,
          blog: null,
          email: null,
          bio: null,
          public_repos: 1,
          followers: 0,
          created_at: "2020-01-01T00:00:00Z",
          url: `https://github.com/${login}`
        };
      }
    };

    const result = await harvestData({
      source,
      repos: ["old/repo"],
      since: new Date("2026-06-01T00:00:00Z")
    });

    expect(calls).toContain("repo:old/repo");
    expect(calls).toContain("prs:canonical/repo");
    expect(result.data.repos[0]?.full_name).toBe("canonical/repo");
    expect(result.data.pullRequests[0]?.repo).toBe("canonical/repo");
  });

  test("can skip expensive detail endpoints and cap fetched users for large harvests", async () => {
    const calls: string[] = [];
    const source: GitHubDataSource = {
      stats: {
        requestCount: 1,
        failedRequestCount: 0,
        rateLimitRemaining: 4000,
        rateLimitResetAt: null,
        failures: []
      },
      async fetchRepo(fullName) {
        calls.push(`repo:${fullName}`);
        return {
          id: 1,
          full_name: fullName,
          owner_login: "owner",
          owner_type: "Organization",
          description: null,
          topics: [],
          stars: 1,
          forks: 0,
          primary_language: "TypeScript",
          default_branch: "main",
          is_fork: false,
          is_archived: false,
          pushed_at: "2026-06-01T00:00:00Z",
          readme_text: null,
          url: `https://github.com/${fullName}`
        };
      },
      async fetchPullRequests(repo) {
        calls.push(`prs:${repo}`);
        return [
          {
            id: 10,
            repo,
            number: 1,
            title: "Fix realtime bug",
            body: null,
            author_login: "pr-author",
            state: "open",
            merged: false,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-02T00:00:00Z",
            merged_at: null,
            changed_files: [],
            url: `https://github.com/${repo}/pull/1`
          }
        ];
      },
      async fetchIssues() {
        calls.push("issues");
        return [];
      },
      async fetchIssueComments() {
        calls.push("comments");
        return [];
      },
      async fetchCommits() {
        calls.push("commits");
        return [];
      },
      async fetchManifests() {
        calls.push("manifests");
        return [];
      },
      async fetchPullRequestReviews() {
        calls.push("reviews");
        return [];
      },
      async fetchPullRequestReviewComments() {
        calls.push("review-comments");
        return [];
      },
      async fetchWorkflowRuns() {
        calls.push("workflows");
        return [];
      },
      async fetchUser(login) {
        calls.push(`user:${login}`);
        return {
          id: login === "owner" ? 20 : 21,
          login,
          type: "User",
          name: null,
          company: null,
          location: null,
          blog: null,
          email: null,
          bio: null,
          public_repos: 1,
          followers: 0,
          created_at: "2020-01-01T00:00:00Z",
          url: `https://github.com/${login}`
        };
      }
    };

    const result = await harvestData({
      source,
      repos: ["owner/repo"],
      since: new Date("2026-06-01T00:00:00Z"),
      include: {
        pullRequests: true,
        issues: false,
        comments: false,
        commits: false,
        manifests: false,
        reviews: false,
        workflows: false
      },
      maxUsers: 1
    });

    expect(result.data.pullRequests).toHaveLength(1);
    expect(result.data.issues).toHaveLength(0);
    expect(result.data.comments).toHaveLength(0);
    expect(result.data.commits).toHaveLength(0);
    expect(result.data.manifests).toHaveLength(0);
    expect(result.data.pullRequestReviews).toHaveLength(0);
    expect(result.data.pullRequestReviewComments).toHaveLength(0);
    expect(result.data.workflowRuns).toHaveLength(0);
    expect(result.data.users).toHaveLength(1);
    expect(calls).toContain("prs:owner/repo");
    expect(calls).not.toContain("issues");
    expect(calls).not.toContain("comments");
    expect(calls).not.toContain("commits");
    expect(calls).not.toContain("manifests");
    expect(calls).not.toContain("reviews");
    expect(calls).not.toContain("review-comments");
    expect(calls).not.toContain("workflows");
    expect(calls.filter((call) => call.startsWith("user:"))).toHaveLength(1);
  });
});
