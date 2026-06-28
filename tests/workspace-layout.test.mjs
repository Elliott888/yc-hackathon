import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("workspace desktop layout makes pain points wider than chat", () => {
  const source = read("src/components/chat.tsx");
  const workspace = source.match(
    /function Workspace\([\s\S]*?\nfunction LeadsWorkspace/
  )?.[0];

  assert.ok(workspace, "Workspace component should exist");
  assert.match(
    workspace,
    /lg:grid-cols-\[minmax\(340px,420px\)_minmax\(0,1fr\)\]/
  );
});

test("pain points panel removes company summary and uses a compact trigger", () => {
  const source = read("src/components/chat.tsx");
  const painPointsPanel = source.match(
    /function PainPointsPanel\([\s\S]*?\nfunction ChatPanel/
  )?.[0];

  assert.ok(painPointsPanel, "PainPointsPanel component should exist");
  assert.doesNotMatch(painPointsPanel, /research\.summary|research\.customers/);
  assert.match(source, /function PainPointTrigger/);
  assert.match(painPointsPanel, /group\/trigger relative min-w-0 p-2/);
  assert.match(painPointsPanel, /group-hover\/trigger:opacity-100/);
  assert.match(painPointsPanel, /Open pain point actions/);
  assert.match(painPointsPanel, /DropdownMenuItem onClick=\{onEdit\}/);
  assert.match(painPointsPanel, /Save pain point changes/);
  assert.match(painPointsPanel, /Cancel pain point changes/);
  assert.match(painPointsPanel, /editingDraft/);
  assert.match(painPointsPanel, /ml-7 flex flex-col gap-4 border-l/);
  assert.match(painPointsPanel, /aria-label="Pain point title"/);
  assert.match(painPointsPanel, /aria-label="Pain point description"/);
  assert.doesNotMatch(painPointsPanel, /group-hover:opacity-100/);
});

test("code examples render as borderless text rows without icon affordance", () => {
  const source = read("src/components/chat.tsx");

  assert.doesNotMatch(source, /Code2Icon/);
  assert.match(source, /function CodeExampleList/);
  assert.match(source, /font-medium text-foreground/);
  assert.match(source, /text-muted-foreground/);
});

test("leads table uses buying signals score evidence columns and opens a detail panel", () => {
  const source = read("src/components/chat.tsx");

  assert.match(source, /<TableHead className="px-4 py-3">Name<\/TableHead>/);
  assert.match(
    source,
    /<TableHead className="px-4 py-3">Buying Signals<\/TableHead>/
  );
  assert.doesNotMatch(source, />Profile<\/TableHead>/);
  assert.match(source, /<TableHead className="w-24 px-4 py-3">Score<\/TableHead>/);
  assert.match(source, /<TableHead className="px-4 py-3">Evidence<\/TableHead>/);
  assert.match(source, /averageLeadEvidenceScore\(lead\.evidence, lead\.score\)/);
  assert.match(source, /min-w-\[560px\] overflow-hidden rounded-lg border bg-card/);
  assert.match(source, /TableCell className="px-4 py-4 font-medium"/);
  assert.match(
    source,
    /TableCell className="w-\[28rem\] max-w-\[28rem\] px-4 py-4 align-middle"/
  );
  assert.match(
    source,
    /overflow-hidden text-ellipsis text-sm leading-6 whitespace-normal/
  );
  assert.match(
    source,
    /WebkitLineClamp: 3/
  );
  assert.match(source, /WebkitBoxOrient: "vertical"/);
  assert.match(source, /function LeadEvidencePanel/);
  assert.match(source, /selectedLead/);
});
