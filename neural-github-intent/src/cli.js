#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDotEnv } from "./env.js";
import { formatCliError } from "./errors.js";
import { harvestFromGitHub } from "./github.js";
import { readJsonl } from "./jsonl.js";
import { evaluateNeuralReranker, trainNeuralReranker } from "./neural_model.js";
import {
  buildEngineerProfiles,
  buildProfileEmbeddings,
  buildTrainingExamples,
  scoreEngineerProfiles,
  buildTrackOneArtifacts,
  writeTrackOneArtifacts
} from "./pipeline.js";
import { loadRecipe } from "./recipe.js";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

await loadDotEnv();

try {
  if (command === "run") {
    await run();
  } else if (command === "rescore") {
    await rescore();
  } else if (command === "validate") {
    await validate();
  } else if (command === "train-neural") {
    await trainNeural();
  } else {
    console.error("Usage: node src/cli.js <run|rescore|validate|train-neural> [options]");
    process.exit(1);
  }
} catch (error) {
  console.error(formatCliError(error));
  process.exit(1);
}

async function run() {
  const recipePath = requiredArg(args.recipe, "--recipe");
  const outDir = args.out ?? "data";
  const recipe = await loadRecipe(recipePath);
  const days = Number(args.days ?? recipe.days);
  const now = new Date(args.now ?? undefined);
  const raw = args.fixture
    ? JSON.parse(await readFile(args.fixture, "utf8"))
    : await harvestFromGitHub({
        recipe,
        days,
        limit: args.limit ? Number(args.limit) : undefined,
        maxUsers: args["max-users"] ? Number(args["max-users"]) : undefined,
        now: Number.isNaN(now.getTime()) ? new Date() : now
      });
  const effectiveNow = raw.now ? new Date(raw.now) : Number.isNaN(now.getTime()) ? new Date() : now;
  const artifacts = buildTrackOneArtifacts({ raw, recipe, now: effectiveNow, days });

  await writeTrackOneArtifacts(outDir, artifacts);
  console.log(`Wrote ${artifacts.scoredLeads.length} leads to ${path.join(outDir, "scored_leads.ndjson")}`);
}

async function rescore() {
  const recipePath = requiredArg(args.recipe, "--recipe");
  const dataDir = args.data ?? "data";
  const outDir = args.out ?? dataDir;
  const recipe = await loadRecipe(recipePath);
  const rawEvents = await readJsonl(path.join(dataDir, "raw_events.ndjson"));
  const repoProfiles = await readJsonl(path.join(dataDir, "repo_profiles.ndjson"));
  const previousProfiles = await readJsonl(path.join(dataDir, "engineer_profiles.ndjson"));
  const repoProfileByName = new Map(repoProfiles.map((profile) => [profile.repo, profile]));
  const userByLogin = new Map(previousProfiles.map((profile) => [profile.engineer_login, userFromProfile(profile)]));
  const now = new Date(args.now ?? (await defaultValidationNow(path.join(dataDir, "scored_leads.ndjson"))));
  const days = Number(args.days ?? recipe.days);
  const engineerProfiles = buildEngineerProfiles({
    events: rawEvents,
    repoProfileByName,
    userByLogin,
    recipe
  });
  const profileEmbeddings = buildProfileEmbeddings(engineerProfiles, recipe);
  const trainingExamples = buildTrainingExamples({
    events: rawEvents,
    repoProfileByName,
    recipe
  });
  const scoredLeads = scoreEngineerProfiles({
    profiles: engineerProfiles,
    repoProfileByName,
    recipe,
    now
  });

  await writeTrackOneArtifacts(outDir, {
    rawEvents,
    repoProfiles,
    engineerProfiles,
    profileEmbeddings,
    trainingExamples,
    scoredLeads,
    report: {
      generated_at: now.toISOString(),
      days,
      raw_event_count: rawEvents.length,
      repo_profile_count: repoProfiles.length,
      engineer_profile_count: engineerProfiles.length,
      profile_embedding_count: profileEmbeddings.length,
      training_example_count: trainingExamples.length,
      scored_lead_count: scoredLeads.length,
      rescored_from_existing_events: true
    }
  });
  console.log(`Rescored ${scoredLeads.length} leads from ${rawEvents.length} existing events`);
}

async function validate() {
  const leadsPath = requiredArg(args.leads, "--leads");
  const days = Number(args.days ?? 90);
  const now = new Date(args.now ?? (await defaultValidationNow(leadsPath)));
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const leads = await readJsonl(leadsPath);
  const failures = [];

  for (const [index, lead] of leads.entries()) {
    if (!lead.engineer_login) failures.push(`row ${index + 1}: missing engineer_login`);
    if (!Number.isFinite(lead.score)) failures.push(`row ${index + 1}: missing numeric score`);
    if (!lead.why_relevant) failures.push(`row ${index + 1}: missing why_relevant`);
    if (!lead.outreach_angle) failures.push(`row ${index + 1}: missing outreach_angle`);
    if (!Array.isArray(lead.evidence_links) || lead.evidence_links.length === 0) {
      failures.push(`row ${index + 1}: missing evidence links`);
    } else if (!lead.evidence_links.every((url) => String(url).startsWith("https://github.com/"))) {
      failures.push(`row ${index + 1}: non-GitHub evidence link`);
    }
    if (!lead.last_active_at || new Date(lead.last_active_at) < since) {
      failures.push(`row ${index + 1}: last_active_at is outside ${days} day window`);
    }
  }

  if (leads.length === 0) failures.push("no leads found");

  if (failures.length > 0) {
    console.error(`Validation failed:\n${failures.join("\n")}`);
    process.exit(1);
  }

  console.log(`Validation passed for ${leads.length} leads`);
}

async function trainNeural() {
  const examplesPath = args.examples ?? "data/training_examples.ndjson";
  const modelOut = args["model-out"] ?? "model-experiments/neural_reranker.json";
  const evalOut = args["eval-out"] ?? "evals/neural_reranker_eval.json";
  const examples = await readJsonl(examplesPath);
  const model = trainNeuralReranker(examples, {
    epochs: args.epochs ? Number(args.epochs) : undefined,
    hiddenSize: args["hidden-size"] ? Number(args["hidden-size"]) : undefined,
    learningRate: args["learning-rate"] ? Number(args["learning-rate"]) : undefined,
    maxFeatures: args["max-features"] ? Number(args["max-features"]) : undefined,
    seed: args.seed ? Number(args.seed) : undefined
  });
  const report = evaluateNeuralReranker(model, examples);

  await mkdir(path.dirname(modelOut), { recursive: true });
  await mkdir(path.dirname(evalOut), { recursive: true });
  await writeFile(modelOut, `${JSON.stringify(model, null, 2)}\n`, "utf8");
  await writeFile(evalOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `Trained neural reranker on ${report.example_count} examples; accuracy=${report.training_accuracy}; wrote ${modelOut}`
  );
}

async function defaultValidationNow(leadsPath) {
  const reportPath = path.join(path.dirname(leadsPath), "harvest_report.json");
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    if (report.generated_at) return report.generated_at;
  } catch {
    // Fall back to wall-clock validation for externally supplied lead files.
  }
  return new Date().toISOString();
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

function userFromProfile(profile) {
  return {
    login: profile.engineer_login,
    type: profile.type ?? "Unknown",
    name: profile.name ?? null,
    company: profile.company ?? null,
    location: profile.location ?? null,
    blog: profile.blog ?? "",
    email: profile.email ?? null,
    bio: profile.bio ?? null,
    html_url: profile.html_url ?? `https://github.com/${profile.engineer_login}`
  };
}
