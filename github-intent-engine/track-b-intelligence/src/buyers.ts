import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultProjectRoot } from "./io.js";
import { includesTerm, normalizeText } from "./text.js";
import type { SearchResponse, SearchResultLead } from "./types.js";

export type BuyerGithubFit = "high" | "medium" | "low";

export type BuyerProfile = {
  id: string;
  name: string;
  one_liner: string;
  buyer_type: string;
  github_fit: BuyerGithubFit;
  target_customers: string[];
  pain_signals: string[];
  stack_signals: string[];
  seed_repos: string[];
};

export type BuyerLeadSummary = {
  engineer_login: string;
  score: number;
  buyer_signal_score: number;
  high_signal: boolean;
  buyer_angle: string;
  top_repos: string[];
  problem_signals: string[];
  stack_signals: string[];
  evidence: Array<{
    type: string;
    repo: string;
    title: string;
    url: string;
    created_at: string;
    snippet: string;
  }>;
};

export type BuyerSearchReport = {
  buyer_id: string;
  buyer_name: string;
  github_fit: BuyerGithubFit;
  query: string;
  quality_grade: "demo_ready" | "promising" | "needs_more_data" | "weak_fit";
  quality_score: number;
  quality_notes: string[];
  lead_count: number;
  high_signal_lead_count: number;
  unique_repo_count: number;
  evidence_type_count: Record<string, number>;
  top_leads: BuyerLeadSummary[];
};

const defaultCatalogPath = join(defaultProjectRoot, "contracts", "buyer_catalog.json");

export async function loadBuyerCatalog(path = defaultCatalogPath): Promise<BuyerProfile[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as BuyerProfile[];
  return parsed.map(validateBuyerProfile);
}

export function githubReadyBuyers(buyers: BuyerProfile[]): BuyerProfile[] {
  return buyers.filter((buyer) => buyer.github_fit === "high" || buyer.github_fit === "medium");
}

export function createBuyerQuery(buyer: BuyerProfile): string {
  const targetCustomers = buyer.target_customers.slice(0, 3).join(", ");
  const painSignals = buyer.pain_signals.slice(0, 8).join(", ");
  const stackSignals = buyer.stack_signals.slice(0, 6).join(", ");
  return [
    `Find founders or engineers on GitHub who are potential buyers for ${buyer.name}.`,
    `They should be talking about ${painSignals}.`,
    `Prioritize ${targetCustomers}.`,
    `Relevant stack or ecosystem signals: ${stackSignals}.`
  ].join(" ");
}

export function summarizeBuyerSearch(
  buyer: BuyerProfile,
  search: SearchResponse,
  limit = 10
): BuyerSearchReport {
  const rankedResults = search.results
    .map((lead) => {
      const signalScore = buyerSignalScore(buyer, lead);
      return {
        lead,
        buyerSignalScore: signalScore,
        highSignal: isHighSignalLead(buyer, lead, signalScore)
      };
    })
    .sort((left, right) => {
      if (left.highSignal !== right.highSignal) {
        return left.highSignal ? -1 : 1;
      }
      if (right.buyerSignalScore !== left.buyerSignalScore) {
        return right.buyerSignalScore - left.buyerSignalScore;
      }
      return right.lead.final_score - left.lead.final_score;
    });
  const results = rankedResults.slice(0, limit);
  const highSignalLeads = results.filter((result) => result.highSignal);
  const reportableResults = highSignalLeads;
  const uniqueRepos = new Set(results.flatMap((result) => result.lead.top_repos));
  const evidenceTypeCount = countEvidenceTypes(results.map((result) => result.lead));
  const qualityScore = scoreBuyerSearch(buyer, results, highSignalLeads.length, uniqueRepos.size);

  return {
    buyer_id: buyer.id,
    buyer_name: buyer.name,
    github_fit: buyer.github_fit,
    query: search.query_plan.raw_query,
    quality_grade: gradeBuyerSearch(buyer, qualityScore, highSignalLeads.length),
    quality_score: qualityScore,
    quality_notes: qualityNotes(buyer, highSignalLeads.length, uniqueRepos.size, evidenceTypeCount),
    lead_count: results.length,
    high_signal_lead_count: highSignalLeads.length,
    unique_repo_count: uniqueRepos.size,
    evidence_type_count: evidenceTypeCount,
    top_leads: reportableResults.map((result) =>
      summarizeLeadForBuyer(buyer, result.lead, result.buyerSignalScore, result.highSignal)
    )
  };
}

