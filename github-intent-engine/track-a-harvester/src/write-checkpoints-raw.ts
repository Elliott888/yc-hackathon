import { Command } from "commander";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildContributorStats } from "./contributor-stats.js";
import { dedupeBy } from "./dedupe.js";
import type { RepoHarvestData } from "./harvest.js";
import { rawDataDir } from "./paths.js";
import type { HarvestData, HarvestReport, RawUser } from "./types.js";
import { writeRawHarvest } from "./writer.js";
import { readJsonl } from "./jsonl.js";

type Options = {
  checkpointDir: string;
  rawDir: string;
  usersFile?: string;
};

const program = new Command()
  .name("write-checkpoints-raw")
  .requiredOption("--checkpoint-dir <path>", "directory containing per-repo checkpoint JSON files")
  .option("--raw-dir <path>", "raw output directory", rawDataDir)
  .option("--users-file <path>", "optional existing raw_users.jsonl to preserve profile enrichment");

program.parse(process.argv);

const options = program.opts<Options>();
const checkpoints = await readCheckpoints(options.checkpointDir);
const users = options.usersFile ? await readJsonl<RawUser>(options.usersFile) : [];
const data = buildHarvestData(checkpoints, users);
const report = buildCheckpointReport(data, options.checkpointDir);

await writeRawHarvest(options.rawDir, { data, report });

console.log(`Wrote ${data.repos.length} checkpoint repos to ${options.rawDir}`);
console.log(
  [
    `PRs=${data.pullRequests.length}`,
    `issues=${data.issues.length}`,
    `comments=${data.comments.length}`,
    `commits=${data.commits.length}`,
    `users=${data.users.length}`
  ].join(" ")
);

async function readCheckpoints(checkpointDir: string): Promise<RepoHarvestData[]> {
  const files = (await readdir(checkpointDir))
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  const checkpoints: RepoHarvestData[] = [];
  for (const file of files) {
    const content = await readFile(join(checkpointDir, file), "utf8");
    checkpoints.push(JSON.parse(content) as RepoHarvestData);
  }
  return checkpoints;
}

function buildHarvestData(checkpoints: RepoHarvestData[], users: RawUser[]): HarvestData {
  const repos = checkpoints.map((checkpoint) => checkpoint.repo);
  const pullRequests = checkpoints.flatMap((checkpoint) => checkpoint.pullRequests);
  const issues = checkpoints.flatMap((checkpoint) => checkpoint.issues);
  const comments = checkpoints.flatMap((checkpoint) => checkpoint.comments);
  const commits = checkpoints.flatMap((checkpoint) => checkpoint.commits);
  const manifests = checkpoints.flatMap((checkpoint) => checkpoint.manifests);
  const pullRequestReviews = checkpoints.flatMap((checkpoint) => checkpoint.pullRequestReviews);
  const pullRequestReviewComments = checkpoints.flatMap((checkpoint) => checkpoint.pullRequestReviewComments);
  const workflowRuns = checkpoints.flatMap((checkpoint) => checkpoint.workflowRuns);

  const dedupedPullRequests = dedupeBy(pullRequests, (pullRequest) => `${pullRequest.repo}:${pullRequest.number}`).records;
  const dedupedIssues = dedupeBy(issues, (issue) => `${issue.repo}:${issue.number}`).records;
  const dedupedComments = dedupeBy(comments, (comment) => String(comment.id)).records;
  const dedupedCommits = dedupeBy(commits, (commit) => `${commit.repo}:${commit.sha}`).records;
  const dedupedPullRequestReviews = dedupeBy(pullRequestReviews, (review) => String(review.id)).records;
  const dedupedPullRequestReviewComments = dedupeBy(pullRequestReviewComments, (comment) => String(comment.id)).records;
  const dedupedWorkflowRuns = dedupeBy(workflowRuns, (run) => String(run.id)).records;

  return {
    repos: dedupeBy(repos, (repo) => String(repo.id)).records.sort((left, right) =>
      left.full_name.localeCompare(right.full_name)
    ),
    pullRequests: dedupedPullRequests.sort(byRepoThenNewest((record) => record.updated_at)),
    issues: dedupedIssues.sort(byRepoThenNewest((record) => record.updated_at)),
    comments: dedupedComments.sort(byRepoThenNewest((record) => record.created_at)),
    commits: dedupedCommits.sort(byRepoThenNewest((record) => record.committed_at)),
    manifests: dedupeBy(manifests, (manifest) => `${manifest.repo}:${manifest.path}`).records.sort((left, right) => {
      const repoCompare = left.repo.localeCompare(right.repo);
      return repoCompare !== 0 ? repoCompare : left.path.localeCompare(right.path);
    }),
    pullRequestReviews: dedupedPullRequestReviews.sort(byRepoThenNewest((record) => record.submitted_at)),
    pullRequestReviewComments: dedupedPullRequestReviewComments.sort(byRepoThenNewest((record) => record.created_at)),
    workflowRuns: dedupedWorkflowRuns.sort(byRepoThenNewest((record) => record.updated_at)),
    contributorStats: buildContributorStats({
      pullRequests: dedupedPullRequests,
      issues: dedupedIssues,
      comments: dedupedComments,
      commits: dedupedCommits,
      pullRequestReviews: dedupedPullRequestReviews,
      pullRequestReviewComments: dedupedPullRequestReviewComments,
      workflowRuns: dedupedWorkflowRuns
    }).sort((left, right) => {
      const repoCompare = left.repo.localeCompare(right.repo);
      return repoCompare !== 0 ? repoCompare : left.login.localeCompare(right.login);
    }),
    repoExpansions: [],
    users: dedupeBy(users, (user) => user.login).records.sort((left, right) =>
      left.login.localeCompare(right.login)
    )
  };
}

function buildCheckpointReport(data: HarvestData, checkpointDir: string): HarvestReport {
  const now = new Date().toISOString();
  return {
    started_at: now,
    finished_at: now,
    days: 90,
    seed_repo_count: data.repos.length,
    expanded_repo_count: 0,
    fetched_repo_count: data.repos.length,
    raw_pull_request_count: data.pullRequests.length,
    raw_issue_count: data.issues.length,
    raw_comment_count: data.comments.length,
    raw_commit_count: data.commits.length,
    raw_manifest_count: data.manifests.length,
    raw_pull_request_review_count: data.pullRequestReviews.length,
    raw_pull_request_review_comment_count: data.pullRequestReviewComments.length,
    raw_workflow_run_count: data.workflowRuns.length,
    raw_contributor_stat_count: data.contributorStats.length,
    raw_user_count: data.users.length,
    skipped_repo_count: 0,
    failed_request_count: 0,
    request_count: 0,
    rate_limit_remaining: null,
    rate_limit_reset_at: null,
    invalid_seed_repos: [],
    duplicate_seed_repos: [],
    failures: [
      {
        scope: "checkpoint_stitch",
        resource: checkpointDir,
        message: "Raw dataset was reconstructed from completed per-repo checkpoints."
      }
    ]
  };
}

function byRepoThenNewest<T extends { repo: string }>(timestampFor: (record: T) => string) {
  return (left: T, right: T) => {
    const repoCompare = left.repo.localeCompare(right.repo);
    if (repoCompare !== 0) {
      return repoCompare;
    }
    return timestampFor(right).localeCompare(timestampFor(left));
  };
}
