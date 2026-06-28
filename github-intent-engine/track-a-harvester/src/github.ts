import { Octokit } from "@octokit/rest";
import type { GitHubDataSource, GitHubSourceStats } from "./github-source.js";
import { isAtOrAfter, parseIssueNumberFromIssueUrl, parseRepoFullName } from "./github-utils.js";
import { manifestKindForPath, parseManifestContent } from "./manifest.js";
import {
  normalizeCommit,
  normalizeComment,
  normalizeIssue,
  normalizePullRequest,
  normalizeRepo,
  normalizeUser
} from "./normalize.js";
import type {
  HarvestFailure,
  RawCommit,
  RawComment,
  RawIssue,
  RawManifest,
  RawPullRequest,
  RawPullRequestReview,
  RawPullRequestReviewComment,
  RawRepo,
  RawRepoExpansion,
  RawWorkflowRun,
  RawUser
} from "./types.js";

type GitHubClientOptions = {
  token?: string;
  maxPagesPerList?: number;
  maxItemsPerList?: number;
  maxChangedFiles?: number;
  readmeLimit?: number;
  requestTimeoutMs?: number;
  maxManifestFiles?: number;
  includeReadmes?: boolean;
  includeFileDiffs?: boolean;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  secondaryRateLimitDelayMs?: number;
};

export class GitHubClient implements GitHubDataSource {
  readonly stats: GitHubSourceStats = {
    requestCount: 0,
    failedRequestCount: 0,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
    failures: []
  };

  private readonly octokit: Octokit;
  private readonly maxPagesPerList: number;
  private readonly maxItemsPerList: number;
  private readonly maxChangedFiles: number;
  private readonly readmeLimit: number;
  private readonly maxManifestFiles: number;
  private readonly includeReadmes: boolean;
  private readonly includeFileDiffs: boolean;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly secondaryRateLimitDelayMs: number;

  constructor(options: GitHubClientOptions = {}) {
    this.octokit = new Octokit({
      auth: options.token || undefined,
      userAgent: "github-intent-engine-harvester",
      request: {
        timeout: options.requestTimeoutMs ?? 15_000
      }
    });
    this.maxPagesPerList = options.maxPagesPerList ?? 3;
    this.maxItemsPerList = options.maxItemsPerList ?? 50;
    this.maxChangedFiles = options.maxChangedFiles ?? 100;
    this.readmeLimit = options.readmeLimit ?? 20_000;
    this.maxManifestFiles = options.maxManifestFiles ?? 25;
    this.includeReadmes = options.includeReadmes ?? true;
    this.includeFileDiffs = options.includeFileDiffs ?? true;
    this.maxRetries = options.maxRetries ?? 4;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.secondaryRateLimitDelayMs = options.secondaryRateLimitDelayMs ?? 60_000;
  }

  async fetchRepo(fullName: string): Promise<RawRepo | null> {
    const { owner, repo } = parseRepoFullName(fullName);
    const repoData = await this.safeRequest("repo", fullName, () =>
      this.octokit.rest.repos.get({ owner, repo })
    );
    if (!repoData) {
      return null;
    }

    const readmeText = this.includeReadmes ? await this.fetchReadmeText(owner, repo, fullName) : null;
    return normalizeRepo(repoData.data as unknown as Record<string, unknown>, readmeText, this.readmeLimit);
  }

  async fetchPullRequests(fullName: string, since: Date): Promise<RawPullRequest[]> {
    const { owner, repo } = parseRepoFullName(fullName);
    const records: RawPullRequest[] = [];

    for (let page = 1; page <= this.maxPagesPerList; page += 1) {
      const response = await this.safeRequest("pulls", `${fullName}:page:${page}`, () =>
        this.octokit.rest.pulls.list({
          owner,
          repo,
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page
        })
      );
      if (!response || response.data.length === 0) {
        break;
      }

      for (const pullRequest of response.data) {
        if (!isAtOrAfter(pullRequest.updated_at, since) && !isAtOrAfter(pullRequest.merged_at, since)) {
          continue;
        }
        const changedFiles = await this.fetchPullRequestFiles(owner, repo, pullRequest.number, fullName);
        records.push(
          normalizePullRequest(
            fullName,
            pullRequest as unknown as Record<string, unknown>,
            changedFiles
          )
        );
        if (records.length >= this.maxItemsPerList) {
          return records;
        }
      }

      if (response.data.every((pullRequest) => !isAtOrAfter(pullRequest.updated_at, since))) {
        break;
      }
    }

    return records;
  }

