import { readFile } from "node:fs/promises";
import { FileCheckpointStore } from "./checkpoint.js";
import { parseHarvestArgs } from "./cli.js";
import { GitHubClient } from "./github.js";
import { harvestData } from "./harvest.js";
import { parseSeedRepos } from "./seed.js";
import type { RawRepoExpansion } from "./types.js";
import { writeRawHarvest } from "./writer.js";

try {
  const options = parseHarvestArgs(process.argv);
  const seedContent = await readFile(options.seedFile, "utf8");
  const parsedSeeds = parseSeedRepos(seedContent, options.limit);
  const since = new Date(Date.now() - options.days * 86_400_000);

  if (!process.env.GITHUB_TOKEN) {
    console.warn("warning: GITHUB_TOKEN is not set; unauthenticated GitHub API limits are much lower.");
  }

  const source = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
    maxPagesPerList: options.maxPagesPerList,
    maxItemsPerList: options.maxItemsPerList,
    maxChangedFiles: options.maxChangedFiles,
    readmeLimit: options.readmeLimit,
    includeReadmes: !options.skipReadmes,
    includeFileDiffs: !options.skipFileDiffs,
    maxManifestFiles: options.skipManifests ? 0 : options.maxManifestFiles,
    requestTimeoutMs: options.requestTimeoutMs
  });

  const repoExpansions = options.expandRepos
    ? await expandSeedRepos(source, parsedSeeds.repos, options.maxExpandedRepos)
    : [];
  const expandedRepos = repoExpansions.map((expansion) => expansion.expanded_repo);
  const reposToHarvest = dedupeStrings([...parsedSeeds.repos, ...expandedRepos]);

  const result = await harvestData({
    source,
    repos: reposToHarvest,
    since,
    days: options.days,
    invalidSeedRepos: parsedSeeds.invalid,
    duplicateSeedRepos: parsedSeeds.duplicates,
    repoExpansions,
    include: {
      pullRequests: !options.skipPullRequests,
      issues: !options.skipIssues,
      comments: !options.skipComments,
      commits: !options.skipCommits,
      manifests: !options.skipManifests,
      reviews: !options.skipReviews,
      workflows: !options.skipWorkflows
    },
    maxUsers: options.maxUsers,
    repoDelayMs: options.repoDelayMs,
    checkpointStore: options.checkpointDir ? new FileCheckpointStore(options.checkpointDir) : undefined
  });

  await writeRawHarvest(options.rawDir, result);

  console.log(`Harvest complete: ${result.report.fetched_repo_count}/${result.report.seed_repo_count} repos`);
  console.log(
    [
      `PRs=${result.report.raw_pull_request_count}`,
      `issues=${result.report.raw_issue_count}`,
      `comments=${result.report.raw_comment_count}`,
      `commits=${result.report.raw_commit_count}`,
      `users=${result.report.raw_user_count}`,
      `requests=${result.report.request_count}`,
      `failures=${result.report.failed_request_count}`
    ].join(" ")
  );
  console.log(`Wrote raw data to ${options.rawDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function expandSeedRepos(
  source: GitHubClient,
  repos: string[],
  maxExpandedRepos: number
): Promise<RawRepoExpansion[]> {
  if (maxExpandedRepos <= 0) {
    return [];
  }
  const expansions: RawRepoExpansion[] = [];
  const seen = new Set(repos);
  for (const repo of repos) {
    const repoExpansions = await source.expandRepo(repo);
    for (const expansion of repoExpansions) {
      if (seen.has(expansion.expanded_repo)) {
        continue;
      }
      seen.add(expansion.expanded_repo);
      expansions.push(expansion);
      if (expansions.length >= maxExpandedRepos) {
        return expansions;
      }
    }
  }
  return expansions;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
