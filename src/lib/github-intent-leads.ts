import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { buildGithubIntentQuery } from "@/lib/github-intent-query";
import { averageLeadEvidenceScore, clampScore } from "@/lib/lead-score";
import type { Lead, LeadEvidence, PainPoint } from "@/lib/workflow";

type HybridTriggerEvidence = {
  source?: string;
  type:
    | "pull_request"
    | "issue"
    | "comment"
    | "commit"
    | "review"
    | "review_comment"
    | "technical_comment"
    | "workflow_run"
    | string;
  repo?: string;
  title?: string;
  snippet?: string;
  url?: string;
  occurred_at?: string;
  matched_topics?: string[];
  pain_signals?: string[];
};

type HybridSearchResultLead = {
  engineer_login: string;
  name: string | null;
  company?: string | null;
  github_url?: string;
  icp_fit_score: number;
  score_breakdown?: Record<string, number>;
  trigger?: HybridTriggerEvidence;
  pain_signal?: string;
  why_this_is_high_intent?: string;
  why_product_fits?: string;
  why_convex_fits?: string;
  quality_label?: string;
  quality_reason?: string;
  outreach?: string[];
  sources_used?: {
    structured?: boolean;
    neural?: boolean;
  };
};

type HybridIndexSource = {
  id: string;
  structuredRoot: string;
  neuralLeadsPath: string;
};

type HybridSearchModule = {
  searchHybrid(options: {
    query: string;
    limit: number;
    indexSources: HybridIndexSource[];
    useAllIndexes: boolean;
  }): Promise<{ results: HybridSearchResultLead[] }>;
};

export type FetchGithubIntentLeadsInput = {
  painPoints: PainPoint[];
  companyName?: string;
  limit?: number;
};

export async function fetchGithubIntentLeads({
  painPoints,
  companyName,
  limit = 10,
}: FetchGithubIntentLeadsInput): Promise<Lead[]> {
  const structuredRoot = resolveGithubIntentRoot();
  assertProcessedIndexExists(structuredRoot);

  const query = buildGithubIntentQuery({ painPoints, companyName });
  const indexSources = resolveHybridIndexSources(structuredRoot);
  const { searchHybrid } = (await import(
    "../../hybrid-github-intent/src/engine.js"
  )) as HybridSearchModule;
  const search = await searchHybrid({
    query,
    limit,
    indexSources,
    useAllIndexes: true,
  });

  return search.results.map((result, index) =>
    mapSearchResultToLead(result, painPoints, index)
  );
}

function resolveGithubIntentRoot() {
  const configuredRoot =
    process.env.HYBRID_GITHUB_INTENT_STRUCTURED_ROOT?.trim() ||
    process.env.GITHUB_INTENT_ENGINE_ROOT?.trim();

  if (configuredRoot) {
    return resolve(configuredRoot);
  }

  return resolve(process.cwd(), "github-intent-engine");
}

function resolveHybridIndexSources(structuredRoot: string): HybridIndexSource[] {
  const neuralLeadsPath = resolveNeuralLeadsPath();
  const workspaceRoot = resolve(process.cwd(), "github-intent-engine", "data", "workspaces");
  const workspaceSources: HybridIndexSource[] = [
    {
      id: "fullstack-backend-pain-doubled",
      structuredRoot: resolve(workspaceRoot, "fullstack-backend-pain-doubled"),
      neuralLeadsPath,
    },
    {
      id: "fullstack-backend-pain-upgraded",
      structuredRoot: resolve(workspaceRoot, "fullstack-backend-pain-upgraded"),
      neuralLeadsPath,
    },
    {
      id: "devtool-buyers",
      structuredRoot: resolve(workspaceRoot, "devtool-buyers"),
      neuralLeadsPath,
    },
    {
      id: "fullstack-backend-pain-1000",
      structuredRoot: resolve(workspaceRoot, "fullstack-backend-pain-1000"),
      neuralLeadsPath: resolve(
        process.cwd(),
        "neural-github-intent",
        "data-track-a-1000",
        "scored_leads.ndjson"
      ),
    },
  ].filter((source) => processedIndexExists(source.structuredRoot));

  if (workspaceSources.length > 0) {
    return workspaceSources;
  }

  return [
    {
      id: "github-intent-engine",
      structuredRoot,
      neuralLeadsPath,
    },
  ];
}

