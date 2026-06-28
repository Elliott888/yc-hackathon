import { dirname, resolve } from "node:path";
import { detectCodeSignals, mergeCodeSignals } from "./code-signals.js";
import { embeddingDimensions, embedText } from "./embedding.js";
import { defaultProjectRoot, pathsFor, readJsonl, writeJsonl } from "./io.js";
import { loadNeuralIntentModel, predictNeuralIntent, type NeuralIntentModel } from "./neural.js";
import { painPointEvidenceFromContexts } from "./pain-point-evidence.js";
import { readRecipe } from "./recipe.js";
import { includesTerm, sortTopics, unique } from "./text.js";
import type {
  BuildIntelligenceResult,
  AnswerContext,
  ContributionTopicRecord,
  EngineerEmbedding,
  EngineerProfile,
  EvidenceRecord,
  RankedLead,
  Recipe,
  RepoCategoryRecord,
  ScoreBreakdown
} from "./types.js";

export type ImportTrackOneOptions = {
  rootDir?: string;
  sourcePath?: string;
  modelPath?: string;
};

type TrackOneActivity = {
  type: string;
  repo: string;
  title: string;
  snippet?: string;
  text?: string;
  occurred_at: string;
  url: string;
  matched_terms?: string[];
  pain_score?: number;
  buyer_intent_label?: string;
  pain_signals?: string[];
};

type TrackOneLead = {
  engineer_login: string;
  name: string | null;
  company?: string | null;
  github_url?: string | null;
  repo: string;
  repo_category: string[];
  score: number;
  why_relevant: string;
  matched_topics: string[];
  recent_activity: TrackOneActivity[];
  last_active_at: string;
  evidence_links: string[];
  answer_context?: AnswerContext;
  outreach_angle: string;
};

export async function importTrackOneLeads(
  options: ImportTrackOneOptions = {}
): Promise<BuildIntelligenceResult> {
  const rootDir = options.rootDir;
  const paths = pathsFor(rootDir);
  const recipe = await readRecipe(rootDir);
  const sourcePath =
    options.sourcePath ?? resolve(defaultProjectRoot, "..", "neural-github-intent", "data", "scored_leads.ndjson");
  const sourceLeads = await readJsonl<TrackOneLead>(sourcePath);
  const modelPath = options.modelPath ?? defaultNeuralModelPath(sourcePath);
  const neuralModel = await loadNeuralIntentModel(modelPath, { optional: !options.modelPath });

  const rankedLeads = sourceLeads
    .filter((lead) => !isAutomationIdentity(lead.engineer_login))
    .map((lead) => toRankedLead(lead, recipe, neuralModel));
  const profiles = rankedLeads.map((lead) => toEngineerProfile(lead));
  const embeddings = rankedLeads.map((lead) => toEmbedding(lead, recipe));
  const contributionTopics = rankedLeads.flatMap((lead) => toContributionTopics(lead));
  const repoCategories = toRepoCategories(rankedLeads);

  await writeJsonl(paths.processed.repoCategories, repoCategories);
  await writeJsonl(paths.processed.contributionTopics, contributionTopics);
  await writeJsonl(paths.processed.engineerProfiles, profiles);
  await writeJsonl(paths.processed.engineerEmbeddings, embeddings);
  await writeJsonl(paths.processed.rankedLeads, rankedLeads);

  return {
    leadCount: rankedLeads.length,
    profileCount: profiles.length,
    repoCategoryCount: repoCategories.length,
    topLead: rankedLeads[0] ?? null
  };
}

