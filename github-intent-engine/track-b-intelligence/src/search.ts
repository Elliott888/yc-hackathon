import { cosineSimilarity, embedText, queryCoverageSimilarity } from "./embedding.js";
import { codeSignalScoreForQuery, detectCodeSignals, mergeCodeSignals } from "./code-signals.js";
import { pathsFor, readJsonl } from "./io.js";
import { painPointEvidenceFromContexts } from "./pain-point-evidence.js";
import { readRecipe } from "./recipe.js";
import { extractTopics, includesTerm, keywordScore, matchTerms, normalizeText } from "./text.js";
import type {
  AnswerContext,
  BaselineComparisonResponse,
  CodeSignal,
  CodeSignalContext,
  EvidenceRecord,
  EngineerEmbedding,
  ProductFitExplanation,
  ProblemContext,
  QueryPlan,
  Recipe,
  RankingMode,
  RankedLead,
  SearchResponse,
  SearchResultLead
} from "./types.js";

export type SearchOptions = {
  rootDir?: string;
  query: string;
  limit?: number;
};

export async function searchLeads(options: SearchOptions): Promise<SearchResponse> {
  return searchLeadsWithMode({ ...options, mode: "intent" });
}

export async function compareSearchBaselines(
  options: SearchOptions
): Promise<BaselineComparisonResponse> {
  const limit = options.limit ?? 10;
  const keyword = await searchLeadsWithMode({ ...options, limit, mode: "keyword" });
  const semantic = await searchLeadsWithMode({ ...options, limit, mode: "semantic" });
  const intent = await searchLeadsWithMode({ ...options, limit, mode: "intent" });

  return {
    query_plan: intent.query_plan,
    baselines: {
      keyword: {
        label: "Keyword search",
        results: keyword.results
      },
      semantic: {
        label: "Semantic search",
        results: semantic.results
      },
      intent: {
        label: "Intent ranking",
        results: intent.results
      }
    }
  };
}

async function searchLeadsWithMode(
  options: SearchOptions & { mode: RankingMode }
): Promise<SearchResponse> {
  const rootDir = options.rootDir;
  const paths = pathsFor(rootDir);
  const recipe = await readRecipe(rootDir);
  const queryPlan = buildQueryPlan(options.query, recipe);
  const explicitQueryTopics = filterAlternativeVendorNoise(options.query, [
    ...extractTopics(options.query, recipe),
    ...matchTerms(options.query, recipe.repo_categories),
    ...deriveQuerySignalTerms(options.query, recipe)
  ]);
  const buyerFilteredExplicitTopics = filterBuyerSpecificTopicNoise(options.query, explicitQueryTopics);
  const leads = await readJsonl<RankedLead>(paths.processed.rankedLeads);
  const embeddings = await readJsonl<EngineerEmbedding>(paths.processed.engineerEmbeddings, true);
  const embeddingByLogin = new Map(embeddings.map((embedding) => [embedding.engineer_login, embedding]));
  const dimensions = embeddings[0]?.dimensions ?? [
    ...recipe.topic_terms,
    ...recipe.repo_categories,
    ...recipe.strong_stacks,
    recipe.target_product
  ];
  const expandedQuery = expandQuery(options.query);
  const queryVector = embedText(expandedQuery, dimensions);

  const results = leads
    .map((lead): SearchResultLead => {
      const embedding = embeddingByLogin.get(lead.engineer_login);
      const semanticScore = embedding
        ? Math.max(
            cosineSimilarity(queryVector, embedding.vector),
            queryCoverageSimilarity(queryVector, embedding.vector)
          )
        : 0;
      const keyword = keywordScore(
        `${lead.semantic_document} ${lead.why_relevant} ${lead.outreach_angle}`,
        options.query
      );
      const topic = Math.max(
        topicCoverageScore(lead, queryPlan.topics),
        topicCoverageScore(lead, buyerFilteredExplicitTopics)
      );
      const evidenceTopics = buyerFilteredExplicitTopics.length > 0 ? buyerFilteredExplicitTopics : queryPlan.topics;
      const evidence = sortEvidenceForQuery(lead.evidence, evidenceTopics, options.query, recipe)
        .map(enrichEvidenceCodeSignals);
      const evidenceScore = evidenceCoverageScore(evidence, evidenceTopics, options.query);
      const topProblem = topProblemContext(evidence, options.query, recipe);
      const problemScore = topProblem?.score ?? 0;
      const neuralScore = neuralIntentScore(lead, evidence);
      const codeSignals = sortCodeSignalsForQuery(options.query, codeSignalsForLead(lead, evidence));
      const codeSignalScore = codeSignalScoreForQuery(options.query, codeSignals);
      const firstPartyRepo = isFirstPartyLead(lead, recipe);
      const finalScore = finalScoreForMode({
        mode: options.mode,
        leadScore: lead.score,
        semanticScore,
        keywordScore: keyword,
        topicScore: topic,
        evidenceScore,
        problemScore,
        codeSignalScore,
        neuralScore,
        evidenceFirst: requiresEvidenceMatch(options.query),
        problemRequired: prefersBurningProblemEvidence(options.query),
        firstPartyPenalty:
          firstPartyRepo && isCustomerDiscoveryQuery(options.query)
            ? 75
            : 0
      });
      const { semantic_document: _semanticDocument, ...publicLead } = lead;

      return {
        ...publicLead,
        evidence,
        code_signals: codeSignals,
        answer_context: enrichAnswerContext(lead.answer_context, lead, evidence, codeSignals, topProblem, recipe),
        keyword_score: Number(keyword.toFixed(4)),
        semantic_score: Number(semanticScore.toFixed(4)),
        topic_score: Number(topic.toFixed(4)),
        evidence_score: Number(evidenceScore.toFixed(4)),
        problem_score: Number(problemScore.toFixed(4)),
        code_signal_score: Number(codeSignalScore.toFixed(4)),
        top_problem: topProblem,
        first_party_repo: firstPartyRepo,
        final_score: Number(finalScore.toFixed(2))
      };
    })
    .sort((left, right) => {
      if (right.final_score !== left.final_score) {
        return right.final_score - left.final_score;
      }
      return left.engineer_login.localeCompare(right.engineer_login);
    })
    .slice(0, options.limit ?? 10);

  return {
    query_plan: queryPlan,
    results
  };
}

