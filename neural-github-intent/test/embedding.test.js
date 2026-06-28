import assert from "node:assert/strict";
import { test } from "node:test";
import { semanticSimilarity } from "../src/embedding.js";

test("semantic similarity connects Convex wording to sync and live-query language", () => {
  const query = "reactive backend state for realtime database applications";
  const relevant = "live query invalidation over websocket subscriptions after Postgres replication";
  const irrelevant = "CSS utility examples and color palette documentation";

  assert.ok(semanticSimilarity(query, relevant) > semanticSimilarity(query, irrelevant));
  assert.ok(semanticSimilarity(query, relevant) > 0.15);
});

test("embedding safely handles tokens that collide with object prototype names", () => {
  assert.doesNotThrow(() => semanticSimilarity("reactive database", "constructor prototype websocket sync"));
});