function toRankedLead(lead: TrackOneLead, recipe: Recipe, neuralModel: NeuralIntentModel | null): RankedLead {
  const evidence = toEvidence(lead, recipe, neuralModel);
  const codeSignals = mergeCodeSignals([
    ...(lead.answer_context?.code_signals ?? []),
    ...evidence.flatMap((item) => item.code_signals ?? [])
  ]);
  const neuralIntentScore = maxNeuralScore(evidence);
  const burningProblemScore = maxBurningProblemScore(evidence, lead.answer_context?.burning_problem_score);
  const painSignals = unique([
    ...(lead.answer_context?.pain_signals ?? []),
    ...evidence.flatMap((item) => item.pain_signals ?? [])
  ]);
  const repoCategories = normalizeCategories(lead.repo_category, recipe);
  const topTopics = normalizeTopics(lead.matched_topics, recipe);
  const primaryLanguages = normalizeStacks(lead.matched_topics, recipe);
  const windowStartAt = new Date(
    new Date(lead.last_active_at).getTime() - recipe.time_window_days * 86_400_000
  ).toISOString();
  const semanticDocument = [
    lead.engineer_login,
    lead.name,
    lead.company,
    lead.repo,
    repoCategories.join(" "),
    topTopics.join(" "),
    primaryLanguages.join(" "),
    lead.why_relevant,
    lead.outreach_angle,
    lead.answer_context?.problem_signals.join(" "),
    lead.answer_context?.pain_signals?.join(" "),
    burningProblemScore === undefined ? null : `burning problem score ${burningProblemScore}`,
    painSignals.join(" "),
    lead.answer_context?.stack_signals.join(" "),
    codeSignals
      .map((signal) =>
        `${signal.label} ${signal.pain_point} ${signal.code_manifestation ?? ""} ${signal.matched_terms.join(" ")}`
      )
      .join(" "),
    lead.answer_context?.repo_signals.join(" "),
    lead.answer_context?.outreach_hooks.join(" "),
    lead.answer_context?.evidence_snippets.map((item) => `${item.title} ${item.snippet}`).join(" "),
    evidence.map((item) => `${item.title} ${item.text}`).join(" "),
    neuralIntentScore === undefined ? null : `neural intent score ${neuralIntentScore}`
  ]
    .filter(Boolean)
    .join(" ");

  return {
    engineer_login: lead.engineer_login,
    name: lead.name,
    score: lead.score,
    ...(neuralIntentScore === undefined ? {} : { neural_intent_score: neuralIntentScore }),
    ...(burningProblemScore === undefined ? {} : { burning_problem_score: burningProblemScore }),
    ...(painSignals.length === 0 ? {} : { pain_signals: painSignals }),
    ...(codeSignals.length === 0 ? {} : { code_signals: codeSignals }),
    why_relevant: lead.why_relevant,
    outreach_angle: lead.outreach_angle,
    score_breakdown: scoreBreakdownFromImportedLead(lead, evidence, repoCategories, topTopics, primaryLanguages),
    evidence,
    top_repos: [lead.repo],
    top_topics: topTopics,
    repo_categories: repoCategories,
    primary_languages: primaryLanguages,
    last_active_at: lead.last_active_at,
    window_start_at: windowStartAt,
    time_window_days: recipe.time_window_days,
    answer_context: answerContextWithCodeSignals(lead.answer_context, codeSignals, evidence),
    semantic_document: semanticDocument
  };
}

function toEvidence(lead: TrackOneLead, recipe: Recipe, neuralModel: NeuralIntentModel | null): EvidenceRecord[] {
  const activities = Array.isArray(lead.recent_activity) ? lead.recent_activity : [];
  if (activities.length === 0) {
    return lead.evidence_links.map((url) => ({
      type: "issue",
      repo: lead.repo,
      title: url,
      text: lead.why_relevant,
      url,
      created_at: lead.last_active_at,
      matched_topics: normalizeTopics(lead.matched_topics, recipe),
      repo_categories: normalizeCategories(lead.repo_category, recipe),
      contribution_weight: 1,
      code_signals: detectCodeSignals(lead.why_relevant),
      ...(neuralModel
        ? {
            neural_intent_score: scoreActivityWithModel(neuralModel, lead, {
              type: "issue",
              repo: lead.repo,
              title: url,
              occurred_at: lead.last_active_at,
              url,
              matched_terms: lead.matched_topics
            })
          }
        : {})
    }));
  }

  return activities.map((activity) => {
    const evidence: EvidenceRecord = {
      type: normalizeEvidenceType(activity.type),
      repo: activity.repo || lead.repo,
      title: activity.title || "GitHub activity",
      text: [activity.snippet ?? activity.text, activity.title, ...(activity.matched_terms ?? [])].join(" "),
      url: activity.url,
      created_at: activity.occurred_at || lead.last_active_at,
      matched_topics: normalizeTopics(activity.matched_terms ?? [], recipe),
      repo_categories: normalizeCategories(lead.repo_category, recipe),
      contribution_weight: contributionWeight(activity.type),
      code_signals: detectCodeSignals([activity.snippet ?? activity.text, activity.title, ...(activity.matched_terms ?? [])].join(" ")),
      ...(Number.isFinite(activity.pain_score) ? { burning_problem_score: activity.pain_score } : {}),
      ...(activity.buyer_intent_label ? { buyer_intent_label: activity.buyer_intent_label } : {}),
      ...(activity.pain_signals?.length ? { pain_signals: activity.pain_signals } : {})
    };
    if (neuralModel) {
      evidence.neural_intent_score = scoreActivityWithModel(neuralModel, lead, activity);
    }
    return evidence;
  });
}

