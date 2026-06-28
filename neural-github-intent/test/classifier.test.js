import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { classifyRepo } from "../src/classifier.js";
import { loadRecipe } from "../src/recipe.js";

test("classifies realtime sync repos above unrelated popular repos", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");
  const fixture = JSON.parse(await readFile("test/fixtures/convex-github.json", "utf8"));

  const electric = classifyRepo(fixture.repos[0], recipe);
  const tailwind = classifyRepo(fixture.repos[1], recipe);

  assert.equal(electric.repo, "electric-sql/electric");
  assert.ok(electric.categories.some((category) => category.id === "realtime_sync"));
  assert.ok(electric.categories.some((category) => category.id === "reactive_database"));
  assert.ok(electric.categoryScore > tailwind.categoryScore);
  assert.equal(tailwind.categories.length, 0);
});
