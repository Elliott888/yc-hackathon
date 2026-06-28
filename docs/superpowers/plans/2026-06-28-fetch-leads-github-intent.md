# Fetch Leads GitHub Intent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing frontend "find customers" flow to the GitHub intent engine so edited pain points produce ranked engineer leads in the existing table.

**Architecture:** The frontend keeps sending structured `PainPoint[]` to `/api/fetch-leads`. The route converts those pain points into a natural-language intent query, calls Track B's `searchLeads` over prebuilt `github-intent-engine/data/processed/*.jsonl`, then adapts engine results into the existing `Lead[]` UI contract. GitHub harvesting and index building remain offline/manual jobs, not request-time work.

**Tech Stack:** Next.js App Router route handlers, TypeScript, existing `Lead`/`PainPoint` workflow types, `github-intent-engine/track-b-intelligence/src/search.ts`, Node.js filesystem runtime.

---

## File Structure

- Modify: `src/app/api/fetch-leads/route.ts`
  - Owns HTTP request parsing, validation, response status, cache headers.
  - Calls the new adapter instead of returning placeholders.
- Create: `src/lib/github-intent-query.ts`
  - Converts `PainPoint[]` into the deterministic query string sent to the GitHub intent engine.
  - Keeps query generation testable without invoking the engine.
- Create: `src/lib/github-intent-leads.ts`
  - Locates engine data root.
  - Calls Track B `searchLeads`.
  - Maps `SearchResultLead[]` into the app's existing `Lead[]`.
- Modify: `src/components/chat.tsx`
  - Send `companyName` with `painPoints` for better query context.
  - Update table copy from placeholder/customer language to engineer-lead language.
- Create: `tests/fetch-leads-github-intent.test.mjs`
  - Static integration tests matching the repo's current test style.
  - Verifies the route is Node runtime, calls the adapter, and the adapter calls Track B search.
- Optional later: `vercel.json`
  - Only needed if adding scheduled ingestion later. Not part of this first connection.

## Pre-Implementation Notes

- Read `AGENTS.md` before editing. This repo says the installed Next.js version has breaking changes.
- Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before editing the route.
- Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md` before adding `export const runtime = "nodejs"`.
- The engine search path requires processed files. For local smoke testing without a real harvest, use `github-intent-engine/track-b-intelligence/mock-workspace`.
- Do not call `npm run harvest` inside `/api/fetch-leads`.

---

### Task 1: Add Static Tests For The Desired Connection

**Files:**
- Create: `tests/fetch-leads-github-intent.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/fetch-leads-github-intent.test.mjs`:

```js
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
  assert.match(source, /Prioritize evidence from issues, pull requests, comments, commits, and code changes/);
  assert.match(source, /painPoint\.subpoints/);
});

test("GitHub intent lead adapter calls Track B search and maps evidence", () => {
  const source = read("src/lib/github-intent-leads.ts");

  assert.match(source, /track-b-intelligence\/src\/search/);
  assert.match(source, /searchLeads/);
  assert.match(source, /engineer_login/);
  assert.match(source, /final_score/);
  assert.match(source, /evidence\.slice\(0, 3\)/);
});

