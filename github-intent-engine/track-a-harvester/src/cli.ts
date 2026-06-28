import { Command } from "commander";
import { rawDataDir, seedReposPath } from "./paths.js";

export type HarvestCliOptions = {
  days: number;
  limit: number | undefined;
  seedFile: string;
  rawDir: string;
  maxPagesPerList: number;
  maxItemsPerList: number;
  maxChangedFiles: number;
  readmeLimit: number;
  requestTimeoutMs: number;
  expandRepos: boolean;
  maxExpandedRepos: number;
  skipReadmes: boolean;
  skipPullRequests: boolean;
  skipIssues: boolean;
  skipComments: boolean;
  skipCommits: boolean;
  skipFileDiffs: boolean;
  skipManifests: boolean;
  skipReviews: boolean;
  skipWorkflows: boolean;
  maxManifestFiles: number;
  maxUsers: number | undefined;
  repoDelayMs: number;
  checkpointDir: string | undefined;
};

export function parseHarvestArgs(argv: string[]): HarvestCliOptions {
  const program = new Command()
    .name("harvest")
    .option("--days <number>", "activity window in days", parsePositiveInteger, 90)
    .option("--limit <number>", "limit seed repos after dedupe", parsePositiveInteger)
    .option("--seed-file <path>", "seed repo file path", seedReposPath)
    .option("--raw-dir <path>", "raw output directory", rawDataDir)
    .option("--max-pages-per-list <number>", "page cap for list endpoints", parsePositiveInteger, 3)
    .option("--max-items-per-list <number>", "record cap per repo for list endpoints", parsePositiveInteger, 50)
    .option("--max-changed-files <number>", "changed-file cap per PR/commit", parsePositiveInteger, 100)
    .option("--readme-limit <number>", "README character cap", parsePositiveInteger, 20_000)
    .option("--request-timeout-ms <number>", "GitHub request timeout in milliseconds", parsePositiveInteger, 15_000)
    .option("--expand-repos", "expand seed repos through sibling repos, topics, contributors, and forks", false)
    .option("--max-expanded-repos <number>", "maximum additional repos to harvest", parseNonNegativeInteger, 0)
    .option("--skip-readmes", "skip README fetches during repo metadata harvest", false)
    .option("--skip-pull-requests", "skip pull request list harvest", false)
    .option("--skip-issues", "skip issue list harvest", false)
    .option("--skip-comments", "skip issue comment harvest", false)
    .option("--skip-commits", "skip commit list harvest", false)
    .option("--skip-file-diffs", "skip per-PR and per-commit changed-file lookups", false)
    .option("--skip-manifests", "skip dependency manifest harvest", false)
    .option("--skip-reviews", "skip pull request review and review comment harvest", false)
    .option("--skip-workflows", "skip workflow run harvest", false)
    .option("--max-manifest-files <number>", "manifest file cap per repo; use 0 to disable", parseNonNegativeInteger, 25)
    .option("--max-users <number>", "maximum GitHub user profiles to fetch; use 0 to disable", parseNonNegativeInteger)
    .option("--repo-delay-ms <number>", "delay after each live repo fetch, useful for secondary rate limits", parseNonNegativeInteger, 0)
    .option("--checkpoint-dir <path>", "directory for per-repo checkpoint/resume files")
    .exitOverride();

  program.parse(argv, { from: "node" });
  const options = program.opts<HarvestCliOptions>();
  return {
    days: options.days,
    limit: options.limit,
    seedFile: options.seedFile,
    rawDir: options.rawDir,
    maxPagesPerList: options.maxPagesPerList,
    maxItemsPerList: options.maxItemsPerList,
    maxChangedFiles: options.maxChangedFiles,
    readmeLimit: options.readmeLimit,
    requestTimeoutMs: options.requestTimeoutMs,
    expandRepos: options.expandRepos,
    maxExpandedRepos: options.maxExpandedRepos,
    skipReadmes: options.skipReadmes,
    skipPullRequests: options.skipPullRequests,
    skipIssues: options.skipIssues,
    skipComments: options.skipComments,
    skipCommits: options.skipCommits,
    skipFileDiffs: options.skipFileDiffs,
    skipManifests: options.skipManifests,
    skipReviews: options.skipReviews,
    skipWorkflows: options.skipWorkflows,
    maxManifestFiles: options.maxManifestFiles,
    maxUsers: options.maxUsers,
    repoDelayMs: options.repoDelayMs,
    checkpointDir: options.checkpointDir
  };
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected non-negative integer, got: ${value}`);
  }
  return parsed;
}