function toEngineerProfile(lead: RankedLead): EngineerProfile {
  return {
    login: lead.engineer_login,
    name: lead.name,
    company: null,
    location: null,
    blog: null,
    email: null,
    bio: null,
    url: null,
    followers: 0,
    public_repos: 0,
    top_repos: lead.top_repos,
    top_topics: lead.top_topics,
    repo_categories: lead.repo_categories,
    primary_languages: lead.primary_languages,
    stack_signals: [],
    code_signals: lead.code_signals ?? lead.answer_context?.code_signals ?? [],
    contribution_counts: countEvidenceTypes(lead.evidence),
    last_active_at: lead.last_active_at,
    evidence: lead.evidence,
    negative_flags: [],
    profile_text: lead.semantic_document
  };
}

function answerContextWithCodeSignals(
  answerContext: AnswerContext | undefined,
  codeSignals: ReturnType<typeof mergeCodeSignals>,
  evidence: EvidenceRecord[]
): AnswerContext {
  const codeSignalContext = evidence.flatMap((item) =>
    (item.code_signals ?? []).map((signal) => ({
      ...signal,
      repo: item.repo,
      title: item.title,
      url: item.url
    }))
  );

  return {
    problem_signals: [
      ...new Set([
        ...(answerContext?.problem_signals ?? []),
        ...codeSignals.map((signal) => signal.label)
      ])
    ].slice(0, 12),
    ...(answerContext?.pain_signals ? { pain_signals: answerContext.pain_signals } : {}),
    ...(answerContext?.burning_problem_score === undefined
      ? {}
      : { burning_problem_score: answerContext.burning_problem_score }),
    code_signals: codeSignals,
    code_signal_context: codeSignalContext,
    pain_point_evidence: painPointEvidenceFromContexts(codeSignalContext),
    stack_signals: answerContext?.stack_signals ?? [],
    repo_signals: answerContext?.repo_signals ?? [],
    evidence_snippets:
      answerContext?.evidence_snippets?.map((snippet) => ({
        ...snippet,
        code_signals: evidence.find((item) => item.url === snippet.url)?.code_signals ?? snippet.code_signals
      })) ?? [],
    outreach_hooks:
      codeSignals.length === 0
        ? answerContext?.outreach_hooks ?? []
        : [
            ...(answerContext?.outreach_hooks ?? []),
            `Lead with ${codeSignals.slice(0, 3).map((signal) => signal.label).join(", ")}.`
          ]
  };
}

function toEmbedding(lead: RankedLead, recipe: Recipe): EngineerEmbedding {
  const dimensions = embeddingDimensions(recipe);
  return {
    engineer_login: lead.engineer_login,
    dimensions,
    vector: embedText(lead.semantic_document, dimensions)
  };
}

function toContributionTopics(lead: RankedLead): ContributionTopicRecord[] {
  return lead.evidence.map((evidence) => ({
    repo: evidence.repo,
    actor_login: lead.engineer_login,
    evidence_url: evidence.url,
    evidence_type: evidence.type,
    matched_topics: evidence.matched_topics,
    created_at: evidence.created_at
  }));
}

function toRepoCategories(leads: RankedLead[]): RepoCategoryRecord[] {
  const categoriesByRepo = new Map<string, Set<string>>();
  for (const lead of leads) {
    for (const repo of lead.top_repos) {
      const categories = categoriesByRepo.get(repo) ?? new Set<string>();
      for (const category of lead.repo_categories) categories.add(category);
      categoriesByRepo.set(repo, categories);
    }
  }

  return [...categoriesByRepo.entries()]
    .map(([repo, categories]) => ({
      repo,
      categories: [...categories],
      category_scores: Object.fromEntries([...categories].map((category) => [category, 1])),
      negative_flags: []
    }))
    .sort((left, right) => left.repo.localeCompare(right.repo));
}

function normalizeCategories(categories: string[], recipe: Recipe): string[] {
  return unique(
    categories
      .map((category) => mapCategory(category))
      .filter((category) => recipe.repo_categories.includes(category))
  );
}

