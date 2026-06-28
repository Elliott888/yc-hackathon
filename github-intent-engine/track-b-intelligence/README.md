# Track B: Intelligence, Search, And Eval

Owns transformation from raw GitHub data into ranked leads and search responses.

This track should not call GitHub directly. It consumes `../data/raw/*.jsonl`, so it can start with mock data while Track A is still being built.

## Milestones

1. Create mock raw JSONL files matching the contracts.
2. Classify repos into Convex-adjacent categories.
3. Extract contribution topics from PRs, issues, comments, and commits.
4. Build engineer profiles.
5. Score engineers for Convex fit.
6. Serve evidence-backed search results.
7. Evaluate top-k quality against golden labels.

## Command Targets

```bash
npm run build-intelligence
npm run import-track1 -- --source ../neural-github-intent/data/scored_leads.ndjson
npm run search -- "Find engineers active in real-time sync, reactive databases, or BaaS repos in the last 90 days for Convex outreach"
npm run eval
```

Use the deterministic Track B fixture when Track A output is not ready:

```bash
npm run build-intelligence -- --root track-b-intelligence/mock-workspace
npm run search -- --root track-b-intelligence/mock-workspace "Find engineers contributing to reactive databases and realtime sync for Convex"
npm run eval -- --root track-b-intelligence/mock-workspace
```

The real integration path uses the shared workspace root and consumes `data/raw/*.jsonl`.

When Track 1 has already produced `scored_leads.ndjson`, import it directly:

```bash
npm run import-track1 -- --source ../neural-github-intent/data/scored_leads.ndjson
```

This writes Track B search artifacts into `data/processed/*.jsonl`.

## API

```bash
npm run serve
```

Endpoints:

- `POST /search` with `{ "query": "...", "limit": 10 }`
- `GET /lead/:engineer_login`
- `GET /evaluate`
- `GET /health`

## Quality Checks

- Top results include evidence links.
- Evidence happened within the requested time window.
- Score breakdown is explainable.
- Precision@10 beats keyword-only baseline.
