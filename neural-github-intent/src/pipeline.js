import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyRepo } from "./classifier.js";
import { embedText, semanticSimilarity } from "./embedding.js";
import { compactText, matchedTerms, normalizeText } from "./text.js";
import { writeJsonl } from "./jsonl.js";

const CONTRIBUTION_WEIGHTS = {
  merged_pull_request: 10,
  opened_pull_request: 7,
  commit: 6,
  technical_comment: 4,
  issue: 3,
  star: 1
};

export function buildTrackOneArtifacts({ raw, recipe, now = new Date(), days = recipe.days }) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const repoProfiles = (raw.repos ?? []).map((repo) => classifyRepo(repo, recipe));
  const repoProfileByName = new Map(repoProfiles.map((profile) => [profile.repo, profile]));
  const userByLogin = new Map((raw.users ?? []).map((user) => [user.login, user]));
  const rawEvents = materializeEvents(raw, { since, recipe });
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

  return {
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
      scored_lead_count: scoredLeads.length
    }
  };
}

export async function writeTrackOneArtifacts(outDir, artifacts) {
  await mkdir(outDir, { recursive: true });
  await writeJsonl(path.join(outDir, "raw_events.ndjson"), artifacts.rawEvents);
  await writeJsonl(path.join(outDir, "repo_profiles.ndjson"), artifacts.repoProfiles);
  await writeJsonl(path.join(outDir, "engineer_profiles.ndjson"), artifacts.engineerProfiles);
  await writeJsonl(path.join(outDir, "profile_embeddings.ndjson"), artifacts.profileEmbeddings);
  await writeJsonl(path.join(outDir, "training_examples.ndjson"), artifacts.trainingExamples);
  await writeJsonl(path.join(outDir, "scored_leads.ndjson"), artifacts.scoredLeads);
  await writeFile(
    path.join(outDir, "harvest_report.json"),
    `${JSON.stringify(artifacts.report, null, 2)}\n`,
    "utf8"
  );
}

export function buildProfileEmbeddings(engineerProfiles, recipe) {
  return engineerProfiles.map((profile) => {
    const vector = embedText(profile.profile_text);
    const dimensions = [...vector.entries()]
      .map(([term, weight]) => ({ term, weight: Math.round(weight * 1000) / 1000 }))
      .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term))
      .slice(0, 40);

    return {
      engineer_login: profile.engineer_login,
      query_similarity: Math.round(semanticSimilarity(recipe.targetPrompt, profile.profile_text) * 1000) / 1000,
      dimensions
    };
  });
}

export function buildTrainingExamples({ events, repoProfileByName, recipe }) {
  return events.map((event) => {
    const repoProfile = repoProfileByName.get(event.repo);
    const problemSignals = problemSignalsFromTerms(event.matched_terms, recipe);
    const stackSignals = stackSignalsFromText(event.text, recipe);
    const repoCategories = (repoProfile?.categories ?? []).map((category) => category.label);
    const buyerIntent = classifyBuyerIntent(event, recipe);
    const hasRelevantRepo = repoCategories.length > 0;
    const label = problemSignals.length > 0 && hasRelevantRepo ? "positive" : "hard_negative";

    return {
      id: event.id,
      query: recipe.targetPrompt,
      engineer_login: event.actor_login,
      repo: event.repo,
      event_type: event.type,
      occurred_at: event.occurred_at,
      evidence_url: event.url,
      evidence_title: event.title,
      evidence_text: compactText([event.title, event.text]),
      label,
      buyer_intent_label: buyerIntent.label,
      pain_score: buyerIntent.score,
      weight: event.weight,
      labels: {
        problem_signals: problemSignals,
        pain_signals: buyerIntent.pain_signals,
        buyer_intent_reasons: buyerIntent.reasons,
        stack_signals: stackSignals,
        repo_categories: repoCategories
      }
    };
  });
}

