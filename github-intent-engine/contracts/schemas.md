# JSONL Schemas

These are MVP schemas, not final database tables.

## `raw_repos.jsonl`

```json
{
  "id": 123,
  "full_name": "electric-sql/electric",
  "owner_login": "electric-sql",
  "owner_type": "Organization",
  "description": "Sync engine for local-first apps",
  "topics": ["local-first", "sync", "postgres"],
  "stars": 12000,
  "forks": 400,
  "primary_language": "TypeScript",
  "default_branch": "main",
  "is_fork": false,
  "is_archived": false,
  "pushed_at": "2026-06-20T12:00:00Z",
  "readme_text": "README excerpt or null",
  "url": "https://github.com/electric-sql/electric"
}
```

## `raw_pull_requests.jsonl`

```json
{
  "id": 456,
  "repo": "electric-sql/electric",
  "number": 123,
  "title": "Improve live query invalidation",
  "body": "Fixes replication edge case...",
  "author_login": "jane-dev",
  "state": "closed",
  "merged": true,
  "created_at": "2026-06-10T12:00:00Z",
  "updated_at": "2026-06-11T12:00:00Z",
  "merged_at": "2026-06-12T12:00:00Z",
  "changed_files": ["packages/sync/src/live-query.ts"],
  "url": "https://github.com/electric-sql/electric/pull/123"
}
```

## `raw_issues.jsonl`

```json
{
  "id": 789,
  "repo": "electric-sql/electric",
  "number": 456,
  "title": "Replication lag with live queries",
  "body": "Live queries sometimes fall behind...",
  "author_login": "jane-dev",
  "state": "open",
  "created_at": "2026-06-05T12:00:00Z",
  "updated_at": "2026-06-06T12:00:00Z",
  "url": "https://github.com/electric-sql/electric/issues/456"
}
```

## `raw_comments.jsonl`

```json
{
  "id": 101112,
  "repo": "electric-sql/electric",
  "parent_type": "issue",
  "parent_number": 456,
  "body": "This looks like a conflict resolution bug.",
  "author_login": "jane-dev",
  "created_at": "2026-06-06T13:00:00Z",
  "url": "https://github.com/electric-sql/electric/issues/456#issuecomment-101112"
}
```

## `raw_commits.jsonl`

```json
{
  "sha": "abc123",
  "repo": "electric-sql/electric",
  "author_login": "jane-dev",
  "message": "Fix websocket reconnect behavior",
  "committed_at": "2026-06-09T12:00:00Z",
  "changed_files": ["packages/sync/src/socket.ts"],
  "url": "https://github.com/electric-sql/electric/commit/abc123"
}
```

## `raw_users.jsonl`

```json
{
  "id": 42,
  "login": "jane-dev",
  "type": "User",
  "name": "Jane Developer",
  "company": "ExampleCo",
  "location": "San Francisco",
  "blog": "https://jane.dev",
  "email": null,
  "bio": "Building sync systems",
  "public_repos": 80,
  "followers": 1200,
  "created_at": "2017-01-01T00:00:00Z",
  "url": "https://github.com/jane-dev"
}
```

## `ranked_leads.jsonl`

```json
{
  "engineer_login": "jane-dev",
  "score": 94,
  "why_relevant": "Recently worked on live query invalidation and replication in ElectricSQL.",
  "outreach_angle": "Likely understands reactive backend sync complexity, which Convex simplifies.",
  "score_breakdown": {
    "recent_activity": 22,
    "repo_category_fit": 24,
    "topic_fit": 21,
    "contribution_depth": 16,
    "stack_fit": 8,
    "evidence_quality": 3
  },
  "evidence": [
    {
      "type": "pull_request",
      "title": "Improve live query invalidation",
      "url": "https://github.com/electric-sql/electric/pull/123",
      "created_at": "2026-06-10T12:00:00Z",
      "matched_topics": ["live query", "invalidation", "replication"]
    }
  ]
}
```
