# Track A Implementation Plan

Track A owns only data collection. It should not classify repos, score engineers, run semantic search, or generate outreach copy.

## Track A Contract

Input:
- `../seed_repos.txt`
- `--days`, default `90`
- `--limit`, optional repo limit for demos
- `--max-pages-per-list`, default `3`
- `--max-items-per-list`, default `50`
- `--max-changed-files`, default `100`
- `GITHUB_TOKEN`

Output:
- `../data/raw/raw_repos.jsonl`
- `../data/raw/raw_pull_requests.jsonl`
- `../data/raw/raw_issues.jsonl`
- `../data/raw/raw_comments.jsonl`
- `../data/raw/raw_commits.jsonl`
- `../data/raw/raw_users.jsonl`
- `../data/raw/harvest_report.json`

Success means Track B can consume these files without calling GitHub.

## Milestone A0: Project Skeleton

Goal: make the harvester runnable before adding GitHub logic.

Tasks:
- Add `package.json`.
- Add TypeScript config.
- Add `src/run.ts` CLI entrypoint.
- Add `src/paths.ts` for all input/output paths.
- Add `src/jsonl.ts` helpers for append/write/read JSONL.
- Add `.env.example` documenting `GITHUB_TOKEN`.

Done when:
- `npm run harvest -- --days 90 --limit 1` runs and writes empty JSONL files plus a report.

## Milestone A1: Seed Repo Reader

Goal: turn `seed_repos.txt` into validated repo identifiers.

Tasks:
- Read one repo per line.
- Ignore blank lines and `#` comments.
- Validate `owner/repo` shape.
- Deduplicate while preserving file order.
- Apply `--limit` after dedupe.

Output:
- in-memory list of repo full names.

Done when:
- invalid lines are reported in `harvest_report.json`.
- duplicate seed repos are not fetched twice.

## Milestone A2: GitHub API Client

Goal: create a small reliable wrapper around GitHub REST calls.

Tasks:
- Use authenticated REST requests.
- Add request retry for transient `5xx` and network failures.
- Track rate-limit headers.
- Track total requests, failed requests, and skipped resources.
- Return typed errors instead of throwing raw fetch errors everywhere.

Required functions:
- `getRepo(owner, repo)`
- `getReadme(owner, repo)`
- `listPullRequests(owner, repo, since)`
- `listIssues(owner, repo, since)`
- `listIssueComments(owner, repo, since)`
- `listCommits(owner, repo, since)`
- `getUser(login)`

Done when:
- one repo can be fetched end-to-end with request counts in the report.

## Milestone A3: Repo Metadata Harvester

Goal: produce trustworthy `raw_repos.jsonl`.

Fetch:
- repo id
- full name
- owner login
- owner type
- description
- topics
- stars
- forks
- primary language
- default branch
- fork/archive flags
- pushed date
- README text
- public URL

Important details:
- README can be `null` if missing or too large.
- Keep README text capped to a practical limit, for example 20,000 characters.
- Do not fail the repo if README fetch fails.

Output:
- `../data/raw/raw_repos.jsonl`

Done when:
- every seed repo has either a repo record or a clear failure reason in the report.

## Milestone A4: Pull Request Harvester

Goal: produce `raw_pull_requests.jsonl` for recent PR activity.

Fetch:
- open and closed PRs updated within the time window.
- author login.
- title/body/state.
- created/updated/merged timestamps.
- changed files for each PR, capped if needed.
- public PR URL.

Rules:
- Include PRs created before the window if they were updated or merged inside the window.
- Mark `merged` as true only if GitHub reports a merge timestamp.
- If file fetching fails for a PR, keep the PR and set `changed_files` to `[]`.

Output:
- `../data/raw/raw_pull_requests.jsonl`

Done when:
- each PR has repo, number, author, timestamps, and URL.

## Milestone A5: Issue And Comment Harvester

Goal: produce `raw_issues.jsonl` and `raw_comments.jsonl`.

Fetch issues:
- issues updated within the time window.
- exclude pull requests from issue output.
- title/body/state.
- author login.
- created/updated timestamps.
- URL.