  async fetchIssues(fullName: string, since: Date): Promise<RawIssue[]> {
    const { owner, repo } = parseRepoFullName(fullName);
    const records: RawIssue[] = [];

    for (let page = 1; page <= this.maxPagesPerList; page += 1) {
      const response = await this.safeRequest("issues", `${fullName}:page:${page}`, () =>
        this.octokit.rest.issues.listForRepo({
          owner,
          repo,
          state: "all",
          since: since.toISOString(),
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page
        })
      );
      if (!response || response.data.length === 0) {
        break;
      }

      for (const issue of response.data) {
        if ("pull_request" in issue) {
          continue;
        }
        records.push(normalizeIssue(fullName, issue as unknown as Record<string, unknown>));
        if (records.length >= this.maxItemsPerList) {
          return records;
        }
      }
    }

    return records;
  }

  async fetchIssueComments(fullName: string, since: Date): Promise<RawComment[]> {
    const { owner, repo } = parseRepoFullName(fullName);
    const records: RawComment[] = [];

    for (let page = 1; page <= this.maxPagesPerList; page += 1) {
      const response = await this.safeRequest("comments", `${fullName}:page:${page}`, () =>
        this.octokit.rest.issues.listCommentsForRepo({
          owner,
          repo,
          since: since.toISOString(),
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page
        })
      );
      if (!response || response.data.length === 0) {
        break;
      }

      for (const comment of response.data) {
        const issueNumber = parseIssueNumberFromIssueUrl(comment.issue_url);
        if (issueNumber === null) {
          this.recordFailure({
            scope: "comment",
            resource: `${fullName}:${comment.id}`,
            message: "Could not parse parent issue number"
          });
          continue;
        }

        records.push(
          normalizeComment(fullName, {
            ...(comment as unknown as Record<string, unknown>),
            issue_number: issueNumber
          })
        );
        if (records.length >= this.maxItemsPerList) {
          return records;
        }
      }
    }

    return records;
  }

  async fetchCommits(fullName: string, since: Date): Promise<RawCommit[]> {
    const { owner, repo } = parseRepoFullName(fullName);
    const records: RawCommit[] = [];

    for (let page = 1; page <= this.maxPagesPerList; page += 1) {
      const response = await this.safeRequest("commits", `${fullName}:page:${page}`, () =>
        this.octokit.rest.repos.listCommits({
          owner,
          repo,
          since: since.toISOString(),
          per_page: 100,
          page
        })
      );
      if (!response || response.data.length === 0) {
        break;
      }

      for (const commit of response.data) {
        const changedFiles = await this.fetchCommitFiles(owner, repo, commit.sha, fullName);
        records.push(
          normalizeCommit(fullName, commit as unknown as Record<string, unknown>, changedFiles)
        );
        if (records.length >= this.maxItemsPerList) {
          return records;
        }
      }
    }

    return records;
  }

  async fetchUser(login: string): Promise<RawUser | null> {
    const response = await this.safeRequest("user", login, () =>
      this.octokit.rest.users.getByUsername({ username: login })
    );
    if (!response) {
      return null;
    }

    return normalizeUser(response.data as unknown as Record<string, unknown>);
  }

