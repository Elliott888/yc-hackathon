import { existsSync, readFileSync } from "node:fs";
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

test("workflow persists the latest browser snapshot and clears it on reset", () => {
  const chat = read("src/components/chat.tsx");

  assert.match(chat, /loadWorkflowSnapshot/);
  assert.match(chat, /saveWorkflowSnapshot/);
  assert.match(chat, /clearWorkflowSnapshot/);
  assert.match(chat, /hasHydratedSnapshotRef/);
  assert.match(chat, /setResearch\(snapshot\.research\)/);
  assert.match(chat, /setPainPoints\(snapshot\.painPoints\)/);
  assert.match(chat, /setLeads\(snapshot\.leads\)/);
  assert.match(chat, /clearWorkflowSnapshot\(\)/);
});

test("workflow storage exposes a versioned latest-snapshot localStorage contract", () => {
  const storagePath = new URL("../src/lib/workflow-storage.ts", import.meta.url);

  assert.equal(existsSync(storagePath), true);

  const storage = read("src/lib/workflow-storage.ts");

  assert.match(storage, /WORKFLOW_SNAPSHOT_VERSION = 1/);
  assert.match(storage, /WORKFLOW_SNAPSHOT_STORAGE_KEY/);
  assert.match(storage, /export type WorkflowSnapshot/);
  assert.match(storage, /export function loadWorkflowSnapshot/);
  assert.match(storage, /export function saveWorkflowSnapshot/);
  assert.match(storage, /export function clearWorkflowSnapshot/);
  assert.match(storage, /isPainPoint/);
  assert.match(storage, /isLead/);
});
