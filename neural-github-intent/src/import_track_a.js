#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readJsonl } from "./jsonl.js";
import { loadRecipe } from "./recipe.js";
import { buildTrackOneArtifacts, writeTrackOneArtifacts } from "./pipeline.js";

const args = parseArgs(process.argv.slice(2));

const rawDir = requiredArg(args["raw-dir"], "--raw-dir");
const recipePath = requiredArg(args.recipe, "--recipe");
const outDir = args.out ?? "data-track-a";
const recipe = await loadRecipe(recipePath);
const raw = await readTrackARaw(rawDir);
const report = await readHarvestReport(rawDir);
const now = new Date(args.now ?? report.finished_at ?? report.generated_at ?? Date.now());
const days = Number(args.days ?? report.days ?? recipe.days);
const artifacts = buildTrackOneArtifacts({ raw, recipe, now, days });

await writeTrackOneArtifacts(outDir, artifacts);

console.log(`Imported ${raw.repos.length} Track A repos into ${outDir}`);
console.log(
  [
    `events=${artifacts.rawEvents.length}`,
    `training_examples=${artifacts.trainingExamples.length}`,
    `scored_leads=${artifacts.scoredLeads.length}`
  ].join(" ")
);

async function readTrackARaw(rawDir) {
  const repos = await readJsonl(path.join(rawDir, "raw_repos.jsonl"));
  const pullRequests = await readJsonl(path.join(rawDir, "raw_pull_requests.jsonl"));
  const issues = await readJsonl(path.join(rawDir, "raw_issues.jsonl"));
  const comments = await readJsonl(path.join(rawDir, "raw_comments.jsonl"));
  const commits = await readJsonl(path.join(rawDir, "raw_commits.jsonl"));
  const users = await readJsonl(path.join(rawDir, "raw_users.jsonl"));

  return {
    repos: repos.map((repo) => ({
      full_name: repo.full_name,
      owner_login: repo.owner_login,
      owner_type: repo.owner_type,
      description: repo.description ?? null,
      topics: repo.topics ?? [],
      language: repo.primary_language ?? null,
      stars: repo.stars ?? 0,
      forks: repo.forks ?? 0,
      is_fork: Boolean(repo.is_fork),
      is_archived: Boolean(repo.is_archived),
      pushed_at: repo.pushed_at ?? null,
      html_url: repo.url,
      readme: repo.readme_text ?? null
    })),
    pull_requests: pullRequests.map((pullRequest) => ({
      repo: pullRequest.repo,
      number: pullRequest.number,
      author_login: pullRequest.author_login,
      title: pullRequest.title ?? "",
      body: pullRequest.body ?? null,
      state: pullRequest.state,
      created_at: pullRequest.created_at,
      updated_at: pullRequest.updated_at,
      merged_at: pullRequest.merged_at,
      changed_files: pullRequest.changed_files ?? [],
      html_url: pullRequest.url
    })),
    issues: issues.map((issue) => ({
      repo: issue.repo,
      number: issue.number,
      author_login: issue.author_login,
      title: issue.title ?? "",
      body: issue.body ?? null,
      state: issue.state,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      html_url: issue.url
    })),
    comments: comments.map((comment) => ({
      repo: comment.repo,
      issue_number: comment.parent_number,
      author_login: comment.author_login,
      body: comment.body ?? null,
      created_at: comment.created_at,
      updated_at: comment.created_at,
      html_url: comment.url
    })),
    commits: commits.map((commit) => ({
      repo: commit.repo,
      sha: commit.sha,
      author_login: commit.author_login,
      message: commit.message ?? "",
      committed_at: commit.committed_at,
      changed_files: commit.changed_files ?? [],
      html_url: commit.url
    })),
    users: users.map((user) => ({
      login: user.login,
      type: user.type,
      name: user.name ?? null,
      company: user.company ?? null,
      location: user.location ?? null,
      blog: user.blog ?? "",
      email: user.email ?? null,
      bio: user.bio ?? null,
      public_repos: user.public_repos ?? 0,
      followers: user.followers ?? 0,
      html_url: user.url
    }))
  };
}

async function readHarvestReport(rawDir) {
  try {
    return JSON.parse(await readFile(path.join(rawDir, "harvest_report.json"), "utf8"));
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? "true" : argv[++index];
    parsed[key] = value;
  }
  return parsed;
}

function requiredArg(value, name) {
  if (!value) {
    console.error(`Missing required argument ${name}`);
    process.exit(1);
  }
  return value;
}
