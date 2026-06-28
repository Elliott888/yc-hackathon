import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("workflow stages have separate routes backed by a shared layout", () => {
  const layout = read("src/app/(workflow)/layout.tsx");
  const input = read("src/app/(workflow)/input/page.tsx");
  const painpoints = read("src/app/(workflow)/painpoints/page.tsx");
  const table = read("src/app/(workflow)/table/page.tsx");

  assert.match(layout, /WorkflowProvider/);
  assert.match(input, /WorkflowInputRoute/);
  assert.match(painpoints, /WorkflowPainPointsRoute/);
  assert.match(table, /WorkflowTableRoute/);
});

test("root route sends users to the input stage", () => {
  const page = read("src/app/page.tsx");

  assert.match(page, /redirect\(["']\/input["']\)/);
});

test("hardcoded painpoints table preview route renders the preview component", () => {
  const page = read("src/app/painpoints-table/page.tsx");

  assert.match(page, /PainPointsTablePreview/);
});
