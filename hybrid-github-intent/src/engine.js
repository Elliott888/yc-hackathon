import path from "node:path";
import { fileURLToPath } from "node:url";
import { semanticSimilarity } from "../../neural-github-intent/src/embedding.js";
import { readJsonl } from "./jsonl.js";
import {
  compact,
  evidenceText,
  evidencePersuasionScore,
  evidenceTypeWeight,
  exactPhraseMatches,
  failureTermScore,
  fitTermScore,
  hasOwnCompanyEvidenceEmail,
  hasProfileInfo,
  implementationEvidencePenalty,
  isBot,
  isDocsOnlyEvidence,
  isFirstPartyProductRepo,
  isOwnCompanyMaintainer,
  negativeEvidencePenalty,
  normalizeLogin,
  painTermScore,
  parseEmailFromText,
  recencyScore
} from "./signals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

export const DEFAULT_STRUCTURED_ROOT = path.join(
  repoRoot,
  "github-intent-engine",
  "data",
  "workspaces",
  "fullstack-backend-pain-doubled"
);

export const DEFAULT_NEURAL_LEADS = path.join(
  repoRoot,
  "neural-github-intent",
  "data",
  "scored_leads.ndjson"
);

export async function searchHybrid({
  query,
  structuredRoot = DEFAULT_STRUCTURED_ROOT,
  neuralLeadsPath = DEFAULT_NEURAL_LEADS,
  limit = 10,
  now = new Date(),
  requireProfile = true
}) {
  if (!query || !query.trim()) {
    throw new Error("query is required");
  }

  const inputs = await loadHybridInputs({ structuredRoot, neuralLeadsPath });
  return rankHybridLeads({
    ...inputs,
    query,
    limit,
    now,
    requireProfile
  });
}

export async function loadHybridInputs({ structuredRoot, neuralLeadsPath }) {
  const processedDir = path.join(structuredRoot, "data", "processed");
  const rawDir = path.join(structuredRoot, "data", "raw");

  const [structuredLeads, neuralLeads, rawUsers] = await Promise.all([
    readJsonl(path.join(processedDir, "ranked_leads.jsonl")),
    readJsonl(neuralLeadsPath, { optional: true }),
    readJsonl(path.join(rawDir, "raw_users.jsonl"), { optional: true })
  ]);

  return {
    structuredLeads,
    neuralLeads,
    rawUsers
  };
}

