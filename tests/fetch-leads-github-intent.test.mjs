import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fetch leads route uses the Node runtime and GitHub intent adapter", () => {
  const source = read("src/app/api/fetch-leads/route.ts");

  assert.match(source, /export const runtime = ["']nodejs["']/);
  assert.match(source, /fetchGithubIntentLeads/);
  assert.match(source, /painPoints/);
  assert.match(source, /companyName/);
  assert.doesNotMatch(source, /createPlaceholderLeads/);
});

test("GitHub intent query builder asks for engineer leads from pain points", () => {
  const source = read("src/lib/github-intent-query.ts");

  assert.match(source, /Return engineers, not companies/);
  assert.match(
    source,
    /Prioritize evidence from issues, pull requests, comments, commits, and code changes/
  );
  assert.match(source, /painPoint\.subpoints/);
});

test("GitHub intent lead adapter calls Track B search and maps evidence", () => {
  const source = read("src/lib/github-intent-leads.ts");

  assert.match(source, /dist\/track-b-intelligence\/src\/search\.js/);
  assert.match(source, /searchLeads/);
  assert.match(source, /engineer_login/);
  assert.match(source, /final_score/);
  assert.match(source, /evidence\.slice\(0, 3\)/);
});

test("frontend sends company name with pain points and labels results as engineer leads", () => {
  const source = read("src/components/chat.tsx");

  assert.match(
    source,
    /body: JSON\.stringify\(\{ painPoints, companyName \}\)/
  );
  assert.match(source, /Engineer leads/);
  assert.doesNotMatch(source, /Placeholder accounts matched/);
});