function finalScoreForMode(input: {
  mode: RankingMode;
  leadScore: number;
  semanticScore: number;
  keywordScore: number;
  topicScore: number;
  evidenceScore: number;
  problemScore: number;
  codeSignalScore: number;
  neuralScore: number;
  evidenceFirst: boolean;
  problemRequired: boolean;
  firstPartyPenalty: number;
}): number {
  if (input.mode === "keyword") {
    return input.keywordScore * 100 + input.leadScore * 0.01 - input.firstPartyPenalty;
  }
  if (input.mode === "semantic") {
    return input.semanticScore * 100 + input.leadScore * 0.01 - input.firstPartyPenalty;
  }

  if (input.evidenceFirst) {
    const missingEvidencePenalty = input.evidenceScore === 0 ? 65 : input.evidenceScore < 0.25 ? 25 : 0;
    const neuralEvidenceBoost = input.evidenceScore === 0 ? 0 : input.neuralScore * 30;
    const effectiveProblemScore = input.evidenceScore === 0 ? input.problemScore * 0.2 : input.problemScore;
    const effectiveCodeSignalScore = effectiveCodeSignalScoreForPainQuery(
      input.codeSignalScore,
      input.problemScore,
      input.problemRequired
    );
    const weakProblemPenalty = input.problemRequired ? weakProblemPenaltyFor(input.problemScore) : 0;
    return (
      input.leadScore * 0.3 +
      input.semanticScore * 15 +
      input.keywordScore * 8 +
      input.topicScore * 18 +
      input.evidenceScore * 110 -
      missingEvidencePenalty +
      effectiveProblemScore * 90 +
      effectiveCodeSignalScore * 55 +
      neuralEvidenceBoost -
      weakProblemPenalty -
      input.firstPartyPenalty
    );
  }
  const effectiveProblemScore = input.evidenceScore === 0 ? input.problemScore * 0.2 : input.problemScore;
  const effectiveCodeSignalScore = effectiveCodeSignalScoreForPainQuery(
    input.codeSignalScore,
    input.problemScore,
    input.problemRequired
  );
  const weakProblemPenalty = input.problemRequired ? weakProblemPenaltyFor(input.problemScore) : 0;

  return (
    input.leadScore +
    input.semanticScore * 20 +
    input.keywordScore * 10 +
    input.topicScore * 20 +
    input.evidenceScore * 35 +
    effectiveProblemScore * 35 +
    effectiveCodeSignalScore * 22 +
    input.neuralScore * 15 -
    weakProblemPenalty -
    input.firstPartyPenalty
  );
}

function effectiveCodeSignalScoreForPainQuery(
  codeSignalScore: number,
  problemScore: number,
  problemRequired: boolean
): number {
  if (!problemRequired) {
    return codeSignalScore;
  }
  if (problemScore < 0.35) {
    return codeSignalScore * 0.1;
  }
  if (problemScore < 0.5) {
    return codeSignalScore * 0.35;
  }
  if (problemScore < 0.65) {
    return codeSignalScore * 0.7;
  }
  return codeSignalScore;
}

function neuralIntentScore(lead: RankedLead, evidence: EvidenceRecord[]): number {
  const evidenceScore = Math.max(
    0,
    ...evidence
      .map((item) => item.neural_intent_score)
      .filter((score): score is number => Number.isFinite(score))
  );
  return Math.max(lead.neural_intent_score ?? 0, evidenceScore);
}

function requiresEvidenceMatch(query: string): boolean {
  return [
    "talking about",
    "discussing",
    "mentioning",
    "mentions",
    "wanting",
    "asking for",
    "actively contributing",
    "contributing to",
    "building",
    "working on",
    "worked on",
    "using"
  ].some((term) => includesTerm(query, term));
}

function prefersBurningProblemEvidence(query: string): boolean {
  return [
    "alternative",
    "alternatives",
    "asking for",
    "bug",
    "broken",
    "cache invalidation",
    "can't",
    "cannot",
    "discussing",
    "failure",
    "fails",
    "looking for",
    "simpler",
    "talking about",
    "wanting"
  ].some((term) => includesTerm(query, term));
}

function weakProblemPenaltyFor(problemScore: number): number {
  if (problemScore === 0) return 55;
  if (problemScore < 0.35) return 42;
  if (problemScore < 0.5) return 28;
  if (problemScore < 0.65) return 12;
  return 0;
}

function evidenceCoverageScore(evidence: EvidenceRecord[], queryTopics: string[], query: string): number {
  if (queryTopics.length === 0 || evidence.length === 0) {
    return 0;
  }
  return Math.max(...evidence.map((item) => evidenceRelevanceScore(item, queryTopics, query)));
}

function sortEvidenceForQuery(
  evidence: EvidenceRecord[],
  queryTopics: string[],
  query: string,
  recipe: Recipe
): EvidenceRecord[] {
  const evidenceFirst = requiresEvidenceMatch(query);
  return [...evidence].sort((left, right) => {
    if (evidenceFirst) {
      const problemScoreDiff =
        problemContextForEvidence(right, query, recipe).score -
        problemContextForEvidence(left, query, recipe).score;
      if (Math.abs(problemScoreDiff) >= 0.12) {
        return problemScoreDiff;
      }
    }
    const scoreDiff =
      evidenceRelevanceScore(right, queryTopics, query) -
      evidenceRelevanceScore(left, queryTopics, query);
    if (scoreDiff !== 0) return scoreDiff;
    if (right.contribution_weight !== left.contribution_weight) {
      return right.contribution_weight - left.contribution_weight;
    }
    return right.created_at.localeCompare(left.created_at);
  });
}

function evidenceRelevanceScore(evidence: EvidenceRecord, queryTopics: string[], query: string): number {
  const topicCoverage = evidenceTopicCoverage(evidence, queryTopics);
  const evidenceText = `${evidence.title} ${evidence.text}`;
  const titleLexicalCoverage =
    queryTopics.length === 0
      ? 0
      : queryTopics.filter((topic) => includesTerm(evidence.title, topic)).length / queryTopics.length;
  const lexicalCoverage =
    queryTopics.length === 0
      ? 0
      : queryTopics.filter((topic) => includesTerm(evidenceText, topic)).length / queryTopics.length;
  const alternativeVendorBoost = alternativeVendorProblemBoost(evidence, query);
  const codeSignalBoost = codeSignalScoreForQuery(query, codeSignalsForEvidence(evidence)) * 0.22;
  if (
    topicCoverage === 0 &&
    lexicalCoverage === 0 &&
    titleLexicalCoverage === 0 &&
    alternativeVendorBoost === 0 &&
    codeSignalBoost === 0
  ) {
    return 0;
  }
  const typeBoost =
    evidence.type === "pull_request" || evidence.type === "issue"
      ? 0.12
      : evidence.type === "review"
        ? 0.08
        : evidence.type === "review_comment"
          ? 0.06
          : evidence.type === "comment"
            ? 0.04
            : 0.02;
  const depthBoost = Math.min(0.08, evidence.contribution_weight / 100);
  const promptSpecificBoost = includesTerm(query, "talking about") && lexicalCoverage > 0 ? 0.08 : 0;
  const penaltyMultiplier = evidencePenaltyMultiplier(evidence, titleLexicalCoverage);
  const querySpecificMultiplier = querySpecificNoiseMultiplier(evidence, query);

  const score =
    (topicCoverage * 0.42 +
      lexicalCoverage * 0.18 +
      titleLexicalCoverage * 0.25 +
      alternativeVendorBoost +
      codeSignalBoost +
      typeBoost +
      depthBoost +
      promptSpecificBoost) *
    penaltyMultiplier *
    querySpecificMultiplier;
  return Number(Math.max(0, Math.min(1, score)).toFixed(4));
}

