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
- `results[].outreach`: personalized outreach panel
- `results[].sources_used`: badges showing whether structured, neural, or both sources supported the lead

### Server API Contract

Add a thin server-side adapter in the client app, for example `POST /api/intent/search`. It can import `searchHybrid()` from `hybrid-github-intent/src/engine.js` or shell out to the CLI during the hackathon demo.

Request:

```json
{
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
  "leads": [
    {
      "id": "lead:daylightcreative",
      "login": "daylightcreative",
      "name": "Steven Day",
      "company": "DayLight Creative Technologies",
      "githubUrl": "https://github.com/daylightcreative",
      "intentScore": 92,
      "scoreBreakdown": {
        "evidence": 100,
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

## Current Limits

This reranker consumes existing artifacts. It does not yet harvest missing fields such as user-level star events with `starred_at` or commit author email from GitHub commit metadata. If those fields are added to Track A, this hybrid layer will be able to use them directly.