  async expandRepo(fullName: string): Promise<RawRepoExpansion[]> {
    const repo = await this.fetchRepo(fullName);
    if (!repo) {
      return [];
    }

    const expansions: RawRepoExpansion[] = [];
    expansions.push(...(await this.expandOwnerSiblings(repo)));
    expansions.push(...(await this.expandSimilarTopics(repo)));
    expansions.push(...(await this.expandContributorRepos(repo)));
    expansions.push(...(await this.expandContributorStarredRepos(repo)));
    expansions.push(...(await this.expandForks(repo)));

    const seen = new Set<string>();
    return expansions.filter((expansion) => {
      if (expansion.expanded_repo === fullName || seen.has(expansion.expanded_repo)) {
        return false;
      }
      seen.add(expansion.expanded_repo);
      return true;
    });
  }

  async fetchManifests(repoRecord: RawRepo): Promise<RawManifest[]> {
    if (this.maxManifestFiles <= 0) {
      return [];
    }

    const { owner, repo } = parseRepoFullName(repoRecord.full_name);
    const tree = await this.safeRequest("tree", repoRecord.full_name, () =>
      this.octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: repoRecord.default_branch,
        recursive: "true"
      })
    );
    if (!tree) {
      return [];
    }

    const manifestPaths = tree.data.tree
      .map((entry) => entry.path)
      .filter((path): path is string => typeof path === "string" && manifestKindForPath(path) !== null)
      .slice(0, this.maxManifestFiles);

    const manifests: RawManifest[] = [];
    for (const path of manifestPaths) {
      const content = await this.fetchFileContent(owner, repo, path, repoRecord.full_name);
      if (content === null) {
        continue;
      }
      const parsed = parseManifestContent(path, content);
      manifests.push({
        repo: repoRecord.full_name,
        path,
        kind: parsed.kind,
        package_names: parsed.package_names.slice(0, 100),
        scripts: parsed.scripts.slice(0, 50),
        ci_keywords: parsed.ci_keywords,
        content_excerpt: content.slice(0, 5000),
        url: `https://github.com/${repoRecord.full_name}/blob/${repoRecord.default_branch}/${path}`
      });
    }

    return manifests;
  }

  async fetchPullRequestReviews(
    fullName: string,
    pullRequests: RawPullRequest[],
    since: Date
  ): Promise<RawPullRequestReview[]> {
    const { owner, repo } = parseRepoFullName(fullName);
    const reviews: RawPullRequestReview[] = [];
    for (const pullRequest of pullRequests.slice(0, this.maxItemsPerList)) {
      const response = await this.safeRequest("pull_reviews", `${fullName}#${pullRequest.number}`, () =>
        this.octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: pullRequest.number,
          per_page: 100,
          page: 1
        })
      );
      if (!response) continue;
      for (const review of response.data) {
        if (!isAtOrAfter(review.submitted_at, since)) continue;
        reviews.push({
          id: review.id,
          repo: fullName,
          pull_number: pullRequest.number,
          author_login: review.user?.login ?? null,
          state: review.state,
          body: review.body ?? null,
          submitted_at: review.submitted_at ?? pullRequest.updated_at,
          url: review.html_url ?? pullRequest.url
        });
        if (reviews.length >= this.maxItemsPerList) return reviews;
      }
    }
    return reviews;
  }

  async fetchPullRequestReviewComments(
    fullName: string,
    pullRequests: RawPullRequest[],
    since: Date
  ): Promise<RawPullRequestReviewComment[]> {
    const { owner, repo } = parseRepoFullName(fullName);
    const comments: RawPullRequestReviewComment[] = [];
    for (const pullRequest of pullRequests.slice(0, this.maxItemsPerList)) {
      const response = await this.safeRequest("pull_review_comments", `${fullName}#${pullRequest.number}`, () =>
        this.octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: pullRequest.number,
          per_page: 100,
          page: 1
        })
      );
      if (!response) continue;
      for (const comment of response.data) {
        if (!isAtOrAfter(comment.created_at, since)) continue;
        comments.push({
          id: comment.id,
          repo: fullName,
          pull_number: pullRequest.number,
          author_login: comment.user?.login ?? null,
          body: comment.body ?? null,
          path: comment.path ?? null,
          created_at: comment.created_at,
          url: comment.html_url
        });
        if (comments.length >= this.maxItemsPerList) return comments;
      }
    }
    return comments;
  }

  async fetchWorkflowRuns(fullName: string, since: Date): Promise<RawWorkflowRun[]> {
    const { owner, repo } = parseRepoFullName(fullName);
    const records: RawWorkflowRun[] = [];
    for (let page = 1; page <= this.maxPagesPerList; page += 1) {
      const response = await this.safeRequest("workflow_runs", `${fullName}:page:${page}`, () =>
        this.octokit.rest.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          per_page: 100,
          page
        })
      );
      if (!response || response.data.workflow_runs.length === 0) break;
      for (const run of response.data.workflow_runs) {
        if (!isAtOrAfter(run.created_at, since) && !isAtOrAfter(run.updated_at, since)) continue;
        records.push({
          id: run.id,
          repo: fullName,
          name: run.name ?? null,
          event: run.event,
          status: run.status ?? null,
          conclusion: run.conclusion ?? null,
          actor_login: run.actor?.login ?? null,
          created_at: run.created_at,
          updated_at: run.updated_at,
          url: run.html_url
        });
        if (records.length >= this.maxItemsPerList) return records;
      }
    }
    return records;
  }

  private async fetchReadmeText(owner: string, repo: string, fullName: string): Promise<string | null> {
    const response = await this.safeRequest("readme", fullName, () =>
      this.octokit.request("GET /repos/{owner}/{repo}/readme", {
        owner,
        repo,
        mediaType: { format: "raw" }
      })
    );
    if (!response) {
      return null;
    }

    return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  }

  private async fetchFileContent(
    owner: string,
    repo: string,
    path: string,
    fullName: string
  ): Promise<string | null> {
    const response = await this.safeRequest("file_content", `${fullName}:${path}`, () =>
      this.octokit.rest.repos.getContent({
        owner,
        repo,
        path
      })
    );
    if (!response || Array.isArray(response.data) || !("content" in response.data)) {
      return null;
    }

    const content = response.data.content;
    if (typeof content !== "string") {
      return null;
    }
    return Buffer.from(content, "base64").toString("utf8");
  }

  private async expandOwnerSiblings(repoRecord: RawRepo): Promise<RawRepoExpansion[]> {
    const owner = repoRecord.owner_login;
    const response =
      repoRecord.owner_type === "Organization"
        ? await this.safeRequest("expand_owner_repos", owner, () =>
            this.octokit.rest.repos.listForOrg({
              org: owner,
              sort: "pushed",
              direction: "desc",
              per_page: 10
            })
          )
        : await this.safeRequest("expand_owner_repos", owner, () =>
            this.octokit.rest.repos.listForUser({
              username: owner,
              sort: "pushed",
              direction: "desc",
              per_page: 10
            })
          );
    if (!response) return [];
    return response.data
      .filter((repo) => !repo.fork && !repo.archived)
      .map((repo) => ({
        source_repo: repoRecord.full_name,
        expanded_repo: repo.full_name,
        reason: "org_sibling_repo",
        evidence: `${repoRecord.owner_login} recently pushed ${repo.full_name}`
      }));
  }

  private async expandSimilarTopics(repoRecord: RawRepo): Promise<RawRepoExpansion[]> {
    const topics = repoRecord.topics.slice(0, 3);
    const expansions: RawRepoExpansion[] = [];
    for (const topic of topics) {
      const response = await this.safeRequest("expand_topic_search", `${repoRecord.full_name}:${topic}`, () =>
        this.octokit.rest.search.repos({
          q: `topic:${topic} stars:>50 archived:false`,
          sort: "updated",
          order: "desc",
          per_page: 5
        })
      );
      if (!response) continue;
      expansions.push(
        ...response.data.items.map((repo) => ({
          source_repo: repoRecord.full_name,
          expanded_repo: repo.full_name,
          reason: "similar_topic",
          evidence: `Shares GitHub topic ${topic}`
        }))
      );
    }
    return expansions;
  }

  private async expandContributorRepos(repoRecord: RawRepo): Promise<RawRepoExpansion[]> {
    const { owner, repo } = parseRepoFullName(repoRecord.full_name);
    const contributors = await this.safeRequest("expand_contributors", repoRecord.full_name, () =>
      this.octokit.rest.repos.listContributors({
        owner,
        repo,
        per_page: 3
      })
    );
    if (!contributors) return [];

    const expansions: RawRepoExpansion[] = [];
    for (const contributor of contributors.data) {
      const login = contributor.login;
      if (!login) continue;
      const repos = await this.safeRequest("expand_contributor_repos", login, () =>
        this.octokit.rest.repos.listForUser({
          username: login,
          sort: "updated",
          direction: "desc",
          per_page: 5
        })
      );
      if (!repos) continue;
      expansions.push(
        ...repos.data
          .filter((candidate) => !candidate.fork && !candidate.archived)
          .map((candidate) => ({
            source_repo: repoRecord.full_name,
            expanded_repo: candidate.full_name,
            reason: "shared_contributor",
            evidence: `${login} contributes near ${repoRecord.full_name}`
          }))
      );
    }
    return expansions;
  }

  private async expandContributorStarredRepos(repoRecord: RawRepo): Promise<RawRepoExpansion[]> {
    const { owner, repo } = parseRepoFullName(repoRecord.full_name);
    const contributors = await this.safeRequest("expand_starred_contributors", repoRecord.full_name, () =>
      this.octokit.rest.repos.listContributors({
        owner,
        repo,
        per_page: 2
      })
    );
    if (!contributors) return [];

    const expansions: RawRepoExpansion[] = [];
    for (const contributor of contributors.data) {
      const login = contributor.login;
      if (!login) continue;
      const starred = await this.safeRequest("expand_starred_repos", login, () =>
        this.octokit.rest.activity.listReposStarredByUser({
          username: login,
          sort: "updated",
          direction: "desc",
          per_page: 5
        })
      );
      if (!starred) continue;
      const starredRepos = starred.data
        .map(normalizeStarredRepo)
        .filter((candidate): candidate is StarredRepoCandidate => Boolean(candidate));
      expansions.push(
        ...starredRepos
          .filter((candidate) => !candidate.fork && !candidate.archived)
          .map((candidate) => ({
            source_repo: repoRecord.full_name,
            expanded_repo: candidate.full_name,
            reason: "starred_by_shared_contributor",
            evidence: `${login} starred ${candidate.full_name} near ${repoRecord.full_name}`
          }))
      );
    }
    return expansions;
  }

  private async expandForks(repoRecord: RawRepo): Promise<RawRepoExpansion[]> {
    const { owner, repo } = parseRepoFullName(repoRecord.full_name);
    const response = await this.safeRequest("expand_forks", repoRecord.full_name, () =>
      this.octokit.rest.repos.listForks({
        owner,
        repo,
        sort: "stargazers",
        per_page: 5
      })
    );
    if (!response) return [];
    return response.data.map((candidate) => ({
      source_repo: repoRecord.full_name,
      expanded_repo: candidate.full_name,
      reason: "forked_adjacent_repo",
      evidence: `${candidate.full_name} is a fork adjacent to ${repoRecord.full_name}`
    }));
  }

  private async fetchPullRequestFiles(
    owner: string,
    repo: string,
    pullNumber: number,
    fullName: string
  ): Promise<string[]> {
    if (!this.includeFileDiffs || this.maxChangedFiles <= 0) {
      return [];
    }

    const response = await this.safeRequest("pull_files", `${fullName}#${pullNumber}`, () =>
      this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: Math.min(this.maxChangedFiles, 100),
        page: 1
      })
    );

    return response ? response.data.map((file) => file.filename).slice(0, this.maxChangedFiles) : [];
  }

  private async fetchCommitFiles(
    owner: string,
    repo: string,
    sha: string,
    fullName: string
  ): Promise<string[]> {
    if (!this.includeFileDiffs || this.maxChangedFiles <= 0) {
      return [];
    }

    const response = await this.safeRequest("commit_files", `${fullName}@${sha}`, () =>
      this.octokit.rest.repos.getCommit({ owner, repo, ref: sha })
    );

    return response
      ? (response.data.files ?? []).map((file) => file.filename).slice(0, this.maxChangedFiles)
      : [];
  }

  private async safeRequest<T>(
    scope: string,
    resource: string,
    request: () => Promise<T>
  ): Promise<T | null> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      this.stats.requestCount += 1;
      try {
        const response = await request();
        this.updateRateLimit(response);
        return response;
      } catch (error) {
        if (!isRetryableGitHubError(error) || attempt >= this.maxRetries) {
          this.recordRequestFailure(scope, resource, error);
          return null;
        }
        await sleep(
          retryDelayMsForError(error, attempt, {
            retryBaseDelayMs: this.retryBaseDelayMs,
            secondaryRateLimitDelayMs: this.secondaryRateLimitDelayMs
          })
        );
      }
    }
    return null;
  }

  private updateRateLimit(response: unknown): void {
    const headers = (response as { headers?: Record<string, string | number | undefined> }).headers;
    if (!headers) {
      return;
    }

    const remaining = headers["x-ratelimit-remaining"];
    const reset = headers["x-ratelimit-reset"];

    if (remaining !== undefined) {
      this.stats.rateLimitRemaining = Number(remaining);
    }
    if (reset !== undefined) {
      this.stats.rateLimitResetAt = new Date(Number(reset) * 1000).toISOString();
    }
  }

  private recordRequestFailure(scope: string, resource: string, error: unknown): void {
    this.stats.failedRequestCount += 1;
    this.recordFailure({
      scope,
      resource,
      message: error instanceof Error ? error.message : String(error),
      status: statusFromError(error)
    });
  }

  private recordFailure(failure: HarvestFailure): void {
    this.stats.failures.push(failure);
  }
}

