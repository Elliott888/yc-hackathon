import assert from "node:assert/strict";
import test from "node:test";
import { BUYER_PROFILES, resolveBuyerProfile } from "../src/buyer-profiles.js";
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

test("hybrid ranker emits company source and commit metadata email when indexed", () => {
  const result = rankHybridLeads({
    query,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "commit-email-lead",
        name: "Commit Email Lead",
        company: "Realtime Startup",
        bio: "Building collaborative apps",
        email: null,
        type: "User"
      }
    ],
    rawCommits: [
      {
        author_login: "commit-email-lead",
        author_email: "founder@realtime.example",
        repo: "liveblocks/liveblocks",
        url: "https://github.com/liveblocks/liveblocks/commit/abc"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "commit-email-lead",
        name: "Commit Email Lead",
        score: 80,
        evidence: [
          {
            type: "issue",
            repo: "liveblocks/liveblocks",
            title: "Shared room storage overwrite causes data loss",
            text: "What happened? Shared room storage overwrites collaborative state and causes data loss for users.",
            url: "https://github.com/liveblocks/liveblocks/issues/2",
            created_at: "2026-06-25T12:00:00Z",
            matched_topics: ["liveblocks", "shared state", "data loss"],
            contribution_weight: 4
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].company, "Realtime Startup");
  assert.equal(result.results[0].company_source, "profile");
  assert.deepEqual(result.results[0].email, {
    value: "founder@realtime.example",
    source: "commit_metadata",
    note: "Found in indexed commit metadata."
  });
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

test("Convex profile rejects Copilot script failure noise", () => {
  const result = rankHybridLeads({
    query,
    buyerProfile: BUYER_PROFILES.convex,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "script-noise",
        name: "Script Noise",
        company: "Devtools Startup",
        bio: "Build tooling maintainer",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "script-noise",
        name: "Script Noise",
        score: 95,
        evidence: [
          {
            type: "comment",
            repo: "pubkey/rxdb-server",
            title: "@copilot still fails: node ./scripts/update-version-variable.mjs exits during release",
            text: "@copilot still fails: node ./scripts/update-version-variable.mjs prints package version output and exits with a release script error. This is test automation noise, not backend state or realtime app pain.",
            url: "https://github.com/pubkey/rxdb-server/issues/1#issuecomment-1",
            created_at: "2026-06-27T12:00:00Z",
            matched_topics: ["sync"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 0);
});

test("Convex profile treats shared room overwrite data loss as demo-ready", () => {
  const result = rankHybridLeads({
    query,
    buyerProfile: BUYER_PROFILES.convex,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "shared-state-builder",
        name: "Shared State Builder",
        company: "Realtime App Co",
        bio: "Building collaborative apps",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "shared-state-builder",
        name: "Shared State Builder",
        score: 90,
        evidence: [
          {
            type: "issue",
            repo: "liveblocks/liveblocks",
            title: "Attempting a large single write overwrites a room with initialStorage",
            text: "What happened? A large write to shared room storage overwrites existing collaborative state with initialStorage and causes data loss for users.",
            url: "https://github.com/liveblocks/liveblocks/issues/1",
            created_at: "2026-06-27T12:00:00Z",
            matched_topics: ["liveblocks", "room", "shared state", "data loss"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].quality_label, "demo_ready");
  assert.ok(result.results[0].score_breakdown.product_fit >= 5);
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

test("Lore profile rejects generic multi-agent infrastructure without AI-coding collaboration anchors", () => {
  const result = rankHybridLeads({
    query: BUYER_PROFILES.lore.query,
    buyerProfile: BUYER_PROFILES.lore,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "agent-infra",
        name: "Agent Infra",
        company: "AI Infra Startup",
        bio: "Building multi-agent systems",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "agent-infra",
        name: "Agent Infra",
        score: 90,
        evidence: [
          {
            type: "issue",
            repo: "agent-infra/orchestrator",
            title: "Core SDK lacks a multi-model panel provider without a multi-agent graph",
            text: "The orchestrator can run multiple agents with GPT and Anthropic Claude models but cannot get a multi-model perspective on one response without creating a new multi-agent graph. The shared context and prompt workflow are internal runtime concepts, not team AI-coding collaboration.",
            url: "https://github.com/agent-infra/orchestrator/issues/1",
            created_at: "2026-06-27T12:00:00Z",
            matched_topics: ["multi-agent", "shared context", "prompt workflow"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 0);
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

test("custom buyer profile extracts product and expands domain terms", () => {
  const profile = resolveBuyerProfile({
    query:
      "I want leads for Rev1, AI for mechanical engineers. Find engineers discussing CAD, CAE, STEP files, meshing failures, simulation setup, tolerance analysis, or mechanical design automation."
  });

  assert.equal(profile.id, "custom");
  assert.equal(profile.product, "Rev1");
  assert.equal(profile.label, "Rev1 Buyer");
  assert.ok(profile.fitTerms.includes("cad"));
  assert.ok(profile.fitTerms.includes("step"));
  assert.ok(profile.fitTerms.includes("mechanical engineering"));
  assert.ok(profile.suggestedSeedRepos.includes("FreeCAD/FreeCAD"));
});

test("explicit buyer product name outranks generic pain-category inference", () => {
  const profile = resolveBuyerProfile({
    query:
      "I want leads for Convex. Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend."
  });

  assert.equal(profile.id, "convex");
  assert.equal(profile.product, "Convex");
});

test("custom buyer profile extracts product from parenthetical format", () => {
  const profile = resolveBuyerProfile({
    query:
      "Find GitHub users for Verdex (Satellite Imagery Verification for Insurance) who are discussing geospatial imagery, raster pipelines, roof detection, claims workflows, or satellite data quality."
  });

  assert.equal(profile.product, "Verdex");
  assert.equal(profile.label, "Verdex Buyer");
  assert.ok(profile.fitTerms.includes("satellite imagery"));
  assert.ok(profile.fitTerms.includes("geospatial"));
  assert.ok(profile.fitTerms.includes("insurance claims"));
  assert.ok(profile.suggestedSeedRepos.includes("rasterio/rasterio"));
});

test("custom buyer ranking uses extracted product in fit and outreach", () => {
  const query =
    "I want leads for Rev1, AI for mechanical engineers. Find engineers discussing CAD, CAE, STEP files, meshing failures, simulation setup, tolerance analysis, or mechanical design automation.";
  const profile = resolveBuyerProfile({ query });
  const result = rankHybridLeads({
    query,
    buyerProfile: profile,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "mech-founder",
        name: "Mechanical Founder",
        company: "Hardware Startup",
        bio: "Building CAD automation for mechanical teams",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "mech-founder",
        name: "Mechanical Founder",
        score: 55,
        evidence: [
          {
            type: "issue",
            repo: "FreeCAD/FreeCAD",
            title: "STEP import creates invalid mesh and breaks tolerance analysis workflow",
            text: "What happened? Our mechanical design automation pipeline fails when STEP import creates invalid CAD geometry. The CAE simulation setup breaks and engineers manually repair the mesh.",
            url: "https://github.com/FreeCAD/FreeCAD/issues/1",
            created_at: "2026-06-26T12:00:00Z",
            matched_topics: ["cad", "step", "mesh", "simulation"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].product_fit.product, "Rev1");
  assert.match(result.results[0].why_product_fits, /Rev1/);
  assert.match(result.results[0].outreach.join(" "), /Rev1/);
  assert.match(result.results[0].why_this_is_high_intent, /mechanical engineering/);
});

test("custom domain profile rejects weak one-term false positives", () => {
  const query =
    "I want leads for Rev1, AI for mechanical engineers. Find engineers discussing CAD, CAE, STEP files, meshing failures, simulation setup, tolerance analysis, or mechanical design automation.";
  const profile = resolveBuyerProfile({ query });
  const result = rankHybridLeads({
    query,
    buyerProfile: profile,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "generic-backend",
        name: "Generic Backend",
        company: "Backend Startup",
        bio: "Backend engineer",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "generic-backend",
        name: "Generic Backend",
        score: 95,
        evidence: [
          {
            type: "issue",
            repo: "supabase/supabase-flutter",
            title: "Realtime channel fails during setup",
            text: "What happened? The realtime channel fails during setup and users stop receiving updates.",
            url: "https://github.com/supabase/supabase-flutter/issues/2",
            created_at: "2026-06-26T12:00:00Z",
            matched_topics: ["realtime"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 0);
  assert.equal(result.coverage_diagnostics.status, "missing");
});

test("custom observability query extracts category and seed repos", () => {
  const profile = resolveBuyerProfile({
    query:
      "I want leads for an observability startup. Find engineers talking about flaky traces, missing spans, error grouping, production incidents, log correlation, alert fatigue, or debugging distributed systems."
  });

  assert.equal(profile.product, "Observability startup");
  assert.equal(profile.painArea, "observability");
  assert.ok(profile.fitTerms.includes("trace"));
  assert.ok(profile.fitTerms.includes("error grouping"));
  assert.ok(profile.suggestedSeedRepos.includes("open-telemetry/opentelemetry-js"));
});

test("custom observability profile rejects generic production failures without observability anchors", () => {
  const query =
    "I want leads for an observability startup. Find engineers talking about flaky traces, missing spans, error grouping, production incidents, log correlation, alert fatigue, or debugging distributed systems.";
  const profile = resolveBuyerProfile({ query });
  const result = rankHybridLeads({
    query,
    buyerProfile: profile,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "prod-debugger",
        name: "Production Debugger",
        company: "Infra Startup",
        bio: "Backend engineer",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "prod-debugger",
        name: "Production Debugger",
        score: 98,
        evidence: [
          {
            type: "issue",
            repo: "generic/backend",
            title: "Rolling deploy caused a production incident",
            text: "What happened? During a distributed systems deploy we had a production incident. The logs include a stack trace, but this is really a retry race in startup order.",
            url: "https://github.com/generic/backend/issues/1",
            created_at: "2026-06-27T12:00:00Z",
            matched_topics: ["production incident"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 0);
  assert.equal(result.coverage_diagnostics.status, "missing");
});

test("custom observability profile accepts explicit tracing and span failures", () => {
  const query =
    "I want leads for an observability startup. Find engineers talking about flaky traces, missing spans, error grouping, production incidents, log correlation, alert fatigue, or debugging distributed systems.";
  const profile = resolveBuyerProfile({ query });
  const result = rankHybridLeads({
    query,
    buyerProfile: profile,
    now: new Date("2026-06-28T12:00:00Z"),
    rawUsers: [
      {
        login: "otel-builder",
        name: "OTel Builder",
        company: "Infra Startup",
        bio: "Observability engineer",
        type: "User"
      }
    ],
    structuredLeads: [
      {
        engineer_login: "otel-builder",
        name: "OTel Builder",
        score: 72,
        evidence: [
          {
            type: "issue",
            repo: "open-telemetry/opentelemetry-js",
            title: "OpenTelemetry tracing drops child spans after reconnect",
            text: "What happened? Missing spans break trace correlation during production incidents and make error grouping unreliable.",
            url: "https://github.com/open-telemetry/opentelemetry-js/issues/1",
            created_at: "2026-06-27T12:00:00Z",
            matched_topics: ["opentelemetry", "tracing", "spans"],
            contribution_weight: 5
          }
        ]
      }
    ],
    neuralLeads: []
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].product_fit.product, "Observability startup");
  assert.match(result.results[0].why_product_fits, /traces|spans|logs|incidents/i);
});

test("custom serverless state query extracts category and stateful edge terms", () => {
  const profile = resolveBuyerProfile({
    query:
      "I want leads for a serverless state platform. Find engineers discussing Durable Objects, actor systems, websocket state, edge coordination, regional consistency, or stateful serverless scaling."
  });

  assert.equal(profile.product, "Serverless state platform");
  assert.equal(profile.painArea, "serverless state");
  assert.ok(profile.fitTerms.includes("durable objects"));
  assert.ok(profile.fitTerms.includes("actor systems"));
  assert.ok(profile.suggestedSeedRepos.includes("cloudflare/workerd"));
});
