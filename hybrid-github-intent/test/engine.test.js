import assert from "node:assert/strict";
import test from "node:test";
import { BUYER_PROFILES } from "../src/buyer-profiles.js";
import { loadHybridInputsFromSources, rankHybridLeads } from "../src/engine.js";

const query =
  'Find Convex leads frustrated with "WebSocket reconnect", "real-time sync", cache invalidation, or Supabase alternatives.';

test("hybrid ranker keeps semantically relevant failure evidence even without exact wording", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "alice-sync",
        name: "Alice Sync",
        company: "Small Startup",
        bio: "Building collaborative TypeScript apps",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "alice-sync",
        name: "Alice Sync",
        score: 80,
        burning_problem_score: 0.8,
        evidence: [
          {
            type: "issue",
            repo: "supabase/supabase-swift",
            title: "Realtime first channel subscribe stalls for minutes",
            text: "channel.subscribeWithError stalls for 50 seconds to 7 minutes on first join",
            url: "https://github.com/supabase/supabase-swift/issues/999",
            created_at: "2026-06-20T12:00:00Z",
            matched_topics: ["realtime", "websocket"],
            contribution_weight: 4
          }
        ]
      }
    ],
    neuralLeads: [
      {
        engineer_login: "alice-sync",
        score: 90,
        answer_context: {
          burning_problem_score: 0.9
        },
        recent_activity: [
          {
            type: "issue",
            repo: "supabase/supabase-swift",
            title: "Realtime first channel subscribe stalls for minutes",
            snippet: "Realtime subscribe stalls and reconnect behavior is unreliable.",
            url: "https://github.com/supabase/supabase-swift/issues/999",
            occurred_at: "2026-06-20T12:00:00Z",
            matched_terms: ["realtime", "subscription"],
            pain_score: 0.8,
            pain_signals: ["timeout"]
          }
        ]
      }
    ]
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].engineer_login, "alice-sync");
  assert.ok(result.results[0].icp_fit_score >= 6.5);
  assert.equal(result.results[0].sources_used.structured, true);
  assert.equal(result.results[0].sources_used.neural, true);
});

test("hybrid ranker excludes own-company maintainers and docs-only activity", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "supabase-maintainer",
        name: "Maintainer",
        company: "@supabase",
        bio: "Realtime maintainer",
        type: "User"
      },
      {
        login: "docs-only",
        name: "Docs Only",
        company: "TinyCo",
        bio: "Frontend engineer",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "supabase-maintainer",
        name: "Maintainer",
        score: 99,
        evidence: [
          {
            type: "pull_request",
            repo: "supabase/realtime",
            title: "fix realtime reconnect",
            text: "Fix reconnect failure",
            url: "https://github.com/supabase/realtime/pull/1",
            created_at: "2026-06-20T12:00:00Z",
            matched_topics: ["realtime"],
            contribution_weight: 10
          }
        ]
      },
      {
        engineer_login: "docs-only",
        name: "Docs Only",
        score: 75,
        evidence: [
          {
            type: "pull_request",
            repo: "liveblocks/liveblocks",
            title: "Fix README typo",
            text: "docs typo README.md",
            url: "https://github.com/liveblocks/liveblocks/pull/2",
            created_at: "2026-06-20T12:00:00Z",
            matched_topics: [],
            contribution_weight: 10
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 0);
});

test("hybrid ranker can accept neural-only candidates when evidence is strong", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "neural-only",
        name: "Neural Only",
        company: "Seed Stage",
        bio: "Building realtime dashboards",
        type: "User"
      }
    ],
    structuredLeads: [],
    neuralLeads: [
      {
        engineer_login: "neural-only",
        name: "Neural Only",
        score: 88,
        answer_context: {
          burning_problem_score: 0.75
        },
        recent_activity: [
          {
            type: "technical_comment",
            repo: "anomalyco/sst",
            title: "Comment on bridge timeout",
            snippet: "Intermittent bridge timeout after AppSync connection drops and reconnect does not recover.",
            url: "https://github.com/anomalyco/sst/issues/1#issuecomment-1",
            occurred_at: "2026-06-26T12:00:00Z",
            matched_terms: ["websocket", "reconnect"],
            pain_score: 0.85,
            pain_signals: ["timeout", "reconnect failure"]
          }
        ]
      }
    ]
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sources_used.structured, false);
  assert.equal(result.results[0].sources_used.neural, true);
});