function validateBuyerProfile(profile: BuyerProfile): BuyerProfile {
  if (!profile.id || !profile.name || !profile.github_fit) {
    throw new Error(`Invalid buyer profile: ${JSON.stringify(profile)}`);
  }
  return {
    ...profile,
    target_customers: profile.target_customers ?? [],
    pain_signals: profile.pain_signals ?? [],
    stack_signals: profile.stack_signals ?? [],
    seed_repos: profile.seed_repos ?? []
  };
}

function isHighSignalLead(
  buyer: BuyerProfile,
  lead: SearchResultLead,
  buyerSignalScore: number
): boolean {
  const hasDirectEvidence = lead.evidence.length > 0 && buyerSignalScore >= 0.18;
  if (!hasDirectEvidence) return false;
  if (buyer.github_fit === "low") return false;
  const hasSeedRepoFit = hasBuyerSeedRepoFit(buyer, lead);
  const hasEcosystemFit = hasBuyerEcosystemFit(buyer, lead);
  if (buyer.github_fit === "medium" && !hasEcosystemFit) {
    return false;
  }
  if (buyer.id === "lopus") {
    return hasEcosystemFit;
  }
  if (buyer.github_fit === "high" && !hasSeedRepoFit && buyerSignalScore < 0.3) {
    return false;
  }
  return true;
}

function countEvidenceTypes(leads: SearchResultLead[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const evidence of leads.flatMap((lead) => lead.evidence.slice(0, 3))) {
    counts[evidence.type] = (counts[evidence.type] ?? 0) + 1;
  }
  return counts;
}

function scoreBuyerSearch(
  buyer: BuyerProfile,
  leads: Array<{ lead: SearchResultLead; buyerSignalScore: number; highSignal: boolean }>,
  highSignalLeadCount: number,
  uniqueRepoCount: number
): number {
  if (buyer.github_fit === "low") {
    return Math.min(45, leads.length * 3 + highSignalLeadCount * 8);
  }
  return Math.min(
    100,
    highSignalLeadCount * 40 +
      Math.min(20, uniqueRepoCount * 5) +
      Math.min(20, leads.length * 3) +
      (buyer.github_fit === "high" ? 20 : 0)
  );
}

function gradeBuyerSearch(
  buyer: BuyerProfile,
  qualityScore: number,
  highSignalLeadCount: number
): BuyerSearchReport["quality_grade"] {
  if (buyer.github_fit === "low") return "weak_fit";
  if (highSignalLeadCount === 0) return "needs_more_data";
  if (highSignalLeadCount >= 1 && qualityScore >= 60) return "demo_ready";
  if (highSignalLeadCount >= 1 || qualityScore >= 45) return "promising";
  return "needs_more_data";
}

function qualityNotes(
  buyer: BuyerProfile,
  highSignalLeadCount: number,
  uniqueRepoCount: number,
  evidenceTypeCount: Record<string, number>
): string[] {
  const notes = [
    `${highSignalLeadCount} high-signal leads`,
    `${uniqueRepoCount} unique repos in top results`,
    `${Object.keys(evidenceTypeCount).length} evidence types represented`
  ];
  if (buyer.github_fit === "low") {
    notes.push("GitHub is probably not the primary buyer-intent source for this company.");
  }
  if (highSignalLeadCount === 0) {
    notes.push("Needs a buyer-specific harvest before demoing this account.");
  }
  return notes;
}

function summarizeLeadForBuyer(
  buyer: BuyerProfile,
  lead: SearchResultLead,
  buyerSignalScore: number,
  highSignal: boolean
): BuyerLeadSummary {
  const evidence = sortEvidenceForBuyer(buyer, lead).slice(0, 3);
  const problemSignals = [
    ...(lead.answer_context?.problem_signals ?? []),
    ...lead.top_topics,
    ...evidence.flatMap((item) => item.matched_topics)
  ];
  const stackSignals = [
    ...(lead.answer_context?.stack_signals ?? []),
    ...lead.primary_languages
  ];

  return {
    engineer_login: lead.engineer_login,
    score: lead.final_score,
    buyer_signal_score: buyerSignalScore,
    high_signal: highSignal,
    buyer_angle: buyerAngle(buyer, lead, evidence[0]),
    top_repos: lead.top_repos.slice(0, 5),
    problem_signals: unique(problemSignals).slice(0, 8),
    stack_signals: unique(stackSignals).slice(0, 8),
    evidence: evidence.map((item) => ({
      type: item.type,
      repo: item.repo,
      title: item.title,
      url: item.url,
      created_at: item.created_at,
      snippet: compactSnippet(`${item.title} ${item.text}`)
    }))
  };
}

function buyerSignalScore(buyer: BuyerProfile, lead: SearchResultLead): number {
  return Math.max(0, ...lead.evidence.slice(0, 5).map((item) =>
    buyerSignalScoreForEvidence(buyer, lead, item)
  ));
}