export function rankHybridLeads({
  query,
  structuredLeads,
  neuralLeads,
  rawUsers = [],
  limit = 10,
  now = new Date(),
  requireProfile = true
}) {
  const usersByLogin = new Map(rawUsers.map((user) => [normalizeLogin(user.login), user]));
  const neuralByLogin = new Map(neuralLeads.map((lead) => [normalizeLogin(lead.engineer_login), lead]));
  const structuredByLogin = new Map(structuredLeads.map((lead) => [normalizeLogin(lead.engineer_login), lead]));
  const logins = new Set([...structuredByLogin.keys(), ...neuralByLogin.keys()]);
  const candidates = [];

  for (const login of logins) {
    const structured = structuredByLogin.get(login) ?? null;
    const neural = neuralByLogin.get(login) ?? null;
    const user = usersByLogin.get(login) ?? null;
    const lead = structured ?? leadFromNeural(neural);
    if (!lead) continue;

    const evidenceItems = normalizeEvidence(structured, neural);
    const repos = [...new Set(evidenceItems.map((item) => item.repo).filter(Boolean))];
    const exclusions = exclusionReasons({
      login: lead.engineer_login,
      user,
      lead,
      repos,
      evidenceItems,
      requireProfile
    });
    if (exclusions.length > 0) continue;

    const bestEvidence = chooseBestEvidence({ query, evidenceItems, now });
    if (
      !bestEvidence ||
      bestEvidence.hybrid_evidence_score < 0.35 ||
      bestEvidence.topical_fit_score < 0.12
    ) {
      continue;
    }

    const structuredScore = normalizeStructuredScore(structured);
    const neuralScore = normalizeNeuralScore(neural);
    const semanticScore = Math.max(bestEvidence.semantic_score, neural?.query_similarity ?? 0);
    const recency = recencyScore(bestEvidence.created_at, now);
    const depth = contributionDepthScore(structured, neural);
    const problemSpecificity = Math.max(
      bestEvidence.failure_score,
      bestEvidence.exact_phrase_matches.length > 0 ? 1 : 0,
      bestEvidence.pain_signals?.length > 0 ? 0.8 : 0
    );
    const persuasion = bestEvidence.persuasion_score;
    const finalScore =
      bestEvidence.hybrid_evidence_score * 4.2 +
      persuasion * 2.6 +
      problemSpecificity * 1.35 +
      structuredScore * 0.75 +
      neuralScore * 0.45 +
      semanticScore * 0.35 +
      recency * 0.7 +
      depth * 0.2 -
      bestEvidence.implementation_penalty * 0.8 -
      bestEvidence.negative_penalty * 0.9;

    const scoreOutOfTen = Math.max(0, Math.min(10, Number(finalScore.toFixed(2))));
    if (scoreOutOfTen < 4.5) continue;

    const email = bestAvailableEmail({ user, lead, neural, bestEvidence });

    candidates.push({
      engineer_login: lead.engineer_login,
      name: lead.name ?? neural?.name ?? user?.name ?? null,
      company: lead.company ?? neural?.company ?? user?.company ?? null,
      github_url: user?.url ?? neural?.github_url ?? `https://github.com/${lead.engineer_login}`,
      email,
      icp_fit_score: scoreOutOfTen,
      score_breakdown: {
        evidence: Number((bestEvidence.hybrid_evidence_score * 10).toFixed(2)),
        persuasion: Number((persuasion * 10).toFixed(2)),
        problem_specificity: Number((problemSpecificity * 10).toFixed(2)),
        semantic: Number((semanticScore * 10).toFixed(2)),
        structured: Number((structuredScore * 10).toFixed(2)),
        neural: Number((neuralScore * 10).toFixed(2)),
        recency: Number((recency * 10).toFixed(2)),
        depth: Number((depth * 10).toFixed(2))
      },
      trigger: publicEvidence(bestEvidence),
      exact_phrase_matches: bestEvidence.exact_phrase_matches,
      pain_signal: oneSentencePain(bestEvidence),
      why_this_is_high_intent: whyHighIntent(bestEvidence),
      why_convex_fits: whyConvexFits(bestEvidence),
      outreach: outreachForLead(lead, bestEvidence),
      sources_used: {
        structured: Boolean(structured),
        neural: Boolean(neural)
      }
    });
  }

  candidates.sort((left, right) => right.icp_fit_score - left.icp_fit_score);

  return {
    query,
    approach: "hybrid evidence-grounded semantic intent",
    input_counts: {
      structured_leads: structuredLeads.length,
      neural_leads: neuralLeads.length,
      raw_users: rawUsers.length
    },
    result_count: candidates.length,
    results: candidates.slice(0, limit)
  };
}

function leadFromNeural(neural) {
  if (!neural) return null;
  return {
    engineer_login: neural.engineer_login,
    name: neural.name ?? null,
    company: neural.company ?? null,
    score: neural.score ?? 0,
    evidence: [],
    primary_languages: [],
    last_active_at: neural.last_active_at,
    why_relevant: neural.why_relevant ?? "",
    outreach_angle: neural.outreach_angle ?? ""
  };
}

function normalizeEvidence(structured, neural) {
  const structuredEvidence = (structured?.evidence ?? []).map((item) => ({
    source: "structured",
    type: item.type,
    repo: item.repo,
    title: item.title,
    text: item.text,
    url: item.url,
    created_at: item.created_at,
    matched_topics: item.matched_topics ?? [],
    pain_signals: item.pain_signals ?? [],
    contribution_weight: item.contribution_weight ?? 0,
    code_signals: item.code_signals ?? []
  }));

  const neuralEvidence = (neural?.recent_activity ?? []).map((item) => ({
    source: "neural",
    type: item.type,
    repo: item.repo,
    title: item.title,
    text: item.snippet,
    url: item.url,
    created_at: item.occurred_at,
    matched_topics: item.matched_terms ?? [],
    pain_signals: item.pain_signals ?? [],
    contribution_weight: item.weight ?? 0,
    neural_pain_score: item.pain_score ?? 0,
    buyer_intent_label: item.buyer_intent_label
  }));

  return [...structuredEvidence, ...neuralEvidence].filter((item) => item.url);
}

