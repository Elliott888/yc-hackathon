import assert from "node:assert/strict";
import test from "node:test";
import { nextAdaptiveBatch, shouldContinueAdaptiveDeepening } from "../src/adaptive.js";

test("nextAdaptiveBatch selects the next unfetched candidate logins in stable order", () => {
  const leads = [
    { engineer_login: "alpha" },
    { engineer_login: "beta" },
    { engineer_login: "alpha" },
    { engineer_login: "gamma" },
    { engineer_login: "" },
    { engineer_login: "delta" }
  ];

  assert.deepEqual(nextAdaptiveBatch({ leads, fetchedLogins: new Set(["alpha"]), batchSize: 2 }), ["beta", "gamma"]);
  assert.deepEqual(nextAdaptiveBatch({ leads, fetchedLogins: new Set(["alpha", "beta", "gamma"]), batchSize: 3 }), [
    "delta"
  ]);
});

test("shouldContinueAdaptiveDeepening stops after target demo-ready count or candidate exhaustion", () => {
  assert.equal(
    shouldContinueAdaptiveDeepening({
      targetDemoReady: 2,
      demoReadyCount: 1,
      fetchedCount: 4,
      candidateCount: 10
    }),
    true
  );
  assert.equal(
    shouldContinueAdaptiveDeepening({
      targetDemoReady: 2,
      demoReadyCount: 2,
      fetchedCount: 4,
      candidateCount: 10
    }),
    false
  );
  assert.equal(
    shouldContinueAdaptiveDeepening({
      targetDemoReady: 2,
      demoReadyCount: 1,
      fetchedCount: 10,
      candidateCount: 10
    }),
    false
  );
});
