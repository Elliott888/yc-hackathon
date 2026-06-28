export type InvalidSeedRepo = {
  line: number;
  value: string;
  reason: string;
};

export type ParsedSeedRepos = {
  repos: string[];
  invalid: InvalidSeedRepo[];
  duplicates: string[];
};

export type HarvestFailure = {
  scope: string;
  resource: string;
  message: string;
  status?: number;
};

export type HarvestReport = {
  started_at: string;
  finished_at: string | null;
  days: number;
  seed_repo_count: number;
  expanded_repo_count: number;
  fetched_repo_count: number;
  raw_pull_request_count: number;
  raw_issue_count: number;
  raw_comment_count: number;
  raw_commit_count: number;
  raw_manifest_count: number;
  raw_pull_request_review_count: number;
  raw_pull_request_review_comment_count: number;
  raw_workflow_run_count: number;
  raw_contributor_stat_count: number;
  raw_user_count: number;
  skipped_repo_count: number;
  failed_request_count: number;
  request_count: number;
  rate_limit_remaining: number | null;
  rate_limit_reset_at: string | null;
  invalid_seed_repos: InvalidSeedRepo[];
  duplicate_seed_repos: string[];
  failures: HarvestFailure[];
};

export type RawRepo = {
  id: number;
  full_name: string;
  owner_login: string;
  owner_type: string;
  description: string | null;
  topics: string[];
  stars: number;
  forks: number;
  primary_language: string | null;
  default_branch: string;
  is_fork: boolean;
  is_archived: boolean;
  pushed_at: string | null;
  readme_text: string | null;
  url: string;
};

export type RawPullRequest = {
  id: number;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  author_login: string | null;
  state: string;
  merged: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  changed_files: string[];
  url: string;
};

export type RawIssue = {
  id: number;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  author_login: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  url: string;
};

export type RawComment = {
  id: number;
  repo: string;
  parent_type: "issue";
  parent_number: number;
  body: string | null;
  author_login: string | null;
  created_at: string;
  url: string;
};

export type RawCommit = {
  sha: string;
  repo: string;
  author_login: string | null;
  message: string;
  committed_at: string;
  changed_files: string[];
  url: string;
};

export type RawUser = {
  id: number;
  login: string;
  type: string;
  name: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  email: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  created_at: string;
  url: string;
};

export type RawManifest = {
  repo: string;
  path: string;
  kind: string;
  package_names: string[];
  scripts: string[];
  ci_keywords: string[];
  content_excerpt: string;
  url: string;
};

export type RawPullRequestReview = {
  id: number;
  repo: string;
  pull_number: number;
  author_login: string | null;
  state: string;
  body: string | null;
  submitted_at: string;
  url: string;
};

export type RawPullRequestReviewComment = {
  id: number;
  repo: string;
  pull_number: number;
  author_login: string | null;
  body: string | null;
  path: string | null;
  created_at: string;
  url: string;
};

export type RawWorkflowRun = {
  id: number;
  repo: string;
  name: string | null;
  event: string;
  status: string | null;
  conclusion: string | null;
  actor_login: string | null;
  created_at: string;
  updated_at: string;
  url: string;
};

export type RawContributorStat = {
  login: string;
  repo: string;
  pull_request_count: number;
  merged_pull_request_count: number;
  commit_count: number;
  issue_count: number;
  comment_count: number;
  review_count: number;
  review_comment_count: number;
  failed_workflow_count: number;
  repos_touched: string[];
  last_active_at: string;
};

export type RawRepoExpansion = {
  source_repo: string;
  expanded_repo: string;
  reason: string;
  evidence: string;
};

export type HarvestData = {
  repos: RawRepo[];
  pullRequests: RawPullRequest[];
  issues: RawIssue[];
  comments: RawComment[];
  commits: RawCommit[];
  manifests: RawManifest[];
  pullRequestReviews: RawPullRequestReview[];
  pullRequestReviewComments: RawPullRequestReviewComment[];
  workflowRuns: RawWorkflowRun[];
  contributorStats: RawContributorStat[];
  repoExpansions: RawRepoExpansion[];
  users: RawUser[];
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};
