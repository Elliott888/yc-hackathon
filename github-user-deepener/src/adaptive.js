export function nextAdaptiveBatch({ leads, fetchedLogins = new Set(), batchSize = 8 }) {
  if (!Array.isArray(leads)) {
    throw new Error("leads must be an array");
  }
  const fetched = new Set([...fetchedLogins].map(normalizeLogin));
  const seen = new Set();
  const batch = [];

  for (const lead of leads) {
    const login = lead?.engineer_login ?? lead?.login;
    const normalized = normalizeLogin(login);
    if (!normalized || fetched.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    batch.push(login);
    if (batch.length >= batchSize) break;
  }

  return batch;
}

export function shouldContinueAdaptiveDeepening({
  targetDemoReady = 0,
  demoReadyCount = 0,
  fetchedCount = 0,
  candidateCount = 0
}) {
  if (targetDemoReady <= 0) return false;
  if (demoReadyCount >= targetDemoReady) return false;
  return fetchedCount < candidateCount;
}

function normalizeLogin(value) {
  return String(value ?? "").toLowerCase();
}
