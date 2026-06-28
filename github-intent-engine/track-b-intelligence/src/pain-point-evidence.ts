import type { CodeSignalContext, PainPointEvidence } from "./types.js";

export function painPointEvidenceFromContexts(
  contexts: CodeSignalContext[],
  limit = 8
): PainPointEvidence[] {
  const byKey = new Map<string, PainPointEvidence>();

  for (const context of contexts) {
    const codeManifestation = context.code_manifestation ?? fallbackCodeManifestation(context.matched_terms);
    if (!codeManifestation) {
      continue;
    }

    const key = `${context.id}:${context.url}`;
    const candidate: PainPointEvidence = {
      pain_point: context.pain_point,
      code_manifestation: codeManifestation,
      matched_terms: context.matched_terms,
      evidence_title: context.title,
      evidence_url: context.url,
      repo: context.repo,
      score: context.score,
      why_it_matters: whyItMatters(context.pain_point, context.matched_terms)
    };
    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score || candidate.matched_terms.length > existing.matched_terms.length) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()]
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.pain_point.localeCompare(right.pain_point);
    })
    .slice(0, limit);
}

function fallbackCodeManifestation(matchedTerms: string[]): string | null {
  if (matchedTerms.length === 0) {
    return null;
  }
  return `Matched code-shape terms: ${matchedTerms.slice(0, 5).join(", ")}.`;
}

function whyItMatters(painPoint: string, matchedTerms: string[]): string {
  const evidence =
    matchedTerms.length === 0
      ? "the code shape matches this pain point"
      : `the GitHub evidence contains ${matchedTerms.slice(0, 5).join(", ")}`;
  return `${painPoint} This matters because ${evidence}, which is stronger than a generic repo-topic match.`;
}