export function materializeEvents(raw, { since, recipe }) {
  const events = [];

  for (const pr of raw.pull_requests ?? []) {
    const timestamp = pr.merged_at ?? pr.updated_at ?? pr.created_at;
    if (!isRecent(timestamp, since)) continue;
    events.push({
      id: `pr:${pr.repo}:${pr.number}`,
      type: pr.merged_at ? "merged_pull_request" : "opened_pull_request",
      repo: pr.repo,
      actor_login: pr.author_login,
      title: pr.title ?? "",
      text: compactText([pr.title, pr.body, ...(pr.changed_files ?? [])]),
      url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      occurred_at: timestamp,
      weight: pr.merged_at ? CONTRIBUTION_WEIGHTS.merged_pull_request : CONTRIBUTION_WEIGHTS.opened_pull_request,
      matched_terms: matchedTerms(compactText([pr.title, pr.body, ...(pr.changed_files ?? [])]), allTerms(recipe))
    });
  }

  for (const issue of raw.issues ?? []) {
    const timestamp = issue.updated_at ?? issue.created_at;
    if (!isRecent(timestamp, since)) continue;
    events.push({
      id: `issue:${issue.repo}:${issue.number}`,
      type: "issue",
      repo: issue.repo,
      actor_login: issue.author_login,
      title: issue.title ?? "",
      text: compactText([issue.title, issue.body]),
      url: issue.html_url,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      occurred_at: timestamp,
      weight: CONTRIBUTION_WEIGHTS.issue,
      matched_terms: matchedTerms(compactText([issue.title, issue.body]), allTerms(recipe))
    });
  }

  for (const comment of raw.comments ?? []) {
    const timestamp = comment.updated_at ?? comment.created_at;
    if (!isRecent(timestamp, since)) continue;
    events.push({
      id: `comment:${comment.repo}:${comment.issue_number}:${comment.html_url}`,
      type: "technical_comment",
      repo: comment.repo,
      actor_login: comment.author_login,
      title: `Comment on #${comment.issue_number}`,
      text: compactText([comment.body]),
      url: comment.html_url,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      occurred_at: timestamp,
      weight: CONTRIBUTION_WEIGHTS.technical_comment,
      matched_terms: matchedTerms(comment.body ?? "", allTerms(recipe))
    });
  }

  for (const commit of raw.commits ?? []) {
    if (!isRecent(commit.committed_at, since)) continue;
    events.push({
      id: `commit:${commit.repo}:${commit.sha}`,
      type: "commit",
      repo: commit.repo,
      actor_login: commit.author_login,
      title: firstLine(commit.message),
      text: compactText([commit.message, ...(commit.changed_files ?? [])]),
      url: commit.html_url,
      created_at: commit.committed_at,
      updated_at: commit.committed_at,
      occurred_at: commit.committed_at,
      weight: CONTRIBUTION_WEIGHTS.commit,
      matched_terms: matchedTerms(compactText([commit.message, ...(commit.changed_files ?? [])]), allTerms(recipe))
    });
  }

  return events
    .filter((event) => event.actor_login && event.url)
    .sort((left, right) => left.repo.localeCompare(right.repo) || right.occurred_at.localeCompare(left.occurred_at));
}