function evidenceTopicCoverage(evidence: EvidenceRecord, queryTopics: string[]): number {
  if (queryTopics.length === 0) {
    return 0;
  }
  const matched = new Set(evidence.matched_topics.map((topic) => topic.toLowerCase()));
  const covered = queryTopics.filter((topic) => matched.has(topic.toLowerCase())).length;
  return covered / queryTopics.length;
}

function evidencePenaltyMultiplier(evidence: EvidenceRecord, titleLexicalCoverage: number): number {
  const text = normalizeEvidenceText(evidence);
  const titleWords = normalizeText(evidence.title).split(" ").filter(Boolean);
  const weakSignals = [
    "docs",
    "documentation",
    "guide",
    "tutorial",
    "example",
    "demo",
    "typo",
    "chore",
    "deps",
    "lint",
    "format",
    "snapshot",
    "unit test warning",
    "deprecation",
    "observability",
    "list",
    "log tail",
    "metrics",
    "sentry",
    "otel",
    "tail session",
    "telemetry",
    "logs explorer",
    "wrangler tail",
    "benchmark"
  ];
  const hasWeakSignal = weakSignals.some((signal) => includesTerm(text, signal));
  const isMergeCommit = evidence.type === "commit" && includesTerm(text, "merge pull request");
  const hasThinTitle = titleWords.length <= 2 && titleLexicalCoverage === 0;

  if (hasThinTitle && hasWeakSignal) {
    return 0.15;
  }
  if (hasThinTitle) {
    return 0.25;
  }
  if (hasWeakSignal && isMergeCommit) {
    return 0.2;
  }
  if (hasWeakSignal) {
    return 0.35;
  }
  if (isMergeCommit) {
    return 0.6;
  }
  if (titleLexicalCoverage === 0) {
    return 0.75;
  }
  return 1;
}

function querySpecificNoiseMultiplier(evidence: EvidenceRecord, query: string): number {
  if (!isBackendStatePainDiscoveryQuery(query)) {
    return 1;
  }

  const text = `${evidence.repo} ${normalizeEvidenceText(evidence)}`;
  const hasCoreFit = hasConvexBackendStateFit(text, query);
  let multiplier = 1;

  if (hasGenericProtocolTransportNoise(text) && !hasCoreFit) {
    multiplier *= 0.32;
  }
  if (hasAuthOrUiOnlyNoise(text, query) && !hasCoreFit) {
    multiplier *= 0.42;
  }

  return multiplier;
}

function isBackendStatePainDiscoveryQuery(query: string): boolean {
  return [
    "cache invalidation",
    "backend state",
    "reactive data",
    "reactive database",
    "live query",
    "Firebase alternatives",
    "Supabase alternatives",
    "simpler full-stack backend",
    "full-stack backend",
    "backend-as-a-service",
    "Convex"
  ].some((term) => includesTerm(query, term));
}

function hasConvexBackendStateFit(text: string, query: string): boolean {
  const directBackendPainTerms = [
    "cache invalidation",
    "invalidation",
    "stale data",
    "stale state",
    "backend state",
    "reactive data",
    "reactive database",
    "live query",
    "data connect",
    "@refresh",
    "postgres_changes",
    "replication",
    "database sync",
    "local-first",
    "offline-first",
    "optimistic update",
    "mutation",
    "clientSubscriptions",
    "subscription",
    "subscriptions"
  ];
  if (directBackendPainTerms.some((term) => includesTerm(text, term))) {
    return true;
  }

  const productSpecificBackendTerms = ["Firebase", "Supabase", "InstantDB", "PowerSync", "Liveblocks", "Replicache"];
  if (
    productSpecificBackendTerms.some((term) => includesTerm(text, term)) &&
    [
      "reconnect",
      "replication",
      "realtime updates",
      "real-time updates",
      "live query",
      "data loss",
      "stale",
      "checkpoint",
      "checksum",
      "room storage",
      "backend state"
    ].some((term) => includesTerm(text, term))
  ) {
    return true;
  }

  if (!includesTerm(text, "WebSocket")) {
    return false;
  }

  const websocketProductPainTerms = [
    "cannot connect",
    "can't connect",
    "disconnect",
    "dropped connection",
    "reconnect",
    "data loss",
    "realtime updates",
    "real-time updates",
    "updates stop",
    "updates are blocked",
    "customers lose",
    "users lose",
    "production users",
    "self-hosted sandbox",
    "oversized mutation",
    "close code"
  ];
  return websocketProductPainTerms.some((term) => includesTerm(text, term)) && includesTerm(query, "WebSocket");
}

function hasGenericProtocolTransportNoise(text: string): boolean {
  const protocolTerms = [
    "MCP",
    "modelcontextprotocol",
    "stdio",
    "SSE",
    "EventSource",
    "POST transport",
    "protocol test",
    "transport compatibility",
    "response headers",
    "response header",
    "upgrade headers"
  ];
  return protocolTerms.some((term) => includesTerm(text, term));
}

function hasAuthOrUiOnlyNoise(text: string, query: string): boolean {
  if (includesTerm(query, "auth") || includesTerm(query, "authentication") || includesTerm(query, "login")) {
    return false;
  }
  const authTerms = [
    "auth",
    "authentication",
    "authorization",
    "login",
    "logout",
    "session",
    "passkey",
    "permission",
    "permissions",
    "rbac"
  ];
  const uiTerms = [
    "editor UI",
    "UI",
    "settings",
    "panel",
    "advisory",
    "disclosure",
    "security",
    "reverse proxy"
  ];
  const hasAuth = authTerms.some((term) => includesTerm(text, term));
  const hasUiOrAdminSurface = uiTerms.some((term) => includesTerm(text, term));
  return hasAuth && hasUiOrAdminSurface;
}

function normalizeEvidenceText(evidence: EvidenceRecord): string {
  return `${evidence.title} ${evidence.text}`;
}

function topProblemContext(
  evidence: EvidenceRecord[],
  query: string,
  recipe: Recipe
): ProblemContext | null {
  const contexts = evidence
    .map((item) => problemContextForEvidence(item, query, recipe))
    .filter((context) => context.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.severity.localeCompare(left.severity);
    });
  return contexts[0] ?? null;
}

