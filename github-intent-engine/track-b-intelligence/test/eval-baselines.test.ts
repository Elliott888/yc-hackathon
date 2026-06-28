import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { embeddingDimensions, embedText } from "../src/embedding.js";
import { evaluateLeads } from "../src/eval.js";
import { writeJsonl } from "../src/io.js";
import { parseRecipe } from "../src/recipe.js";
import { compareSearchBaselines } from "../src/search.js";
import type { EngineerEmbedding, RankedLead, Recipe } from "../src/types.js";

let rootDir: string;
let recipe: Recipe;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "track-b-eval-"));
  await mkdirp(join(rootDir, "contracts"));
  await mkdirp(join(rootDir, "data", "processed"));
  await mkdirp(join(rootDir, "data", "eval"));
  const recipeText = recipeFixture();
  recipe = parseRecipe(recipeText);
  await writeFile(join(rootDir, "contracts", "convex_recipe.yaml"), recipeText, "utf8");
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("query-specific evaluation with baselines", () => {
  test("shows intent ranking improving precision over keyword and semantic baselines", async () => {
    const query =
      "Find founders or engineers on Github talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.";
    const queryId = "convex_cache_websocket_baas_prompt";
    const keywordTrap = leadFixture({
      engineer_login: "keyword-trap",
      score: 120,
      top_topics: ["backend state"],
      semantic_document:
        "Firebase alternatives Supabase alternatives simpler full-stack backend backend-as-a-service",
      evidence: [
        {
          type: "pull_request",
          repo: "supabase/supabase",
          title: "docs: add Firebase alternatives comparison guide",
          text: "Supabase alternatives Firebase alternatives guide",
          url: "https://github.com/supabase/supabase/pull/1",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const semanticTrap = leadFixture({
      engineer_login: "semantic-trap",
      score: 105,
      top_topics: ["realtime", "WebSocket", "backend state"],
      semantic_document:
        "realtime WebSocket backend-as-a-service serverless backend Firebase Supabase full-stack backend",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "chore: refresh UI snapshots",
          text: "routine ui update",
          url: "https://github.com/appwrite/appwrite/pull/2",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 7
        }
      ]
    });
    const evidenceLead = leadFixture({
      engineer_login: "evidence-lead",
      score: 62,
      top_topics: ["cache invalidation", "WebSocket", "subscriptions"],
      semantic_document:
        "cache invalidation WebSocket subscriptions backend-as-a-service simpler backend",
      evidence: [
        {
          type: "issue",
          repo: "appwrite/appwrite",
          title: "Cache invalidation race breaks WebSocket subscriptions",
          text: "We want a simpler full-stack backend because cache invalidation keeps breaking realtime websocket subscriptions.",
          url: "https://github.com/appwrite/appwrite/issues/3",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation", "WebSocket", "subscriptions"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      keywordTrap,
      semanticTrap,
      evidenceLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(keywordTrap),
      embeddingFor(semanticTrap),
      embeddingFor(evidenceLead)
    ]);
    await writeJsonl(join(rootDir, "data", "eval", "golden_labels.jsonl"), [
      { query_id: queryId, engineer_login: "keyword-trap", label: 0 },
      { query_id: queryId, engineer_login: "semantic-trap", label: 1 },
      { query_id: queryId, engineer_login: "evidence-lead", label: 3 }
    ]);

    const comparison = await compareSearchBaselines({ rootDir, query, limit: 3 });

    expect(comparison.baselines.keyword.results[0]?.engineer_login).toBe("keyword-trap");
    expect(comparison.baselines.semantic.results[0]?.engineer_login).toBe("semantic-trap");
    expect(comparison.baselines.intent.results[0]?.engineer_login).toBe("evidence-lead");

    const report = await evaluateLeads({ rootDir, query, queryId, kValues: [1, 3] });

    expect(report.metrics.precision_at_1).toBe(1);
    expect(report.baseline_metrics?.keyword.precision_at_1).toBe(0);
    expect(report.baseline_metrics?.semantic.precision_at_1).toBe(0);
    expect(report.baseline_metrics?.intent.precision_at_1).toBe(1);
    expect(report.baseline_top_leads?.intent[0]).toBe("evidence-lead");
  });
});

function leadFixture(overrides: Partial<RankedLead>): RankedLead {
  return {
    engineer_login: "engineer",
    name: null,
    score: 50,
    why_relevant: "Relevant public activity.",
    outreach_angle: "Relevant to Convex.",
    score_breakdown: {
      recent_activity: 20,
      repo_category_fit: 20,
      topic_fit: 20,
      contribution_depth: 10,
      stack_fit: 5,
      evidence_quality: 5,
      penalties: 0
    },
    evidence: [],
    top_repos: ["appwrite/appwrite"],
    top_topics: [],
    repo_categories: ["backend-as-a-service", "real-time sync"],
    primary_languages: ["TypeScript"],
    last_active_at: "2026-06-20T10:00:00Z",
    window_start_at: "2026-03-22T10:00:00Z",
    time_window_days: 90,
    semantic_document: "",
    ...overrides
  };
}

function embeddingFor(lead: RankedLead): EngineerEmbedding {
  const dimensions = embeddingDimensions(recipe);
  return {
    engineer_login: lead.engineer_login,
    dimensions,
    vector: embedText(lead.semantic_document, dimensions)
  };
}

async function mkdirp(path: string) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path, { recursive: true }));
}

function recipeFixture(): string {
  return `id: convex_realtime_sync_engineers
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
`;
}
