import { existsSync, readFileSync } from "node:fs";
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

test("GitHub intent lead adapter calls hybrid search and maps multiple evidence signals", () => {
  const source = read("src/lib/github-intent-leads.ts");

  assert.match(source, /hybrid-github-intent\/src\/engine\.js/);
  assert.match(source, /searchHybrid/);
  assert.match(source, /useAllIndexes/);
  assert.match(source, /engineer_login/);
  assert.match(source, /icp_fit_score/);
  assert.match(source, /trigger/);
  assert.match(source, /evidence\?: HybridTriggerEvidence\[\]/);
  assert.match(source, /result\.evidence/);
  assert.match(source, /\.slice\(0, 3\)/);
  assert.doesNotMatch(source, /result\.outreach\?\.join\(" "\)/);
  assert.doesNotMatch(source, /searchLeads/);
});

test("GitHub intent lead adapter has a deployable fallback index", () => {
  const source = read("src/lib/github-intent-leads.ts");
  const nextConfig = read("next.config.ts");
  const fallbackIndexPath = new URL(
    "../src/data/hybrid-structured/data/processed/ranked_leads.jsonl",
    import.meta.url
  );

  assert.match(source, /production-neural-fallback/);
  assert.match(source, /"src",\s*"data",\s*"hybrid-structured"/);
  assert.match(source, /assertHybridIndexSourcesExist\(indexSources\)/);
  assert.doesNotMatch(source, /assertProcessedIndexExists\(structuredRoot\)/);
  assert.ok(existsSync(fallbackIndexPath));
  assert.match(nextConfig, /outputFileTracingIncludes/);
  assert.match(nextConfig, /["']\/api\/fetch-leads["']/);
  assert.match(nextConfig, /src\/data\/hybrid-structured/);
  assert.match(nextConfig, /neural-github-intent\/data-track-a-1000\/scored_leads\.ndjson/);
});

test("frontend sends company name with pain points and labels results as engineer leads", () => {
  const source = read("src/components/chat.tsx");

  assert.match(
    source,
    /body: JSON\.stringify\(\{ painPoints, companyName \}\)/
  );
  assert.match(source, /Find Engineers/);
  assert.match(source, /finding engineers/);
  assert.match(source, /Engineer leads/);
  assert.doesNotMatch(source, /Find Customers/);
  assert.doesNotMatch(source, /Placeholder accounts matched/);
});