function problemContextForEvidence(
  evidence: EvidenceRecord,
  query: string,
  recipe: Recipe
): ProblemContext {
  const text = normalizeEvidenceText(evidence);
  const queryText = normalizeText(query);
  const codeSignals = codeSignalsForEvidence(evidence);
  const codeSignalQueryScore = codeSignalScoreForQuery(query, codeSignals);
  const matchedSignals = [
    ...new Set([
      ...problemSignalLabels(text),
      ...(evidence.pain_signals ?? []),
      ...codeSignals
        .filter((signal) => codeSignalQueryScore > 0 || signal.score >= 0.45)
        .map((signal) => signal.label)
    ])
  ];
  const matchedTools = currentToolsForEvidence(text, recipe);
  const weakMultiplier = evidencePenaltyMultiplier(evidence, 1);
  const hasQueryFit =
    evidence.matched_topics.length > 0 ||
    matchedTools.some((tool) => queryText.includes(normalizeText(tool))) ||
    queryMentionsAlternativeToTool(query, matchedTools) ||
    codeSignalQueryScore >= 0.25;
  const importedScore = evidence.burning_problem_score ?? 0;
  if (matchedSignals.length === 0 && importedScore <= 0 && codeSignalQueryScore === 0) {
    return {
      score: 0,
      severity: "none",
      summary: compactProblemSummary(text),
      evidence_url: evidence.url,
      repo: evidence.repo,
      title: evidence.title,
      signals: [],
      current_tools: matchedTools.slice(0, 8),
      code_signals: codeSignals
    };
  }
  const signalWeight = Math.min(0.75, matchedSignals.length * 0.18);
  const typeWeight = evidence.type === "issue" ? 0.16 : evidence.type === "pull_request" ? 0.11 : 0.07;
  const toolWeight = matchedTools.length > 0 ? 0.08 : 0;
  const queryFitWeight = hasQueryFit ? 0.1 : 0;
  const codeSignalWeight = Math.min(0.28, codeSignalQueryScore * 0.28);
  const queryFitMultiplier = problemQueryFitMultiplier(evidence, query, recipe);
  const querySpecificMultiplier = querySpecificNoiseMultiplier(evidence, query);
  const heuristicScore =
    (signalWeight + typeWeight + toolWeight + queryFitWeight + codeSignalWeight) *
    weakMultiplier *
    problemNoiseMultiplier(text) *
    queryFitMultiplier *
    querySpecificMultiplier;
  const rawScore = Math.max(importedScore * queryFitMultiplier * querySpecificMultiplier, heuristicScore);
  const score = Number(Math.max(0, Math.min(1, rawScore)).toFixed(4));

  return {
    score,
    severity: severityForProblemScore(score),
    summary: compactProblemSummary(text),
    evidence_url: evidence.url,
    repo: evidence.repo,
    title: evidence.title,
    signals: [...new Set(matchedSignals)].slice(0, 8),
    current_tools: matchedTools.slice(0, 8),
    code_signals: codeSignals
  };
}

function currentToolsForEvidence(text: string, recipe: Recipe): string[] {
  const toolTerms = [
    recipe.target_product,
    ...recipe.strong_stacks,
    "Appwrite",
    "Firebase",
    "Liveblocks",
    "Parse",
    "PostHog",
    "Supabase",
    "WebSocket"
  ];
  return [...new Set(toolTerms.filter((tool) => includesTerm(text, tool)))];
}

function queryMentionsAlternativeToTool(query: string, tools: string[]): boolean {
  const normalizedQuery = normalizeText(query);
  return tools.some((tool) => {
    const normalizedTool = normalizeText(tool);
    return (
      normalizedQuery.includes(`${normalizedTool} alternative`) ||
      normalizedQuery.includes(`${normalizedTool} alternatives`) ||
      normalizedQuery.includes(`alternative to ${normalizedTool}`)
    );
  });
}

function severityForProblemScore(score: number): ProblemContext["severity"] {
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  if (score > 0) return "low";
  return "none";
}

function compactProblemSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 260);
}

const PROBLEM_SIGNAL_RULES = [
  { label: "cannot connect", patterns: ["can't connect", "cannot connect", "can't call", "cannot call"] },
  { label: "blocked", patterns: ["blocked", "blocking", "stuck"] },
  { label: "broken", patterns: ["broken", "breaks", "not working"] },
  { label: "data loss", patterns: ["data loss", "lost data", "lose realtime updates"] },
  { label: "dropped connection", patterns: ["dropped connection", "drops websocket", "disconnect", "disconnects"] },
  { label: "error", patterns: ["error", "exception", "rejected", "rejects"] },
  { label: "failure", patterns: ["fail", "fails", "failure", "failing"] },
  { label: "flaky", patterns: ["flaky", "unstable", "intermittent"] },
  { label: "production impact", patterns: ["production", "customers", "users lose", "users cannot"] },
  { label: "race condition", patterns: ["race", "race condition"] },
  { label: "reconnect failure", patterns: ["reconnect", "reconnects fail", "reconnect handling"] },
  { label: "regression", patterns: ["regression", "no longer"] },
  { label: "timeout", patterns: ["timeout", "timed out"] },
  { label: "workaround", patterns: ["workaround", "hack around"] },
  { label: "alternative intent", patterns: ["alternative", "migrate from", "replacement"] },
  { label: "complexity pain", patterns: ["too complex", "simpler", "hard to manage"] },
  { label: "performance pain", patterns: ["lag", "behind", "slow", "too large"] }
];

function problemSignalLabels(text: string): string[] {
  return PROBLEM_SIGNAL_RULES
    .filter((rule) => problemRuleMatches(text, rule))
    .map((rule) => rule.label);
}

function problemRuleMatches(
  text: string,
  rule: { label: string; patterns: string[] }
): boolean {
  const matchedPatterns = rule.patterns.filter((pattern) => includesTerm(text, pattern));
  if (matchedPatterns.length === 0) {
    return false;
  }
  if (
    rule.label === "production impact" &&
    matchedPatterns.every((pattern) => pattern === "production") &&
    includesTerm(text, "production ready")
  ) {
    return false;
  }
  return true;
}

function alternativeVendorProblemBoost(evidence: EvidenceRecord, query: string): number {
  const evidenceText = `${evidence.repo} ${normalizeEvidenceText(evidence)}`;
  if (problemSignalLabels(evidenceText).length === 0) {
    return 0;
  }
  const alternativeVendors = ["Firebase", "Supabase"];
  const hasAlternativeVendorPain = alternativeVendors.some(
    (vendor) =>
      queryMentionsAlternativeToTool(query, [vendor]) &&
      includesTerm(evidenceText, vendor) &&
      hasAlternativeBackendPain(evidenceText)
  );
  return hasAlternativeVendorPain ? 0.24 : 0;
}

