import type {
  HarvestFailure,
  RawCommit,
  RawComment,
  RawContributorStat,
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

export type GitHubSourceStats = {
  requestCount: number;
  failedRequestCount: number;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  failures: HarvestFailure[];
};

export type GitHubDataSource = {
  stats: GitHubSourceStats;
  fetchRepo(fullName: string): Promise<RawRepo | null>;
  fetchPullRequests(fullName: string, since: Date): Promise<RawPullRequest[]>;
  fetchIssues(fullName: string, since: Date): Promise<RawIssue[]>;
  fetchIssueComments(fullName: string, since: Date): Promise<RawComment[]>;
  fetchCommits(fullName: string, since: Date): Promise<RawCommit[]>;
  fetchUser(login: string): Promise<RawUser | null>;
  expandRepo?(fullName: string): Promise<RawRepoExpansion[]>;
  fetchManifests?(repo: RawRepo): Promise<RawManifest[]>;
  fetchPullRequestReviews?(fullName: string, pullRequests: RawPullRequest[], since: Date): Promise<RawPullRequestReview[]>;
  fetchPullRequestReviewComments?(fullName: string, pullRequests: RawPullRequest[], since: Date): Promise<RawPullRequestReviewComment[]>;
  fetchWorkflowRuns?(fullName: string, since: Date): Promise<RawWorkflowRun[]>;
};
