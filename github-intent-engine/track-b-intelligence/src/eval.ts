import { pathsFor, readJsonl, writeJson } from "./io.js";
import { readRecipe } from "./recipe.js";
import { compareSearchBaselines } from "./search.js";
import type { EvalReport, RankedLead, RankingMode, SearchResultLead } from "./types.js";

type GoldenLabel = {
  query_id: string;
  engineer_login: string;
  label: number;
};

export type EvaluateOptions = {
  rootDir?: string;
  query?: string;
  queryId?: string;
  kValues?: number[];
};

export async function evaluateLeads(options: EvaluateOptions = {}): Promise<EvalReport> {
  const rootDir = options.rootDir;
  const paths = pathsFor(rootDir);
  const recipe = await readRecipe(rootDir);
  const kValues = options.kValues ?? [5, 10];
  const leads = await readJsonl<RankedLead>(paths.processed.rankedLeads);
  const queryId = options.queryId ?? recipe.id;
  const labels = (await readJsonl<GoldenLabel>(paths.eval.goldenLabels, true)).filter(
    (label) => label.query_id === queryId
  );
  const labelByLogin = new Map(labels.map((label) => [label.engineer_login, label.label]));

  const metrics: Record<string, number> = {};
  let evaluatedLeads: Array<RankedLead | SearchResultLead> = leads;
  let baselineMetrics: Record<RankingMode, Record<string, number>> | undefined;
  let baselineTopLeads: Record<RankingMode, string[]> | undefined;

  if (options.query) {
    const comparison = await compareSearchBaselines({
      rootDir,
      query: options.query,
      limit: Math.max(...kValues, 10)
    });
    evaluatedLeads = comparison.baselines.intent.results;
    baselineMetrics = {
      keyword: metricsFor(comparison.baselines.keyword.results, labelByLogin, kValues),
      semantic: metricsFor(comparison.baselines.semantic.results, labelByLogin, kValues),
      intent: metricsFor(comparison.baselines.intent.results, labelByLogin, kValues)
    };
    baselineTopLeads = {
      keyword: comparison.baselines.keyword.results.map((lead) => lead.engineer_login),
      semantic: comparison.baselines.semantic.results.map((lead) => lead.engineer_login),
      intent: comparison.baselines.intent.results.map((lead) => lead.engineer_login)
    };
  }

  Object.assign(metrics, metricsFor(evaluatedLeads, labelByLogin, kValues));
  metrics.evidence_validity = evidenceValidity(evaluatedLeads);
  metrics.time_window_validity = timeWindowValidity(evaluatedLeads);

  const report: EvalReport = {
    query_id: queryId,
    ...(options.query ? { query: options.query } : {}),
    k_values: kValues,
    metrics,
    ...(baselineMetrics ? { baseline_metrics: baselineMetrics } : {}),
    ...(baselineTopLeads ? { baseline_top_leads: baselineTopLeads } : {}),
    lead_count: leads.length,
    labeled_lead_count: labels.length
  };

  await writeJson(paths.eval.report, report);
  return report;
}

function metricsFor<T extends { engineer_login: string }>(
  leads: T[],
  labels: Map<string, number>,
  kValues: number[]
): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const k of kValues) {
    metrics[`precision_at_${k}`] = precisionAtK(leads, labels, k);
  }
  metrics.ndcg_at_10 = ndcgAtK(leads, labels, 10);
  return metrics;
}

function precisionAtK<T extends { engineer_login: string }>(
  leads: T[],
  labels: Map<string, number>,
  k: number
): number {
  const top = leads.slice(0, k);
  if (top.length === 0) {
    return 0;
  }
  const relevant = top.filter((lead) => (labels.get(lead.engineer_login) ?? 0) >= 2).length;
  return Number((relevant / top.length).toFixed(4));
}

function ndcgAtK<T extends { engineer_login: string }>(
  leads: T[],
  labels: Map<string, number>,
  k: number
): number {
  const top = leads.slice(0, k);
  const dcg = top.reduce((sum, lead, index) => {
    const relevance = labels.get(lead.engineer_login) ?? 0;
    return sum + gain(relevance, index);
  }, 0);
  const ideal = [...labels.values()]
    .sort((left, right) => right - left)
    .slice(0, k)
    .reduce((sum, relevance, index) => sum + gain(relevance, index), 0);
  return ideal === 0 ? 0 : Number((dcg / ideal).toFixed(4));
}

function gain(relevance: number, index: number): number {
  return (2 ** relevance - 1) / Math.log2(index + 2);
}

function evidenceValidity(leads: Array<RankedLead | SearchResultLead>): number {
  const allEvidence = leads.flatMap((lead) => lead.evidence);
  if (allEvidence.length === 0) {
    return 0;
  }
  const validEvidence = allEvidence.filter((evidence) => isValidUrl(evidence.url)).length;
  return Number((validEvidence / allEvidence.length).toFixed(4));
}

function timeWindowValidity(leads: Array<RankedLead | SearchResultLead>): number {
  const allEvidence = leads.flatMap((lead) =>
    lead.evidence.map((evidence) => ({
      timestamp: Date.parse(evidence.created_at),
      windowStart: Date.parse(lead.window_start_at)
    }))
  );
  if (allEvidence.length === 0) {
    return 0;
  }
  const validEvidence = allEvidence.filter(
    (evidence) =>
      Number.isFinite(evidence.timestamp) &&
      Number.isFinite(evidence.windowStart) &&
      evidence.timestamp >= evidence.windowStart
  ).length;
  return Number((validEvidence / allEvidence.length).toFixed(4));
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
