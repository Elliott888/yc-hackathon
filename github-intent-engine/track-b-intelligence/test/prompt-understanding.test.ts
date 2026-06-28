import { describe, expect, test } from "vitest";
import { parseRecipe } from "../src/recipe.js";
import { buildQueryPlan } from "../src/search.js";
import { includesTerm } from "../src/text.js";

const prompt =
  "Find founders or engineers on Github talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.";

describe("prompt understanding", () => {
  test("recognizes comma-delimited cache invalidation terms", () => {
    expect(includesTerm(prompt, "cache invalidation")).toBe(true);
  });

  test("expands Firebase/Supabase alternative and full-stack backend intent", () => {
    const plan = buildQueryPlan(prompt, recipeFixture());

    expect(plan.target_entity).toBe("founder_or_engineer");
    expect(plan.topics).toEqual(
      expect.arrayContaining(["cache invalidation", "WebSocket", "backend state", "serverless function"])
    );
    expect(plan.categories).toEqual(
      expect.arrayContaining(["backend-as-a-service", "serverless backend", "reactive database"])
    );
  });

  test("uses buyer product named in preset-style prompts", () => {
    const recipe = recipeFixture();

    expect(
      buildQueryPlan(
        "Find AI engineers or platform teams who look like potential buyers for OpenAI: people building agents and evals.",
        recipe
      ).target_product
    ).toBe("OpenAI");
    expect(
      buildQueryPlan(
        "Find AI engineering teams or devtool founders who look like potential buyers for Lore: people running into Codex context limits.",
        recipe
      ).target_product
    ).toBe("Lore");
    expect(
      buildQueryPlan(
        "Find growth engineers or product engineers who look like potential buyers for Lopus: people struggling with event ingestion quality.",
        recipe
      ).target_product
    ).toBe("Lopus");
  });
});

function recipeFixture() {
  return parseRecipe(`id: convex_realtime_sync_engineers
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
`);
}
