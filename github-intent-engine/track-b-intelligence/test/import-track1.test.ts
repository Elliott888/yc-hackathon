import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { importTrackOneLeads } from "../src/import-track1.js";
import { readJsonl } from "../src/io.js";
import { searchLeads } from "../src/search.js";
import type { EngineerEmbedding, RankedLead } from "../src/types.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "track-b-import-"));
  await mkdirp(join(rootDir, "contracts"));
  await mkdirp(join(rootDir, "data", "processed"));
  await writeRecipe(rootDir);
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("Track 1 lead import", () => {
  test("converts scored_leads.ndjson into searchable Track B artifacts", async () => {
    const sourcePath = await writeTrackOneLeadFixture(rootDir);
    const modelPath = await writeNeuralModelFixture(rootDir);

    const result = await importTrackOneLeads({ rootDir, sourcePath, modelPath });

    expect(result.leadCount).toBe(1);
    expect(result.topLead?.engineer_login).toBe("jane-sync");
    expect(result.topLead?.neural_intent_score).toBeGreaterThan(0.9);

    const leads = await readJsonl<RankedLead>(join(rootDir, "data", "processed", "ranked_leads.jsonl"));
    expect(leads[0]?.score).toBe(92);
    expect(leads[0]?.neural_intent_score).toBeGreaterThan(0.9);
    expect(leads[0]?.burning_problem_score).toBeGreaterThan(0.7);
    expect(leads[0]?.pain_signals).toContain("production impact");
    expect(leads[0]?.repo_categories).toEqual(["real-time sync", "reactive database"]);
    expect(leads[0]?.top_topics).toEqual(["replication", "live query", "WebSocket"]);
    expect(leads[0]?.primary_languages).toEqual(["Postgres", "WebSocket"]);
    expect(leads[0]?.evidence[0]?.type).toBe("pull_request");
    expect(leads[0]?.evidence[0]?.neural_intent_score).toBeGreaterThan(0.9);
    expect(leads[0]?.evidence[0]?.burning_problem_score).toBeGreaterThan(0.7);
    expect(leads[0]?.evidence[0]?.buyer_intent_label).toBe("burning_problem");
    expect(leads[0]?.evidence[0]?.pain_signals).toContain("production impact");
    expect(leads[0]?.evidence[0]?.text).toContain("Production users");
    expect(leads[0]?.evidence[0]?.matched_topics).toEqual(["replication", "live query", "WebSocket"]);
    expect(leads[0]?.semantic_document).toContain("live query invalidation");
    expect(leads[0]?.semantic_document).toContain("WebSocket, SSE, or polling code");
    expect(leads[0]?.semantic_document).toContain("production impact");
    expect(leads[0]?.semantic_document).toContain("neural intent score");
    expect(leads[0]?.answer_context?.problem_signals).toContain("live query");
    expect(leads[0]?.answer_context?.burning_problem_score).toBeGreaterThan(0.7);
    expect(leads[0]?.answer_context?.stack_signals).toContain("Postgres");
    expect(leads[0]?.semantic_document).toContain("Ask about live query invalidation");

    const embeddings = await readJsonl<EngineerEmbedding>(
      join(rootDir, "data", "processed", "engineer_embeddings.jsonl")
    );
    expect(embeddings[0]?.engineer_login).toBe("jane-sync");
    expect(embeddings[0]?.vector.some((value) => value > 0)).toBe(true);

    const searchResult = await searchLeads({
      rootDir,
      query: "Find engineers working on reactive database live query replication for Convex",
      limit: 1
    });
    expect(searchResult.results[0]?.engineer_login).toBe("jane-sync");
    expect(searchResult.results[0]?.semantic_score).toBeGreaterThan(0.5);
  });

  test("CLI imports a Track 1 scored leads file", async () => {
    const sourcePath = await writeTrackOneLeadFixture(rootDir);

    const result = spawnSync(
      "npx",
      ["tsx", "track-b-intelligence/src/cli.ts", "import-track1", "--root", rootDir, "--source", sourcePath],
      {
        cwd: join(import.meta.dirname, "..", ".."),
        encoding: "utf8"
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"leadCount": 1');

    const leads = await readJsonl<RankedLead>(join(rootDir, "data", "processed", "ranked_leads.jsonl"));
    expect(leads[0]?.engineer_login).toBe("jane-sync");
  });

  test("does not copy broad lead topics onto unrelated activity evidence", async () => {
    const sourcePath = join(rootDir, "scored_leads.ndjson");
    await writeFile(
      sourcePath,
      `${JSON.stringify({
        engineer_login: "docs-heavy",
        name: null,
        company: null,
        github_url: "https://github.com/docs-heavy",
        repo: "supabase/supabase",
        repo_category: ["Realtime sync", "Backend as a service"],
        score: 88,
        why_relevant: "Broadly active in a realtime backend repo.",
        matched_topics: ["realtime", "replication", "websocket"],
        recent_activity: [
          {
            type: "opened_pull_request",
            repo: "supabase/supabase",
            title: "Fix docs typo",
            occurred_at: "2026-06-20T10:00:00Z",
            url: "https://github.com/supabase/supabase/pull/42",
            matched_terms: []
          }
        ],
        last_active_at: "2026-06-20T10:00:00Z",
        evidence_links: ["https://github.com/supabase/supabase/pull/42"],
        outreach_angle: "Potentially relevant but this activity is weak."
      })}\n`,
      "utf8"
    );

    await importTrackOneLeads({ rootDir, sourcePath });

    const leads = await readJsonl<RankedLead>(join(rootDir, "data", "processed", "ranked_leads.jsonl"));
    expect(leads[0]?.top_topics).toEqual(["replication", "realtime", "WebSocket"]);
    expect(leads[0]?.evidence[0]?.matched_topics).toEqual([]);
  });

  test("does not inflate generic cache evidence into cache invalidation", async () => {
    const sourcePath = join(rootDir, "scored_leads.ndjson");
    await writeFile(
      sourcePath,
      `${JSON.stringify({
        engineer_login: "generic-cache",
        name: null,
        company: null,
        github_url: "https://github.com/generic-cache",
        repo: "vercel/ai",
        repo_category: ["Backend as a service"],
        score: 82,
        why_relevant: "Generic cache work in a backend repo.",
        matched_topics: ["cache"],
        recent_activity: [
          {
            type: "opened_pull_request",
            repo: "vercel/ai",
            title: "Add provider cache option",
            occurred_at: "2026-06-20T10:00:00Z",
            url: "https://github.com/vercel/ai/pull/88",
            matched_terms: ["cache"]
          }
        ],
        last_active_at: "2026-06-20T10:00:00Z",
        evidence_links: ["https://github.com/vercel/ai/pull/88"],
        outreach_angle: "Should not be treated as cache invalidation pain."
      })}\n`,
      "utf8"
    );

    await importTrackOneLeads({ rootDir, sourcePath });

    const leads = await readJsonl<RankedLead>(join(rootDir, "data", "processed", "ranked_leads.jsonl"));
    expect(leads[0]?.top_topics).not.toContain("cache invalidation");
    expect(leads[0]?.evidence[0]?.matched_topics).not.toContain("cache invalidation");
  });

  test("caps neural score for weak maintenance evidence during import", async () => {
    const sourcePath = join(rootDir, "scored_leads.ndjson");
    const modelPath = await writeDemoLinkModelFixture(rootDir);
    await writeFile(
      sourcePath,
      `${JSON.stringify({
        engineer_login: "weak-maintenance",
        name: null,
        company: null,
        github_url: "https://github.com/weak-maintenance",
        repo: "umami-software/umami",
        repo_category: ["Analytics and growth engineering"],
        score: 80,
        why_relevant: "Broad analytics repo activity.",
        matched_topics: ["analytics"],
        recent_activity: [
          {
            type: "opened_pull_request",
            repo: "umami-software/umami",
            title: "Update demo link",
            occurred_at: "2026-06-20T10:00:00Z",
            url: "https://github.com/umami-software/umami/pull/42",
            matched_terms: []
          }
        ],
        last_active_at: "2026-06-20T10:00:00Z",
        evidence_links: ["https://github.com/umami-software/umami/pull/42"],
        outreach_angle: "Should not get a neural boost."
      })}\n`,
      "utf8"
    );

    await importTrackOneLeads({ rootDir, sourcePath, modelPath });

    const leads = await readJsonl<RankedLead>(join(rootDir, "data", "processed", "ranked_leads.jsonl"));
    expect(leads[0]?.neural_intent_score).toBeLessThan(0.3);
    expect(leads[0]?.evidence[0]?.neural_intent_score).toBeLessThan(0.3);
  });

  test("filters known automation identities from imported leads", async () => {
    const sourcePath = join(rootDir, "scored_leads.ndjson");
    await writeFile(
      sourcePath,
      `${JSON.stringify({
        engineer_login: "Copilot",
        name: "Copilot",
        company: null,
        github_url: "https://github.com/Copilot",
        repo: "pubkey/rxdb",
        repo_category: ["Realtime sync", "Reactive database"],
        score: 99,
        why_relevant: "Automation account touched sync code.",
        matched_topics: ["replication", "live query"],
        recent_activity: [
          {
            type: "commit",
            repo: "pubkey/rxdb",
            title: "Automated sync update",
            occurred_at: "2026-06-20T10:00:00Z",
            url: "https://github.com/pubkey/rxdb/commit/1",
            matched_terms: ["replication", "live query"]
          }
        ],
        last_active_at: "2026-06-20T10:00:00Z",
        evidence_links: ["https://github.com/pubkey/rxdb/commit/1"],
        outreach_angle: "Should not be shown as a human sales lead."
      })}\n`,
      "utf8"
    );

    const result = await importTrackOneLeads({ rootDir, sourcePath });

    expect(result.leadCount).toBe(0);
    const leads = await readJsonl<RankedLead>(join(rootDir, "data", "processed", "ranked_leads.jsonl"));
    expect(leads).toEqual([]);
  });
});

async function writeTrackOneLeadFixture(workspaceRoot: string): Promise<string> {
  const sourcePath = join(workspaceRoot, "scored_leads.ndjson");
  await writeFile(
    sourcePath,
    `${JSON.stringify({
        engineer_login: "jane-sync",
        name: "Jane Sync",
        company: "Realtime Systems",
        github_url: "https://github.com/jane-sync",
        repo: "electric-sql/electric",
        repo_category: ["Realtime sync", "Reactive database"],
        score: 92,
        why_relevant: "Recently worked on live query invalidation and Postgres replication.",
        matched_topics: ["replication", "live query", "websocket", "postgres"],
        recent_activity: [
          {
            type: "merged_pull_request",
            repo: "electric-sql/electric",
            title: "Improve live query invalidation for Postgres replication",
            snippet:
              "Production users see stale live query results when Postgres replication falls behind.",
            occurred_at: "2026-06-20T10:00:00Z",
            url: "https://github.com/electric-sql/electric/pull/101",
            matched_terms: ["replication", "live query", "websocket", "postgres"],
            pain_score: 0.82,
            buyer_intent_label: "burning_problem",
            pain_signals: ["production impact", "stale data"]
          }
        ],
        last_active_at: "2026-06-20T10:00:00Z",
        evidence_links: ["https://github.com/electric-sql/electric/pull/101"],
        answer_context: {
          problem_signals: ["live query", "replication"],
          pain_signals: ["production impact", "stale data"],
          burning_problem_score: 0.82,
          stack_signals: ["Postgres", "WebSocket"],
          repo_signals: ["Realtime sync", "Reactive database"],
          evidence_snippets: [
            {
              type: "merged_pull_request",
              repo: "electric-sql/electric",
              title: "Improve live query invalidation for Postgres replication",
              url: "https://github.com/electric-sql/electric/pull/101",
              occurred_at: "2026-06-20T10:00:00Z",
              matched_terms: ["replication", "live query", "websocket", "postgres"],
              pain_score: 0.82,
              buyer_intent_label: "burning_problem",
              pain_signals: ["production impact", "stale data"],
              snippet: "Improve live query invalidation for Postgres replication"
            }
          ],
          outreach_hooks: ["Ask about live query invalidation and Postgres replication."]
        },
        outreach_angle:
          "Good Convex lead because they are actively working near reactive backend state and sync complexity."
      })}\n`,
    "utf8"
  );
  return sourcePath;
}

async function writeNeuralModelFixture(workspaceRoot: string): Promise<string> {
  const modelPath = join(workspaceRoot, "neural_reranker.json");
  await writeFile(
    modelPath,
    `${JSON.stringify({
      kind: "one_hidden_layer_binary_reranker",
      vocabulary: ["live", "query", "replication", "docs"],
      hidden_weights: [[8, 8, 8, -8]],
      hidden_bias: [-8],
      output_weights: [10],
      output_bias: -5
    })}\n`,
    "utf8"
  );
  return modelPath;
}

async function writeDemoLinkModelFixture(workspaceRoot: string): Promise<string> {
  const modelPath = join(workspaceRoot, "demo_link_model.json");
  await writeFile(
    modelPath,
    `${JSON.stringify({
      kind: "one_hidden_layer_binary_reranker",
      vocabulary: ["demo", "link"],
      hidden_weights: [[8, 8]],
      hidden_bias: [-4],
      output_weights: [10],
      output_bias: -5
    })}\n`,
    "utf8"
  );
  return modelPath;
}

async function mkdirp(path: string) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path, { recursive: true }));
}

async function writeRecipe(workspaceRoot: string) {
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
`,
    "utf8"
  );
}
