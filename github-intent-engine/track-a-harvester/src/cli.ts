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
