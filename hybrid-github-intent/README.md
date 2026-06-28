# Hybrid GitHub Intent

Third approach for finding high-intent GitHub buyers.

This folder combines the two existing hackathon approaches:

- `github-intent-engine`: structured harvester, evidence records, code signals, pain explanations, profile metadata.
- `neural-github-intent`: local semantic similarity, scored leads, semantic profile expansion.

The rule for this hybrid approach is:

> Neural retrieval can nominate or boost candidates, but structured GitHub evidence decides whether a lead is real.

## Pipeline

```txt
Track B ranked leads
  + raw GitHub users
  + neural scored leads
  + neural semantic similarity
  -> evidence-grounded hybrid reranker
  -> ranked lead list with trigger evidence and outreach
```

## Why This Exists

The structured engine is precise and explainable, but can miss semantically similar pain when the wording differs from the query.

The neural prototype is flexible, but by itself can over-rank topical activity without a burning problem.

The hybrid engine keeps both:

- semantic expansion for broad discovery
- hard evidence gates for trust
- maintainer, bot, profile, and docs-only filters
- final scoring based on recency, pain specificity, evidence quality, structured score, and neural score

## Run

From this folder:

```bash
npm test

npm run search -- --query "Find Convex leads frustrated with WebSocket reconnect, Supabase realtime, cache invalidation, or Firebase alternatives" --limit 8
```

Run a built-in buyer profile:

```bash
npm run search -- --buyer lore --limit 8
npm run search -- --buyer lopus --limit 8
npm run search -- --buyer openai --limit 8
npm run search -- --buyer orange-slice --limit 8
```

Use every indexed snapshot currently available:

```bash
npm run search -- --buyer openai --all-indexes --limit 8
```

Run an arbitrary product query:

```bash
npm run search -- \
  --all-indexes \
  --query "I want leads for an observability startup. Find engineers talking about flaky traces, missing spans, error grouping, production incidents, log correlation, alert fatigue, or debugging distributed systems."
```

List every built-in profile and its default query:

```bash
node src/cli.js buyers
```

Default inputs:

```txt
../github-intent-engine/data/workspaces/fullstack-backend-pain-doubled
../neural-github-intent/data/scored_leads.ndjson
```

Override them:

```bash
node src/cli.js search \
  --structured-root ../github-intent-engine/data/workspaces/fullstack-backend-pain-doubled \
  --neural-leads ../neural-github-intent/data/scored_leads.ndjson \
  --query "..." \
  --limit 10
```

## UI Integration

The screenshot UI should treat this folder as the search and reasoning backend. The client should not call GitHub directly and should not receive a GitHub token. The browser sends a natural-language query to a server API, the server runs this hybrid engine, and the response is converted into a graph-shaped trace.

The UI buttons can map directly to the built-in `buyer` IDs:

| UI Button | `buyer` ID | What It Searches For |
|---|---|---|
| Convex Buyer | `convex` | Cache invalidation, realtime sync, Firebase/Supabase/Appwrite alternatives, BaaS pain |
| Lore Buyer | `lore` | AI coding workflows, Claude/Codex handoffs, shared context, review collaboration |
| Lopus Buyer | `lopus` | Growth analytics, funnels, dashboards, event ingestion, ClickHouse/PostHog-style pain |
| OpenAI Buyer | `openai` | Agents, tool calling, evals, traces, streaming chat, RAG, model-routing pain |
| Orange Slice Buyer | `orange-slice` | Sales automation, CRM enrichment, lead scraping, outbound, spreadsheet workflows |
| Cache + BaaS Alternatives | `cache-baas` | Stale state, self-hosted backend, Firebase/Supabase/Appwrite/PocketBase frustration |
| Live Query Engineers | `live-query` | Live queries, reactive databases, subscriptions, database watchers |
| CRDT + Local-First | `crdt-local-first` | CRDTs, local-first apps, Automerge/Yjs/Electric/Replicache, conflict resolution |
| BaaS Realtime Infra | `baas-realtime` | Firebase/Supabase/Appwrite/Nhost/PocketBase realtime, auth, storage, self-hosted infra |

Recommended flow:

```txt
User query in UI
  -> POST /api/intent/search
  -> hybrid-github-intent searchHybrid()
  -> ranked leads with trigger evidence
  -> optional per-lead deepening step
  -> graph payload for the UI
```

The current CLI already returns the fields needed for the first version of the UI:

- `results[].engineer_login`, `name`, `company`, `github_url`: lead card and right-side profile panel
- `results[].icp_fit_score`, `score_breakdown`: intent score ring and ranking bars
- `results[].trigger`: evidence node, evidence timeline item, and clickable GitHub source
- `results[].pain_signal`, `why_this_is_high_intent`, `why_convex_fits`: right-side reasoning copy
- `results[].quality_label`, `quality_reason`: whether the lead is `demo_ready`, `strong`, `qualified`, or `thin`
- `results[].why_product_fits`: buyer-specific fit explanation for Convex, Lore, Lopus, OpenAI, etc.
- `results[].outreach`: personalized outreach panel
- `results[].sources_used`: badges showing whether structured, neural, or both sources supported the lead
- `coverage_diagnostics`: whether the indexed corpus is strong, usable, thin, or missing for this buyer

### Server API Contract

Add a thin server-side adapter in the client app, for example `POST /api/intent/search`. It can import `searchHybrid()` from `hybrid-github-intent/src/engine.js` or shell out to the CLI during the hackathon demo.

Request:

```json
{
  "useAllIndexes": true,
  "buyer": "lore",
  "query": "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
  "limit": 20,
  "structuredRoot": "../github-intent-engine/data/workspaces/fullstack-backend-pain-doubled",
  "neuralLeadsPath": "../neural-github-intent/data/scored_leads.ndjson"
}
```

Response:

```json
{
  "runId": "intent-run-20260628-135511",
  "query": "...",
  "inputCounts": {
    "structuredLeads": 981,
    "neuralLeads": 1284,
    "rawUsers": 1283
  },
  "qualitySummary": {
    "demoReady": 5,
    "strong": 12,
    "qualified": 20,
    "thin": 4
  },
  "coverageDiagnostics": {
    "status": "strong",
    "message": "Enough high-confidence leads exist for a demo.",
    "suggestedSeedRepos": []
  },
  "leads": [
    {
      "id": "lead:daylightcreative",
      "login": "daylightcreative",
      "name": "Steven Day",
      "company": "DayLight Creative Technologies",
      "githubUrl": "https://github.com/daylightcreative",
      "intentScore": 92,
      "qualityLabel": "demo_ready",
      "scoreBreakdown": {
        "evidence": 100,
        "productFit": 54,
        "persuasion": 90,
        "problemSpecificity": 100,
        "recency": 100
      },
      "whyRelevant": "Direct Supabase realtime failure: postgres_changes reports subscribed but delivers no events.",
      "convexFit": "Convex can replace brittle realtime subscription plumbing with a TypeScript-native reactive backend.",
      "outreach": [
        "Saw your Supabase Flutter issue where postgres_changes reports subscribed but delivers no events.",
        "That looks like exactly the kind of realtime reliability failure Convex is designed to remove.",
        "Convex gives you reactive backend queries without stitching together Postgres changes, WebSockets, and client cache invalidation."
      ],
      "graph": {
        "nodes": [],
        "edges": []
      },
      "timeline": []
    }
  ]
}
```

### Graph Payload

The graph in the screenshot should be generated from the lead's evidence chain. Use five node types so the UI can color them consistently:

```txt
engineer -> evidence -> pattern -> pain -> convex_fit
```

Example graph for a lead:

```json
{
  "nodes": [
    {
      "id": "engineer:daylightcreative",
      "type": "engineer",
      "label": "@daylightcreative",
      "subtitle": "Steven Day"
    },
    {
      "id": "evidence:supabase-flutter-1466",
      "type": "evidence",
      "label": "Supabase realtime issue",
      "url": "https://github.com/supabase/supabase-flutter/issues/1466",
      "occurredAt": "2026-06-25T00:51:23Z",
      "snippet": "postgres_changes channel reports SUBSCRIBED but delivers nothing"
    },
    {
      "id": "pattern:subscribed-no-events",
      "type": "pattern",
      "label": "subscribed but no events"
    },
    {
      "id": "pain:realtime-reliability",
      "type": "pain",
      "label": "realtime reliability"
    },
    {
      "id": "convex:reactive-backend",
      "type": "convex_fit",
      "label": "Convex reactive backend"
    }
  ],
  "edges": [
    {
      "from": "engineer:daylightcreative",
      "to": "evidence:supabase-flutter-1466",
      "label": "opened issue"
    },
    {
      "from": "evidence:supabase-flutter-1466",
      "to": "pattern:subscribed-no-events",
      "label": "contains"
    },
    {
      "from": "pattern:subscribed-no-events",
      "to": "pain:realtime-reliability",
      "label": "indicates"
    },
    {
      "from": "pain:realtime-reliability",
      "to": "convex:reactive-backend",
      "label": "maps to"
    }
  ]
}
```

