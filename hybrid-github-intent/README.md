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

## Current Limits

This reranker consumes existing artifacts. It does not yet harvest missing fields such as user-level star events with `starred_at` or commit author email from GitHub commit metadata. If those fields are added to Track A, this hybrid layer will be able to use them directly.
