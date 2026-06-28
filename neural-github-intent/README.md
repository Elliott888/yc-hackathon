# Neural GitHub Intent

Track 1 for the hackathon: a standalone GitHub intent engine that produces ranked, evidence-backed engineers for Convex-style outreach.

The final handoff artifact is:

```txt
data/scored_leads.ndjson
```

Each row contains a GitHub engineer, relevant repo, score, matched topics, recent activity, evidence links, and a Convex outreach angle.

## What This Builds

Pipeline:

```txt
Convex recipe
  -> GitHub activity harvest or fixture data
  -> repo category classifier
  -> engineer activity profiles
  -> local semantic profile embeddings
  -> Convex-specific lead scoring
  -> validated scored_leads.ndjson
```

Generated artifacts:

```txt
data/raw_events.ndjson
data/repo_profiles.ndjson
data/engineer_profiles.ndjson
data/profile_embeddings.ndjson
data/training_examples.ndjson
data/scored_leads.ndjson
data/harvest_report.json
```

`profile_embeddings.ndjson` is intentionally separate from `scored_leads.ndjson`. Semantic similarity finds adjacent technical work; the final scorer filters for recency, contribution strength, direct problem evidence, evidence quality, repo category, and negative signals like bots or docs-only activity.

`training_examples.ndjson` is the larger model-training/eval corpus. Each row maps one GitHub activity item to the recipe query, label, evidence text, repo categories, problem signals, stack signals, and evidence URL. This can be used later to train or evaluate a neural reranker.

## Commands

Run all unit and E2E tests:

```bash
npm test
```

Run only the CLI E2E:

```bash
npm run test:e2e
```

Generate deterministic fixture artifacts:

```bash
npm run harvest:fixture
```

Validate generated leads:

```bash
npm run validate
```

Run against live GitHub seed repos:

```bash
GITHUB_TOKEN=... npm run harvest:convex -- --limit 2 --max-users 100
```

Or create a local `.env` file using `.env.example`:

```bash
GITHUB_TOKEN=your_local_token
```

`.env` is ignored by git and should not be shared.

The live path can run without `GITHUB_TOKEN`, but GitHub rate limits will be much tighter.

## Track 1 Contract

Input:

```txt
recipes/convex.yaml
```

Important recipe fields:

- `target_prompt`: natural-language sales/retrieval goal
- `seed_repos`: GitHub repos to harvest
- `categories`: repo taxonomy, such as realtime sync and reactive database
- `positive_terms`: technical buying-intent terms
- `stack_terms`: stack fit terms
- `negative_terms`: low-quality lead signals

Output:

```txt
data/scored_leads.ndjson
```

Example row shape:

```json
{
  "engineer_login": "jane-sync",
  "name": "Jane Sync",
  "company": "Realtime Systems",
  "github_url": "https://github.com/jane-sync",
  "repo": "electric-sql/electric",
  "repo_category": ["Realtime sync", "Reactive database"],
  "score": 92,
  "why_relevant": "jane-sync merged a recent PR in electric-sql/electric around realtime, sync, replication, and live query.",
  "matched_topics": ["realtime", "sync", "replication", "live query"],
  "recent_activity": [],
  "last_active_at": "2026-06-22T10:00:00.000Z",
  "evidence_links": ["https://github.com/electric-sql/electric/pull/101"],
  "answer_context": {
    "problem_signals": ["live query", "replication"],
    "stack_signals": ["Postgres", "WebSocket"],
    "repo_signals": ["Realtime sync", "Reactive database"],
    "evidence_snippets": [],
    "outreach_hooks": ["Ask about their recent live query work."]
  },
  "outreach_angle": "Good Convex lead because they are actively working near realtime, sync, and replication..."
}
```

## Current Neural Approach

This version uses a deterministic local semantic embedding layer so the whole pipeline is testable without external model credentials. It behaves like a lightweight neural retriever:

- expands Convex-adjacent terms like reactive, realtime, sync, replication, subscriptions, CRDT, and BaaS
- embeds engineer profile text into sparse semantic vectors
- computes query similarity against the recipe prompt
- combines semantic relevance with structured scoring

Next upgrade:

- replace `src/embedding.js` with OpenAI, Voyage, Nomic, or sentence-transformer embeddings
- keep the same `profile_embeddings.ndjson` and `scored_leads.ndjson` contracts
- add a labeled eval set to compare keyword, generic embedding, and fine-tuned retrieval precision

## Current Limitations

- Live GitHub harvesting is intentionally simple and capped for hackathon use.
- PR changed files are not fetched in the live path yet.
- No BigQuery/GH Archive bulk ingest yet.
- The local embedding layer is not a trained model; it is a deterministic stand-in with the same retrieval contract.
- The fixture currently proves correctness on a small dataset; real lead volume depends on running the live harvester with a token.