function exclusionReasons({ login, user, lead, repos, evidenceItems, requireProfile }) {
  const reasons = [];
  if (isBot(login, user)) reasons.push("bot");
  if (requireProfile && !hasProfileInfo(user, lead)) reasons.push("no_profile_info");
  if (isFirstPartyProductRepo(repos)) reasons.push("first_party_product_repo");
  if (isOwnCompanyMaintainer(user, repos)) reasons.push("own_company_maintainer");
  if (hasOwnCompanyEvidenceEmail(evidenceItems)) reasons.push("own_company_evidence_email");
  if (isDocsOnlyEvidence(evidenceItems)) reasons.push("docs_only_activity");
  return reasons;
}

function chooseBestEvidence({ query, evidenceItems, now }) {
  let best = null;

  for (const item of evidenceItems) {
    const text = evidenceText(item);
    const semantic = semanticSimilarity(query, text);
    const pain = Math.max(painTermScore(text), item.neural_pain_score ?? 0, item.burning_problem_score ?? 0);
    const failure = failureTermScore(text);
    const fit = fitTermScore(text);
    const type = evidenceTypeWeight(item.type);
    const recency = recencyScore(item.created_at, now);
    const exactMatches = exactPhraseMatches(text, query);
    const exact = exactMatches.length > 0 ? 0.2 : 0;
    const codeSignalBoost = Math.min(0.2, (item.code_signals?.length ?? 0) * 0.05);
    const negativePenalty = negativeEvidencePenalty(text);
    const implementationPenalty = implementationEvidencePenalty(text, item.type);
    const persuasion = evidencePersuasionScore(text, item.type);
    const hybridEvidenceScore = Math.min(
      1,
      Math.max(
        0,
          semantic * 0.22 +
          pain * 0.18 +
          failure * 0.22 +
          fit * 0.18 +
          type * 0.14 +
          recency * 0.10 +
          persuasion * 0.15 +
          exact +
          codeSignalBoost -
          negativePenalty -
          implementationPenalty
      )
    );
    const directBuyerEvidenceBoost =
      item.type === "issue" || item.type === "comment" || item.type === "technical_comment" ? 0.18 : 0;
    const candidate = {
      ...item,
      semantic_score: semantic,
      pain_score: pain,
      failure_score: failure,
      persuasion_score: persuasion,
      topical_fit_score: Math.max(fit, semantic, exactMatches.length > 0 ? 1 : 0),
      type_score: type,
      recency_score: recency,
      exact_phrase_matches: exactMatches,
      negative_penalty: negativePenalty,
      implementation_penalty: implementationPenalty,
      hybrid_evidence_score: hybridEvidenceScore,
      selection_score: hybridEvidenceScore + persuasion * 0.25 + directBuyerEvidenceBoost - implementationPenalty
    };

    if (!best || candidate.selection_score > best.selection_score) {
      best = candidate;
    }
  }

  return best;
}

function normalizeStructuredScore(structured) {
  if (!structured) return 0;
  return Math.max(0, Math.min(1, Math.max((structured.score ?? 0) / 100, structured.burning_problem_score ?? 0)));
}

function normalizeNeuralScore(neural) {
  if (!neural) return 0;
  return Math.max(0, Math.min(1, Math.max((neural.score ?? 0) / 120, neural.answer_context?.burning_problem_score ?? 0)));
}

function contributionDepthScore(structured, neural) {
  const structuredDepth = Math.min(1, (structured?.evidence?.length ?? 0) / 6);
  const neuralDepth = Math.min(1, (neural?.recent_activity?.length ?? 0) / 6);
  return Math.max(structuredDepth, neuralDepth);
}

