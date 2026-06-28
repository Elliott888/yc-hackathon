import assert from "node:assert/strict";
import test from "node:test";
import {
  nearMissesForFollowUp,
  shouldRunNearMissFollowUps,
  summarizeFollowUpRun
} from "../src/followups.js";

test("near-miss follow-ups run automatically when the demo-ready target is not met", () => {
  assert.equal(
    shouldRunNearMissFollowUps({
      mode: undefined,
      liveUserActivity: true,
      targetDemoReady: 2,
      qualityReport: {
        target_met: false,
        demo_ready_shortfall: 1,
        near_misses: [{ engineer_login: "alice", follow_up_actions: [{ kind: "github_issue_search" }] }]
      }
    }),
    true
  );

  assert.equal(
    shouldRunNearMissFollowUps({
      mode: "false",
      liveUserActivity: true,
      targetDemoReady: 2,
      qualityReport: { target_met: false, near_misses: [{ engineer_login: "alice" }] }
    }),
    false
  );

  assert.equal(
    shouldRunNearMissFollowUps({
      mode: undefined,
      liveUserActivity: true,
      targetDemoReady: 2,
      qualityReport: { target_met: true, near_misses: [{ engineer_login: "alice" }] }
    }),
    false
  );
});

test("nearMissesForFollowUp keeps only actionable near misses up to the requested limit", () => {
  const nearMisses = nearMissesForFollowUp({
    qualityReport: {
      near_misses: [
        { engineer_login: "alice", follow_up_actions: [{ kind: "github_issue_search" }] },
        { engineer_login: "bob", follow_up_actions: [] },
        { engineer_login: "cara", follow_up_actions: [{ kind: "github_user_code_harvest" }] }
      ]
    },
    limit: 1
  });

  assert.deepEqual(
    nearMisses.map((nearMiss) => nearMiss.engineer_login),
    ["alice"]
  );
});

test("nearMissesForFollowUp skips logins that were already attempted in an earlier round", () => {
  const nearMisses = nearMissesForFollowUp({
    qualityReport: {
      near_misses: [
        { engineer_login: "alice", follow_up_actions: [{ kind: "github_issue_search" }] },
        { engineer_login: "cara", follow_up_actions: [{ kind: "github_user_code_harvest" }] }
      ]
    },
    attemptedLogins: new Set(["ALICE"]),
    limit: 2
  });

  assert.deepEqual(
    nearMisses.map((nearMiss) => nearMiss.engineer_login),
    ["cara"]
  );
});

test("summarizeFollowUpRun reports whether follow-ups improved demo-ready count", () => {
  assert.deepEqual(
    summarizeFollowUpRun({
      enabled: true,
      nearMisses: [{ engineer_login: "alice" }, { engineer_login: "cara" }],
      activities: [{}, {}, {}],
      beforeQuality: { reliability_counts: { demo_ready: 1 } },
      afterQuality: { reliability_counts: { demo_ready: 2 } }
    }),
    {
      enabled: true,
      near_miss_count: 2,
      activity_count: 3,
      demo_ready_before: 1,
      demo_ready_after: 2,
      demo_ready_delta: 1
    }
  );
});