The UI can render this directly:

- left panel: query, filters, minimum intent score, ranked lead list
- center canvas: `graph.nodes` and `graph.edges`
- right panel: selected lead, `intentScore`, `whyRelevant`, `convexFit`, and outreach
- bottom timeline: chronological `timeline` entries from GitHub issues, comments, PRs, commits, and code evidence

Recommended UI behavior:

- Show `demo_ready` and `strong` leads by default.
- Keep `qualified` leads visible behind an "inspect more" control.
- Hide `thin` leads from the first demo view unless the user lowers the threshold.
- If `coverage_diagnostics.status` is `missing`, show the suggested seed repos and query terms instead of an empty table.
- If `coverage_diagnostics.status` is `thin`, show the lead with a coverage warning rather than presenting it as a complete market map.

### Arbitrary Product Queries

For product descriptions that do not match a built-in buyer profile, the engine now creates a custom buyer profile from the query:

- routes explicit product names like `Convex`, `OpenAI`, `Lore`, `Lopus`, and `Orange Slice` before matching broad pain categories
- extracts the product name when the query says `for Rev1`, `for Verdex (...)`, or `for an observability startup`
- expands known domains such as mechanical/CAD, geospatial/insurance, recruiting, content generation, observability, and serverless state
- requires stronger domain anchors for niche domains so generic backend failures do not become fake leads
- uses stricter profile-specific anchors where broad terms are misleading; for example, Lore requires AI-coding collaboration evidence, and observability requires tracing/span/OpenTelemetry-style evidence rather than generic production failures
- returns `coverage_diagnostics.suggested_seed_repos` when the current indexes do not cover the buyer's market

This means the correct output for some products is intentionally "missing coverage" rather than a bad lead list. For example, the current indexes are strong for OpenAI/BaaS/realtime/devtools searches, but they do not yet cover mechanical CAD or satellite insurance deeply enough. The UI should surface the suggested seed repos as the next indexing action.

### Deep Evidence Mode

For a stronger demo, use a two-step interaction:

1. `POST /api/intent/search` returns fast ranked leads and one trigger per lead.
2. `GET /api/intent/leads/:login/graph?query=...` expands a selected lead into a richer graph.

The second endpoint should merge:

- hybrid result trigger evidence from this folder
- raw structured evidence from `github-intent-engine`
- semantic evidence from `neural-github-intent`
- optional user-level enrichment from `github-user-deepener` when live GitHub access is enabled

This is what makes the UI feel like a reasoning system rather than a table search. A good selected-lead graph should prove:

- what the person did on GitHub
- which exact issue, comment, PR, commit, or code sample triggered the match
- what technical pattern the system inferred
- what pain point that pattern represents
- why that pain point maps to Convex

### Live Trace UX

The screenshot shows a "run trace" interaction. The backend can support that with either polling or server-sent events:

```txt
trace_started
query_understood
structured_candidates_loaded
neural_candidates_loaded
evidence_scored
lead_graph_built
trace_complete
```

Each event should include `runId`, `stage`, `message`, and optional `leadId`. The client can use these events for the progress bar, the "trace complete" label, and animated node appearance.

### Quality Notes From Buyer Benchmarks

The current corpus is strongest for developer-tool buyers whose pain appears in GitHub issues and PRs:

- Strong: `convex`, `openai`, `baas-realtime`
- Usable: `lore`, `crdt-local-first`
- Promising but needs more targeted harvesting: `lopus`, observability-style custom queries
- Missing with the current corpus: `orange-slice`, mechanical/CAD, geospatial insurance, recruiting-specific searches

For weak profiles, the backend should not fake confidence. If `result_count` is low or all scores are below the UI threshold, show the trace as "not enough indexed evidence" and suggest expanding the harvester toward the profile's source repos and search terms.

## Current Limits

This reranker consumes existing artifacts. It does not yet harvest missing fields such as user-level star events with `starred_at` or commit author email from GitHub commit metadata. If those fields are added to Track A, this hybrid layer will be able to use them directly.
