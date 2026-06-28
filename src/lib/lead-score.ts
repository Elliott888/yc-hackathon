export type ScoredEvidence = {
  score: number;
};

export function clampScore(score: number) {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function averageLeadEvidenceScore(
  evidence: ScoredEvidence[],
  fallbackScore: number
) {
  const scores = evidence
    .map((item) => item.score)
    .filter((score) => Number.isFinite(score));

  if (scores.length === 0) {
    return clampScore(fallbackScore);
  }

  const total = scores.reduce((sum, score) => sum + score, 0);

  return clampScore(total / scores.length);
}
