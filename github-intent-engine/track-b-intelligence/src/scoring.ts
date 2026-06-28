import { daysBetween } from "./text.js";
import { detectCodeSignals, mergeCodeSignals } from "./code-signals.js";
import { painPointEvidenceFromContexts } from "./pain-point-evidence.js";
import type { AnswerContext, CodeSignal, EngineerProfile, EvidenceRecord, RankedLead, Recipe, ScoreBreakdown } from "./types.js";

export function rankProfiles(input: {
  profiles: EngineerProfile[];
  recipe: Recipe;
  now: Date;
}): RankedLead[] {
  const windowStart = new Date(input.now.getTime() - input.recipe.time_window_days * 86_400_000);
  return input.profiles
    .filter((profile) => !isAutomationIdentity(profile.login))
    .map((profile) => scoreProfile(profile, input.recipe, input.now, windowStart))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.engineer_login.localeCompare(right.engineer_login);
    });
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
    normalized.includes("renovate") ||
    normalized.includes("coderabbit")
  );
}

function scoreProfile(
  profile: EngineerProfile,
  recipe: Recipe,
  now: Date,
  windowStart: Date
): RankedLead {
  const scoreBreakdown: ScoreBreakdown = {
    recent_activity: recentActivityScore(profile, now),
    repo_category_fit: repoCategoryScore(profile, recipe),
    topic_fit: topicScore(profile, recipe),
    contribution_depth: contributionDepthScore(profile),
    stack_fit: stackScore(profile, recipe),
    evidence_quality: evidenceQualityScore(profile),
    penalties: penaltyScore(profile)
  };

  const rawScore = Object.entries(scoreBreakdown).reduce((sum, [key, value]) => {
    return key === "penalties" ? sum - value : sum + value;
  }, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const topics = profile.top_topics.slice(0, 3);
  const repo = profile.top_repos[0] ?? "relevant GitHub repositories";

  return {
    engineer_login: profile.login,
    name: profile.name,
    score,
    why_relevant:
      topics.length > 0
        ? `Recently worked on ${topics.join(", ")} in ${repo}.`
        : `Recently contributed to ${repo}.`,
    outreach_angle:
      topics.length > 0
        ? `For ${recipe.target_product}, this is relevant because their public activity touches ${topics.join(
            ", "
          )}, which maps to reactive backend and sync complexity.`
        : `For ${recipe.target_product}, this engineer has recent activity in adjacent backend infrastructure.`,
    score_breakdown: scoreBreakdown,
    evidence: profile.evidence,
    top_repos: profile.top_repos,
    top_topics: profile.top_topics,
    repo_categories: profile.repo_categories,
    primary_languages: profile.primary_languages,
    code_signals: profile.code_signals,
    last_active_at: profile.last_active_at,
    window_start_at: windowStart.toISOString(),
    time_window_days: recipe.time_window_days,
    answer_context: buildAnswerContext(profile, recipe),
    semantic_document: profile.profile_text
  };
}

function recentActivityScore(profile: EngineerProfile, now: Date): number {
  const lastActiveAt = new Date(profile.last_active_at);
  if (!Number.isFinite(lastActiveAt.getTime())) {
    return 0;
  }

  const recencyDays = daysBetween(lastActiveAt, now);
  const recencyBonus = recencyDays <= 7 ? 18 : recencyDays <= 30 ? 15 : recencyDays <= 90 ? 10 : 0;
  return Math.min(25, recencyBonus + profile.evidence.length * 2);
}

function repoCategoryScore(profile: EngineerProfile, recipe: Recipe): number {
  const categoryHits = profile.repo_categories.filter((category) =>
    recipe.repo_categories.includes(category)
  ).length;
  return Math.min(25, categoryHits * 7);
}

function topicScore(profile: EngineerProfile, recipe: Recipe): number {
  const topicHits = profile.top_topics.filter((topic) => recipe.topic_terms.includes(topic)).length;
  return Math.min(25, topicHits * 8);
}

function contributionDepthScore(profile: EngineerProfile): number {
  const topicEvidence = profile.evidence.filter((evidence) => evidence.matched_topics.length > 0);
  const nonTopicEvidence = profile.evidence.filter((evidence) => evidence.matched_topics.length === 0);
  const topicDepth = topicEvidence.reduce((sum, evidence) => sum + evidence.contribution_weight, 0);
  const supportingDepth = nonTopicEvidence.reduce((sum, evidence) => sum + evidence.contribution_weight, 0) * 0.25;
  const statDepth = Math.min(
    5,
    (profile.contribution_counts.merged_pull_request_count ?? 0) * 1.2 +
      (profile.contribution_counts.commit_count ?? 0) * 0.25 +
      (profile.contribution_counts.review_count ?? 0) * 0.8 +
      (profile.contribution_counts.review_comment_count ?? 0) * 0.4 +
      (profile.contribution_counts.failed_workflow_count ?? 0) * 0.4
  );
  return Math.min(
    20,
    topicDepth + supportingDepth + statDepth
  );
}

function evidenceQualityScore(profile: EngineerProfile): number {
  const topicEvidenceCount = profile.evidence.filter((evidence) => evidence.matched_topics.length > 0).length;
  const topicDensity = profile.evidence.length === 0 ? 0 : topicEvidenceCount / profile.evidence.length;
  return Math.min(5, topicEvidenceCount * 1.5 + topicDensity * 2);
}

function stackScore(profile: EngineerProfile, recipe: Recipe): number {
  const languageHits = profile.primary_languages.filter((language) =>
    recipe.strong_stacks.includes(language)
  ).length;
  const stackSignalHits = profile.stack_signals.filter((stack) =>
    recipe.strong_stacks.includes(stack)
  ).length;
  const textHits = recipe.strong_stacks.filter((stack) =>
    profile.profile_text.toLowerCase().includes(stack.toLowerCase())
  ).length;
  return Math.min(10, languageHits * 6 + stackSignalHits * 2 + textHits);
}

function penaltyScore(profile: EngineerProfile): number {
  let penalty = profile.negative_flags.length * 12;
  const topicEvidenceCount = profile.evidence.filter((evidence) => evidence.matched_topics.length > 0).length;
  const topicDensity = profile.evidence.length === 0 ? 0 : topicEvidenceCount / profile.evidence.length;
  if (profile.top_topics.length === 0) {
    penalty += 18;
  } else if (profile.top_topics.length === 1) {
    penalty += 8;
  }
  if (profile.evidence.length >= 3 && topicDensity < 0.25) {
    penalty += 10;
  }
  if (profile.followers <= 1 && profile.public_repos <= 3) {
    penalty += 8;
  }
  if (profile.evidence.length === 1 && profile.evidence[0]?.type === "comment") {
    penalty += 8;
  }
  return Math.min(40, penalty);
}

function buildAnswerContext(profile: EngineerProfile, recipe: Recipe): AnswerContext {
  const evidence = profile.evidence.slice(0, 5);
  const codeSignals = mergeCodeSignals([
    ...(profile.code_signals ?? []),
    ...evidence.flatMap((item) => codeSignalsForEvidence(item))
  ]);
  const problemSignals = unique([
    ...profile.top_topics,
    ...evidence.flatMap((item) => item.matched_topics),
    ...codeSignals.map((signal) => signal.label)
  ]).slice(0, 10);
  const stackSignals = unique([
    ...profile.primary_languages,
    ...profile.stack_signals
  ]).slice(0, 10);
  const repoSignals = unique(profile.repo_categories).slice(0, 10);

  return {
    problem_signals: problemSignals,
    code_signals: codeSignals,
    code_signal_context: codeSignalContext(evidence).slice(0, 8),
    pain_point_evidence: painPointEvidenceFromContexts(codeSignalContext(evidence).slice(0, 8)),
    stack_signals: stackSignals,
    repo_signals: repoSignals,
    evidence_snippets: evidence.map(toEvidenceSnippet),
    outreach_hooks: outreachHooks(profile, recipe, problemSignals, stackSignals, codeSignals)
  };
}

function toEvidenceSnippet(evidence: EvidenceRecord): AnswerContext["evidence_snippets"][number] {
  return {
    type: evidence.type,
    repo: evidence.repo,
    title: evidence.title,
    url: evidence.url,
    occurred_at: evidence.created_at,
    matched_terms: evidence.matched_topics,
    code_signals: codeSignalsForEvidence(evidence),
    snippet: compactSnippet(`${evidence.title} ${evidence.text}`)
  };
}

function outreachHooks(
  profile: EngineerProfile,
  recipe: Recipe,
  problemSignals: string[],
  stackSignals: string[],
  codeSignals: CodeSignal[]
): string[] {
  const repo = profile.top_repos[0] ?? "their recent GitHub work";
  const firstEvidence = profile.evidence[0];
  const hooks = [
    `For ${recipe.target_product}, ask about ${formatList(problemSignals.slice(0, 4)) || "their recent backend work"} in ${repo}.`
  ];
  if (stackSignals.length > 0) {
    hooks.push(`Connect ${recipe.target_product} to their ${formatList(stackSignals.slice(0, 4))} stack.`);
  }
  if (codeSignals.length > 0) {
    hooks.push(`Lead with ${formatList(codeSignals.slice(0, 3).map((signal) => signal.label))}; it is more specific than a generic repo-topic pitch.`);
  }
  if (firstEvidence) {
    hooks.push(`Reference "${firstEvidence.title}" instead of sending a generic devtools pitch.`);
  }
  return hooks;
}

function codeSignalsForEvidence(evidence: EvidenceRecord): CodeSignal[] {
  return evidence.code_signals ?? detectCodeSignals(`${evidence.title} ${evidence.text}`);
}

function codeSignalContext(evidence: EvidenceRecord[]): AnswerContext["code_signal_context"] {
  return evidence.flatMap((item) =>
    codeSignalsForEvidence(item).map((signal) => ({
      ...signal,
      repo: item.repo,
      title: item.title,
      url: item.url
    }))
  );
}

function compactSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function formatList(values: string[]): string {
  return values.filter(Boolean).join(", ");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
