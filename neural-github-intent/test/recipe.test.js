import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRecipe } from "../src/recipe.js";

test("loads the Convex recipe with seed repos, categories, and scoring terms", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");

  assert.equal(recipe.id, "convex");
  assert.equal(recipe.days, 90);
  assert.ok(recipe.targetPrompt.includes("Convex"));
  assert.ok(recipe.seedRepos.includes("electric-sql/electric"));
  assert.ok(recipe.seedRepos.includes("instantdb/instant"));
  assert.ok(recipe.seedRepos.includes("firebase/firebase-js-sdk"));
  assert.ok(recipe.seedRepos.includes("posthog/posthog"));
  assert.ok(recipe.seedRepos.includes("continuedev/continue"));
  assert.ok(recipe.seedRepos.includes("openai/openai-node"));
  assert.ok(recipe.seedRepos.includes("n8n-io/n8n"));
  assert.ok(recipe.seedRepos.length >= 40);
  assert.ok(recipe.categories.realtime_sync.terms.includes("replication"));
  assert.ok(recipe.categories.cache_state.terms.includes("cache invalidation"));
  assert.ok(recipe.categories.analytics_growth.terms.includes("event tracking"));
  assert.ok(recipe.categories.ai_devtools.terms.includes("coding agent"));
  assert.ok(recipe.categories.workflow_automation.terms.includes("spreadsheet"));
  assert.ok(recipe.positiveTerms.includes("live query"));
  assert.ok(recipe.positiveTerms.includes("firebase alternative"));
  assert.ok(recipe.positiveTerms.includes("simpler full-stack backend"));
  assert.ok(recipe.negativeTerms.includes("docs only"));
});
