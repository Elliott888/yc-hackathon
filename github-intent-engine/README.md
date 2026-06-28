# GitHub Intent Engine Backend

Backend workspace for a GitHub intent engine focused on devtool sales prospecting.

The hackathon slice is:

> Find engineers who have been actively contributing to real-time sync, reactive databases, or backend-as-a-service repos in the last 90 days for Convex outreach.

## Architecture

Two tracks work independently and meet at JSONL file contracts.

### Track A: GitHub Data Harvester

Collects trustworthy public GitHub data.

Inputs:
- `seed_repos.txt`
- GitHub token
- time window

Outputs:
- `data/raw/raw_repos.jsonl`
- `data/raw/raw_pull_requests.jsonl`
- `data/raw/raw_issues.jsonl`
- `data/raw/raw_comments.jsonl`
- `data/raw/raw_commits.jsonl`
- `data/raw/raw_users.jsonl`
- `data/raw/harvest_report.json`

### Track B: Intelligence, Search, And Eval

Turns correctly shaped raw files into ranked searchable leads.

Inputs:
- `data/raw/*.jsonl`
- `contracts/convex_recipe.yaml`

Outputs:
- `data/processed/repo_categories.jsonl`
- `data/processed/contribution_topics.jsonl`
- `data/processed/engineer_profiles.jsonl`
- `data/processed/ranked_leads.jsonl`
- search API responses
- eval report

## Milestones

1. Define JSONL contracts.
2. Harvest seed repo metadata and recent activity.
3. Classify repos into Convex-adjacent categories.
4. Extract contribution topics from PRs, issues, comments, and commits.
5. Build engineer profiles.
6. Score engineers for Convex fit.
7. Serve evidence-backed search results.
8. Evaluate top-k quality against a manually labeled golden set.

## Demo Standard

The backend is good enough when the top 10 results for the Convex query contain evidence-backed engineers that a Convex founder would plausibly contact.