function problemQueryFitMultiplier(evidence: EvidenceRecord, query: string, recipe: Recipe): number {
  const text = `${evidence.repo} ${normalizeEvidenceText(evidence)}`;
  if (directProblemQueryMatch(text, query)) {
    return 1;
  }

  const isAlternativeVendorEvidence = ["Firebase", "Supabase"].some(
    (vendor) => queryMentionsAlternativeToTool(query, [vendor]) && includesTerm(text, vendor)
  );
  if (isAlternativeVendorEvidence) {
    return hasAlternativeBackendPain(text) ? 1 : 0.45;
  }

  if (
    includesTerm(query, "full-stack backend") &&
    ["backend", "serverless", "full-stack", "database sync", "realtime"].some((term) => includesTerm(text, term))
  ) {
    return 1;
  }

  if (recipe.topic_terms.some((topic) => includesTerm(query, topic) && includesTerm(text, topic))) {
    return 1;
  }

  return 0.7;
}

function directProblemQueryMatch(text: string, query: string): boolean {
  const directTerms = [
    "cache invalidation",
    "invalidation",
    "WebSocket",
    "websocket",
    "WebSocket infrastructure",
    "simpler full-stack backend",
    "full-stack backend"
  ];
  return directTerms.some((term) => includesTerm(query, term) && includesTerm(text, term));
}

function hasAlternativeBackendPain(text: string): boolean {
  return [
    "cache invalidation",
    "invalidation",
    "live query",
    "postgres_changes",
    "realtime",
    "real-time",
    "reconnect",
    "replication",
    "subscription",
    "sync",
    "websocket",
    "WebSocket"
  ].some((term) => includesTerm(text, term));
}

function problemNoiseMultiplier(text: string): number {
  const hasFeatureRequestSignal = [
    "add",
    "feature request",
    "option",
    "support"
  ].some((signal) => includesTerm(text, signal));
  const hasMaintenanceSignal = [
    "benchmark",
    "bump",
    "chore",
    "ci",
    "dependency",
    "deps",
    "docs",
    "format",
    "lint",
    "lockfile",
    "package",
    "refactor",
    "unit test",
    "upgrade"
  ].some((signal) => includesTerm(text, signal));
  const hasDirectProductionImpact =
    includesTerm(text, "production") && !includesTerm(text, "production ready");
  const hasCustomerImpact = hasDirectProductionImpact || [
    "can't connect",
    "cannot connect",
    "customers",
    "data loss",
    "users cannot",
    "users lose"
  ].some((signal) => includesTerm(text, signal));
  if (hasFeatureRequestSignal && !hasCustomerImpact) {
    return 0.55;
  }
  if (!hasMaintenanceSignal) {
    return 1;
  }
  return hasCustomerImpact ? 0.75 : 0.35;
}

function isFirstPartyLead(lead: RankedLead, recipe: Recipe): boolean {
  const normalizedProduct = normalizeText(recipe.target_product).replace(/\s+/g, "");
  if (!normalizedProduct || normalizedProduct.length < 3) return false;
  return [...lead.top_repos, ...lead.evidence.map((item) => item.repo)].some((repo) => {
    const normalizedRepo = normalizeText(repo).replace(/\s+/g, "");
    return normalizedRepo.includes(normalizedProduct);
  });
}

function isCustomerDiscoveryQuery(query: string): boolean {
  return (
    includesTerm(query, "find") &&
    (includesTerm(query, "founder") ||
      includesTerm(query, "founders") ||
      includesTerm(query, "engineer") ||
      includesTerm(query, "engineers") ||
      includesTerm(query, "potential customers") ||
      includesTerm(query, "users"))
  );
}

function topicCoverageScore(lead: RankedLead, queryTopics: string[]): number {
  if (queryTopics.length === 0) {
    return 0;
  }

  const leadTopics = new Set([
    ...lead.top_topics.map((topic) => topic.toLowerCase()),
    ...lead.evidence.flatMap((evidence) =>
      evidence.matched_topics.map((topic) => topic.toLowerCase())
    )
  ]);
  const covered = queryTopics.filter((topic) => leadTopics.has(topic.toLowerCase())).length;
  return covered / queryTopics.length;
}

function enrichEvidenceCodeSignals(evidence: EvidenceRecord): EvidenceRecord {
  const signals = mergeCodeSignals([
    ...(evidence.code_signals ?? []),
    ...detectCodeSignals(`${evidence.title} ${evidence.text}`)
  ]);
  return signals.length === 0 ? evidence : { ...evidence, code_signals: signals };
}

function codeSignalsForEvidence(evidence: EvidenceRecord): CodeSignal[] {
  return evidence.code_signals ?? detectCodeSignals(`${evidence.title} ${evidence.text}`);
}

function codeSignalsForLead(lead: RankedLead, evidence: EvidenceRecord[]): CodeSignal[] {
  return mergeCodeSignals([
    ...(lead.code_signals ?? []),
    ...(lead.answer_context?.code_signals ?? []),
    ...evidence.flatMap((item) => codeSignalsForEvidence(item)),
    ...detectCodeSignals(lead.semantic_document)
  ]);
}