function buyerSignalScoreForEvidence(
  buyer: BuyerProfile,
  lead: SearchResultLead,
  evidence: SearchResultLead["evidence"][number]
): number {
  const text = `${lead.top_repos.join(" ")} ${evidence.title} ${evidence.text}`;
  const baseScore = buyerSignalScoreForText(buyer, text);
  return Number((baseScore * buyerEvidenceQualityMultiplier(text)).toFixed(4));
}

function buyerSignalScoreForText(buyer: BuyerProfile, text: string): number {
  const painHits = buyer.pain_signals.filter((term) => buyerTermMatches(text, term)).length;
  const stackHits = buyer.stack_signals.filter((term) => buyerTermMatches(text, term)).length;
  const painDenominator = Math.max(1, Math.min(4, buyer.pain_signals.length));
  const stackDenominator = Math.max(1, Math.min(3, buyer.stack_signals.length));
  const score = painHits / painDenominator * 0.85 + stackHits / stackDenominator * 0.15;
  return Number(Math.min(1, score).toFixed(4));
}

function sortEvidenceForBuyer(buyer: BuyerProfile, lead: SearchResultLead) {
  return [...lead.evidence].sort((left, right) => {
    const rightScore = buyerSignalScoreForEvidence(buyer, lead, right);
    const leftScore = buyerSignalScoreForEvidence(buyer, lead, left);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return right.contribution_weight - left.contribution_weight;
  });
}

function buyerEvidenceQualityMultiplier(text: string): number {
  const weakSignals = [
    "advisory",
    "benchmark",
    "chore",
    "cve",
    "demo",
    "deps",
    "dependency",
    "docs",
    "documentation",
    "example",
    "format",
    "guide",
    "lint",
    "lockfile",
    "release notes",
    "snapshot",
    "sponsor",
    "tutorial",
    "typo"
  ];
  const generatedSignals = [
    "auto-generated comment",
    "background agent",
    "coderabbit",
    "cursor_agent_pr_body",
    "open in cursor"
  ];
  const hasWeakSignal = weakSignals.some((signal) => includesTerm(text, signal));
  const hasGeneratedSignal = generatedSignals.some((signal) => includesTerm(text, signal));
  if (hasWeakSignal && hasGeneratedSignal) return 0.2;
  if (hasWeakSignal) return 0.35;
  if (hasGeneratedSignal) return 0.65;
  return 1;
}

function hasBuyerEcosystemFit(buyer: BuyerProfile, lead: SearchResultLead): boolean {
  const repoHit = hasBuyerSeedRepoFit(buyer, lead);
  const text = [
    lead.top_repos.join(" "),
    lead.primary_languages.join(" "),
    lead.evidence.slice(0, 5).map((item) => `${item.title} ${item.text}`).join(" ")
  ].join(" ");
  const stackHit = buyer.stack_signals
    .filter((term) => !GENERIC_STACK_SIGNALS.has(normalizeText(term)))
    .some((term) => buyerTermMatches(text, term));
  return repoHit || stackHit;
}

function hasBuyerSeedRepoFit(buyer: BuyerProfile, lead: SearchResultLead): boolean {
  return lead.top_repos.some((repo) =>
    buyer.seed_repos.some((seedRepo) => seedRepo.toLowerCase() === repo.toLowerCase())
  );
}

const GENERIC_STACK_SIGNALS = new Set([
  "javascript",
  "next js",
  "node",
  "node js",
  "postgres",
  "python",
  "react",
  "sqlite",
  "typescript",
  "websocket"
]);

function buyerTermMatches(text: string, term: string): boolean {
  if (includesTerm(text, term)) {
    return true;
  }
  const words = normalizeText(term)
    .split(" ")
    .filter((word) => word.length > 2 && !BUYER_TERM_STOPWORDS.has(word));
  if (words.length <= 1) {
    return false;
  }
  return words.every((word) => includesTerm(text, word));
}

const BUYER_TERM_STOPWORDS = new Set([
  "and",
  "api",
  "for",
  "the",
  "tool",
  "tools",
  "with"
]);


function buyerAngle(
  buyer: BuyerProfile,
  lead: SearchResultLead,
  strongestEvidence?: SearchResultLead["evidence"][number]
): string {
  const firstEvidence = strongestEvidence ?? lead.evidence[0];
  const repo = lead.top_repos[0] ?? firstEvidence?.repo ?? "GitHub";
  const signal =
    firstEvidence?.title ??
    lead.top_topics.slice(0, 3).join(", ") ??
    "recent public engineering activity";
  return `For ${buyer.name}, this lead is relevant because ${lead.engineer_login} showed public activity in ${repo}: ${signal}`;
}

function compactSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 360);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
