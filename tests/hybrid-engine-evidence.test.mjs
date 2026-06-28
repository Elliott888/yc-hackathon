import { test } from "node:test";
import assert from "node:assert/strict";

import { rankHybridLeads } from "../hybrid-github-intent/src/engine.js";

test("hybrid ranker returns multiple supporting evidence signals per lead", () => {
  const result = rankHybridLeads({
    query: "cache invalidation websocket sync bug",
    buyerProfile: {
      id: "custom",
      label: "Custom realtime backend",
      product: "Convex",
      fitTerms: ["cache invalidation", "websocket", "sync"],
      solutionAngles: [],
      defaultFit:
        "Convex is relevant because the evidence matches realtime sync pain.",
      painArea: "realtime sync",
    },
    structuredLeads: [],
    neuralLeads: [
      {
        engineer_login: "syncdev",
        name: "Sync Dev",
        company: "Acme",
        github_url: "https://github.com/syncdev",
        score: 115,
        query_similarity: 0.8,
        answer_context: {
          burning_problem_score: 0.8,
        },
        recent_activity: [
          {
            type: "issue",
            repo: "acme/realtime",
            title: "Cache invalidation bug causes websocket sync failure",
            snippet:
              "What happened: production users hit a cache invalidation bug and websocket sync fails with stale data.",
            occurred_at: "2026-06-24T12:00:00Z",
            url: "https://github.com/acme/realtime/issues/1",
            matched_terms: ["cache invalidation", "websocket", "sync"],
            pain_score: 0.9,
            pain_signals: ["bug", "failure", "stale"],
          },
          {
            type: "comment",
            repo: "acme/realtime",
            title: "Cache invalidation bug follow-up",
            snippet:
              "Follow-up on the same issue: websocket sync still fails for production users.",
            occurred_at: "2026-06-24T13:00:00Z",
            url: "https://github.com/acme/realtime/issues/1",
            matched_terms: ["cache invalidation", "websocket", "sync"],
            pain_score: 0.92,
            pain_signals: ["bug", "failure", "stale"],
          },
          {
            type: "issue",
            repo: "acme/realtime",
            title: "Subscription reconnect drops realtime updates",
            snippet:
              "Users report reconnect failures where subscription sync drops updates and causes timeout errors.",
            occurred_at: "2026-06-22T12:00:00Z",
            url: "https://github.com/acme/realtime/issues/2",
            matched_terms: ["subscription", "sync"],
            pain_score: 0.78,
            pain_signals: ["reconnect failure", "timeout"],
          },
          {
            type: "opened_pull_request",
            repo: "acme/realtime",
            title: "Retry database writes after sync race",
            snippet:
              "Fixes a race where database writes diverge during websocket sync and users see stale state.",
            occurred_at: "2026-06-20T12:00:00Z",
            url: "https://github.com/acme/realtime/pull/3",
            matched_terms: ["database", "sync", "websocket"],
            pain_score: 0.72,
            pain_signals: ["race", "stale"],
          },
        ],
      },
    ],
    rawUsers: [],
    rawCommits: [],
    limit: 1,
    now: new Date("2026-06-28T12:00:00Z"),
  });

  const [lead] = result.results;

  assert.ok(lead, "expected a ranked lead");
  assert.equal(lead.trigger.url, "https://github.com/acme/realtime/issues/1");
  assert.equal(lead.evidence.length, 3);
  assert.deepEqual(
    lead.evidence.map((evidence) => evidence.url),
    [
      "https://github.com/acme/realtime/issues/1",
      "https://github.com/acme/realtime/issues/2",
      "https://github.com/acme/realtime/pull/3",
    ]
  );
  assert.ok(
    lead.evidence.every((evidence) => Number.isInteger(evidence.score)),
    "each public evidence item should include an integer score"
  );
});
