import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawTrackBData } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const defaultProjectRoot = resolve(moduleDir, "../..");

export function pathsFor(rootDir = defaultProjectRoot) {
  return {
    root: rootDir,
    recipe: join(rootDir, "contracts", "convex_recipe.yaml"),
    raw: {
      repos: join(rootDir, "data", "raw", "raw_repos.jsonl"),
      pullRequests: join(rootDir, "data", "raw", "raw_pull_requests.jsonl"),
      issues: join(rootDir, "data", "raw", "raw_issues.jsonl"),
      comments: join(rootDir, "data", "raw", "raw_comments.jsonl"),
      commits: join(rootDir, "data", "raw", "raw_commits.jsonl"),
      manifests: join(rootDir, "data", "raw", "raw_manifests.jsonl"),
      pullRequestReviews: join(rootDir, "data", "raw", "raw_pull_request_reviews.jsonl"),
      pullRequestReviewComments: join(rootDir, "data", "raw", "raw_pull_request_review_comments.jsonl"),
      workflowRuns: join(rootDir, "data", "raw", "raw_workflow_runs.jsonl"),
      contributorStats: join(rootDir, "data", "raw", "raw_contributor_stats.jsonl"),
      repoExpansions: join(rootDir, "data", "raw", "raw_repo_expansions.jsonl"),
      users: join(rootDir, "data", "raw", "raw_users.jsonl")
    },
    processed: {
      repoCategories: join(rootDir, "data", "processed", "repo_categories.jsonl"),
      contributionTopics: join(rootDir, "data", "processed", "contribution_topics.jsonl"),
      engineerProfiles: join(rootDir, "data", "processed", "engineer_profiles.jsonl"),
      engineerEmbeddings: join(rootDir, "data", "processed", "engineer_embeddings.jsonl"),
      rankedLeads: join(rootDir, "data", "processed", "ranked_leads.jsonl")
    },
    eval: {
      goldenLabels: join(rootDir, "data", "eval", "golden_labels.jsonl"),
      report: join(rootDir, "data", "eval", "evaluation_report.json")
    }
  } as const;
}

export async function readJsonl<T>(path: string, missingOk = false): Promise<T[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (missingOk && isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  if (!content.trim()) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonl<T>(path: string, records: T[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body.length > 0 ? `${body}\n` : "");
}

export async function writeJson(path: string, record: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
}

export async function readRawTrackBData(rootDir?: string): Promise<RawTrackBData> {
  const paths = pathsFor(rootDir);
  return {
    repos: await readJsonl(paths.raw.repos, true),
    pullRequests: await readJsonl(paths.raw.pullRequests, true),
    issues: await readJsonl(paths.raw.issues, true),
    comments: await readJsonl(paths.raw.comments, true),
    commits: await readJsonl(paths.raw.commits, true),
    manifests: await readJsonl(paths.raw.manifests, true),
    pullRequestReviews: await readJsonl(paths.raw.pullRequestReviews, true),
    pullRequestReviewComments: await readJsonl(paths.raw.pullRequestReviewComments, true),
    workflowRuns: await readJsonl(paths.raw.workflowRuns, true),
    contributorStats: await readJsonl(paths.raw.contributorStats, true),
    repoExpansions: await readJsonl(paths.raw.repoExpansions, true),
    users: await readJsonl(paths.raw.users, true)
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
