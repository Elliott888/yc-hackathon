import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeJsonl } from "./jsonl.js";
import type { HarvestResult } from "./harvest.js";

export async function writeRawHarvest(outputDir: string, result: HarvestResult): Promise<void> {
  await mkdir(dirname(outputDir), { recursive: true });
  const tmpDir = `${outputDir}.tmp-${process.pid}-${Date.now()}`;

  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  await writeJsonl(join(tmpDir, "raw_repos.jsonl"), result.data.repos);
  await writeJsonl(join(tmpDir, "raw_pull_requests.jsonl"), result.data.pullRequests);
  await writeJsonl(join(tmpDir, "raw_issues.jsonl"), result.data.issues);
  await writeJsonl(join(tmpDir, "raw_comments.jsonl"), result.data.comments);
  await writeJsonl(join(tmpDir, "raw_commits.jsonl"), result.data.commits);
  await writeJsonl(join(tmpDir, "raw_manifests.jsonl"), result.data.manifests);
  await writeJsonl(join(tmpDir, "raw_pull_request_reviews.jsonl"), result.data.pullRequestReviews);
  await writeJsonl(join(tmpDir, "raw_pull_request_review_comments.jsonl"), result.data.pullRequestReviewComments);
  await writeJsonl(join(tmpDir, "raw_workflow_runs.jsonl"), result.data.workflowRuns);
  await writeJsonl(join(tmpDir, "raw_contributor_stats.jsonl"), result.data.contributorStats);
  await writeJsonl(join(tmpDir, "raw_repo_expansions.jsonl"), result.data.repoExpansions);
  await writeJsonl(join(tmpDir, "raw_users.jsonl"), result.data.users);
  await writeFile(join(tmpDir, "harvest_report.json"), `${JSON.stringify(result.report, null, 2)}\n`);

  await rm(outputDir, { recursive: true, force: true });
  await rename(tmpDir, outputDir);
}