test("hybrid ranker excludes repo-company emails found in stored evidence", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "internal-nhost",
        name: "Internal Nhost",
        company: null,
        bio: "Backend engineer",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "internal-nhost",
        name: "Internal Nhost",
        score: 90,
        evidence: [
          {
            type: "commit",
            repo: "nhost/nhost",
            title: "fix realtime reconnect",
            text: "Co-authored-by: internal-nhost <internal@nhost.io>",
            url: "https://github.com/nhost/nhost/commit/1",
            created_at: "2026-06-20T12:00:00Z",
            matched_topics: ["realtime"],
            contribution_weight: 6
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 0);
});

test("direct buyer issue evidence outranks implementation PR evidence", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "buyer-issue",
        name: "Buyer Issue",
        company: "Seed Startup",
        bio: "Building realtime apps",
        type: "User"
      },
      {
        login: "implementation-pr",
        name: "Implementation PR",
        company: "Consultant",
        bio: "OSS contributor",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "buyer-issue",
        name: "Buyer Issue",
        score: 35,
        evidence: [
          {
            type: "issue",
            repo: "supabase/supabase-flutter",
            title: "postgres_changes reports SUBSCRIBED but delivers nothing",
            text: "What happened? In our production app, postgres_changes reports SUBSCRIBED but users receive no realtime updates after replication fails.",
            url: "https://github.com/supabase/supabase-flutter/issues/1",
            created_at: "2026-06-25T12:00:00Z",
            matched_topics: ["realtime", "replication", "supabase"],
            contribution_weight: 4
          }
        ]
      },
      {
        engineer_login: "implementation-pr",
        name: "Implementation PR",
        score: 95,
        evidence: [
          {
            type: "pull_request",
            repo: "supabase/supabase-flutter",
            title: "fix(realtime): improve reconnect implementation",
            text: "Refactor reconnect code paths and add tests for dropped sockets.",
            url: "https://github.com/supabase/supabase-flutter/pull/1",
            created_at: "2026-06-26T12:00:00Z",
            matched_topics: ["realtime", "websocket"],
            contribution_weight: 10
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results[0].engineer_login, "buyer-issue");
});

test("code-only comments do not look like persuasive buyer pain", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "code-only",
        name: "Code Only",
        company: "App Studio",
        bio: "React Native developer",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "code-only",
        name: "Code Only",
        score: 85,
        evidence: [
          {
            type: "comment",
            repo: "instantdb/instant",
            title: "```typescript import { useEffect, useRef, useState } from \"react\";",
            text: "```typescript import { useEffect, useRef, useState } from 'react'; const x = useState(); function Demo() { return null } export function App() { return <Demo /> } ```",
            url: "https://github.com/instantdb/instant/issues/1#issuecomment-1",
            created_at: "2026-06-25T12:00:00Z",
            matched_topics: ["auth"],
            contribution_weight: 2
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 0);
});

test("older severe realtime issue can still rank as persuasive", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "realtime-stall",
        name: "Realtime Stall",
        company: "Mobile App Co",
        bio: "Building realtime mobile products",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "realtime-stall",
        name: "Realtime Stall",
        score: 43,
        evidence: [
          {
            type: "issue",
            repo: "supabase/supabase-swift",
            title: "[Bug]: Realtime first channel subscribe stalls for 50s-7min",
            text: "What happened? channel.subscribeWithError stalls for tens of seconds or minutes on the first JOIN of a realtime channel.",
            url: "https://github.com/supabase/supabase-swift/issues/999",
            created_at: "2026-05-20T02:49:41Z",
            matched_topics: ["realtime", "websocket"],
            contribution_weight: 4
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 1);
  assert.ok(result.results[0].icp_fit_score >= 7);
});