function mapCategory(category: string): string {
  const normalized = category.toLowerCase().replace(/[-_\s]+/g, " ").trim();
  const map: Record<string, string> = {
    "realtime sync": "real-time sync",
    "real time sync": "real-time sync",
    "reactive database": "reactive database",
    "backend as a service": "backend-as-a-service",
    baas: "backend-as-a-service",
    "local first": "local-first",
    "offline first": "offline-first",
    "crdt collaboration": "CRDT/collaboration",
    "serverless backend": "serverless backend",
    "database sync": "database sync"
  };
  return map[normalized] ?? category;
}

function normalizeTopics(terms: string[] = [], recipe: Recipe): string[] {
  const normalized = recipe.topic_terms.filter((topic) =>
    terms.some((term) => termsMatch(term, topic))
  );
  return sortTopics(normalized);
}

function normalizeStacks(terms: string[] = [], recipe: Recipe): string[] {
  return recipe.strong_stacks.filter((stack) => terms.some((term) => termsMatch(term, stack)));
}

function termsMatch(left: string, right: string): boolean {
  if (right.toLowerCase() === "postgres changefeed") {
    return /change\s*feeds?/i.test(left) || /postgres\s*change\s*feeds?/i.test(left);
  }
  if (includesTerm(left, right)) {
    return true;
  }
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .replace(/s$/, "");
  return normalize(left) === normalize(right);
}

function normalizeEvidenceType(type: string): EvidenceRecord["type"] {
  if (type.includes("pull_request")) return "pull_request";
  if (type.includes("comment")) return "comment";
  if (type.includes("commit")) return "commit";
  return "issue";
}

function contributionWeight(type: string): number {
  if (type === "merged_pull_request") return 10;
  if (type === "opened_pull_request") return 7;
  if (type === "commit") return 6;
  if (type === "technical_comment") return 2;
  return 4;
}

function countEvidenceTypes(evidence: EvidenceRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of evidence) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return counts;
}

function scoreBreakdownFromImportedLead(
  lead: TrackOneLead,
  evidence: EvidenceRecord[],
  repoCategories: string[],
  topTopics: string[],
  primaryLanguages: string[]
): ScoreBreakdown {
  return {
    recent_activity: Math.min(25, evidence.length * 3 + 10),
    repo_category_fit: Math.min(25, repoCategories.length * 8),
    topic_fit: Math.min(25, topTopics.length * 5),
    contribution_depth: Math.min(20, evidence.reduce((sum, item) => sum + item.contribution_weight, 0) / 2),
    stack_fit: Math.min(10, primaryLanguages.length * 3),
    evidence_quality: Math.min(5, lead.evidence_links.length),
    penalties: 0
  };
}

function scoreActivityWithModel(
  model: NeuralIntentModel,
  lead: TrackOneLead,
  activity: TrackOneActivity
): number {
  return predictNeuralIntent(model, {
    repo: activity.repo || lead.repo,
    event_type: activity.type,
    evidence_title: activity.title,
    evidence_text: [activity.snippet ?? activity.text, activity.title, ...(activity.matched_terms ?? [])].join(" "),
    labels: {
      problem_signals: activity.matched_terms ?? lead.matched_topics,
      pain_signals: activity.pain_signals ?? lead.answer_context?.pain_signals ?? [],
      stack_signals: lead.answer_context?.stack_signals ?? [],
      repo_categories: lead.repo_category
    }
  });
}

function maxNeuralScore(evidence: EvidenceRecord[]): number | undefined {
  const scores = evidence
    .map((item) => item.neural_intent_score)
    .filter((score): score is number => Number.isFinite(score));
  if (scores.length === 0) return undefined;
  return Number(Math.max(...scores).toFixed(4));
}

function maxBurningProblemScore(
  evidence: EvidenceRecord[],
  answerContextScore?: number
): number | undefined {
  const scores = [
    answerContextScore,
    ...evidence.map((item) => item.burning_problem_score)
  ].filter((score): score is number => Number.isFinite(score));
  if (scores.length === 0) return undefined;
  return Number(Math.max(...scores).toFixed(4));
}

function defaultNeuralModelPath(sourcePath: string): string {
  return resolve(dirname(sourcePath), "..", "model-experiments", "neural_reranker.json");
}

function isAutomationIdentity(login: string): boolean {
  const normalized = login.toLowerCase();
  return (
    normalized === "copilot" ||
    normalized === "github-actions" ||
    normalized === "github-actions[bot]" ||
    normalized.endsWith("[bot]") ||
    normalized.endsWith("-bot") ||
    normalized.includes("dependabot") ||
    normalized.includes("renovate")
  );
}