type StarredRepoCandidate = {
  full_name: string;
  fork: boolean;
  archived: boolean;
};

function normalizeStarredRepo(item: unknown): StarredRepoCandidate | null {
  const record = item as Record<string, unknown>;
  const repo =
    record.repo && typeof record.repo === "object"
      ? (record.repo as Record<string, unknown>)
      : record;
  const fullName = repo.full_name;
  if (typeof fullName !== "string") {
    return null;
  }
  return {
    full_name: fullName,
    fork: Boolean(repo.fork),
    archived: Boolean(repo.archived)
  };
}

function statusFromError(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function isRetryableGitHubError(error: unknown): boolean {
  const status = statusFromError(error);
  return status === undefined || status === 403 || status === 429 || status >= 500;
}

export function retryDelayMsForError(
  error: unknown,
  attempt: number,
  options: {
    retryBaseDelayMs?: number;
    secondaryRateLimitDelayMs?: number;
    nowMs?: number;
  } = {}
): number {
  const headers = headersFromError(error);
  const retryAfter = numberHeader(headers, "retry-after");
  if (retryAfter !== null) {
    return Math.max(0, retryAfter * 1000);
  }

  const remaining = numberHeader(headers, "x-ratelimit-remaining");
  const reset = numberHeader(headers, "x-ratelimit-reset");
  if (remaining === 0 && reset !== null) {
    return Math.max(0, reset * 1000 - (options.nowMs ?? Date.now()) + 1000);
  }

  const status = statusFromError(error);
  if (status === 403 || status === 429) {
    return (options.secondaryRateLimitDelayMs ?? 60_000) * Math.max(1, attempt + 1);
  }

  return (options.retryBaseDelayMs ?? 1_000) * 2 ** attempt;
}

function headersFromError(error: unknown): Record<string, unknown> {
  const record = error as {
    response?: { headers?: Record<string, unknown> };
    headers?: Record<string, unknown>;
  };
  return record.response?.headers ?? record.headers ?? {};
}

function numberHeader(headers: Record<string, unknown>, key: string): number | null {
  const value = headers[key] ?? headers[key.toLowerCase()];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