function bestAvailableEmail({ user, lead, neural, bestEvidence }) {
  const commitEmail = bestEvidence.type === "commit" ? parseEmailFromText(bestEvidence.text) : null;
  return {
    value: commitEmail ?? user?.email ?? lead?.email ?? neural?.email ?? null,
    source: commitEmail ? "commit_text" : user?.email ? "profile" : null,
    note: commitEmail
      ? "Parsed from stored commit text."
      : "Commit metadata email is not persisted in the current Track A artifacts."
  };
}

function publicEvidence(evidence) {
  return {
    source: evidence.source,
    type: evidence.type,
    repo: evidence.repo,
    title: compact(evidence.title, 180),
    url: evidence.url,
    occurred_at: evidence.created_at,
    matched_topics: evidence.matched_topics ?? [],
    pain_signals: evidence.pain_signals ?? [],
    snippet: compact(evidence.text, 260)
  };
}

function oneSentencePain(evidence) {
  if (evidence.exact_phrase_matches.length > 0) {
    return `They explicitly mention ${evidence.exact_phrase_matches.join(", ")} in GitHub evidence.`;
  }
  if (evidence.type === "issue" || evidence.type === "comment" || evidence.type === "technical_comment") {
    return `They reported a concrete failure: ${compact(evidence.title, 100)}.`;
  }
  if (evidence.pain_score >= 0.75) {
    return `Their GitHub activity describes a concrete failure around ${compact(evidence.title, 90)}.`;
  }
  if (evidence.semantic_score >= 0.25) {
    return `Their GitHub activity is semantically close to the requested backend/realtime pain: ${compact(evidence.title, 90)}.`;
  }
  return `Their GitHub activity is relevant but should be manually reviewed: ${compact(evidence.title, 90)}.`;
}

function whyHighIntent(evidence) {
  const text = evidenceText(evidence).toLowerCase();
  const directReport =
    evidence.type === "issue" || evidence.type === "comment" || evidence.type === "technical_comment";
  const productionSignal = [
    "production",
    "users",
    "user-facing",
    "self-hosted",
    "reproduction",
    "what happened",
    "symptom",
    "steps to reproduce"
  ].some((term) => text.includes(term));
  const severeFailure = [
    "delivers nothing",
    "stalls",
    "data loss",
    "overwrites",
    "breaks",
    "crash",
    "diverge",
    "race",
    "races",
    "timeout",
    "dropped",
    "stale",
    "fails"
  ].some((term) => text.includes(term));

  if (directReport && productionSignal && severeFailure) {
    return "High intent because this is a direct user report of a severe, reproducible backend/realtime failure.";
  }
  if (directReport && severeFailure) {
    return "High intent because the person is publicly reporting a concrete failure in their current backend/realtime stack.";
  }
  if (productionSignal && severeFailure) {
    return "High intent because the evidence ties a severe failure to production or self-hosted usage.";
  }
  return "Moderate intent because the evidence is technically relevant, but should be manually qualified before outreach.";
}

function whyConvexFits(evidence) {
  const text = evidenceText(evidence).toLowerCase();
  if (text.includes("websocket") || text.includes("reconnect") || text.includes("realtime")) {
    return "Convex can replace custom realtime/WebSocket plumbing with a TypeScript-native reactive backend.";
  }
  if (text.includes("cache") || text.includes("invalidation") || text.includes("stale")) {
    return "Convex can reduce client cache invalidation and stale server-state handling by making backend queries reactive.";
  }
  if (text.includes("firebase") || text.includes("supabase") || text.includes("self-hosted")) {
    return "Convex is positioned as a simpler backend-as-a-service alternative for teams tired of stitching infrastructure together.";
  }
  return "Convex may fit if they are building interactive product state that needs durable backend data and live client updates.";
}

function outreachForLead(lead, evidence) {
  const title = compact(evidence.title, 110);
  const repo = evidence.repo;
  return [
    `Saw your GitHub activity in ${repo} around "${title}".`,
    `${whyHighIntent(evidence)}`,
    `${whyConvexFits(evidence)}`
  ];
}
