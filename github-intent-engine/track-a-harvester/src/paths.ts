import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(moduleDir, "../..");
export const rawDataDir = resolve(projectRoot, "data/raw");
export const seedReposPath = resolve(projectRoot, "seed_repos.txt");

export const rawPaths = {
  repos: resolve(rawDataDir, "raw_repos.jsonl"),
  pullRequests: resolve(rawDataDir, "raw_pull_requests.jsonl"),
  issues: resolve(rawDataDir, "raw_issues.jsonl"),
  comments: resolve(rawDataDir, "raw_comments.jsonl"),
  commits: resolve(rawDataDir, "raw_commits.jsonl"),
  users: resolve(rawDataDir, "raw_users.jsonl"),
  report: resolve(rawDataDir, "harvest_report.json")
} as const;
