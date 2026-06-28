# GitHub User Deepener

Fourth backend layer for the hackathon demo.

The previous engines start from repositories and rank people from repo-local evidence. This module starts from those ranked people and asks a harder question:

> Does the same GitHub user have other public activity that independently proves the product pain?

## What It Adds

For each candidate lead, it builds a user-level dossier:

- direct trigger pain from the original hybrid search
- related issues/comments from the same user
- dependency/manifest proof from their own repos
- code-pattern proof such as `useEffect(fetch)`, `queryClient.invalidateQueries`, WebSocket listeners, and manual refetching
- explicit issue-body code/fix snippets when the direct pain report itself contains concrete implementation proof
- a `pain_diagnosis` that names the burning problem, severity, code manifestations, and Convex angle in plain language
- an `evidence_graph` connecting the user, original trigger, same-user proof, Convex fit, and missing-evidence gaps
- an `evidence_timeline` that orders dated, cited events so recency and causality are easy to show
- a `citation_audit` that verifies proof-chain, demo-brief, timeline, and graph claims have source URLs
- a `discovery_trace` that explains how the system moved from initial GitHub trigger to same-user proof to reliability verdict
- a `demo_brief` with a judge-facing headline, cited proof points, reliability summary, talk track, and outreach opener
- a neural-style embedding summary over the user's activity
- a proof-depth score and qualification status

The important rule:

> One strong GitHub issue can nominate a lead, but multi-signal same-user evidence is what makes the result surprising.

## Run Offline

Uses current hybrid outputs plus already harvested structured/neural activities.

```bash
npm test

npm run dossier -- \
  --query "Find Convex leads frustrated with WebSocket reconnect, realtime sync, cache invalidation, Supabase alternatives, Firebase alternatives, or self-hosted backend pain" \
  --limit 8
```

## Run With Live User Deepening

Fetches public user events, recent repos, and manifests for the top candidates.
It also searches recently updated GitHub issues/PRs involving that user, which is the second-hop path that finds pain outside the seed repo.

Create an ignored local env file first:

```bash
printf 'GITHUB_TOKEN=your_token_here\n' > .env.local
```

```bash
npm run dossier -- \
  --query "Find Convex leads frustrated with WebSocket reconnect, realtime sync, cache invalidation, Supabase alternatives, Firebase alternatives, or self-hosted backend pain" \
  --limit 8 \
  --live-user-activity true \
  --live-candidate-limit 8 \
  --repo-limit 6 \
  --include-code-samples true \
  --code-file-limit 4 \
  --include-code-search true \
  --code-search-limit 5 \
  --code-search-languages TypeScript,JavaScript \
  --min-reliability demo_ready \
  --target-demo-ready 2 \
  --live-batch-size 8 \
  --cache-dir data/cache/user-activity
```

Without `GITHUB_TOKEN`, GitHub's unauthenticated rate limit may still work for a small demo, but the token-backed path is more reliable.
Live activity is cached per GitHub login. Refreshes run one user at a time, so if GitHub rate-limits one candidate the CLI keeps successful users, writes their cache entries, and reports the failed login in `warnings` and `live_cache_report`.
When `--include-code-samples true` is enabled, the deepener samples high-signal TypeScript/JavaScript files from recent user repos and emits `code` activities only when it sees manual patterns such as `useEffect(fetch)`, `queryClient.invalidateQueries`, WebSocket listeners, refetching, or optimistic rollback logic.
When `--include-code-search true` is enabled, it also uses GitHub code search for those same code manifestations across the user's public repos. This is usually the best path for finding surprisingly specific proof because it does not depend on guessing the right file from a repo tree. GitHub code search requires authentication in practice; without a token, the fetcher skips that optional sub-step and still keeps events/issues/repos/manifests. Code search runs once per language in `--code-search-languages` instead of combining language filters into one low-recall query.

Each dossier includes `demo_brief`, `pain_diagnosis`, `reliability_audit`, `citation_audit`, `discovery_trace`, `evidence_graph`, and `evidence_timeline`. Treat `demo_ready` leads as judge-facing results. A lead cannot be `demo_ready` unless every proof-chain claim has a source URL and the dossier has concrete code manifestation proof. Manifest/package evidence alone is not enough; it must be backed by code patterns, repro code, or an explicit implementation/fix snippet in the direct issue. Uncited or under-proven proof is reported in `citation_audit.uncited_claims` and `reliability_audit.evidence_gaps`. `discovery_trace` is the judge-facing audit trail: candidate trigger, user deepening, code proof, and reliability gate. Treat `needs_more_user_evidence`, `needs_independent_support`, `needs_pain_linkage`, or `needs_stack_or_code_proof` as honest next-harvest targets rather than polished leads. The graph is intentionally useful even for weak leads because it shows exactly which proof is present and which proof is still missing.

Use `--min-reliability demo_ready` for the judge demo path. The CLI still scores every candidate, then returns only demo-ready dossiers and includes `quality_report` with reliability counts and the number of discarded under-proven candidates.

Use `--target-demo-ready N` with live deepening to widen the candidate pool and keep fetching additional candidate batches until the CLI finds `N` demo-ready leads or exhausts the candidate pool. If the target is not met, `quality_report` includes `target_met`, `demo_ready_shortfall`, and `near_misses` with the missing proof for the strongest under-proven candidates. Each near miss also includes prioritized `follow_up_actions`, such as targeted GitHub issue searches and user-owned code/manifest harvests, with `github_api_url` or `github_web_url` plus the `expected_proof` each action is meant to find. Issue follow-ups use executable GitHub query syntax like `involves:USER is:issue realtime` and include pull-request alternates. Near-miss follow-ups are ordered by conversion potential, so direct public pain reports that only need second-hop code evidence are investigated before high-scoring but stack-only leads.

## Why This Matters

Repo search says:

```txt
This person appeared in a Supabase realtime issue.
```

User deepening says:

```txt
This same person also has a TypeScript app using Supabase, React Query, and WebSocket glue, plus code that manually invalidates cached server state after realtime events.
```

That second result is much harder for generic search tools to produce because it connects person, pain, stack, and code behavior into one explainable lead dossier.
