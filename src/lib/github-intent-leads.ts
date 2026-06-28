import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { buildGithubIntentQuery } from "@/lib/github-intent-query";
import type { Lead, LeadEvidence, PainPoint } from "@/lib/workflow";

type EngineEvidenceRecord = {
  type:
    | "pull_request"
    | "issue"
    | "comment"
    | "commit"
    | "review"
    | "review_comment"
    | "workflow_run";
  repo: string;
  title: string;
  text: string;
  url: string;
  created_at: string;
  matched_topics: string[];
};

type EngineSearchResultLead = {
  engineer_login: string;
  name: string | null;
  score: number;
  final_score?: number;
  why_relevant: string;
  outreach_angle: string;
  evidence: EngineEvidenceRecord[];
  top_repos: string[];
};

type SearchModule = {
  searchLeads(options: {
    rootDir: string;
    query: string;
    limit: number;
  }): Promise<{ results: EngineSearchResultLead[] }>;
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
  const rootDir = resolveGithubIntentRoot();
  assertProcessedIndexExists(rootDir);

  const query = buildGithubIntentQuery({ painPoints, companyName });
  const { searchLeads } = (await import(
    "../../github-intent-engine/dist/track-b-intelligence/src/search.js"
  )) as SearchModule;
  const search = await searchLeads({
    rootDir,
    query,
    limit,
  });

  return search.results.map((result, index) =>
    mapSearchResultToLead(result, painPoints, index)
  );
}

function resolveGithubIntentRoot() {
  const configuredRoot = process.env.GITHUB_INTENT_ENGINE_ROOT?.trim();

  if (configuredRoot) {
    return resolve(configuredRoot);
  }

  return resolve(process.cwd(), "github-intent-engine");
}

function assertProcessedIndexExists(rootDir: string) {
  const rankedLeadsPath = resolve(
    rootDir,
    "data",
    "processed",
    "ranked_leads.jsonl"
  );

  if (!existsSync(rankedLeadsPath)) {
    throw new Error(
      `GitHub intent index is missing at ${rankedLeadsPath}. Run "cd github-intent-engine && npm run harvest && npm run build-intelligence" before searching.`
    );
  }
}

function mapSearchResultToLead(
  result: EngineSearchResultLead,
  painPoints: PainPoint[],
  index: number
): Lead {
  const score = clampScore(result.final_score ?? result.score);
  const displayName = result.name?.trim() || result.engineer_login;
  const profileParts = [
    result.why_relevant,
    result.outreach_angle,
    result.top_repos.length > 0
      ? `Recent repos: ${result.top_repos.slice(0, 3).join(", ")}`
      : "",
  ].filter(Boolean);

  return {
    id: `github_engineer_${result.engineer_login || index}`,
    name: displayName,
    profile: profileParts.join(" "),
    score,
    evidence: result.evidence.slice(0, 3)
      .map((evidence, evidenceIndex) =>
        mapEvidenceToLeadEvidence({
          evidence,
          result,
          painPoints,
          evidenceIndex,
          leadScore: score,
        })
      ),
  };
}

function mapEvidenceToLeadEvidence({
  evidence,
  result,
  painPoints,
  evidenceIndex,
  leadScore,
}: {
  evidence: EngineEvidenceRecord;
  result: EngineSearchResultLead;
  painPoints: PainPoint[];
  evidenceIndex: number;
  leadScore: number;
}): LeadEvidence {
  const matchedPainPoint = findMatchedPainPoint(evidence, painPoints);
  const evidenceScore = clampScore(Math.max(52, leadScore - evidenceIndex * 4));
  const source = [evidence.repo, evidence.type.replaceAll("_", " ")]
    .filter(Boolean)
    .join(" ");

  return {
    id: `${result.engineer_login}_evidence_${evidenceIndex + 1}`,
    painPointId: matchedPainPoint?.id ?? "github_intent",
    painPointTitle: matchedPainPoint?.title ?? "GitHub intent signal",
    score: evidenceScore,
    description:
      evidence.title ||
      evidence.text.slice(0, 180) ||
      `${result.engineer_login} has matching GitHub activity.`,
    href: evidence.url,
    source: source || "GitHub activity",
  };
}

function findMatchedPainPoint(
  evidence: EngineEvidenceRecord,
  painPoints: PainPoint[]
) {
  const evidenceText = [
    evidence.title,
    evidence.text,
    evidence.matched_topics.join(" "),
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

function clampScore(score: number) {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
