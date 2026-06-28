import type {
  RawCommit,
  RawComment,
  RawContributorStat,
  RawIssue,
  RawPullRequest,
  RawPullRequestReview,
  RawPullRequestReviewComment,
  RawWorkflowRun
} from "./types.js";

export type ContributorStatsInput = {
  pullRequests: RawPullRequest[];
  issues: RawIssue[];
  comments: RawComment[];
  commits: RawCommit[];
  pullRequestReviews: RawPullRequestReview[];
  pullRequestReviewComments: RawPullRequestReviewComment[];
  workflowRuns: RawWorkflowRun[];
};

type MutableStat = RawContributorStat & {
  reposSet: Set<string>;
};

export function buildContributorStats(input: ContributorStatsInput): RawContributorStat[] {
  const stats = new Map<string, MutableStat>();

  for (const pr of input.pullRequests) {
    mutate(stats, pr.author_login, pr.repo, pr.merged_at ?? pr.updated_at, (stat) => {
      stat.pull_request_count += 1;
      if (pr.merged) stat.merged_pull_request_count += 1;
    });
  }
  for (const issue of input.issues) {
    mutate(stats, issue.author_login, issue.repo, issue.updated_at, (stat) => {
      stat.issue_count += 1;
    });
  }
  for (const comment of input.comments) {
    mutate(stats, comment.author_login, comment.repo, comment.created_at, (stat) => {
      stat.comment_count += 1;
    });
  }
  for (const commit of input.commits) {
    mutate(stats, commit.author_login, commit.repo, commit.committed_at, (stat) => {
      stat.commit_count += 1;
    });
  }
  for (const review of input.pullRequestReviews) {
    mutate(stats, review.author_login, review.repo, review.submitted_at, (stat) => {
      stat.review_count += 1;
    });
  }
  for (const comment of input.pullRequestReviewComments) {
    mutate(stats, comment.author_login, comment.repo, comment.created_at, (stat) => {
      stat.review_comment_count += 1;
    });
  }
  for (const run of input.workflowRuns) {
    if (run.conclusion !== "failure" && run.conclusion !== "timed_out" && run.conclusion !== "cancelled") {
      continue;
    }
    mutate(stats, run.actor_login, run.repo, run.updated_at, (stat) => {
      stat.failed_workflow_count += 1;
    });
  }

  return [...stats.values()]
    .map(({ reposSet: _reposSet, ...stat }) => ({
      ...stat,
      repos_touched: [..._reposSet].sort()
    }))
    .sort((left, right) => {
      const loginCompare = left.login.localeCompare(right.login);
      return loginCompare !== 0 ? loginCompare : left.repo.localeCompare(right.repo);
    });
}

function mutate(
  stats: Map<string, MutableStat>,
  login: string | null,
  repo: string,
  timestamp: string,
  update: (stat: MutableStat) => void
): void {
  if (!login) return;
  const key = `${login}:${repo}`;
  const stat = stats.get(key) ?? emptyStat(login, repo);
  update(stat);
  stat.reposSet.add(repo);
  if (timestamp > stat.last_active_at) {
    stat.last_active_at = timestamp;
  }
  stats.set(key, stat);
}

function emptyStat(login: string, repo: string): MutableStat {
  return {
    login,
    repo,
    pull_request_count: 0,
    merged_pull_request_count: 0,
    commit_count: 0,
    issue_count: 0,
    comment_count: 0,
    review_count: 0,
    review_comment_count: 0,
    failed_workflow_count: 0,
    repos_touched: [],
    reposSet: new Set<string>(),
    last_active_at: ""
  };
}