function resolveNeuralLeadsPath() {
  const configuredPath =
    process.env.HYBRID_GITHUB_INTENT_NEURAL_LEADS_PATH?.trim() ||
    process.env.NEURAL_GITHUB_INTENT_LEADS_PATH?.trim();

  if (configuredPath) {
    return resolve(configuredPath);
  }

  const candidates = [
    resolve(process.cwd(), "neural-github-intent", "data", "scored_leads.ndjson"),
    resolve(
      process.cwd(),
      "neural-github-intent",
      "data-track-a-1000",
      "scored_leads.ndjson"
    ),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function assertProcessedIndexExists(rootDir: string) {
  if (!processedIndexExists(rootDir)) {
    const rankedLeadsPath = resolveProcessedIndexPath(rootDir);

    throw new Error(
      `Hybrid GitHub intent index is missing at ${rankedLeadsPath}. Run "cd github-intent-engine && npm run harvest && npm run build-intelligence" before searching.`
    );
  }
}

function processedIndexExists(rootDir: string) {
  return existsSync(resolveProcessedIndexPath(rootDir));
}

function resolveProcessedIndexPath(rootDir: string) {
  const rankedLeadsPath = resolve(
    rootDir,
    "data",
    "processed",
    "ranked_leads.jsonl"
  );

  return rankedLeadsPath;
}

function mapSearchResultToLead(
  result: HybridSearchResultLead,
  painPoints: PainPoint[],
  index: number
): Lead {
  const baseScore = clampIntentScore(result.icp_fit_score);
  const displayName = result.name?.trim() || result.engineer_login;
  const profileParts = [
    result.company ? `Company: ${result.company}` : "",
    result.pain_signal,
    result.why_this_is_high_intent,
    result.why_product_fits ?? result.why_convex_fits,
    result.quality_label && result.quality_reason
      ? `${result.quality_label}: ${result.quality_reason}`
      : result.quality_label,
    result.outreach?.join(" "),
    result.sources_used
      ? `Sources: ${[
          result.sources_used.structured ? "structured" : "",
          result.sources_used.neural ? "neural" : "",
        ]
          .filter(Boolean)
          .join(" + ")}`
      : "",
  ].filter(Boolean);
  const evidence = result.trigger
    ? [
        mapTriggerToLeadEvidence({
          trigger: result.trigger,
          result,
          painPoints,
          leadScore: baseScore,
        }),
      ]
    : [];
  const score = averageLeadEvidenceScore(evidence, baseScore);

  return {
    id: `github_engineer_${result.engineer_login || index}`,
    name: displayName,
    profile: profileParts.join(" "),
    score,
    evidence,
  };
}

function mapTriggerToLeadEvidence({
  trigger,
  result,
  painPoints,
  leadScore,
}: {
  trigger: HybridTriggerEvidence;
  result: HybridSearchResultLead;
  painPoints: PainPoint[];
  leadScore: number;
}): LeadEvidence {
  const matchedPainPoint = findMatchedPainPoint(trigger, painPoints);
  const evidenceScore = clampScore(Math.max(52, leadScore));
  const source = [
    trigger.repo,
    trigger.source,
    trigger.type.replaceAll("_", " "),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `${result.engineer_login}_trigger`,
    painPointId: matchedPainPoint?.id ?? "github_intent",
    painPointTitle: matchedPainPoint?.title ?? "Hybrid GitHub intent signal",
    score: evidenceScore,
    description:
      trigger.title ||
      trigger.snippet?.slice(0, 180) ||
      `${result.engineer_login} has matching GitHub activity.`,
    href: trigger.url ?? result.github_url ?? `https://github.com/${result.engineer_login}`,
    source: source || "GitHub activity",
  };
}

function findMatchedPainPoint(
  evidence: HybridTriggerEvidence,
  painPoints: PainPoint[]
) {
  const evidenceText = [
    evidence.title,
    evidence.snippet,
    evidence.matched_topics?.join(" "),
    evidence.pain_signals?.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return painPoints.find((painPoint) => {
    const terms = [
      painPoint.title,
      painPoint.description,
      ...painPoint.subpoints.flatMap((subpoint) => [
        subpoint.title,
        subpoint.description,
      ]),
    ]
      .join(" ")
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length >= 5);

    return terms.some((term) => evidenceText.includes(term));
  });
}

function clampIntentScore(score: number) {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return clampScore(score <= 10 ? score * 10 : score);
}