test("product-aware ranking prefers Lopus analytics pain over generic realtime pain", () => {
  const result = rankHybridLeads({
    query: BUYER_PROFILES.lopus.query,
    buyerProfile: BUYER_PROFILES.lopus,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "generic-realtime",
        name: "Generic Realtime",
        company: "App Co",
        bio: "Building realtime apps",
        type: "User"
      },
      {
        login: "growth-analytics",
        name: "Growth Analytics",
        company: "Growth Startup",
        bio: "Growth engineer working on product analytics",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "generic-realtime",
        name: "Generic Realtime",
        score: 95,
        evidence: [
          {
            type: "issue",
            repo: "supabase/supabase-flutter",
            title: "Realtime channel subscribe stalls",
            text: "What happened? Realtime channel subscribe stalls for minutes and websocket reconnect fails.",
            url: "https://github.com/supabase/supabase-flutter/issues/1",
            created_at: "2026-06-25T12:00:00Z",
            matched_topics: ["realtime", "websocket"],
            contribution_weight: 8
          }
        ]
      },
      {
        engineer_login: "growth-analytics",
        name: "Growth Analytics",
        score: 60,
        evidence: [
          {
            type: "issue",
            repo: "posthog/posthog",
            title: "Events arrive late and break growth dashboard funnels",
            text: "Our production growth dashboard is unreliable because event ingestion lag makes funnels and experiment metrics stale for users.",
            url: "https://github.com/posthog/posthog/issues/1",
            created_at: "2026-06-24T12:00:00Z",
            matched_topics: ["analytics", "events", "growth", "funnel"],
            contribution_weight: 4
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.buyer_profile.id, "lopus");
  assert.equal(result.results[0].engineer_login, "growth-analytics");
  assert.match(result.results[0].why_product_fits, /Lopus/);
  assert.equal(result.results[0].why_convex_fits, undefined);
});

test("non-Convex buyer profile produces product-specific outreach", () => {
  const result = rankHybridLeads({
    query: BUYER_PROFILES.lore.query,
    buyerProfile: BUYER_PROFILES.lore,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "agent-team",
        name: "Agent Team",
        company: "AI Devtools Startup",
        bio: "Building AI coding workflows",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "agent-team",
        name: "Agent Team",
        score: 62,
        evidence: [
          {
            type: "issue",
            repo: "coder/agentapi",
            title: "Agent handoff loses shared Claude Code context",
            text: "We hit a production workflow problem: Claude Code and Codex agents lose shared context during review handoff, so our team repeats prompt setup work.",
            url: "https://github.com/coder/agentapi/issues/1",
            created_at: "2026-06-26T12:00:00Z",
            matched_topics: ["claude", "codex", "agent", "context"],
            contribution_weight: 4
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].product_fit.product, "Lore");
  assert.match(result.results[0].why_product_fits, /Lore/);
  assert.match(result.results[0].outreach.join(" "), /Lore/);
  assert.doesNotMatch(result.results[0].outreach.join(" "), /Convex/);
});

test("quality summary marks strong direct product-fit evidence as demo-ready", () => {
  const result = rankHybridLeads({
    query: BUYER_PROFILES.openai.query,
    buyerProfile: BUYER_PROFILES.openai,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "agent-failure",
        name: "Agent Failure",
        company: "AI Startup",
        bio: "Building agent workflows",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "agent-failure",
        name: "Agent Failure",
        score: 80,
        evidence: [
          {
            type: "issue",
            repo: "langchain-ai/langchainjs",
            title: "Tool calling loop drops function result and breaks production agent",
            text: "What happened? Our production AI agent fails because tool calling drops the function result. Users see a 400 error and the agent cannot recover.",
            url: "https://github.com/langchain-ai/langchainjs/issues/1",
            created_at: "2026-06-26T12:00:00Z",
            matched_topics: ["agent", "tool call", "function calling"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results[0].quality_label, "demo_ready");
  assert.equal(result.quality_summary.demo_ready, 1);
  assert.equal(result.coverage_diagnostics.status, "thin");
});

test("coverage diagnostics reports missing corpus coverage with suggested seeds", () => {
  const result = rankHybridLeads({
    query: BUYER_PROFILES["orange-slice"].query,
    buyerProfile: BUYER_PROFILES["orange-slice"],
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [],
    structuredLeads: [],
    neuralLeads: []
  });

  assert.equal(result.result_count, 0);
  assert.equal(result.coverage_diagnostics.status, "missing");
  assert.ok(result.coverage_diagnostics.suggested_seed_repos.includes("n8n-io/n8n"));
});

test("multi-index loader dedupes users while merging evidence", async () => {
  const result = await loadHybridInputsFromSources([
    {
      id: "fixture-a",
      structuredRoot: new URL("fixtures/source-a", import.meta.url).pathname,
      neuralLeadsPath: new URL("fixtures/source-a/scored_leads.ndjson", import.meta.url).pathname
    },
    {
      id: "fixture-b",
      structuredRoot: new URL("fixtures/source-b", import.meta.url).pathname,
      neuralLeadsPath: new URL("fixtures/source-b/scored_leads.ndjson", import.meta.url).pathname
    }
  ]);

  assert.equal(result.structuredLeads.length, 1);
  assert.equal(result.neuralLeads.length, 1);
  assert.equal(result.rawUsers.length, 1);
  assert.equal(result.structuredLeads[0].evidence.length, 2);
  assert.equal(result.neuralLeads[0].recent_activity.length, 2);
  assert.equal(result.inputTotals.structured_leads, 2);
  assert.equal(result.indexSources.length, 2);
});
