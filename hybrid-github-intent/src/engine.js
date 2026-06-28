import path from "node:path";
import { fileURLToPath } from "node:url";
import { semanticSimilarity } from "../../neural-github-intent/src/embedding.js";
import { queryConceptTerms, resolveBuyerProfile } from "./buyer-profiles.js";
import { readJsonl } from "./jsonl.js";
import {
  buyerVoiceScore,
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

export const DEFAULT_INDEX_SOURCES = [
  {
    id: "fullstack-backend-pain-doubled",
    structuredRoot: DEFAULT_STRUCTURED_ROOT,
    neuralLeadsPath: DEFAULT_NEURAL_LEADS
  },
  {
    id: "fullstack-backend-pain-upgraded",
    structuredRoot: path.join(repoRoot, "github-intent-engine", "data", "workspaces", "fullstack-backend-pain-upgraded"),
    neuralLeadsPath: DEFAULT_NEURAL_LEADS
  },
  {
    id: "devtool-buyers",
    structuredRoot: path.join(repoRoot, "github-intent-engine", "data", "workspaces", "devtool-buyers"),
    neuralLeadsPath: DEFAULT_NEURAL_LEADS
  },
  {
    id: "fullstack-backend-pain-1000",
    structuredRoot: path.join(repoRoot, "github-intent-engine", "data", "workspaces", "fullstack-backend-pain-1000"),
    neuralLeadsPath: path.join(repoRoot, "neural-github-intent", "data-track-a-1000", "scored_leads.ndjson")
  }
];

export async function searchHybrid({
  query,
  buyer,
  buyerProfile,
  structuredRoot = DEFAULT_STRUCTURED_ROOT,
  neuralLeadsPath = DEFAULT_NEURAL_LEADS,
  indexSources,
  useAllIndexes = false,
  limit = 10,
  now = new Date(),
  requireProfile = true
}) {
  const resolvedBuyerProfile = buyerProfile ?? resolveBuyerProfile({ buyer, query });
  const resolvedQuery = query?.trim() || resolvedBuyerProfile.query;

  if (!resolvedQuery || !resolvedQuery.trim()) {
    throw new Error("query is required");
  }

  const inputs = useAllIndexes || indexSources
    ? await loadHybridInputsFromSources(indexSources ?? DEFAULT_INDEX_SOURCES)
    : await loadHybridInputs({ structuredRoot, neuralLeadsPath });
  return rankHybridLeads({
    ...inputs,
    query: resolvedQuery,
    buyerProfile: resolvedBuyerProfile,
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
    rawUsers,
    indexSources: [
      {
        id: path.basename(structuredRoot),
        structuredRoot,
        neuralLeadsPath
      }
    ]
  };
}

export async function loadHybridInputsFromSources(indexSources) {
  const loaded = await Promise.all(indexSources.map(async (source) => {
    const inputs = await loadHybridInputs(source);
    return {
      ...inputs,
      source
    };
  }));

  return mergeHybridInputs(loaded);
}

function mergeHybridInputs(loadedInputs) {
  const structuredByLogin = new Map();
  const neuralByLogin = new Map();
  const usersByLogin = new Map();
  const sourceSummaries = [];
  let structuredInputCount = 0;
  let neuralInputCount = 0;
  let rawUserInputCount = 0;

  for (const inputs of loadedInputs) {
    structuredInputCount += inputs.structuredLeads.length;
    neuralInputCount += inputs.neuralLeads.length;
    rawUserInputCount += inputs.rawUsers.length;
    sourceSummaries.push({
      id: inputs.source?.id ?? inputs.indexSources?.[0]?.id ?? "unknown",
      structured_leads: inputs.structuredLeads.length,
      neural_leads: inputs.neuralLeads.length,
      raw_users: inputs.rawUsers.length
    });

    for (const user of inputs.rawUsers) {
      const login = normalizeLogin(user.login);
      if (!login) continue;
      usersByLogin.set(login, { ...(usersByLogin.get(login) ?? {}), ...user });
    }

    for (const lead of inputs.structuredLeads) {
      const login = normalizeLogin(lead.engineer_login);
      if (!login) continue;
      structuredByLogin.set(login, mergeStructuredLead(structuredByLogin.get(login), lead));
    }

    for (const lead of inputs.neuralLeads) {
      const login = normalizeLogin(lead.engineer_login);
      if (!login) continue;
      neuralByLogin.set(login, mergeNeuralLead(neuralByLogin.get(login), lead));
    }
  }

  return {
    structuredLeads: [...structuredByLogin.values()],
    neuralLeads: [...neuralByLogin.values()],
    rawUsers: [...usersByLogin.values()],
    indexSources: sourceSummaries,
    inputTotals: {
      structured_leads: structuredInputCount,
      neural_leads: neuralInputCount,
      raw_users: rawUserInputCount
    }
  };
}

function mergeStructuredLead(existing, next) {
  if (!existing) return { ...next, evidence: [...(next.evidence ?? [])] };
  return {
    ...existing,
    ...next,
    name: existing.name ?? next.name ?? null,
    company: existing.company ?? next.company ?? null,
    score: Math.max(existing.score ?? 0, next.score ?? 0),
    burning_problem_score: Math.max(existing.burning_problem_score ?? 0, next.burning_problem_score ?? 0),
    evidence: dedupeEvidence([...(existing.evidence ?? []), ...(next.evidence ?? [])])
  };
}

function mergeNeuralLead(existing, next) {
  if (!existing) return { ...next, recent_activity: [...(next.recent_activity ?? [])] };
  return {
    ...existing,
    ...next,
    name: existing.name ?? next.name ?? null,
    company: existing.company ?? next.company ?? null,
    score: Math.max(existing.score ?? 0, next.score ?? 0),
    query_similarity: Math.max(existing.query_similarity ?? 0, next.query_similarity ?? 0),
    answer_context: {
      ...(existing.answer_context ?? {}),
      ...(next.answer_context ?? {}),
      burning_problem_score: Math.max(
        existing.answer_context?.burning_problem_score ?? 0,
        next.answer_context?.burning_problem_score ?? 0
      )
    },
    recent_activity: dedupeEvidence([...(existing.recent_activity ?? []), ...(next.recent_activity ?? [])], "url")
  };
}

function dedupeEvidence(items, urlKey = "url") {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item?.[urlKey] ?? `${item?.repo}:${item?.type}:${item?.title}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function rankHybridLeads({
  query,
  buyer,
  buyerProfile,
  structuredLeads,
  neuralLeads,
  rawUsers = [],
  indexSources = [],
  inputTotals = null,
  limit = 10,
  now = new Date(),
  requireProfile = true
}) {
  const resolvedBuyerProfile = buyerProfile ?? resolveBuyerProfile({ buyer, query });
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

    const bestEvidence = chooseBestEvidence({
      query,
      evidenceItems,
      now,
      buyerProfile: resolvedBuyerProfile
    });
    if (
      !bestEvidence ||
      bestEvidence.hybrid_evidence_score < 0.35 ||
      bestEvidence.topical_fit_score < 0.12 ||
      !passesProductFitGate(bestEvidence, resolvedBuyerProfile)
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

    const quality = leadQuality({
      scoreOutOfTen,
      evidence: bestEvidence,
      productFit: bestEvidence.product_fit_score,
      persuasion
    });

    candidates.push({
      engineer_login: lead.engineer_login,
      name: lead.name ?? neural?.name ?? user?.name ?? null,
      company: lead.company ?? neural?.company ?? user?.company ?? null,
      github_url: user?.url ?? neural?.github_url ?? `https://github.com/${lead.engineer_login}`,
      email,
      icp_fit_score: scoreOutOfTen,
      score_breakdown: {
        evidence: Number((bestEvidence.hybrid_evidence_score * 10).toFixed(2)),
        product_fit: Number((bestEvidence.product_fit_score * 10).toFixed(2)),
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
      pain_signal: oneSentencePain(bestEvidence, resolvedBuyerProfile),
      why_this_is_high_intent: whyHighIntent(bestEvidence, resolvedBuyerProfile),
      quality_label: quality.label,
      quality_reason: quality.reason,
      product_fit: {
        id: resolvedBuyerProfile.id,
        label: resolvedBuyerProfile.label,
        product: resolvedBuyerProfile.product
      },
      why_product_fits: whyProductFits(bestEvidence, resolvedBuyerProfile),
      ...(resolvedBuyerProfile.id === "convex"
        ? { why_convex_fits: whyProductFits(bestEvidence, resolvedBuyerProfile) }
        : {}),
      outreach: outreachForLead(lead, bestEvidence, resolvedBuyerProfile),
      sources_used: {
        structured: Boolean(structured),
        neural: Boolean(neural)
      }
    });
  }

  candidates.sort((left, right) => right.icp_fit_score - left.icp_fit_score);
  const limitedResults = candidates.slice(0, limit);
  const qualitySummary = summarizeQuality(candidates);
  const coverageDiagnostics = coverageDiagnosticsFor({
    buyerProfile: resolvedBuyerProfile,
    resultCount: candidates.length,
    qualitySummary,
    topResults: limitedResults,
    indexSources
  });

  return {
    query,
    approach: "hybrid evidence-grounded semantic intent",
    buyer_profile: {
      id: resolvedBuyerProfile.id,
      label: resolvedBuyerProfile.label,
      product: resolvedBuyerProfile.product
    },
    input_counts: {
      structured_leads: inputTotals?.structured_leads ?? structuredLeads.length,
      neural_leads: inputTotals?.neural_leads ?? neuralLeads.length,
      raw_users: inputTotals?.raw_users ?? rawUsers.length,
      deduped_structured_leads: structuredLeads.length,
      deduped_neural_leads: neuralLeads.length,
      deduped_raw_users: rawUsers.length
    },
    index_sources: indexSources,
    quality_summary: qualitySummary,
    coverage_diagnostics: coverageDiagnostics,
    result_count: candidates.length,
    results: limitedResults
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

function chooseBestEvidence({ query, evidenceItems, now, buyerProfile }) {
  let best = null;

  for (const item of evidenceItems) {
    const text = evidenceText(item);
    const semantic = semanticSimilarity(query, text);
    const pain = Math.max(painTermScore(text), item.neural_pain_score ?? 0, item.burning_problem_score ?? 0);
    const failure = failureTermScore(text);
    const productFit = productFitTermScore(text, buyerProfile, query);
    const baseFit = buyerProfile?.id === "convex" ? fitTermScore(text) : 0;
    const fit = Math.max(baseFit, productFit);
    const type = evidenceTypeWeight(item.type);
    const recency = recencyScore(item.created_at, now);
    const exactMatches = exactPhraseMatches(text, query);
    const exact = exactMatches.length > 0 ? 0.2 : 0;
    const codeSignalBoost = Math.min(0.2, (item.code_signals?.length ?? 0) * 0.05);
    const negativePenalty = negativeEvidencePenalty(text);
    const implementationPenalty = implementationEvidencePenalty(text, item.type);
    const persuasion = Math.max(
      evidencePersuasionScore(text, item.type),
      Math.min(1, productFit * 0.42 + failure * 0.28 + buyerVoiceScore(text, item.type) * 0.3)
    );
    const hybridEvidenceScore = Math.min(
      1,
      Math.max(
        0,
          semantic * 0.22 +
          pain * 0.18 +
          failure * 0.22 +
          fit * 0.24 +
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
      product_fit_score: productFit,
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

function passesProductFitGate(evidence, buyerProfile) {
  if (!buyerProfile || buyerProfile.id === "custom") {
    return evidence.product_fit_score >= 0.08 || evidence.semantic_score >= 0.18 || evidence.exact_phrase_matches.length > 0;
  }
  if (buyerProfile.id === "convex") {
    return true;
  }
  return (
    evidence.product_fit_score >= 0.24 ||
    (evidence.product_fit_score >= 0.18 && evidence.semantic_score >= 0.32) ||
    evidence.exact_phrase_matches.length > 0
  );
}

function productFitTermScore(text, buyerProfile, query) {
  const terms = productFitTerms(buyerProfile, query);
  const normalized = String(text ?? "").toLowerCase();
  const hits = terms.filter((term) => term && textMatchesTerm(normalized, term));
  return Math.min(1, hits.length * 0.18);
}

function productFitTerms(buyerProfile, query) {
  if (buyerProfile && buyerProfile.id !== "custom") {
    return [...new Set((buyerProfile.fitTerms ?? []).map((term) => String(term ?? "").trim()).filter(Boolean))];
  }

  return [
    ...new Set([
      ...(buyerProfile?.fitTerms ?? []),
      ...queryConceptTerms(query)
    ].map((term) => String(term ?? "").trim()).filter(Boolean))
  ];
}

function textMatchesTerm(normalizedText, term) {
  const normalizedTerm = String(term ?? "").trim().toLowerCase();
  if (!normalizedTerm) return false;

  if (/[^a-z0-9]/.test(normalizedTerm)) {
    return normalizedText.includes(normalizedTerm);
  }

  return new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedTerm)}([^a-z0-9]|$)`).test(normalizedText);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function leadQuality({ scoreOutOfTen, evidence, productFit, persuasion }) {
  const directEvidence =
    evidence.type === "issue" || evidence.type === "comment" || evidence.type === "technical_comment";
  const productFitOutOfTen = productFit * 10;

  if (scoreOutOfTen >= 8 && productFitOutOfTen >= 5 && directEvidence && persuasion >= 0.65) {
    return {
      label: "demo_ready",
      reason: "High score, direct GitHub pain evidence, strong product fit, and persuasive buyer language."
    };
  }

  if (scoreOutOfTen >= 7 && productFitOutOfTen >= 3.5 && directEvidence) {
    return {
      label: "strong",
      reason: "Good lead with direct evidence, but it may need one more supporting artifact before outreach."
    };
  }

  if (scoreOutOfTen >= 5.5 && productFitOutOfTen >= 3) {
    return {
      label: "qualified",
      reason: "Relevant technical evidence, but not enough proof to call it demo-ready."
    };
  }

  return {
    label: "thin",
    reason: "Weak product fit, weak buyer pain, or too little supporting evidence."
  };
}

function summarizeQuality(candidates) {
  const counts = {
    demo_ready: 0,
    strong: 0,
    qualified: 0,
    thin: 0
  };
  for (const candidate of candidates) {
    if (counts[candidate.quality_label] !== undefined) {
      counts[candidate.quality_label] += 1;
    }
  }
  return counts;
}

function coverageDiagnosticsFor({ buyerProfile, resultCount, qualitySummary, topResults, indexSources }) {
  const demoReady = qualitySummary.demo_ready;
  const strongOrBetter = qualitySummary.demo_ready + qualitySummary.strong;
  const topScore = topResults[0]?.icp_fit_score ?? 0;
  const status =
    demoReady >= 5 ? "strong" :
    strongOrBetter >= 3 ? "usable" :
    resultCount > 0 ? "thin" :
    "missing";

  const messages = {
    strong: "Enough high-confidence leads exist for a demo.",
    usable: "There are usable leads, but selected-lead deepening would make the demo more persuasive.",
    thin: "The current indexes have some matching evidence, but coverage is thin for this buyer profile.",
    missing: "The current indexes do not cover this buyer profile well enough."
  };

  return {
    status,
    message: messages[status],
    top_score: topScore,
    demo_ready_count: demoReady,
    strong_or_better_count: strongOrBetter,
    indexed_sources_checked: indexSources.map((source) => source.id).filter(Boolean),
    suggested_seed_repos: buyerProfile.suggestedSeedRepos ?? [],
    suggested_query_terms: buyerProfile.fitTerms ?? []
  };
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

function oneSentencePain(evidence, buyerProfile) {
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
    return `Their GitHub activity is semantically close to the requested ${buyerPainArea(buyerProfile)} pain: ${compact(evidence.title, 90)}.`;
  }
  return `Their GitHub activity is relevant but should be manually reviewed: ${compact(evidence.title, 90)}.`;
}

function whyHighIntent(evidence, buyerProfile) {
  const text = evidenceText(evidence).toLowerCase();
  const area = buyerPainArea(buyerProfile);
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
    return `High intent because this is a direct user report of a severe, reproducible ${area} failure.`;
  }
  if (directReport && severeFailure) {
    return `High intent because the person is publicly reporting a concrete failure in their current ${area} stack.`;
  }
  if (productionSignal && severeFailure) {
    return "High intent because the evidence ties a severe failure to production or self-hosted usage.";
  }
  return "Moderate intent because the evidence is technically relevant, but should be manually qualified before outreach.";
}

function whyProductFits(evidence, buyerProfile) {
  const text = evidenceText(evidence).toLowerCase();
  for (const angle of buyerProfile?.solutionAngles ?? []) {
    if ((angle.terms ?? []).some((term) => textMatchesTerm(text, term))) {
      return angle.text;
    }
  }
  return buyerProfile?.defaultFit ?? "This lead is relevant because the GitHub evidence matches the requested buyer pain.";
}

function outreachForLead(lead, evidence, buyerProfile) {
  const title = compact(evidence.title, 110);
  const repo = evidence.repo;
  return [
    `Saw your GitHub activity in ${repo} around "${title}".`,
    `${whyHighIntent(evidence, buyerProfile)}`,
    `${whyProductFits(evidence, buyerProfile)}`
  ];
}

function buyerPainArea(buyerProfile) {
  const areas = {
    convex: "backend/realtime",
    lore: "AI-coding collaboration",
    lopus: "analytics/growth",
    openai: "AI-agent/tool-calling",
    "orange-slice": "sales workflow",
    "cache-baas": "cache/BaaS",
    "live-query": "live-query",
    "crdt-local-first": "local-first sync",
    "baas-realtime": "BaaS realtime"
  };
  return areas[buyerProfile?.id] ?? "requested";
}
