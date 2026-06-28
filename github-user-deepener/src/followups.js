export function shouldRunNearMissFollowUps({
  mode,
  liveUserActivity = false,
  targetDemoReady = 0,
  qualityReport
}) {
  if (String(mode ?? "").toLowerCase() === "false") return false;
  if (String(mode ?? "").toLowerCase() === "true") {
    return nearMissesForFollowUp({ qualityReport }).length > 0;
  }
  if (!liveUserActivity) return false;
  if ((Number(targetDemoReady) || 0) <= 0) return false;
  if (qualityReport?.target_met) return false;
  if ((qualityReport?.demo_ready_shortfall ?? 0) <= 0) return false;
  return nearMissesForFollowUp({ qualityReport }).length > 0;
}

export function nearMissesForFollowUp({ qualityReport, limit = 3, attemptedLogins = new Set() }) {
  const attempted = new Set([...attemptedLogins].map(normalizeLogin));
  return (qualityReport?.near_misses ?? [])
    .filter((nearMiss) => (nearMiss.follow_up_actions ?? []).length > 0)
    .filter((nearMiss) => !attempted.has(normalizeLogin(nearMiss.engineer_login ?? nearMiss.login)))
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function summarizeFollowUpRun({
  enabled = false,
  nearMisses = [],
  activities = [],
  beforeQuality,
  afterQuality
}) {
  const demoReadyBefore = beforeQuality?.reliability_counts?.demo_ready ?? 0;
  const demoReadyAfter = afterQuality?.reliability_counts?.demo_ready ?? demoReadyBefore;
  return {
    enabled,
    near_miss_count: nearMisses.length,
    activity_count: activities.length,
    demo_ready_before: demoReadyBefore,
    demo_ready_after: demoReadyAfter,
    demo_ready_delta: demoReadyAfter - demoReadyBefore
  };
}

function normalizeLogin(value) {
  return String(value ?? "").toLowerCase();
}
