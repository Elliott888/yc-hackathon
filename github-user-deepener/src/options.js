export function defaultCandidateLimit({ resultLimit = 8, targetDemoReady = 0 }) {
  const results = Math.max(1, Number(resultLimit) || 8);
  const target = Math.max(0, Number(targetDemoReady) || 0);
  if (target > 0) {
    return Math.max(results * 3, target * 30, 60);
  }
  return Math.max(results * 3, 20);
}

export function defaultLiveCandidateLimit({
  resultLimit = 8,
  targetDemoReady = 0,
  candidateCount = 0,
  explicitLiveCandidateLimit
}) {
  const explicit = Number(explicitLiveCandidateLimit);
  const candidates = Math.max(0, Number(candidateCount) || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return candidates > 0 ? Math.min(explicit, candidates) : explicit;
  }

  const target = Math.max(0, Number(targetDemoReady) || 0);
  if (target > 0) return candidates;

  const results = Math.max(1, Number(resultLimit) || 8);
  return Math.max(results, 8);
}