test("frontend sends company name with pain points and labels results as engineer leads", () => {
  const source = read("src/components/chat.tsx");

  assert.match(source, /body: JSON\.stringify\(\{ painPoints, companyName \}\)/);
  assert.match(source, /Engineer leads/);
  assert.doesNotMatch(source, /Placeholder accounts matched/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL because `src/lib/github-intent-query.ts` and `src/lib/github-intent-leads.ts` do not exist, and the route still contains `createPlaceholderLeads`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/fetch-leads-github-intent.test.mjs
git commit -m "test: specify github intent fetch leads integration"
```

---

### Task 2: Add The Pain-Point-To-Query Builder

**Files:**
- Create: `src/lib/github-intent-query.ts`

- [ ] **Step 1: Implement query generation**

Create `src/lib/github-intent-query.ts`:

```ts
import type { PainPoint } from "@/lib/workflow";

export function buildGithubIntentQuery({
  painPoints,
  companyName,
}: {
  painPoints: PainPoint[];
  companyName?: string;
}) {
  const normalizedPainPoints = painPoints
    .map((painPoint) => ({
      ...painPoint,
      title: painPoint.title.trim(),
      description: painPoint.description.trim(),
      subpoints: painPoint.subpoints
        .map((subpoint) => ({
          ...subpoint,
          title: subpoint.title.trim(),
          description: subpoint.description.trim(),
        }))
        .filter((subpoint) => subpoint.title || subpoint.description),
    }))
    .filter((painPoint) => painPoint.title || painPoint.description);

  const target = companyName?.trim()
    ? ` for ${companyName.trim()}`
    : "";

  const painPointLines =
    normalizedPainPoints.length > 0
      ? normalizedPainPoints
          .map((painPoint, painPointIndex) => {
            const header = [
              `${painPointIndex + 1}.`,
              painPoint.title || "Untitled pain point",
              painPoint.description ? `- ${painPoint.description}` : "",
            ]
              .filter(Boolean)
              .join(" ");
            const subpoints = painPoint.subpoints
              .map((subpoint) => {
                const label = subpoint.title || "Code-level signal";
                return `   - ${label}${subpoint.description ? `: ${subpoint.description}` : ""}`;
              })
              .join("\n");
            return subpoints ? `${header}\n${subpoints}` : header;
          })
          .join("\n")
      : "1. Developer workflow friction - Find public code activity that suggests urgent developer-tooling pain.";

  return [
    `Find engineers on GitHub${target} with recent public activity showing these developer pain points.`,
    "Return engineers, not companies.",
    "Prioritize evidence from issues, pull requests, comments, commits, and code changes.",
    "Prefer concrete code-level signals over generic repository-topic matches.",
    "",
    "Pain points:",
    painPointLines,
  ].join("\n");
}
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
npm test
```

Expected: Still FAIL because the route and adapter are not implemented yet, but the query-builder assertions pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/github-intent-query.ts
git commit -m "feat: build github intent query from pain points"
```

---

### Task 3: Add The GitHub Intent Lead Adapter

**Files:**
- Create: `src/lib/github-intent-leads.ts`

- [ ] **Step 1: Implement adapter over Track B search**

Create `src/lib/github-intent-leads.ts`:

```ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildGithubIntentQuery } from "@/lib/github-intent-query";
import type { Lead, LeadEvidence, PainPoint } from "@/lib/workflow";
import type {
  EvidenceRecord,
  SearchResultLead,
} from "../../github-intent-engine/track-b-intelligence/src/types";

type SearchModule = typeof import("../../github-intent-engine/track-b-intelligence/src/search");

export type FetchGithubIntentLeadsInput = {
  painPoints: PainPoint[];
  companyName?: string;
  limit?: number;
};

export async function fetchGithubIntentLeads({
  painPoints,
  companyName,
  limit = 10,
}: FetchGithubIntentLeadsInput): Promise<Lead[]> {
  const rootDir = resolveGithubIntentRoot();
  assertProcessedIndexExists(rootDir);

  const query = buildGithubIntentQuery({ painPoints, companyName });
  const { searchLeads } = (await import(
    "../../github-intent-engine/track-b-intelligence/src/search"
  )) as SearchModule;
  const search = await searchLeads({
    rootDir,
    query,
    limit,
  });

  return search.results.map((result, index) =>
    mapSearchResultToLead(result, painPoints, index)
  );
}

function resolveGithubIntentRoot() {
  return resolve(
    process.cwd(),
    process.env.GITHUB_INTENT_ENGINE_ROOT ?? "github-intent-engine"
  );
}

function assertProcessedIndexExists(rootDir: string) {
  const rankedLeadsPath = resolve(
    rootDir,
    "data",
    "processed",
    "ranked_leads.jsonl"
  );

  if (!existsSync(rankedLeadsPath)) {
    throw new Error(
      `GitHub intent index is missing at ${rankedLeadsPath}. Run "cd github-intent-engine && npm run harvest && npm run build-intelligence" before searching.`
    );
  }
}

function mapSearchResultToLead(
  result: SearchResultLead,
  painPoints: PainPoint[],
  index: number
): Lead {
  const score = clampScore(result.final_score ?? result.score);
  const displayName = result.name?.trim() || result.engineer_login;
  const profileParts = [
    result.why_relevant,
    result.outreach_angle,
    result.top_repos.length > 0
      ? `Recent repos: ${result.top_repos.slice(0, 3).join(", ")}`
      : "",
  ].filter(Boolean);

  return {
    id: `github_engineer_${result.engineer_login || index}`,
    name: displayName,
    profile: profileParts.join(" "),
    score,
    evidence: result.evidence
      .slice(0, 3)
      .map((evidence, evidenceIndex) =>
        mapEvidenceToLeadEvidence({
          evidence,
          result,
          painPoints,
          evidenceIndex,
          leadScore: score,
        })
      ),
  };
}

function mapEvidenceToLeadEvidence({
  evidence,
  result,
  painPoints,
  evidenceIndex,
  leadScore,
}: {
  evidence: EvidenceRecord;
  result: SearchResultLead;
  painPoints: PainPoint[];
  evidenceIndex: number;
  leadScore: number;
}): LeadEvidence {
  const matchedPainPoint = findMatchedPainPoint(evidence, painPoints);
  const evidenceScore = clampScore(
    Math.max(52, leadScore - evidenceIndex * 4)
  );
  const source = [evidence.repo, evidence.type.replaceAll("_", " ")]
    .filter(Boolean)
    .join(" ");

  return {
    id: `${result.engineer_login}_evidence_${evidenceIndex + 1}`,
    painPointId: matchedPainPoint?.id ?? "github_intent",
    painPointTitle: matchedPainPoint?.title ?? "GitHub intent signal",
    score: evidenceScore,
    description:
      evidence.title ||
      evidence.text.slice(0, 180) ||
      `${result.engineer_login} has matching GitHub activity.`,
    href: evidence.url,
    source: source || "GitHub activity",
  };
}

function findMatchedPainPoint(evidence: EvidenceRecord, painPoints: PainPoint[]) {
  const evidenceText = [
    evidence.title,
    evidence.text,
    evidence.matched_topics.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return painPoints.find((painPoint) => {
    const terms = [
      painPoint.title,
      painPoint.description,
      ...painPoint.subpoints.flatMap((subpoint) => [
        subpoint.title,
        subpoint.description,
      ]),
    ]
      .join(" ")
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length >= 5);

    return terms.some((term) => evidenceText.includes(term));
  });
}

function clampScore(score: number) {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected: Still FAIL because the route and frontend copy are not updated yet.

- [ ] **Step 3: Commit**

```bash
git add src/lib/github-intent-leads.ts
git commit -m "feat: adapt github intent results to leads"
```

---

### Task 4: Replace The Placeholder Fetch Leads Route

**Files:**
- Modify: `src/app/api/fetch-leads/route.ts`

- [ ] **Step 1: Read local Next route docs**

Run:

```bash
sed -n '13,70p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
sed -n '1,70p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md
```

Expected: docs confirm App Router route handlers use Web `Request`/`Response`, and `export const runtime = "nodejs"` is valid.

- [ ] **Step 2: Replace route implementation**

Replace `src/app/api/fetch-leads/route.ts` with:

```ts
import { fetchGithubIntentLeads } from "@/lib/github-intent-leads";
import type { PainPoint } from "@/lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readPainPoints(value: unknown): PainPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((painPoint): painPoint is PainPoint => {
    if (!painPoint || typeof painPoint !== "object") {
      return false;
    }

    const candidate = painPoint as Partial<PainPoint>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.description === "string" &&
      Array.isArray(candidate.subpoints)
    );
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    painPoints?: unknown;
    companyName?: unknown;
  };
  const painPoints = readPainPoints(body.painPoints);
  const companyName =
    typeof body.companyName === "string" ? body.companyName : undefined;

  try {
    const leads = await fetchGithubIntentLeads({
      painPoints,
      companyName,
      limit: 10,
    });

    return Response.json(
      {
        leads,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lead fetch failed.";

    return Response.json(
      {
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
npm test
```

Expected: Still FAIL until the frontend sends `companyName` and updates copy.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/fetch-leads/route.ts
git commit -m "feat: use github intent engine in fetch leads route"
```

---

### Task 5: Update The Frontend Request And Engineer Copy

**Files:**
- Modify: `src/components/chat.tsx`

- [ ] **Step 1: Send company name to the route**

Find the `fetch("/api/fetch-leads"` call in `handleFindCustomers` and replace the body with:

```ts
body: JSON.stringify({ painPoints, companyName }),
```

- [ ] **Step 2: Update table copy**

In `LeadsTablePanel`, replace:

```tsx
<CardTitle>Leads</CardTitle>
<CardDescription>
  Placeholder accounts matched against {companyName} pain points.
</CardDescription>
```

with:

```tsx
<CardTitle>Engineer leads</CardTitle>
<CardDescription>
  Engineers matched against {companyName} pain points using public GitHub activity.
</CardDescription>
```

- [ ] **Step 3: Update loading copy if present**

If the finding/loading screen says "customers" or "accounts", replace it with engineer-specific language:

```tsx
<p className="mt-2">Ranking engineer intent</p>
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: PASS for all `node --test` tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat.tsx
git commit -m "feat: display github engineer leads"
```

---

### Task 6: Verify With Mock Engine Data Locally

**Files:**
- No source changes required.

- [ ] **Step 1: Install engine dependencies if missing**

Run:

```bash
cd github-intent-engine
npm install
```

Expected: `github-intent-engine/node_modules` exists.

- [ ] **Step 2: Smoke test Track B search directly**

Run:

```bash
cd github-intent-engine
npm run search -- --root track-b-intelligence/mock-workspace "Find engineers with live query replication and websocket sync pain"
```

Expected: JSON response with `results`, including `jane-dev` from the mock workspace.

- [ ] **Step 3: Smoke test Next build**

Run:

```bash
npm run build
```

Expected: build succeeds. If it fails resolving external TypeScript under `github-intent-engine`, move the adapter import behind a Node runtime CLI/API boundary before deploying; do not ship a route that only works in dev.

- [ ] **Step 4: Commit dependency lockfile changes if `npm install` changed them intentionally**

```bash
git add github-intent-engine/package-lock.json
git commit -m "chore: install github intent engine dependencies"
```

Skip this commit if `github-intent-engine/package-lock.json` is unchanged.

---

### Task 7: Generate Real Processed Data For Demo

**Files:**
- Generated locally: `github-intent-engine/data/raw/*`
- Generated locally: `github-intent-engine/data/processed/*`

- [ ] **Step 1: Harvest a small bounded dataset**

Run:

```bash
cd github-intent-engine
GITHUB_TOKEN="$(gh auth token)" npm run harvest -- --days 90 --limit 15 --max-pages-per-list 1 --max-items-per-list 10 --max-changed-files 50
```

Expected: `github-intent-engine/data/raw/harvest_report.json` exists and reports fetched repos, requests, and failures.

- [ ] **Step 2: Build Track B processed index**

Run:

```bash
cd github-intent-engine
npm run build-intelligence
```

Expected: `github-intent-engine/data/processed/ranked_leads.jsonl` exists and is non-empty.

- [ ] **Step 3: Search the real processed index**

Run:

```bash
cd github-intent-engine
npm run search -- "Find engineers on GitHub with recent public activity showing developer workflow pain from issues pull requests commits and comments"
```

Expected: JSON response with non-empty `results`.

- [ ] **Step 4: Decide storage for generated data**

For hackathon demo, use one of these concrete choices:

```bash
# Choice A: commit generated processed files for the demo deployment
git add github-intent-engine/data/processed
git commit -m "data: add github intent processed demo index"
```

or:

```bash
# Choice B: upload processed files to Vercel Blob in a follow-up task
# Keep this task out of the request-path integration unless file size blocks deploy.
```

Do not commit `GITHUB_TOKEN`, `.env`, or other secrets.

---

### Task 8: Run The App And Exercise The Full Flow

**Files:**
- No source changes unless verification exposes a bug.

- [ ] **Step 1: Start Next locally**

Run:

```bash
npm run dev
```

Expected: dev server starts and prints a localhost URL.

- [ ] **Step 2: Use the app flow**

Manual browser steps:

1. Open `/input`.
2. Enter a company website.
3. Wait for company research to produce pain points.
4. Edit pain points if needed.
5. Click the find-customers/find-leads button.
6. Confirm the table shows engineer names, scores, and GitHub evidence links.

- [ ] **Step 3: Verify API response directly**

Run this with the dev server running:

```bash
curl -s http://localhost:3000/api/fetch-leads \
  -H 'content-type: application/json' \
  -d '{"companyName":"Demo Company","painPoints":[{"id":"pain_1","title":"Realtime data drift","description":"Developers struggle with stale client state and live query consistency.","subpoints":[{"id":"sub_1","title":"WebSocket reconnect bugs","description":"Code changes mention reconnect handling and subscription state."}]}]}' 
```

Expected: JSON with a `leads` array. Each lead has `id`, `name`, `profile`, `score`, and `evidence`.

- [ ] **Step 4: Final verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands pass.

- [ ] **Step 5: Commit final verification fixes**

```bash
git add src tests docs
git commit -m "feat: connect fetch leads to github intent search"
```

Skip this commit if all implementation work was already committed in earlier tasks.

---

## Deployment Notes

- Vercel app route should run in Node runtime because the engine reads local files.
- The route must search prebuilt `data/processed/*.jsonl`; it must not harvest GitHub data at request time.
- For the fastest hackathon deployment, commit a small processed demo index if file size is acceptable.
- If the processed files are too large or need refreshes without redeploys, move them to Vercel Blob in a follow-up plan.
- If the teammate's local version actually requires Postgres, provision Neon Postgres through Vercel Marketplace and replace the JSONL adapter with a SQL adapter. The code currently present in this repo does not require Postgres for Track B search.

## Self-Review

- Spec coverage: The plan covers frontend payload, query generation, fetch route, engine search, result mapping, tests, local data generation, and deployment implications.
- Placeholder scan: No task contains TBD/TODO/fill-in wording. Optional Blob/Postgres paths are explicitly marked follow-up choices, not required implementation gaps.
- Type consistency: `PainPoint`, `Lead`, and `LeadEvidence` match `src/lib/workflow.ts`; engine result fields match `SearchResultLead` and `EvidenceRecord` from Track B.
