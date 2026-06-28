# Track A: GitHub Data Harvester

Owns collection of public GitHub data.

This track must not classify, score, or search. It only produces trustworthy raw JSONL files matching `../contracts/schemas.md`.

## Milestones

See `PLAN.md` for the implementation-level breakdown.

1. Read `../seed_repos.txt`.
2. Fetch repo metadata and README text.
3. Fetch last 90 days of PRs, issues, comments, and commits.
4. Fetch public user profiles for all actors.
5. Write `../data/raw/*.jsonl`.
6. Write `../data/raw/harvest_report.json`.

## Command Target

```bash
npm run harvest -- --days 90 --limit 100
```

Useful sizing flags:

```bash
npm run harvest -- --days 90 --limit 15 --max-pages-per-list 1 --max-items-per-list 10 --max-changed-files 50
```

- `--max-pages-per-list` caps GitHub list pagination per repo.
- `--max-items-per-list` caps PRs/issues/comments/commits collected per repo.
- `--max-changed-files` caps changed file paths per PR or commit.

## Quality Checks

- No duplicate repo records.
- Every PR, issue, comment, and commit has a public GitHub URL.
- Every actor in activity files has a matching `raw_users.jsonl` record when GitHub API allows it.
- Harvest report includes request failures and rate-limit status.

## Token Handling

Do not commit GitHub tokens. Prefer passing a token through the process environment:

```bash
GITHUB_TOKEN="$(gh auth token)" npm run harvest -- --days 90 --limit 15 --max-pages-per-list 3 --max-items-per-list 50 --max-changed-files 100
```

The harvester records request counts and rate-limit state in `../data/raw/harvest_report.json`.
Use `--request-timeout-ms` to keep a single slow GitHub endpoint from stalling a batch.
