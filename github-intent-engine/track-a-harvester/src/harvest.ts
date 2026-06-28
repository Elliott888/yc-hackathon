import { dedupeBy } from "./dedupe.js";
import { buildContributorStats } from "./contributor-stats.js";
import type { GitHubDataSource } from "./github-source.js";
import type {
  HarvestData,
  HarvestReport,
  RawCommit,
  RawComment,
  RawIssue,
  RawManifest,
  RawPullRequest,
  RawPullRequestReview,
  RawPullRequestReviewComment,
  RawRepo,
  RawWorkflowRun,
  RawUser
} from "./types.js";

export type HarvestOptions = {
  source: GitHubDataSource;
  repos: string[];
  since: Date;
  days?: number;
  invalidSeedRepos?: HarvestReport["invalid_seed_repos"];
  duplicateSeedRepos?: string[];
  repoExpansions?: HarvestData["repoExpansions"];
  checkpointStore?: CheckpointStore;
};

export type HarvestResult = {
  data: HarvestData;
  report: HarvestReport;
};

export type RepoHarvestData = {
  repo: RawRepo;
  pullRequests: RawPullRequest[];
  issues: RawIssue[];
  comments: RawComment[];
  commits: RawCommit[];
  manifests: RawManifest[];
  pullRequestReviews: RawPullRequestReview[];
  pullRequestReviewComments: RawPullRequestReviewComment[];
  workflowRuns: RawWorkflowRun[];
};

export type CheckpointStore = {
  read(fullName: string): Promise<RepoHarvestData | null>;
  write(fullName: string, data: RepoHarvestData): Promise<void>;
};

