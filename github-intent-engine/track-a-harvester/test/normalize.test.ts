import { describe, expect, test } from "vitest";
import {
  normalizeCommit,
  normalizeIssue,
  normalizePullRequest,
  normalizeRepo,
  normalizeUser
} from "../src/normalize.js";

describe("GitHub response normalization", () => {
  test("normalizes repo metadata and caps README text", () => {
    const repo = normalizeRepo(
      {
        id: 1,
        full_name: "owner/repo",
        owner: { login: "owner", type: "Organization" },
        description: "Repo description",
        topics: ["sync"],
        stargazers_count: 10,
        forks_count: 2,
        language: "TypeScript",
        default_branch: "main",
        fork: false,
        archived: false,
        pushed_at: "2026-06-01T00:00:00Z",
        html_url: "https://github.com/owner/repo"
      },
      "x".repeat(25),
      10
    );

    expect(repo).toMatchObject({
      id: 1,
      full_name: "owner/repo",
      owner_login: "owner",
      owner_type: "Organization",
      readme_text: "xxxxxxxxxx"
    });
  });

  test("normalizes pull requests, issues, commits, and users", () => {
    expect(
      normalizePullRequest(
        "owner/repo",
        {
          id: 2,
          number: 5,
          title: "Fix live queries",
          body: "details",
          user: { login: "jane" },
          state: "closed",
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-02T00:00:00Z",
          merged_at: "2026-06-03T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/5"
        },
        ["src/live.ts"]
      )
    ).toMatchObject({ repo: "owner/repo", number: 5, author_login: "jane", merged: true });

    expect(
      normalizeIssue("owner/repo", {
        id: 3,
        number: 6,
        title: "Replication lag",
        body: null,
        user: { login: "sam" },
        state: "open",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-02T00:00:00Z",
        html_url: "https://github.com/owner/repo/issues/6"
      })
    ).toMatchObject({ repo: "owner/repo", number: 6, author_login: "sam" });

    expect(
      normalizeCommit(
        "owner/repo",
        {
          sha: "abc",
          author: { login: "alex" },
          commit: {
            message: "Fix websocket reconnect",
            committer: { date: "2026-06-01T00:00:00Z" }
          },
          html_url: "https://github.com/owner/repo/commit/abc"
        },
        ["src/socket.ts"]
      )
    ).toMatchObject({ repo: "owner/repo", sha: "abc", author_login: "alex" });

    expect(
      normalizeUser({
        id: 4,
        login: "jane",
        type: "User",
        name: "Jane",
        company: "Acme",
        location: null,
        blog: "https://jane.dev",
        email: null,
        bio: "Building sync",
        public_repos: 12,
        followers: 34,
        created_at: "2020-01-01T00:00:00Z",
        html_url: "https://github.com/jane"
      })
    ).toMatchObject({ login: "jane", public_repos: 12, url: "https://github.com/jane" });
  });
});