export function buildEngineerProfiles({ events, repoProfileByName, userByLogin, recipe }) {
  const grouped = new Map();

  for (const event of events) {
    const profile = grouped.get(event.actor_login) ?? {
      engineer_login: event.actor_login,
      user: userByLogin.get(event.actor_login) ?? null,
      contribution_score: 0,
      recent_activity: [],
      repos: new Set(),
      repo_categories: new Map(),
      matched_topics: new Set(),
      evidence_links: new Set(),
      last_active_at: event.occurred_at
    };

    const repoProfile = repoProfileByName.get(event.repo);
    const buyerIntent = classifyBuyerIntent(event, recipe);
    profile.contribution_score += event.weight;
    profile.recent_activity.push({
      type: event.type,
      repo: event.repo,
      title: event.title,
      snippet: compactText([event.text]).slice(0, 520),
      occurred_at: event.occurred_at,
      url: event.url,
      matched_terms: event.matched_terms,
      pain_score: buyerIntent.score,
      buyer_intent_label: buyerIntent.label,
      pain_signals: buyerIntent.pain_signals
    });
    profile.repos.add(event.repo);
    profile.evidence_links.add(event.url);
    for (const term of event.matched_terms) profile.matched_topics.add(term);
    for (const category of repoProfile?.categories ?? []) {
      profile.repo_categories.set(category.id, category.label);
      for (const term of category.matched_terms) profile.matched_topics.add(term);
    }
    if (new Date(event.occurred_at) > new Date(profile.last_active_at)) {
      profile.last_active_at = event.occurred_at;
    }

    grouped.set(event.actor_login, profile);
  }

  return [...grouped.values()].map((profile) => {
    const user = profile.user;
    const activity = profile.recent_activity.sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
    const profileText = compactText([
      user?.name,
      user?.company,
      user?.bio,
      ...activity.map((event) =>
        `${event.type} ${event.repo} ${event.title} ${event.snippet} ${event.matched_terms.join(" ")} ${event.pain_signals.join(" ")}`
      ),
      [...profile.repo_categories.values()].join(" "),
      [...profile.matched_topics].join(" ")
    ]);

    return {
      engineer_login: profile.engineer_login,
      type: user?.type ?? "Unknown",
      name: user?.name ?? null,
      company: user?.company ?? null,
      location: user?.location ?? null,
      blog: user?.blog ?? null,
      email: user?.email ?? null,
      bio: user?.bio ?? null,
      html_url: user?.html_url ?? `https://github.com/${profile.engineer_login}`,
      contribution_score: profile.contribution_score,
      repos: [...profile.repos].sort(),
      repo_categories: [...profile.repo_categories.entries()].map(([id, label]) => ({ id, label })),
      matched_topics: [...profile.matched_topics].sort(),
      recent_activity: activity.slice(0, 8),
      evidence_links: [...profile.evidence_links],
      last_active_at: profile.last_active_at,
      profile_text: profileText
    };
  });
}

export function scoreEngineerProfiles({ profiles, repoProfileByName, recipe, now }) {
  const scored = [];

  for (const profile of profiles) {
    if (profile.type === "Bot" || isBotLikeLogin(profile.engineer_login)) continue;
    if (profile.evidence_links.length === 0) continue;

    const repoProfiles = profile.repos.map((repo) => repoProfileByName.get(repo)).filter(Boolean);
    const bestRepo = repoProfiles
      .toSorted((left, right) => right.categoryScore - left.categoryScore || right.stars - left.stars)[0];
    const directTerms = [...new Set(profile.recent_activity.flatMap((event) => event.matched_terms))];
    const directProblemTerms = problemSignalsFromTerms(directTerms, recipe);
    if (directProblemTerms.length === 0) continue;

    const categoryRelevance = Math.min(20, repoProfiles.reduce((sum, repo) => sum + repo.categoryScore, 0) / 3);
    const topicRelevance = Math.min(20, directProblemTerms.length * 4);
    const activityStrength = Math.min(25, profile.contribution_score);
    const semanticRelevance = Math.round(semanticSimilarity(recipe.targetPrompt, profile.profile_text) * 25);
    const stackFit = Math.min(10, matchedTerms(profile.profile_text, recipe.stackTerms).length * 2);
    const evidenceQuality = Math.min(10, profile.evidence_links.length * 2);
    const burningProblemScore = maxPainScore(profile.recent_activity);
    const painRelevance = Math.round(burningProblemScore * 25);
    const recency = recencyScore(profile.last_active_at, now);
    const penalty = negativePenalty(profile, recipe) + lowPainPenalty(profile);
    const score = Math.max(
      0,
      Math.round(
        activityStrength +
          categoryRelevance +
          topicRelevance +
          semanticRelevance +
          stackFit +
          evidenceQuality +
          painRelevance +
          recency -
          penalty
      )
    );

    if (score < 35 || !bestRepo || bestRepo.categories.length === 0) continue;

    const strongestTerms = topMatchedTerms(directTerms, recipe);
    const why = buildWhyRelevant(profile, bestRepo, strongestTerms);
    const answerContext = buildAnswerContext(profile, bestRepo, strongestTerms, recipe);

    scored.push({
      engineer_login: profile.engineer_login,
      name: profile.name,
      company: profile.company,
      github_url: profile.html_url,
      repo: bestRepo.repo,
      repo_category: bestRepo.categories.map((category) => category.label),
      score,
      why_relevant: why,
      matched_topics: strongestTerms,
      recent_activity: profile.recent_activity.slice(0, 5),
      last_active_at: profile.last_active_at,
      evidence_links: profile.evidence_links.slice(0, 8),
      answer_context: answerContext,
      outreach_angle: `Good Convex lead because they are actively working near ${humanJoin(strongestTerms.slice(0, 3))} in ${bestRepo.repo}, which maps to reactive backend state and sync complexity.`
    });
  }

  return scored.sort((left, right) => right.score - left.score || left.engineer_login.localeCompare(right.engineer_login));
}

