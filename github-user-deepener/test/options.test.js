import assert from "node:assert/strict";
import test from "node:test";
import { defaultCandidateLimit, defaultLiveCandidateLimit } from "../src/options.js";

test("defaultCandidateLimit keeps small searches modest when no demo-ready target is requested", () => {
  assert.equal(defaultCandidateLimit({ resultLimit: 3, targetDemoReady: 0 }), 20);
  assert.equal(defaultCandidateLimit({ resultLimit: 10, targetDemoReady: 0 }), 30);
});

test("defaultCandidateLimit widens the candidate pool when a demo-ready target is requested", () => {
  assert.equal(defaultCandidateLimit({ resultLimit: 3, targetDemoReady: 2 }), 60);
  assert.equal(defaultCandidateLimit({ resultLimit: 8, targetDemoReady: 3 }), 90);
});

test("defaultLiveCandidateLimit honors explicit caps before adaptive target crawling", () => {
  assert.equal(
    defaultLiveCandidateLimit({
      resultLimit: 6,
      targetDemoReady: 4,
      candidateCount: 80,
      explicitLiveCandidateLimit: undefined
    }),
    80
  );
  assert.equal(
    defaultLiveCandidateLimit({
      resultLimit: 6,
      targetDemoReady: 4,
      candidateCount: 80,
      explicitLiveCandidateLimit: 24
    }),
    24
  );
  assert.equal(
    defaultLiveCandidateLimit({
      resultLimit: 3,
      targetDemoReady: 0,
      candidateCount: 80,
      explicitLiveCandidateLimit: undefined
    }),
    8
  );
});