Fetch comments:
- issue comments updated or created within the time window.
- parent issue number.
- author login.
- body.
- created timestamp.
- URL.

Rules:
- Keep comments even if parent issue was created before the window.
- Do not include PR review comments in MVP unless time permits.

Outputs:
- `../data/raw/raw_issues.jsonl`
- `../data/raw/raw_comments.jsonl`

Done when:
- issue and comment actors are available for user harvesting.

## Milestone A6: Commit Harvester

Goal: produce `raw_commits.jsonl` for recent commit activity.

Fetch:
- commits since time-window start.
- commit SHA.
- author login when GitHub resolves it.
- commit message.
- committed timestamp.
- changed files, capped if needed.
- commit URL.

Rules:
- If GitHub cannot map a commit author to a user, keep the commit with `author_login: null`.
- Do not fetch full patches.
- Changed file paths are useful; raw diffs are out of scope.

Output:
- `../data/raw/raw_commits.jsonl`

Done when:
- commits can be connected to GitHub users when possible.

## Milestone A7: Contributor/User Harvester

Goal: produce `raw_users.jsonl` for every actor found in raw activity.

Collect actors from:
- repo owners
- PR authors
- issue authors
- comment authors
- commit authors when present

Fetch:
- id
- login
- type
- name
- company
- location
- blog
- email
- bio
- public repo count
- followers
- created date
- profile URL

Rules:
- Deduplicate by login.
- Skip `null` authors.
- Keep bot accounts, but preserve `type` and login so Track B can filter them.

Output:
- `../data/raw/raw_users.jsonl`

Done when:
- every resolvable login from activity has a user profile or failure reason.

## Milestone A8: Dedupe And Atomic Writes

Goal: make reruns predictable.

Tasks:
- Write to a temporary output directory first.
- Replace old raw files only after the harvest finishes.
- Deduplicate records by stable keys:
  - repo: `id`
  - pull request: `repo:number`
  - issue: `repo:number`
  - comment: `id`
  - commit: `repo:sha`
  - user: `login`
- Keep output sorted by repo then timestamp where practical.

Done when:
- rerunning the same command does not create duplicate records.

## Milestone A9: Harvest Report

Goal: make backend quality visible.

Report fields:
- started_at
- finished_at
- days
- seed_repo_count
- fetched_repo_count
- raw_pull_request_count
- raw_issue_count
- raw_comment_count
- raw_commit_count
- raw_user_count
- skipped_repo_count
- failed_request_count
- request_count
- rate_limit_remaining
- rate_limit_reset_at
- invalid_seed_repos
- failures

Output:
- `../data/raw/harvest_report.json`

Done when:
- someone can diagnose bad or missing data from the report alone.

## Milestone A10: Validation CLI

Goal: catch broken raw files before Track B uses them.

Tasks:
- Add `npm run validate:raw`.
- Validate required fields exist.
- Validate every evidence record has a URL.
- Validate JSONL files parse line by line.
- Validate no duplicate stable keys.
- Validate timestamps are valid ISO strings.

Done when:
- validation fails loudly on malformed JSONL and duplicate records.

## Milestone A11: Demo Harvest

Goal: produce a real dataset for the Convex query.

Command:

```bash
npm run harvest -- --days 90 --limit 15
npm run validate:raw
```

Expected output:
- 15 repo records if all seed repos are accessible.
- Recent PRs/issues/comments/commits where available.
- User profiles for activity actors.
- A readable report.

Done when:
- Track B can replace mock data with real raw files without code changes.

## Out Of Scope For Track A

- Ranking engineers.
- Classifying repo categories.
- Extracting Convex topics.
- Embeddings or vector search.
- Outreach copy generation.
- Contact enrichment outside public GitHub profile fields.
- Scraping HTML pages.
- Full GitHub crawl.

## Implementation Order

1. A0 project skeleton.
2. A1 seed reader.
3. A2 API client.
4. A3 repo metadata.
5. A4 pull requests.
6. A5 issues/comments.
7. A6 commits.
8. A7 users.
9. A8 atomic writes.
10. A9 report.
11. A10 validation.
12. A11 demo harvest.