function sortCodeSignalsForQuery(query: string, signals: CodeSignal[]): CodeSignal[] {
  return [...signals].sort((left, right) => {
    const rightQueryScore = codeSignalScoreForQuery(query, [right]);
    const leftQueryScore = codeSignalScoreForQuery(query, [left]);
    if (rightQueryScore !== leftQueryScore) {
      return rightQueryScore - leftQueryScore;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.label.localeCompare(right.label);
  });
}

function enrichAnswerContext(
  answerContext: AnswerContext | undefined,
  lead: RankedLead,
  evidence: EvidenceRecord[],
  codeSignals: CodeSignal[],
  topProblem: ProblemContext | null,
  recipe: Recipe
): AnswerContext {
  const codeSignalContext = uniqueCodeSignalContext([
    ...(answerContext?.code_signal_context ?? []),
    ...codeSignalContextForEvidence(evidence)
  ]).slice(0, 10);
  const painPointEvidence = painPointEvidenceFromContexts(codeSignalContext);
  const problemSignals = [
    ...(answerContext?.problem_signals ?? []),
    ...lead.top_topics,
    ...codeSignals.map((signal) => signal.label)
  ];
  const codeHook =
    codeSignals.length === 0
      ? []
      : [
          `Lead with ${codeSignals
            .slice(0, 3)
            .map((signal) => signal.label)
            .join(", ")}; these are visible code-shape pains, not just repo topics.`
        ];

  return {
    problem_signals: [...new Set(problemSignals.filter(Boolean))].slice(0, 12),
    ...(answerContext?.pain_signals ? { pain_signals: answerContext.pain_signals } : {}),
    ...(answerContext?.burning_problem_score === undefined
      ? {}
      : { burning_problem_score: answerContext.burning_problem_score }),
    code_signals: codeSignals,
    code_signal_context: codeSignalContext,
    pain_point_evidence: painPointEvidence,
    product_fit_explanations: productFitExplanations(
      answerContext,
      topProblem,
      evidence,
      codeSignals,
      painPointEvidence,
      recipe
    ),
    stack_signals: [
      ...new Set([...(answerContext?.stack_signals ?? []), ...lead.primary_languages].filter(Boolean))
    ].slice(0, 12),
    repo_signals: [...new Set([...(answerContext?.repo_signals ?? []), ...lead.repo_categories].filter(Boolean))].slice(0, 12),
    evidence_snippets: evidence.slice(0, 5).map(toAnswerEvidenceSnippet),
    outreach_hooks: [...new Set([...(answerContext?.outreach_hooks ?? []), ...codeHook].filter(Boolean))].slice(0, 5)
  };
}

function productFitExplanations(
  answerContext: AnswerContext | undefined,
  topProblem: ProblemContext | null,
  evidence: EvidenceRecord[],
  codeSignals: CodeSignal[],
  painPointEvidence: AnswerContext["pain_point_evidence"],
  recipe: Recipe
): ProductFitExplanation[] {
  if (!topProblem || topProblem.score < 0.45) {
    return answerContext?.product_fit_explanations ?? [];
  }

  const sourceEvidence = evidence.find((item) => item.url === topProblem.evidence_url) ?? evidence[0];
  if (!sourceEvidence) {
    return answerContext?.product_fit_explanations ?? [];
  }

  const sourceText = compactProblemSummary(`${sourceEvidence.title}. ${sourceEvidence.text}`);
  const urgencySignals = [
    ...new Set([
      topProblem.severity,
      ...topProblem.signals,
      ...(sourceEvidence.pain_signals ?? [])
    ].filter(Boolean))
  ].slice(0, 10);
  const productFitSignals = [
    ...new Set([
      ...(topProblem.code_signals?.length ? topProblem.code_signals : codeSignals).map((signal) => signal.label),
      ...topProblem.current_tools,
      ...sourceEvidence.matched_topics
    ].filter(Boolean))
  ].slice(0, 10);
  const explanationSignals = topProblem.code_signals?.length ? topProblem.code_signals : codeSignals;
  const sourcePainEvidence = (painPointEvidence ?? []).filter(
    (item) => item.evidence_url === sourceEvidence.url || item.evidence_url === topProblem.evidence_url
  );
  const relevantPainEvidence = sourcePainEvidence.length > 0 ? sourcePainEvidence : painPointEvidence ?? [];

  return [
    {
      target_product: recipe.target_product,
      severity: topProblem.severity,
      burning_problem: topProblem.title,
      why_it_is_burning: burningProblemExplanation(topProblem, sourceEvidence, sourceText),
      why_product_can_help: productFitExplanation(recipe.target_product, topProblem, explanationSignals),
      evidence_title: sourceEvidence.title,
      evidence_url: sourceEvidence.url,
      urgency_signals: urgencySignals,
      product_fit_signals: productFitSignals,
      detected_pain_points: [...new Set(relevantPainEvidence.map((item) => item.pain_point))].slice(0, 6),
      code_manifestations: [...new Set(relevantPainEvidence.map((item) => item.code_manifestation))].slice(0, 6)
    }
  ];
}

function burningProblemExplanation(
  problem: ProblemContext,
  evidence: EvidenceRecord,
  evidenceSummary: string
): string {
  const severityPhrase =
    problem.severity === "high"
      ? "high-severity"
      : problem.severity === "medium"
        ? "medium-severity"
        : "low-severity";
  const impact = impactExplanation(problem.signals);
  const evidenceDetail = compactExplanationSnippet(evidence.text || evidenceSummary);
  const signalText = problem.signals.length > 0 ? ` The urgency signals are ${problem.signals.slice(0, 5).join(", ")}.` : "";
  return `This is a ${severityPhrase} buying signal because ${impact} The evidence says: ${evidenceDetail}.${signalText}`;
}

function productFitExplanation(
  targetProduct: string,
  problem: ProblemContext,
  codeSignals: CodeSignal[]
): string {
  const reasons = productReasonsForSignals(codeSignals);
  const fallback =
    `${targetProduct} is relevant because it combines backend functions, database state, and reactive client updates in one model, ` +
    "which reduces the custom sync, API, and cache-invalidation plumbing shown in this GitHub evidence.";
  if (reasons.length === 0) {
    return fallback;
  }
  return `${targetProduct} fits for this lead. ${capitalizeSentences(reasons).join(" ")} This maps directly to the reported problem: ${problem.title}.`;
}

function impactExplanation(signals: string[]): string {
  const normalizedSignals = new Set(signals.map((signal) => normalizeText(signal)));
  const impacts: string[] = [];
  if (normalizedSignals.has("cannot connect")) {
    impacts.push("users cannot connect to the product path");
  }
  if (normalizedSignals.has("data loss")) {
    impacts.push("the failure risks lost or overwritten user data");
  }
  if (normalizedSignals.has("production impact")) {
    impacts.push("the issue is affecting production users or customers");
  }
  if (normalizedSignals.has("timeout") || normalizedSignals.has("performance pain")) {
    impacts.push("latency or timeouts are breaking the user experience");
  }
  if (normalizedSignals.has("reconnect failure") || normalizedSignals.has("dropped connection")) {
    impacts.push("reconnect and subscription reliability are failing");
  }
  if (normalizedSignals.has("failure") || normalizedSignals.has("error") || normalizedSignals.has("broken")) {
    impacts.push("the GitHub evidence describes an actual failure mode");
  }
  if (impacts.length === 0) {
    impacts.push("the GitHub evidence reports a real implementation problem, not generic interest");
  }
  return `${impacts.slice(0, 3).join("; ")}.`;
}

function compactExplanationSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function capitalizeSentences(sentences: string[]): string[] {
  return sentences.map((sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1));
}

function productReasonsForSignals(codeSignals: CodeSignal[]): string[] {
  const ids = new Set(codeSignals.map((signal) => signal.id));
  const reasons: string[] = [];
  if (ids.has("realtime_product_critical")) {
    reasons.push("its reactive data model avoids hand-rolled WebSocket subscription, reconnect, and realtime update plumbing.");
  }
  if (ids.has("frontend_server_state_sync")) {
    reasons.push("it removes much of the manual useEffect(fetch), cache invalidation, and optimistic rollback code needed to keep UI state synced.");
  }
  if (ids.has("interactive_app_state")) {
    reasons.push("interactive shared state can live in the backend and update subscribed clients immediately.");
  }
  if (ids.has("multi_user_state")) {
    reasons.push("team, workspace, and permission-sensitive state can be centralized instead of duplicated across client and API layers.");
  }
  if (ids.has("crud_plumbing")) {
    reasons.push("server functions and typed backend state reduce thin CRUD/API route boilerplate.");
  }
  if (ids.has("type_drift")) {
    reasons.push("a TypeScript-first backend path reduces drift between database, API, and frontend types.");
  }
  if (ids.has("schema_churn")) {
    reasons.push("fast-changing product data models are easier to iterate on when backend logic and state stay together.");
  }
  if (ids.has("job_workflow_state")) {
    reasons.push("workflow state can be represented beside durable backend data instead of scattered across queues, cron, and webhook handlers.");
  }
  if (ids.has("ai_durable_state")) {
    reasons.push("agent runs, tool calls, and conversation state need durable backend state with live UI updates.");
  }
  return reasons.slice(0, 4);
}

function toAnswerEvidenceSnippet(evidence: EvidenceRecord): AnswerContext["evidence_snippets"][number] {
  return {
    type: evidence.type,
    repo: evidence.repo,
    title: evidence.title,
    url: evidence.url,
    occurred_at: evidence.created_at,
    matched_terms: evidence.matched_topics,
    ...(evidence.burning_problem_score === undefined ? {} : { pain_score: evidence.burning_problem_score }),
    ...(evidence.buyer_intent_label ? { buyer_intent_label: evidence.buyer_intent_label } : {}),
    ...(evidence.pain_signals ? { pain_signals: evidence.pain_signals } : {}),
    code_signals: codeSignalsForEvidence(evidence),
    snippet: compactProblemSummary(`${evidence.title} ${evidence.text}`)
  };
}

function codeSignalContextForEvidence(evidence: EvidenceRecord[]): CodeSignalContext[] {
  return evidence
    .flatMap((item) =>
      codeSignalsForEvidence(item).map((signal) => ({
        ...signal,
        repo: item.repo,
        title: item.title,
        url: item.url
      }))
    )
    .sort((left, right) => right.score - left.score);
}

function uniqueCodeSignalContext(contexts: CodeSignalContext[]): CodeSignalContext[] {
  const seen = new Set<string>();
  const uniqueContexts: CodeSignalContext[] = [];
  for (const context of contexts) {
    const key = `${context.id}:${context.url}`;
    if (seen.has(key)) {
      const existing = uniqueContexts.find((item) => `${item.id}:${item.url}` === key);
      if (existing) {
        existing.code_manifestation = existing.code_manifestation || context.code_manifestation;
        existing.matched_terms = [...new Set([...existing.matched_terms, ...context.matched_terms])].slice(0, 10);
        existing.score = Math.max(existing.score, context.score);
      }
      continue;
    }
    seen.add(key);
    uniqueContexts.push(context);
  }
  return uniqueContexts.sort((left, right) => right.score - left.score);
}

function expandQuery(query: string): string {
  const expansions: string[] = [];
  if (includesTerm(query, "reactive database") || includesTerm(query, "reactive data")) {
    expansions.push("live query subscriptions reactive data cache invalidation backend state");
  }
  if (includesTerm(query, "realtime") || includesTerm(query, "real-time") || includesTerm(query, "sync")) {
    expansions.push("sync replication realtime live query subscriptions WebSocket Postgres changefeed");
  }
  if (includesTerm(query, "backend-as-a-service") || includesTerm(query, "baas")) {
    expansions.push("backend-as-a-service serverless backend serverless function backend state");
  }
  if (includesTerm(query, "firebase alternative") || includesTerm(query, "firebase alternatives")) {
    expansions.push(
      "backend-as-a-service serverless backend reactive database realtime WebSocket auth storage functions simpler full-stack backend"
    );
  }
  if (includesTerm(query, "supabase alternative") || includesTerm(query, "supabase alternatives")) {
    expansions.push(
      "backend-as-a-service serverless backend reactive database realtime sync Postgres auth storage functions simpler full-stack backend"
    );
  }
  if (
    includesTerm(query, "full-stack backend") ||
    includesTerm(query, "full stack backend") ||
    includesTerm(query, "simpler backend")
  ) {
    expansions.push("backend state serverless function backend-as-a-service serverless backend reactive data");
  }
  if (includesTerm(query, "WebSocket infrastructure")) {
    expansions.push("WebSocket realtime subscriptions sync infrastructure");
  }
  if (includesTerm(query, "cache invalidation")) {
    expansions.push("cache invalidation reactive data live query backend state");
  }
  if (
    includesTerm(query, "state sync") ||
    includesTerm(query, "server state") ||
    includesTerm(query, "React Query") ||
    includesTerm(query, "optimistic update")
  ) {
    expansions.push("frontend server state sync useEffect fetch React Query invalidation optimistic rollback cache update");
  }
  if (includesTerm(query, "workflow state") || includesTerm(query, "job state")) {
    expansions.push("pending running failed done retries cron cleanup webhook idempotency background job progress");
  }
  if (includesTerm(query, "AI durable state") || includesTerm(query, "agent run")) {
    expansions.push("agent runs tool calls conversations transcripts eval traces workflow steps generated artifacts");
  }
  if (includesTerm(query, "Convex")) {
    expansions.push("reactive data live query subscriptions backend state serverless function");
  }
  return [query, ...expansions].join(" ");
}

export function buildQueryPlan(query: string, recipe: Awaited<ReturnType<typeof readRecipe>>): QueryPlan {
  const expanded = expandQuery(query);
  const topics = [
    ...extractTopics(expanded, recipe),
    ...matchTerms(expanded, recipe.repo_categories),
    ...deriveQuerySignalTerms(query, recipe)
  ];
  const filteredTopics = filterBuyerSpecificTopicNoise(
    query,
    filterAlternativeVendorNoise(query, [...new Set(topics)])
  );

  return {
    raw_query: query,
    target_entity: targetEntityForQuery(query, recipe.target_entity),
    target_product: recipe.target_product,
    time_window_days: recipe.time_window_days,
    categories: matchTerms(expanded, recipe.repo_categories),
    topics: filteredTopics,
    indexes_used: [
      "repo_category",
      "contributor_activity",
      "contribution_topic",
      "dependency_manifest",
      "pr_review",
      "ci_failure",
      "code_shape_signal",
      "pain_point_code_manifestation",
      "semantic_vector",
      "keyword",
      "lead_score",
      "evidence"
    ]
  };
}

function filterBuyerSpecificTopicNoise(query: string, topics: string[]): string[] {
  const lowerQuery = query.toLowerCase();
  const hasAnalyticsIntent =
    /\b(product|web|real[-\s]?time)?\s*analytics\b/.test(lowerQuery) ||
    /\bposthog\b|\bgrowthbook\b|\brudderstack\b|\bclickhouse\b|\battribution\b|\bfunnels?\b|\bfeature flags?\b|\bevent ingestion\b/.test(
      lowerQuery
    );
  const hasAiDevtoolIntent =
    /\bopenai\b|\bclaude\b|\bcodex\b|\bmcp\b|\blangchain\b|\bvercel ai\b|\btool calling\b|\bagent runs?\b|\bvector stores?\b|\bevals?\b/.test(
      lowerQuery
    );
  const hasWorkflowIntent =
    /\bspreadsheets?\b|\bcrm\b|\benrichment\b|\bno-code\b|\boutbound\b|\bgtm\b|\bsales workflow\b/.test(
      lowerQuery
    );

  if (!hasAnalyticsIntent && !hasAiDevtoolIntent && !hasWorkflowIntent) {
    return [...new Set(topics)];
  }

  return [...new Set(topics)].filter((topic) => !BROAD_CONVEX_TOPICS.has(topic.toLowerCase()));
}

const BROAD_CONVEX_TOPICS = new Set([
  "replication",
  "live query",
  "sync",
  "realtime",
  "subscriptions",
  "websocket",
  "reactive data",
  "sqlite sync",
  "postgres changefeed",
  "serverless function",
  "backend state",
  "reactive database",
  "backend-as-a-service",
  "serverless backend"
]);

function filterAlternativeVendorNoise(query: string, topics: string[]): string[] {
  const lowerQuery = query.toLowerCase();
  const exactVendorTopicsToRemove = new Set<string>();
  if (/\bfirebase\s+alternatives?\b|\balternative\s+to\s+firebase\b/.test(lowerQuery)) {
    exactVendorTopicsToRemove.add("firebase");
  }
  if (/\bsupabase\s+alternatives?\b|\balternative\s+to\s+supabase\b/.test(lowerQuery)) {
    exactVendorTopicsToRemove.add("supabase");
  }
  if (exactVendorTopicsToRemove.size === 0) {
    return [...new Set(topics)];
  }
  return [...new Set(topics)].filter(
    (topic) => !exactVendorTopicsToRemove.has(topic.toLowerCase())
  );
}

function deriveQuerySignalTerms(query: string, recipe: Awaited<ReturnType<typeof readRecipe>>): string[] {
  const recipeTerms = new Set(
    [...recipe.topic_terms, ...recipe.repo_categories, ...recipe.strong_stacks, recipe.target_product].map((term) =>
      normalizeText(term)
    )
  );
  const terms = new Set<string>();

  for (const segment of query.split(/,|;|\bor\b|\band\b/iu)) {
    const cleaned = canonicalDynamicTerm(cleanQuerySegment(segment));
    if (isUsefulDynamicTerm(cleaned, recipeTerms)) {
      terms.add(cleaned);
    }
  }

  for (const token of query.match(/[A-Za-z][A-Za-z0-9.+#-]{2,}/gu) ?? []) {
    const cleaned = canonicalDynamicTerm(token);
    if (isUsefulDynamicToken(cleaned, recipeTerms)) {
      terms.add(cleaned);
    }
  }

  return [...terms].slice(0, 24);
}

function cleanQuerySegment(segment: string): string {
  return segment
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\b(find|me|people|users|teams|companies|founders?|engineers?|developers?|maintainers?)\b/giu, " ")
    .replace(/\b(on|in|from|across|github|who|that|have|has|been|are|is|were|was)\b/giu, " ")
    .replace(/\b(talking about|discussing|mentioning|mentions|wanting|looking for|asking for)\b/giu, " ")
    .replace(/\b(actively contributing|contributing|working|worked|building|using|use)\b/giu, " ")
    .replace(/\bfor\s+[A-Z][A-Za-z0-9-]*$/u, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function canonicalDynamicTerm(term: string): string {
  let cleaned = term
    .replace(/^[\s"'`]+|[\s"'`]+$/gu, "")
    .replace(/[.,;:!?]+$/gu, "")
    .replace(/^[^A-Za-z0-9.+#-]+|[^A-Za-z0-9.+#-]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  cleaned = trimStopwordEdges(cleaned);
  return cleaned
    .replace(/[.,;:!?]+$/gu, "")
    .replace(/^[^A-Za-z0-9.+#-]+|[^A-Za-z0-9.+#-]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function trimStopwordEdges(term: string): string {
  const words = term.split(/\s+/gu).filter(Boolean);
  while (words.length > 1 && DYNAMIC_QUERY_STOPWORDS.has(normalizeText(words[0]))) {
    words.shift();
  }
  while (words.length > 1 && DYNAMIC_QUERY_STOPWORDS.has(normalizeText(words[words.length - 1]))) {
    words.pop();
  }
  return words.join(" ");
}

function isUsefulDynamicTerm(term: string, recipeTerms: Set<string>): boolean {
  const normalized = normalizeText(term);
  if (!normalized || recipeTerms.has(normalized) || DYNAMIC_QUERY_STOPWORDS.has(normalized)) {
    return false;
  }

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 1) {
    return isUsefulDynamicToken(term, recipeTerms);
  }
  return words.length <= 5 && words.some((word) => !DYNAMIC_QUERY_STOPWORDS.has(word));
}

function isUsefulDynamicToken(term: string, recipeTerms: Set<string>): boolean {
  const normalized = normalizeText(term);
  if (!normalized || recipeTerms.has(normalized) || DYNAMIC_QUERY_STOPWORDS.has(normalized)) {
    return false;
  }
  if (DYNAMIC_QUERY_NAMED_TERMS.has(normalized)) {
    return true;
  }
  const hasAcronymShape = /^[A-Z0-9]{2,}$/u.test(term);
  const hasInternalCapital = /[a-z][A-Z]/u.test(term);
  const hasTechnicalPunctuation = /[.+#]/u.test(term);
  return term.length >= 3 && (hasAcronymShape || hasInternalCapital || hasTechnicalPunctuation);
}

const DYNAMIC_QUERY_STOPWORDS = new Set([
  "a",
  "about",
  "active",
  "an",
  "around",
  "better",
  "code",
  "coding",
  "company",
  "customer",
  "customers",
  "devtool",
  "devtools",
  "find",
  "engineer",
  "engineers",
  "founder",
  "founders",
  "github",
  "lead",
  "leads",
  "open",
  "people",
  "product",
  "repo",
  "repos",
  "repositories",
  "repository",
  "simple",
  "simpler",
  "team",
  "teams",
  "talk",
  "talking",
  "the",
  "to",
  "tool",
  "tools",
  "want",
  "wanting"
]);

const DYNAMIC_QUERY_NAMED_TERMS = new Set([
  "claude",
  "codex",
  "cursor",
  "firebase",
  "growthbook",
  "langchain",
  "llamaindex",
  "mcp",
  "openai",
  "posthog",
  "supabase",
  "vercel"
]);

function targetEntityForQuery(query: string, fallback: string): string {
  const wantsFounders = includesTerm(query, "founder") || includesTerm(query, "founders");
  const wantsEngineers = includesTerm(query, "engineer") || includesTerm(query, "engineers");
  if (wantsFounders && wantsEngineers) return "founder_or_engineer";
  if (wantsFounders) return "founder";
  return fallback;
}