export async function harvestData(options: HarvestOptions): Promise<HarvestResult> {
  const startedAt = new Date();
  const repos: RawRepo[] = [];
  const pullRequests: RawPullRequest[] = [];
  const issues: RawIssue[] = [];
  const comments: RawComment[] = [];
  const commits: RawCommit[] = [];
  const manifests: RawManifest[] = [];
  const pullRequestReviews: RawPullRequestReview[] = [];
  const pullRequestReviewComments: RawPullRequestReviewComment[] = [];
  const workflowRuns: RawWorkflowRun[] = [];

  for (const fullName of options.repos) {
    const checkpoint = await options.checkpointStore?.read(fullName);
    if (checkpoint) {
      pushRepoHarvestData({
        repos,
        pullRequests,
        issues,
        comments,
        commits,
        manifests,
        pullRequestReviews,
        pullRequestReviewComments,
        workflowRuns
      }, checkpoint);
      continue;
    }

    const repo = await options.source.fetchRepo(fullName);
    if (!repo) {
      continue;
    }

    repos.push(repo);

    const canonicalFullName = repo.full_name;
    const [repoPullRequests, repoIssues, repoComments, repoCommits] = await Promise.all([
      options.source.fetchPullRequests(canonicalFullName, options.since),
      options.source.fetchIssues(canonicalFullName, options.since),
      options.source.fetchIssueComments(canonicalFullName, options.since),
      options.source.fetchCommits(canonicalFullName, options.since)
    ]);

    pullRequests.push(...repoPullRequests);
    issues.push(...repoIssues);
    comments.push(...repoComments);
    commits.push(...repoCommits);

    const [repoManifests, repoReviews, repoReviewComments, repoWorkflowRuns] = await Promise.all([
      options.source.fetchManifests?.(repo) ?? Promise.resolve([]),
      options.source.fetchPullRequestReviews?.(canonicalFullName, repoPullRequests, options.since) ??
        Promise.resolve([]),
      options.source.fetchPullRequestReviewComments?.(canonicalFullName, repoPullRequests, options.since) ??
        Promise.resolve([]),
      options.source.fetchWorkflowRuns?.(canonicalFullName, options.since) ?? Promise.resolve([])
    ]);

    manifests.push(...repoManifests);
    pullRequestReviews.push(...repoReviews);
    pullRequestReviewComments.push(...repoReviewComments);
    workflowRuns.push(...repoWorkflowRuns);

    await options.checkpointStore?.write(fullName, {
      repo,
      pullRequests: repoPullRequests,
      issues: repoIssues,
      comments: repoComments,
      commits: repoCommits,
      manifests: repoManifests,
      pullRequestReviews: repoReviews,
      pullRequestReviewComments: repoReviewComments,
      workflowRuns: repoWorkflowRuns
    });
  }

  const dedupedRepos = dedupeBy(repos, (repo) => String(repo.id)).records;
  const dedupedPullRequests = dedupeBy(pullRequests, (pr) => `${pr.repo}:${pr.number}`).records;
  const dedupedIssues = dedupeBy(issues, (issue) => `${issue.repo}:${issue.number}`).records;
  const dedupedComments = dedupeBy(comments, (comment) => String(comment.id)).records;
  const dedupedCommits = dedupeBy(commits, (commit) => `${commit.repo}:${commit.sha}`).records;
  const dedupedManifests = dedupeBy(manifests, (manifest) => `${manifest.repo}:${manifest.path}`).records;
  const dedupedPullRequestReviews = dedupeBy(pullRequestReviews, (review) => String(review.id)).records;
  const dedupedPullRequestReviewComments = dedupeBy(pullRequestReviewComments, (comment) => String(comment.id)).records;
  const dedupedWorkflowRuns = dedupeBy(workflowRuns, (run) => String(run.id)).records;
  const contributorStats = buildContributorStats({
    pullRequests: dedupedPullRequests,
    issues: dedupedIssues,
    comments: dedupedComments,
    commits: dedupedCommits,
    pullRequestReviews: dedupedPullRequestReviews,
    pullRequestReviewComments: dedupedPullRequestReviewComments,
    workflowRuns: dedupedWorkflowRuns
  });

  const users = await fetchUsersForActors(options.source, {
    repos: dedupedRepos,
    pullRequests: dedupedPullRequests,
    issues: dedupedIssues,
    comments: dedupedComments,
    commits: dedupedCommits,
    pullRequestReviews: dedupedPullRequestReviews,
    pullRequestReviewComments: dedupedPullRequestReviewComments,
    workflowRuns: dedupedWorkflowRuns
  });
  const dedupedUsers = dedupeBy(users, (user) => user.login).records;

  const data: HarvestData = {
    repos: sortRepos(dedupedRepos),
    pullRequests: sortByRepoAndTime(dedupedPullRequests, (record) => record.updated_at),
    issues: sortByRepoAndTime(dedupedIssues, (record) => record.updated_at),
    comments: sortByRepoAndTime(dedupedComments, (record) => record.created_at),
    commits: sortByRepoAndTime(dedupedCommits, (record) => record.committed_at),
    manifests: sortManifests(dedupedManifests),
    pullRequestReviews: sortByRepoAndTime(dedupedPullRequestReviews, (record) => record.submitted_at),
    pullRequestReviewComments: sortByRepoAndTime(dedupedPullRequestReviewComments, (record) => record.created_at),
    workflowRuns: sortByRepoAndTime(dedupedWorkflowRuns, (record) => record.updated_at),
    contributorStats,
    repoExpansions: options.repoExpansions ?? [],
    users: dedupedUsers
  };

  const report = buildReport({
    startedAt,
    days: options.days ?? daysBetween(options.since, startedAt),
    seedRepoCount: options.repos.length,
    fetchedRepoCount: data.repos.length,
    data,
    invalidSeedRepos: options.invalidSeedRepos ?? [],
    duplicateSeedRepos: options.duplicateSeedRepos ?? [],
    source: options.source
  });

  return { data, report };
}

function pushRepoHarvestData(
  target: {
    repos: RawRepo[];
    pullRequests: RawPullRequest[];
    issues: RawIssue[];
    comments: RawComment[];
    commits: RawCommit[];
    manifests: RawManifest[];
    pullRequestReviews: RawPullRequestReview[];
    pullRequestReviewComments: RawPullRequestReviewComment[];
    workflowRuns: RawWorkflowRun[];
  },
  data: RepoHarvestData
): void {
  target.repos.push(data.repo);
  target.pullRequests.push(...data.pullRequests);
  target.issues.push(...data.issues);
  target.comments.push(...data.comments);
  target.commits.push(...data.commits);
  target.manifests.push(...data.manifests);
  target.pullRequestReviews.push(...data.pullRequestReviews);
  target.pullRequestReviewComments.push(...data.pullRequestReviewComments);
  target.workflowRuns.push(...data.workflowRuns);
}