function buildAnswerContext(profile, bestRepo, strongestTerms, recipe) {
  const problemSignals = problemSignalsFromTerms(strongestTerms, recipe).slice(0, 8);
  const stackSignals = stackSignalsFromText(profile.profile_text, recipe).slice(0, 8);
  const painSignals = unique(profile.recent_activity.flatMap((event) => event.pain_signals ?? [])).slice(0, 8);
  const burningProblemScore = maxPainScore(profile.recent_activity);
  const evidenceSnippets = profile.recent_activity.slice(0, 5).map((event) => ({
    type: event.type,
    repo: event.repo,
    title: event.title,
    url: event.url,
    occurred_at: event.occurred_at,
    matched_terms: event.matched_terms,
    pain_score: event.pain_score,
    buyer_intent_label: event.buyer_intent_label,
    pain_signals: event.pain_signals ?? [],
    snippet: compactText([event.title, event.snippet, event.matched_terms.join(" ")]).slice(0, 320)
  }));
  const hooks = [
    burningProblemScore >= 0.55 && painSignals.length > 0
      ? `Lead with their visible ${humanJoin(painSignals.slice(0, 3))} pain before pitching Convex.`
      : null,
    problemSignals.length > 0
      ? `Ask about their recent ${humanJoin(problemSignals.slice(0, 4))} work in ${bestRepo.repo}.`
      : `Ask about the backend infrastructure work they have been doing in ${bestRepo.repo}.`,
    stackSignals.length > 0
      ? `Connect Convex to their ${humanJoin(stackSignals.slice(0, 3))} stack.`
      : "Position Convex as a way to simplify realtime backend state.",
    `Reference the specific evidence link instead of sending a generic devtools pitch.`
  ];

  return {
    problem_signals: problemSignals,
    pain_signals: painSignals,
    burning_problem_score: burningProblemScore,
    stack_signals: stackSignals,
    repo_signals: bestRepo.categories.map((category) => category.label),
    evidence_snippets: evidenceSnippets,
    outreach_hooks: hooks.filter(Boolean)
  };
}

function problemSignalsFromTerms(terms, recipe) {
  return recipe.positiveTerms.filter((term) => terms.some((candidate) => termsEqual(candidate, term)));
}

function stackSignalsFromText(text, recipe) {
  return matchedTerms(text, recipe.stackTerms).map(displayStackSignal);
}

