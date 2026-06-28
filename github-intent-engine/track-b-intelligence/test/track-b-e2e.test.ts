import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { evaluateLeads } from "../src/eval.js";
import { buildIntelligence } from "../src/pipeline.js";
import { searchLeads } from "../src/search.js";
import { createTrackBServer } from "../src/server.js";

async function writeJsonl(filePath: string, records: unknown[]) {
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const text = await readFile(filePath, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "track-b-"));
  await writeFile(join(rootDir, ".gitkeep"), "");
  await createFixtureWorkspace(rootDir);
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("Track B end-to-end pipeline", () => {
  test("builds Convex-ranked leads, supports search, and evaluates quality", async () => {
    const buildResult = await buildIntelligence({
      rootDir,
      now: new Date("2026-06-27T12:00:00Z")
    });

    expect(buildResult.leadCount).toBe(2);
    expect(buildResult.topLead?.engineer_login).toBe("jane-dev");
    expect(buildResult.topLead?.score).toBeGreaterThan(70);
    expect(buildResult.topLead?.evidence[0]?.url).toBe(
      "https://github.com/electric-sql/electric/pull/123"
    );
    expect(buildResult.topLead?.answer_context?.problem_signals).toEqual(
      expect.arrayContaining(["replication", "live query"])
    );
    expect(buildResult.topLead?.answer_context?.stack_signals).toEqual(
      expect.arrayContaining(["TypeScript", "Postgres"])
    );
    expect(buildResult.topLead?.answer_context?.code_signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["frontend_server_state_sync", "realtime_product_critical"])
    );
    expect(buildResult.topLead?.answer_context?.evidence_snippets[0]?.url).toBe(
      "https://github.com/electric-sql/electric/pull/123"
    );
    expect(buildResult.topLead?.answer_context?.outreach_hooks[0]).toMatch(/Convex/);

    const categories = await readJsonl<{
      repo: string;
      categories: string[];
      negative_flags: string[];
    }>(join(rootDir, "data", "processed", "repo_categories.jsonl"));

    expect(categories.find((repo) => repo.repo === "electric-sql/electric")?.categories.slice(0, 3)).toEqual([
      "real-time sync",
      "local-first",
      "database sync"
    ]);
    expect(categories.find((repo) => repo.repo === "docs-only/reactive-demo")?.negative_flags).toContain(
      "tutorial"
    );

    const profiles = await readJsonl<{
      login: string;
      top_topics: string[];
      evidence: unknown[];
      stack_signals: string[];
      code_signals: Array<{ id: string }>;
      contribution_counts: Record<string, number>;
      profile_text: string;
    }>(join(rootDir, "data", "processed", "engineer_profiles.jsonl"));

    const jane = profiles.find((profile) => profile.login === "jane-dev");
    expect(jane?.top_topics.slice(0, 3)).toEqual(["replication", "live query", "sync"]);
    expect(jane?.evidence).toHaveLength(7);
    expect(jane?.stack_signals).toEqual(
      expect.arrayContaining(["TypeScript", "React", "Postgres", "WebSocket"])
    );
    expect(jane?.code_signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["frontend_server_state_sync", "realtime_product_critical"])
    );
    expect(jane?.profile_text).toContain("Lots of useEffect(fetch...)");
    expect(jane?.contribution_counts.review_count).toBeGreaterThan(0);

    const embeddings = await readJsonl<{
      engineer_login: string;
      dimensions: string[];
      vector: number[];
    }>(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"));

    const janeEmbedding = embeddings.find((embedding) => embedding.engineer_login === "jane-dev");
    expect(janeEmbedding?.dimensions).toContain("replication");
    expect(janeEmbedding?.vector.some((value) => value > 0)).toBe(true);

    const searchResult = await searchLeads({
      rootDir,
      query: "Find engineers contributing to reactive databases and realtime sync for Convex",
      limit: 5
    });

    expect(searchResult.query_plan.target_entity).toBe("engineer");
    expect(searchResult.query_plan.time_window_days).toBe(90);
    expect(searchResult.query_plan.indexes_used).toEqual([
      "repo_category",
      "contributor_activity",
      "contribution_topic",
      "dependency_manifest",
      "pr_review",
      "ci_failure",
      "code_shape_signal",
      "pain_point_code_manifestation",
      "semantic_vector",
      "keyword",
      "lead_score",
      "evidence"
    ]);
    expect(searchResult.results[0]?.engineer_login).toBe("jane-dev");
    expect(searchResult.results[0]?.semantic_score).toBeGreaterThan(0.5);
    expect(searchResult.results[0]).not.toHaveProperty("semantic_document");
    expect(searchResult.results[0]?.why_relevant).toMatch(/live query|replication/i);
    expect(searchResult.results[0]?.outreach_angle).toMatch(/Convex/i);

    const evalReport = await evaluateLeads({ rootDir, kValues: [1, 2] });
    expect(evalReport.metrics.precision_at_1).toBe(1);
    expect(evalReport.metrics.precision_at_2).toBe(0.5);
    expect(evalReport.metrics.evidence_validity).toBe(1);
    expect(evalReport.metrics.time_window_validity).toBe(1);

    const server = createTrackBServer({ rootDir });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const searchResponse = await fetch(`http://127.0.0.1:${address.port}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "Find engineers working on live query replication for Convex",
          limit: 1
        })
      });
      expect(searchResponse.status).toBe(200);
      const searchBody = (await searchResponse.json()) as Awaited<ReturnType<typeof searchLeads>>;
      expect(searchBody.results[0]?.engineer_login).toBe("jane-dev");

      const leadResponse = await fetch(`http://127.0.0.1:${address.port}/lead/jane-dev`);
      expect(leadResponse.status).toBe(200);
      const leadBody = (await leadResponse.json()) as { engineer_login: string };
      expect(leadBody.engineer_login).toBe("jane-dev");

      const evaluateResponse = await fetch(`http://127.0.0.1:${address.port}/evaluate`);
      expect(evaluateResponse.status).toBe(200);
      const evaluateBody = (await evaluateResponse.json()) as Awaited<ReturnType<typeof evaluateLeads>>;
      expect(evaluateBody.metrics.precision_at_10).toBe(0.5);

      const compareResponse = await fetch(`http://127.0.0.1:${address.port}/compare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "Find engineers talking about live query replication for Convex",
          limit: 2
        })
      });
      expect(compareResponse.status).toBe(200);
      const compareBody = await compareResponse.json() as {
        baselines: {
          keyword: { results: Array<{ engineer_login: string }> };
          semantic: { results: Array<{ engineer_login: string }> };
          intent: { results: Array<{ engineer_login: string }> };
        };
      };
      expect(compareBody.baselines.intent.results[0]?.engineer_login).toBe("jane-dev");
      expect(compareBody.baselines.keyword.results.length).toBeGreaterThan(0);
      expect(compareBody.baselines.semantic.results.length).toBeGreaterThan(0);

      const queryEvalResponse = await fetch(
        `http://127.0.0.1:${address.port}/evaluate?query=${encodeURIComponent(
          "Find engineers talking about live query replication for Convex"
        )}&query_id=convex_realtime_sync_engineers&k=1,2`
      );
      expect(queryEvalResponse.status).toBe(200);
      const queryEvalBody = (await queryEvalResponse.json()) as Awaited<ReturnType<typeof evaluateLeads>>;
      expect(queryEvalBody.baseline_metrics?.intent.precision_at_1).toBe(1);
      expect(queryEvalBody.baseline_top_leads?.intent[0]).toBe("jane-dev");

      const appResponse = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(appResponse.status).toBe(200);
      expect(appResponse.headers.get("content-type")).toContain("text/html");
      const appHtml = await appResponse.text();
      expect(appHtml).toContain("GitHub Intent Engine");
      expect(appHtml).toContain("id=\"search-form\"");
      expect(appHtml).toContain("id=\"preset-list\"");
      expect(appHtml).toContain("id=\"lead-list\"");
      expect(appHtml).toContain("id=\"query-plan\"");
      expect(appHtml).toContain("id=\"baseline-comparison\"");
      expect(appHtml).toContain("id=\"lead-detail\"");
      expect(appHtml).toContain("Problem Signals");
      expect(appHtml).toContain("Outreach Hooks");
      expect(appHtml).toContain("Convex Buyer");
      expect(appHtml).toContain("Lore Buyer");
      expect(appHtml).toContain("Lopus Buyer");
      expect(appHtml).toContain("OpenAI Buyer");
      expect(appHtml).toContain("Orange Slice Buyer");
      expect(appHtml).toContain("renderSearchResults(data)");
      expect(appHtml).toContain("loadAuxiliaryPanels(query, queryId)");
      expect(appHtml).not.toContain("Promise.all([");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

async function createFixtureWorkspace(workspaceRoot: string) {
  await mkdirp(join(workspaceRoot, "contracts"));
  await mkdirp(join(workspaceRoot, "data", "raw"));
  await mkdirp(join(workspaceRoot, "data", "processed"));
  await mkdirp(join(workspaceRoot, "data", "eval"));

  await writeFile(
    join(workspaceRoot, "contracts", "convex_recipe.yaml"),
    `id: convex_realtime_sync_engineers
label: Engineers working on Convex-shaped backend problems
target_product: Convex
target_entity: engineer
time_window_days: 90
repo_categories:
  - real-time sync
  - reactive database
  - backend-as-a-service
  - local-first
  - offline-first
  - CRDT/collaboration
  - serverless backend
  - database sync
topic_terms:
  - sync
  - replication
  - realtime
  - live query
  - subscriptions
  - reactive data
  - cache invalidation
  - optimistic update
  - conflict resolution
  - CRDT
  - WebSocket
  - SQLite sync
  - Postgres changefeed
  - serverless function
  - backend state
strong_stacks:
  - TypeScript
  - React
  - Next.js
  - Node.js
  - Postgres
  - SQLite
  - WebSocket
negative_terms:
  - tutorial
  - sample
  - example
  - demo
  - toy
  - awesome-list
`
  );

  const rawDir = join(workspaceRoot, "data", "raw");
  await writeJsonl(join(rawDir, "raw_repos.jsonl"), [
    {
      id: 1,
      full_name: "electric-sql/electric",
      owner_login: "electric-sql",
      owner_type: "Organization",
      description: "Sync engine for local-first apps on Postgres",
      topics: ["local-first", "sync", "postgres", "realtime"],
      stars: 12000,
      forks: 400,
      primary_language: "TypeScript",
      default_branch: "main",
      is_fork: false,
      is_archived: false,
      pushed_at: "2026-06-20T12:00:00Z",
      readme_text: "Local-first sync engine with live queries, replication, and Postgres changefeeds.",
      url: "https://github.com/electric-sql/electric"
    },
    {
      id: 2,
      full_name: "docs-only/reactive-demo",
      owner_login: "docs-only",
      owner_type: "User",
      description: "Tutorial example showing a toy realtime database demo",
      topics: ["tutorial", "example"],
      stars: 4,
      forks: 1,
      primary_language: "JavaScript",
      default_branch: "main",
      is_fork: false,
      is_archived: false,
      pushed_at: "2026-06-18T12:00:00Z",
      readme_text: "A sample demo tutorial for reactive database ideas.",
      url: "https://github.com/docs-only/reactive-demo"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_pull_requests.jsonl"), [
    {
      id: 101,
      repo: "electric-sql/electric",
      number: 123,
      title: "Improve live query invalidation for replicated rows",
      body:
        "Fixes replication edge cases when live queries fall behind Postgres changefeeds. " +
        "React Query invalidateQueries and useEffect(fetch('/api/rooms')) caused stale client state, " +
        "so this adds optimistic update rollback and WebSocket presence reconnect handling.",
      author_login: "jane-dev",
      state: "closed",
      merged: true,
      created_at: "2026-06-10T12:00:00Z",
      updated_at: "2026-06-11T12:00:00Z",
      merged_at: "2026-06-12T12:00:00Z",
      changed_files: ["packages/sync/src/live-query.ts", "apps/web/src/hooks/useRooms.tsx"],
      url: "https://github.com/electric-sql/electric/pull/123"
    },
    {
      id: 102,
      repo: "docs-only/reactive-demo",
      number: 5,
      title: "Fix README typo",
      body: "Corrects tutorial text.",
      author_login: "weak-docs",
      state: "closed",
      merged: true,
      created_at: "2026-06-10T12:00:00Z",
      updated_at: "2026-06-10T12:00:00Z",
      merged_at: "2026-06-10T12:00:00Z",
      changed_files: ["README.md"],
      url: "https://github.com/docs-only/reactive-demo/pull/5"
    },
    {
      id: 103,
      repo: "electric-sql/electric",
      number: 6,
      title: "Automated live query replication cleanup",
      body: "Automated account touched live query replication code.",
      author_login: "Copilot",
      state: "closed",
      merged: true,
      created_at: "2026-06-10T12:00:00Z",
      updated_at: "2026-06-10T12:00:00Z",
      merged_at: "2026-06-10T12:00:00Z",
      changed_files: ["packages/sync/src/live-query.ts"],
      url: "https://github.com/electric-sql/electric/pull/6"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_issues.jsonl"), [
    {
      id: 201,
      repo: "electric-sql/electric",
      number: 456,
      title: "Replication lag with live queries",
      body: "Live queries sometimes fall behind when subscriptions reconnect.",
      author_login: "jane-dev",
      state: "open",
      created_at: "2026-06-05T12:00:00Z",
      updated_at: "2026-06-06T12:00:00Z",
      url: "https://github.com/electric-sql/electric/issues/456"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_comments.jsonl"), [
    {
      id: 301,
      repo: "electric-sql/electric",
      parent_type: "issue",
      parent_number: 456,
      body: "This looks like a conflict resolution bug in the sync protocol.",
      author_login: "jane-dev",
      created_at: "2026-06-06T13:00:00Z",
      url: "https://github.com/electric-sql/electric/issues/456#issuecomment-301"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_commits.jsonl"), [
    {
      sha: "abc123",
      repo: "electric-sql/electric",
      author_login: "jane-dev",
      message: "Fix websocket reconnect behavior for subscriptions",
      committed_at: "2026-06-09T12:00:00Z",
      changed_files: ["packages/sync/src/socket.ts"],
      url: "https://github.com/electric-sql/electric/commit/abc123"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_manifests.jsonl"), [
    {
      repo: "electric-sql/electric",
      path: "package.json",
      kind: "package_json",
      package_names: ["typescript", "react", "pg", "ws"],
      scripts: ["test", "build"],
      ci_keywords: [],
      content_excerpt: "{\"dependencies\":{\"react\":\"latest\",\"pg\":\"latest\",\"ws\":\"latest\"}}",
      url: "https://github.com/electric-sql/electric/blob/main/package.json"
    },
    {
      repo: "electric-sql/electric",
      path: ".github/workflows/ci.yml",
      kind: "github_workflow",
      package_names: [],
      scripts: [],
      ci_keywords: ["test", "postgres", "websocket"],
      content_excerpt: "Run sync integration tests against Postgres and WebSocket subscriptions.",
      url: "https://github.com/electric-sql/electric/blob/main/.github/workflows/ci.yml"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_pull_request_reviews.jsonl"), [
    {
      id: 401,
      repo: "electric-sql/electric",
      pull_number: 123,
      author_login: "jane-dev",
      state: "APPROVED",
      body: "The live query invalidation path looks correct after this replication fix.",
      submitted_at: "2026-06-11T14:00:00Z",
      url: "https://github.com/electric-sql/electric/pull/123#pullrequestreview-401"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_pull_request_review_comments.jsonl"), [
    {
      id: 501,
      repo: "electric-sql/electric",
      pull_number: 123,
      author_login: "jane-dev",
      body: "This WebSocket reconnect path should invalidate subscription cache entries.",
      path: "packages/sync/src/socket.ts",
      created_at: "2026-06-11T15:00:00Z",
      url: "https://github.com/electric-sql/electric/pull/123#discussion_r501"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_workflow_runs.jsonl"), [
    {
      id: 601,
      repo: "electric-sql/electric",
      name: "sync integration tests",
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      actor_login: "jane-dev",
      created_at: "2026-06-11T16:00:00Z",
      updated_at: "2026-06-11T16:30:00Z",
      url: "https://github.com/electric-sql/electric/actions/runs/601"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_contributor_stats.jsonl"), [
    {
      login: "jane-dev",
      repo: "electric-sql/electric",
      pull_request_count: 1,
      merged_pull_request_count: 1,
      commit_count: 1,
      issue_count: 1,
      comment_count: 1,
      review_count: 1,
      review_comment_count: 1,
      failed_workflow_count: 1,
      repos_touched: ["electric-sql/electric"],
      last_active_at: "2026-06-12T12:00:00Z"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_repo_expansions.jsonl"), [
    {
      source_repo: "electric-sql/electric",
      expanded_repo: "electric-sql/pglite",
      reason: "shared_contributor",
      evidence: "jane-dev contributes near electric-sql/electric"
    }
  ]);

  await writeJsonl(join(rawDir, "raw_users.jsonl"), [
    {
      id: 42,
      login: "jane-dev",
      type: "User",
      name: "Jane Developer",
      company: "ExampleCo",
      location: "San Francisco",
      blog: "https://jane.dev",
      email: null,
      bio: "Building sync systems",
      public_repos: 80,
      followers: 1200,
      created_at: "2017-01-01T00:00:00Z",
      url: "https://github.com/jane-dev"
    },
    {
      id: 43,
      login: "weak-docs",
      type: "User",
      name: "Weak Docs",
      company: null,
      location: null,
      blog: null,
      email: null,
      bio: "Tutorial writer",
      public_repos: 3,
      followers: 1,
      created_at: "2025-01-01T00:00:00Z",
      url: "https://github.com/weak-docs"
    },
    {
      id: 44,
      login: "Copilot",
      type: "Bot",
      name: "Copilot",
      company: null,
      location: null,
      blog: null,
      email: null,
      bio: "Automation",
      public_repos: 0,
      followers: 0,
      created_at: "2025-01-01T00:00:00Z",
      url: "https://github.com/Copilot"
    }
  ]);

  await writeJsonl(join(workspaceRoot, "data", "eval", "golden_labels.jsonl"), [
    { query_id: "convex_realtime_sync_engineers", engineer_login: "jane-dev", label: 3 },
    { query_id: "convex_realtime_sync_engineers", engineer_login: "weak-docs", label: 0 }
  ]);
}

async function mkdirp(path: string) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path, { recursive: true }));
}