async function fetchUsersForActors(
  source: GitHubDataSource,
  data: Pick<
    HarvestData,
    | "repos"
    | "pullRequests"
    | "issues"
    | "comments"
    | "commits"
    | "pullRequestReviews"
    | "pullRequestReviewComments"
    | "workflowRuns"
  >
): Promise<RawUser[]> {
  const logins = new Set<string>();

  for (const repo of data.repos) {
    addLogin(logins, repo.owner_login);
  }
  for (const pr of data.pullRequests) {
    addLogin(logins, pr.author_login);
  }
  for (const issue of data.issues) {
    addLogin(logins, issue.author_login);
  }
  for (const comment of data.comments) {
    addLogin(logins, comment.author_login);
  }
  for (const commit of data.commits) {
    addLogin(logins, commit.author_login);
  }
  for (const review of data.pullRequestReviews) {
    addLogin(logins, review.author_login);
  }
  for (const comment of data.pullRequestReviewComments) {
    addLogin(logins, comment.author_login);
  }
  for (const run of data.workflowRuns) {
    addLogin(logins, run.actor_login);
  }

  const users: RawUser[] = [];
  for (const login of logins) {
    const user = await source.fetchUser(login);
    if (user) {
      users.push(user);
    }
  }

  return users;
}

function addLogin(logins: Set<string>, login: string | null): void {
  if (login) {
    logins.add(login);
  }
}

function buildReport(input: {
  startedAt: Date;
  days: number;
  seedRepoCount: number;
  fetchedRepoCount: number;
  data: HarvestData;
  invalidSeedRepos: HarvestReport["invalid_seed_repos"];
  duplicateSeedRepos: string[];
  source: GitHubDataSource;
}): HarvestReport {
  return {
    started_at: input.startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    days: input.days,
    seed_repo_count: input.seedRepoCount,
    expanded_repo_count: input.data.repoExpansions.length,
    fetched_repo_count: input.fetchedRepoCount,
    raw_pull_request_count: input.data.pullRequests.length,
    raw_issue_count: input.data.issues.length,
    raw_comment_count: input.data.comments.length,
    raw_commit_count: input.data.commits.length,
    raw_manifest_count: input.data.manifests.length,
    raw_pull_request_review_count: input.data.pullRequestReviews.length,
    raw_pull_request_review_comment_count: input.data.pullRequestReviewComments.length,
    raw_workflow_run_count: input.data.workflowRuns.length,
    raw_contributor_stat_count: input.data.contributorStats.length,
    raw_user_count: input.data.users.length,
    skipped_repo_count: input.seedRepoCount - input.fetchedRepoCount,
    failed_request_count: input.source.stats.failedRequestCount,
    request_count: input.source.stats.requestCount,
    rate_limit_remaining: input.source.stats.rateLimitRemaining,
    rate_limit_reset_at: input.source.stats.rateLimitResetAt,
    invalid_seed_repos: input.invalidSeedRepos,
    duplicate_seed_repos: input.duplicateSeedRepos,
    failures: input.source.stats.failures
  };
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function sortRepos(repos: RawRepo[]): RawRepo[] {
  return [...repos].sort((left, right) => left.full_name.localeCompare(right.full_name));
}

function sortManifests(manifests: RawManifest[]): RawManifest[] {
  return [...manifests].sort((left, right) => {
    const repoCompare = left.repo.localeCompare(right.repo);
    return repoCompare !== 0 ? repoCompare : left.path.localeCompare(right.path);
  });
}

function sortByRepoAndTime<T extends { repo: string }>(
  records: T[],
  timestampFor: (record: T) => string
): T[] {
  return [...records].sort((left, right) => {
    const repoCompare = left.repo.localeCompare(right.repo);
    if (repoCompare !== 0) {
      return repoCompare;
    }
    return timestampFor(right).localeCompare(timestampFor(left));
  });
}