export function classifyBuyerIntent(event, recipe) {
  const text = compactText([event.title, event.text]);
  const topicSignals = problemSignalsFromTerms(event.matched_terms ?? [], recipe);
  const stackSignals = stackSignalsFromText(text, recipe);
  const painSignals = matchedRuleLabels(text, BUYER_PAIN_RULES);
  const solutionSignals = matchedRuleLabels(text, SOLUTION_SEEKING_RULES);
  const maintenanceSignals = matchedRuleLabels(text, MAINTENANCE_NOISE_RULES);
  const hasDomainFit = topicSignals.length > 0 || stackSignals.length > 0;
  const hasMaintenanceNoise = maintenanceSignals.length > 0;
  const eventWeight = painEventTypeWeight(event.type);
  const painWeight = Math.min(0.6, painSignals.length * 0.14);
  const solutionWeight = Math.min(0.25, solutionSignals.length * 0.16);
  const domainWeight = hasDomainFit ? 0.08 : 0;
  const maintenanceMultiplier = hasMaintenanceNoise && painSignals.length === 0 && solutionSignals.length === 0 ? 0.35 : 1;
  const score = roundScore(Math.max(0, Math.min(1, (painWeight + solutionWeight + eventWeight + domainWeight) * maintenanceMultiplier)));
  let label = "bad_fit";

  if (hasDomainFit && score >= 0.75 && painSignals.length >= 2) {
    label = "burning_problem";
  } else if (hasDomainFit && solutionSignals.length > 0 && score >= 0.4) {
    label = "solution_seeking";
  } else if (hasMaintenanceNoise && painSignals.length === 0 && solutionSignals.length === 0) {
    label = "maintenance_noise";
  } else if (hasDomainFit) {
    label = "technical_fit_only";
  }

  return {
    label,
    score,
    pain_signals: unique([...painSignals, ...solutionSignals]),
    reasons: unique([
      ...painSignals,
      ...solutionSignals,
      ...(hasDomainFit ? ["domain fit"] : []),
      ...(hasMaintenanceNoise ? ["maintenance noise"] : [])
    ])
  };
}

function matchedRuleLabels(text, rules) {
  return rules
    .filter((rule) => ruleMatches(text, rule))
    .map((rule) => rule.label);
}

function ruleMatches(text, rule) {
  const matchedPatterns = rule.patterns.filter((pattern) => includesPhrase(text, pattern));
  if (matchedPatterns.length === 0) return false;
  if (
    rule.label === "production impact" &&
    matchedPatterns.every((pattern) => pattern === "production") &&
    includesPhrase(text, "production ready")
  ) {
    return false;
  }
  return true;
}

function includesPhrase(text, pattern) {
  const normalize = (value) =>
    normalizeText(value)
      .replace(/[^a-z0-9_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const textTokens = normalize(text).split(" ").filter(Boolean);
  const patternTokens = normalize(pattern).split(" ").filter(Boolean);
  if (patternTokens.length === 0 || textTokens.length < patternTokens.length) return false;
  for (let index = 0; index <= textTokens.length - patternTokens.length; index += 1) {
    const slice = textTokens.slice(index, index + patternTokens.length);
    if (slice.every((token, tokenIndex) => token === patternTokens[tokenIndex])) return true;
  }
  return false;
}

function painEventTypeWeight(type) {
  if (type === "issue") return 0.16;
  if (type === "technical_comment") return 0.12;
  if (type === "opened_pull_request") return 0.07;
  if (type === "merged_pull_request") return 0.04;
  if (type === "commit") return 0.03;
  return 0;
}

function roundScore(value) {
  return Math.round(value * 10000) / 10000;
}

function displayStackSignal(term) {
  const normalized = String(term).toLowerCase();
  const labels = {
    typescript: "TypeScript",
    react: "React",
    "next.js": "Next.js",
    node: "Node.js",
    postgres: "Postgres",
    sqlite: "SQLite",
    websocket: "WebSocket",
    serverless: "Serverless"
  };
  return labels[normalized] ?? term;
}

function termsEqual(left, right) {
  const normalize = (value) => normalizeText(value).replace(/[_\s]+/g, "");
  return normalize(left) === normalize(right);
}

function isBotLikeLogin(login) {
  const normalized = String(login ?? "").toLowerCase();
  return (
    normalized.endsWith("[bot]") ||
    normalized.endsWith("-bot") ||
    normalized.includes("renovate") ||
    normalized.includes("dependabot")
  );
}

function buildWhyRelevant(profile, repo, terms) {
  const merged = profile.recent_activity.find((event) => event.type === "merged_pull_request");
  const verb = merged ? "merged a recent PR" : "showed recent activity";
  return `${profile.engineer_login} ${verb} in ${repo.repo} around ${humanJoin(terms.slice(0, 4))}. The repo is classified as ${humanJoin(repo.categories.map((category) => category.label))}.`;
}

function topMatchedTerms(terms, recipe) {
  const preferred = recipe.positiveTerms.filter((term) => terms.includes(term));
  const rest = [...terms].filter((term) => !preferred.includes(term));
  return [...preferred, ...rest].slice(0, 10);
}

function allTerms(recipe) {
  return [
    ...recipe.positiveTerms,
    ...recipe.stackTerms,
    ...Object.values(recipe.categories).flatMap((category) => category.terms)
  ];
}

function isRecent(timestamp, since) {
  return Boolean(timestamp) && new Date(timestamp) >= since;
}

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/)[0];
}

