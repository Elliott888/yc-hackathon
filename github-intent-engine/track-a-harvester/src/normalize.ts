import type {
  RawCommit,
  RawComment,
  RawIssue,
  RawPullRequest,
  RawRepo,
  RawUser
} from "./types.js";

export function normalizeRepo(
  repo: Record<string, unknown>,
  readmeText: string | null,
  readmeLimit = 20_000
): RawRepo {
  const owner = asRecord(repo.owner);

  return {
    id: asNumber(repo.id),
    full_name: asString(repo.full_name),
    owner_login: asString(owner.login),
    owner_type: asString(owner.type),
    description: nullableString(repo.description),
    topics: asStringArray(repo.topics),
    stars: asNumber(repo.stargazers_count),
    forks: asNumber(repo.forks_count),
    primary_language: nullableString(repo.language),
    default_branch: asString(repo.default_branch),
    is_fork: asBoolean(repo.fork),
    is_archived: asBoolean(repo.archived),
    pushed_at: nullableString(repo.pushed_at),
    readme_text: readmeText === null ? null : readmeText.slice(0, readmeLimit),
    url: asString(repo.html_url)
  };
}

export function normalizePullRequest(
  repo: string,
  pullRequest: Record<string, unknown>,
  changedFiles: string[]
): RawPullRequest {
  const user = asRecord(pullRequest.user);
  const mergedAt = nullableString(pullRequest.merged_at);

  return {
    id: asNumber(pullRequest.id),
    repo,
    number: asNumber(pullRequest.number),
    title: asString(pullRequest.title),
    body: nullableString(pullRequest.body),
    author_login: nullableString(user.login),
    state: asString(pullRequest.state),
    merged: mergedAt !== null,
    created_at: asString(pullRequest.created_at),
    updated_at: asString(pullRequest.updated_at),
    merged_at: mergedAt,
    changed_files: changedFiles,
    url: asString(pullRequest.html_url)
  };
}

export function normalizeIssue(repo: string, issue: Record<string, unknown>): RawIssue {
  const user = asRecord(issue.user);

  return {
    id: asNumber(issue.id),
    repo,
    number: asNumber(issue.number),
    title: asString(issue.title),
    body: nullableString(issue.body),
    author_login: nullableString(user.login),
    state: asString(issue.state),
    created_at: asString(issue.created_at),
    updated_at: asString(issue.updated_at),
    url: asString(issue.html_url)
  };
}

export function normalizeComment(repo: string, comment: Record<string, unknown>): RawComment {
  const user = asRecord(comment.user);

  return {
    id: asNumber(comment.id),
    repo,
    parent_type: "issue",
    parent_number: asNumber(comment.issue_number),
    body: nullableString(comment.body),
    author_login: nullableString(user.login),
    created_at: asString(comment.created_at),
    url: asString(comment.html_url)
  };
}

export function normalizeCommit(
  repo: string,
  commit: Record<string, unknown>,
  changedFiles: string[]
): RawCommit {
  const author = asRecord(commit.author);
  const commitObject = asRecord(commit.commit);
  const committer = asRecord(commitObject.committer);

  return {
    sha: asString(commit.sha),
    repo,
    author_login: nullableString(author.login),
    message: asString(commitObject.message),
    committed_at: asString(committer.date),
    changed_files: changedFiles,
    url: asString(commit.html_url)
  };
}

export function normalizeUser(user: Record<string, unknown>): RawUser {
  return {
    id: asNumber(user.id),
    login: asString(user.login),
    type: asString(user.type),
    name: nullableString(user.name),
    company: nullableString(user.company),
    location: nullableString(user.location),
    blog: nullableString(user.blog),
    email: nullableString(user.email),
    bio: nullableString(user.bio),
    public_repos: asNumber(user.public_repos),
    followers: asNumber(user.followers),
    created_at: asString(user.created_at),
    url: asString(user.html_url)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