function negativePenalty(profile, recipe) {
  let penalty = 0;
  const normalized = normalizeText(profile.profile_text);
  for (const term of recipe.negativeTerms) {
    if (normalized.includes(normalizeText(term).replace(/\s+/g, "_"))) penalty += 8;
  }
  const docsOnly = profile.recent_activity.every((event) => normalizeText(event.title).includes("docs") || normalizeText(event.title).includes("readme"));
  if (docsOnly) penalty += 25;
  return penalty;
}

function lowPainPenalty(profile) {
  const painScore = maxPainScore(profile.recent_activity);
  if (painScore >= 0.55) return 0;
  const hasOnlyRoutineImplementation = profile.recent_activity.every((event) =>
    ["merged_pull_request", "commit"].includes(event.type)
  );
  return hasOnlyRoutineImplementation ? 18 : 8;
}

function maxPainScore(activity) {
  if (!Array.isArray(activity) || activity.length === 0) return 0;
  return roundScore(Math.max(0, ...activity.map((event) => event.pain_score ?? 0)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function recencyScore(timestamp, now) {
  const ageDays = (now.getTime() - new Date(timestamp).getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 8;
  if (ageDays <= 90) return 5;
  return 0;
}

function humanJoin(values) {
  const clean = values.filter(Boolean);
  if (clean.length === 0) return "relevant sync/database work";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean.at(-1)}`;
}

const BUYER_PAIN_RULES = [
  { label: "cannot connect", patterns: ["can't connect", "cannot connect", "cannot call", "can't call"] },
  { label: "blocked", patterns: ["blocked", "blocking", "stuck"] },
  { label: "broken", patterns: ["broken", "breaks", "not working", "does not work", "doesn't work"] },
  { label: "data loss", patterns: ["data loss", "lost data", "lose realtime updates", "loses realtime updates"] },
  { label: "dropped connection", patterns: ["dropped connection", "drops websocket", "drops updates", "disconnect", "disconnects"] },
  { label: "error", patterns: ["error", "exception", "rejected", "rejects", "crash", "crashes"] },
  { label: "failure", patterns: ["fail", "fails", "failure", "failing"] },
  { label: "flaky", patterns: ["flaky", "unstable", "intermittent"] },
  { label: "production impact", patterns: ["production", "customers", "users lose", "users cannot"] },
  { label: "race condition", patterns: ["race", "race condition"] },
  { label: "reconnect failure", patterns: ["reconnect", "reconnects fail", "reconnect handling"] },
  { label: "regression", patterns: ["regression", "no longer"] },
  { label: "stale data", patterns: ["stale data", "stale cache", "stale query"] },
  { label: "timeout", patterns: ["timeout", "timed out"] },
  { label: "workaround", patterns: ["workaround", "hack around"] }
];

const SOLUTION_SEEKING_RULES = [
  { label: "alternative intent", patterns: ["alternative", "replacement", "replace", "migrate from"] },
  { label: "complexity pain", patterns: ["too complex", "simpler", "hard to manage", "less backend complexity"] },
  { label: "solution seeking", patterns: ["looking for", "is there a way", "how do i", "how can i", "any way to"] }
];

const MAINTENANCE_NOISE_RULES = [
  { label: "docs", patterns: ["docs", "documentation", "readme", "guide", "tutorial"] },
  { label: "dependency chore", patterns: ["dependabot", "renovate", "bump", "upgrade dependency", "deps"] },
  { label: "formatting", patterns: ["format", "lint", "typo", "copy", "screenshot", "snapshot"] },
  { label: "demo", patterns: ["demo", "example", "sample"] }
];
