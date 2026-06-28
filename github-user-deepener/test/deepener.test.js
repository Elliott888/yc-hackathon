import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeadDossiers,
  filterDossiersByReliability,
  rankUserEvidence,
  summarizeDossierQuality
} from "../src/deepener.js";

const query =
  "Find Convex leads with real-time sync failures, cache invalidation pain, Firebase or Supabase alternatives, and simpler TypeScript full-stack backend needs.";

const now = new Date("2026-06-28T12:00:00Z");

test("lead dossier upgrades a repo-triggered lead when cross-repo user evidence triangulates the same Convex pain", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "alice-sync",
        name: "Alice Sync",
        github_url: "https://github.com/alice-sync",
        icp_fit_score: 7.2,
        trigger: {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "postgres_changes reports SUBSCRIBED but delivers nothing",
          snippet:
            "What happened? In our production app, postgres_changes reports SUBSCRIBED but users receive no realtime updates.",
          url: "https://github.com/supabase/supabase-flutter/issues/1",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["supabase", "realtime", "replication"]
        }
      }
    ],
    userActivities: [
      {
        login: "alice-sync",
        type: "issue",
        repo: "myorg/collab-dashboard",
        title: "Presence channel drops updates after reconnect",
        text:
          "In our app users stop seeing shared dashboard changes after reconnect. We need realtime sync without manual rollback logic.",
        url: "https://github.com/myorg/collab-dashboard/issues/42",
        occurred_at: "2026-06-24T12:00:00Z"
      },
      {
        login: "alice-sync",
        type: "manifest",
        repo: "alice-sync/launchpad",
        path: "package.json",
        text: '{"dependencies":{"@supabase/supabase-js":"latest","@tanstack/react-query":"latest","ws":"latest","zod":"latest"}}',
        url: "https://github.com/alice-sync/launchpad/blob/main/package.json",
        occurred_at: "2026-06-22T12:00:00Z"
      },
      {
        login: "alice-sync",
        type: "code",
        repo: "alice-sync/launchpad",
        path: "src/hooks/useTasks.ts",
        text:
          "useEffect(() => { fetch('/api/tasks').then(load); }, [teamId]); queryClient.invalidateQueries(['tasks']); socket.on('task:update', refetch);",
        url: "https://github.com/alice-sync/launchpad/blob/main/src/hooks/useTasks.ts",
        occurred_at: "2026-06-21T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers.length, 1);
  const dossier = dossiers[0];
  assert.equal(dossier.engineer_login, "alice-sync");
  assert.ok(dossier.proof_depth_score >= 9);
  assert.equal(dossier.proof_chain.direct_pain.length, 1);
  assert.equal(dossier.proof_chain.related_pain.length, 1);
  assert.equal(dossier.proof_chain.stack_evidence.length, 1);
  assert.equal(dossier.proof_chain.code_manifestations.length, 1);
  assert.equal(dossier.reliability_audit.level, "demo_ready");
  assert.deepEqual(dossier.reliability_audit.evidence_gaps, []);
  assert.match(dossier.why_this_is_surprisingly_deep, /same person/i);
  assert.match(dossier.why_convex_fits, /reactive backend/i);

  assert.equal(dossier.evidence_graph.nodes.some((node) => node.id === "user:alice-sync"), true);
  assert.equal(dossier.evidence_graph.nodes.some((node) => node.type === "trigger_pain"), true);
  assert.equal(dossier.evidence_graph.nodes.some((node) => node.type === "related_pain"), true);
  assert.equal(dossier.evidence_graph.nodes.some((node) => node.type === "stack_evidence"), true);
  assert.equal(dossier.evidence_graph.nodes.some((node) => node.type === "code_manifestation"), true);
  assert.equal(dossier.evidence_graph.nodes.some((node) => node.id === "product:convex"), true);
  assert.equal(new Set(dossier.evidence_graph.nodes.map((node) => node.id)).size, dossier.evidence_graph.nodes.length);
  assert.deepEqual(dossier.evidence_graph.summary, {
    direct_pain: 1,
    related_pain: 1,
    stack_evidence: 1,
    code_manifestations: 1
  });
  assert.equal(
    dossier.evidence_graph.edges.some(
      (edge) => edge.from === "user:alice-sync" && edge.relation === "reported" && edge.to.startsWith("trigger:")
    ),
    true
  );
  assert.equal(
    dossier.evidence_graph.edges.some(
      (edge) => edge.from.startsWith("evidence:") && edge.relation === "supports_fit" && edge.to === "product:convex"
    ),
    true
  );
});

test("lead dossier marks a single-trigger lead as under-proven when no other user activity supports it", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "single-signal",
        name: "Single Signal",
        github_url: "https://github.com/single-signal",
        icp_fit_score: 7.8,
        trigger: {
          type: "issue",
          repo: "supabase/supabase-swift",
          title: "Realtime first channel subscribe stalls for minutes",
          snippet: "channel.subscribe stalls on first join",
          url: "https://github.com/supabase/supabase-swift/issues/99",
          occurred_at: "2026-06-20T12:00:00Z",
          matched_topics: ["realtime", "supabase"]
        }
      }
    ],
    userActivities: []
  });

  assert.equal(dossiers.length, 1);
  assert.ok(dossiers[0].proof_depth_score < 8);
  assert.equal(dossiers[0].qualification_status, "needs_more_user_evidence");
  assert.equal(dossiers[0].reliability_audit.level, "not_demo_ready");
  assert.ok(dossiers[0].reliability_audit.evidence_gaps.includes("Needs second-hop same-user evidence"));
  assert.match(dossiers[0].next_best_harvest, /public events/i);
  assert.equal(dossiers[0].evidence_graph.nodes.some((node) => node.type === "gap"), true);
  assert.equal(
    dossiers[0].evidence_graph.edges.some((edge) => edge.relation === "needs_evidence"),
    true
  );
});

test("quality filtering can return only demo-ready dossiers with discard counts", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "demo-lead",
        name: "Demo Lead",
        github_url: "https://github.com/demo-lead",
        icp_fit_score: 8.5,
        trigger: {
          type: "issue",
          repo: "liveblocks/liveblocks",
          title: "Large single write overwrites a room with initialStorage",
          snippet:
            "Attempting to write a large enough change in a single LiveObject.set can result in the room contents being overwritten with initialStorage.",
          url: "https://github.com/liveblocks/liveblocks/issues/10",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["liveblocks"]
        }
      },
      {
        engineer_login: "thin-lead",
        name: "Thin Lead",
        github_url: "https://github.com/thin-lead",
        icp_fit_score: 8.1,
        trigger: {
          type: "issue",
          repo: "supabase/supabase-swift",
          title: "Realtime first channel subscribe stalls for minutes",
          snippet: "channel.subscribe stalls on first join",
          url: "https://github.com/supabase/supabase-swift/issues/10",
          occurred_at: "2026-06-20T12:00:00Z",
          matched_topics: ["realtime", "supabase"]
        }
      }
    ],
    userActivities: [
      {
        login: "demo-lead",
        type: "code",
        repo: "demo-lead/liveblocks-repro",
        path: "src/lib/loggingWebSocket.ts",
        title: "src/lib/loggingWebSocket.ts",
        text:
          "const socket = new WebSocket(url); // Liveblocks storage repro for room initialStorage overwrite. socket.onmessage = console.log;",
        url: "https://github.com/demo-lead/liveblocks-repro/blob/main/src/lib/loggingWebSocket.ts",
        occurred_at: "2026-06-24T12:00:00Z"
      }
    ],
    limit: 10
  });

  const filtered = filterDossiersByReliability(dossiers, "demo_ready");
  const report = summarizeDossierQuality({
    allDossiers: dossiers,
    returnedDossiers: filtered,
    minReliability: "demo_ready",
    targetDemoReady: 2
  });

  assert.deepEqual(filtered.map((dossier) => dossier.engineer_login), ["demo-lead"]);
  assert.equal(report.total_candidates_scored, 2);
  assert.equal(report.returned_count, 1);
  assert.equal(report.discarded_by_filter_count, 1);
  assert.equal(report.target_demo_ready, 2);
  assert.equal(report.target_met, false);
  assert.equal(report.demo_ready_shortfall, 1);
  assert.equal(report.reliability_counts.demo_ready, 1);
  assert.equal(report.reliability_counts.not_demo_ready, 1);
  assert.deepEqual(report.returned_reliability_levels, ["demo_ready"]);
  assert.equal(report.near_misses.length, 1);
  assert.equal(report.near_misses[0].engineer_login, "thin-lead");
  assert.deepEqual(report.near_misses[0].missing_proof, ["Needs second-hop same-user evidence"]);
  assert.equal(report.near_misses[0].follow_up_actions.length, 3);
  assert.deepEqual(
    report.near_misses[0].follow_up_actions.map((action) => action.kind),
    ["github_user_activity_harvest", "github_issue_search", "github_user_code_harvest"]
  );
  assert.match(report.near_misses[0].follow_up_actions[1].query, /involves:thin-lead/);
  assert.doesNotMatch(report.near_misses[0].follow_up_actions[1].query, /[()]/);
  assert.match(report.near_misses[0].follow_up_actions[1].query, /is:issue/);
  assert.match(report.near_misses[0].follow_up_actions[1].query, /realtime|websocket/i);
  assert.equal(report.near_misses[0].follow_up_actions[0].priority, 1);
  assert.equal(report.near_misses[0].follow_up_actions[1].priority, 2);
  assert.equal(report.near_misses[0].follow_up_actions[1].expected_proof, "same-user pain issue/comment");
  assert.match(report.near_misses[0].follow_up_actions[1].github_api_url, /^https:\/\/api\.github\.com\/search\/issues\?q=/);
  assert.match(report.near_misses[0].follow_up_actions[1].github_web_url, /^https:\/\/github\.com\/search\?q=/);
  assert.equal(report.near_misses[0].follow_up_actions[1].alternate_queries.length, 1);
  assert.match(report.near_misses[0].follow_up_actions[1].alternate_queries[0].query, /is:pull-request/);
  assert.match(report.near_misses[0].follow_up_actions[1].alternate_queries[0].github_api_url, /^https:\/\/api\.github\.com\/search\/issues\?q=/);
  assert.match(report.near_misses[0].follow_up_actions[2].reason, /code|manifest/i);
  assert.equal(report.near_misses[0].follow_up_actions[2].priority, 3);
  assert.equal(report.near_misses[0].follow_up_actions[2].expected_proof, "owned repo code or manifest evidence");
  assert.doesNotMatch(report.near_misses[0].follow_up_actions[1].query, /[()]/);
  assert.match(report.near_misses[0].follow_up_actions[1].github_web_url, /^https:\/\/github\.com\/search\?q=/);
});

test("quality reporting can expose a wider near-miss window for follow-up rounds", () => {
  const candidate = (login, score) => ({
    engineer_login: login,
    name: login,
    proof_depth_score: score,
    trigger: {
      type: "issue",
      repo: "supabase/supabase-js",
      title: `Realtime cache pain ${login}`,
      text: "Realtime cache invalidation problem",
      url: `https://github.com/supabase/supabase-js/issues/${score}`,
      occurred_at: "2026-06-25T12:00:00Z"
    },
    proof_chain: {
      direct_pain: [],
      related_pain: [],
      stack_evidence: [],
      code_manifestations: []
    },
    reliability_audit: {
      level: "needs_stack_or_code_proof",
      cross_repo_support: false,
      evidence_gaps: ["Needs direct buyer pain report"]
    },
    demo_brief: {
      headline: `${login} needs more proof`
    },
    next_best_harvest: `Fetch ${login}`
  });

  const allDossiers = [
    candidate("lead-1", 9.6),
    candidate("lead-2", 9.5),
    candidate("lead-3", 9.4),
    candidate("lead-4", 9.3),
    candidate("lead-5", 9.2)
  ];

  const defaultReport = summarizeDossierQuality({
    allDossiers,
    returnedDossiers: [],
    minReliability: "demo_ready",
    targetDemoReady: 2
  });
  const wideReport = summarizeDossierQuality({
    allDossiers,
    returnedDossiers: [],
    minReliability: "demo_ready",
    targetDemoReady: 2,
    nearMissLimit: 5
  });

  assert.deepEqual(
    defaultReport.near_misses.map((nearMiss) => nearMiss.engineer_login),
    ["lead-1", "lead-2", "lead-3"]
  );
  assert.deepEqual(
    wideReport.near_misses.map((nearMiss) => nearMiss.engineer_login),
    ["lead-1", "lead-2", "lead-3", "lead-4", "lead-5"]
  );
});

test("near-miss reporting prioritizes direct-pain leads that need second-hop proof over stack-only leads", () => {
  const directPainNeedsDeepening = {
    engineer_login: "direct-needs-code",
    name: "Direct Needs Code",
    proof_depth_score: 3.5,
    trigger: {
      type: "issue",
      repo: "liveblocks/liveblocks",
      title: "Large single write overwrites room initialStorage",
      text: "Liveblocks websocket room state overwrite needs a repro.",
      url: "https://github.com/liveblocks/liveblocks/issues/1",
      occurred_at: "2026-06-25T12:00:00Z"
    },
    proof_chain: {
      direct_pain: [{ title: "Large single write overwrites room initialStorage" }],
      related_pain: [],
      stack_evidence: [],
      code_manifestations: []
    },
    reliability_audit: {
      level: "not_demo_ready",
      cross_repo_support: false,
      evidence_gaps: ["Needs second-hop same-user evidence"]
    },
    demo_brief: { headline: "Direct lead needs code" },
    next_best_harvest: "Fetch direct-needs-code"
  };
  const stackOnlyHigherScore = {
    engineer_login: "stack-only-high-score",
    name: "Stack Only High Score",
    proof_depth_score: 9.5,
    trigger: {
      type: "issue",
      repo: "firebase/firebase-tools",
      title: "Firestore cache timeout",
      text: "Firestore cache timeout",
      url: "https://github.com/firebase/firebase-tools/issues/2",
      occurred_at: "2026-06-25T12:00:00Z"
    },
    proof_chain: {
      direct_pain: [{ title: "Firestore cache timeout" }],
      related_pain: [{ title: "Related issue" }],
      stack_evidence: [{ title: "package-lock.json" }],
      code_manifestations: []
    },
    reliability_audit: {
      level: "needs_stack_or_code_proof",
      cross_repo_support: true,
      evidence_gaps: ["Needs code manifestation proof"]
    },
    demo_brief: { headline: "Stack-only lead needs code" },
    next_best_harvest: "Fetch stack-only-high-score"
  };

  const report = summarizeDossierQuality({
    allDossiers: [stackOnlyHigherScore, directPainNeedsDeepening],
    returnedDossiers: [],
    minReliability: "demo_ready",
    targetDemoReady: 2,
    nearMissLimit: 2
  });

  assert.deepEqual(
    report.near_misses.map((nearMiss) => nearMiss.engineer_login),
    ["direct-needs-code", "stack-only-high-score"]
  );
});

test("semantic user evidence finds related activity even when wording differs from the original trigger", () => {
  const ranked = rankUserEvidence({
    query,
    now,
    login: "semantic-fit",
    trigger: {
      repo: "firebase/firebase-js-sdk",
      title: "Firestore local cache returns stale document after cold getDoc",
      snippet: "memoryLocalCache returns a stale doc and our UI does not update",
      url: "https://github.com/firebase/firebase-js-sdk/issues/1",
      occurred_at: "2026-06-26T12:00:00Z",
      type: "issue"
    },
    activities: [
      {
        login: "semantic-fit",
        type: "comment",
        repo: "other/repro",
        title: "Local-first replica stops converging after reconnect",
        text:
          "The browser replica diverges from server state after the tab resumes. Subscription callbacks never fire again.",
        url: "https://github.com/other/repro/issues/7#issuecomment-1",
        occurred_at: "2026-06-25T12:00:00Z"
      },
      {
        login: "semantic-fit",
        type: "pull_request",
        repo: "other/repro",
        title: "docs: fix typo",
        text: "README spelling",
        url: "https://github.com/other/repro/pull/8",
        occurred_at: "2026-06-25T12:00:00Z"
      }
    ]
  });

  assert.equal(ranked[0].url, "https://github.com/other/repro/issues/7#issuecomment-1");
  assert.ok(ranked[0].deep_relevance_score > 0.6);
  assert.ok(ranked.every((item) => item.type !== "pull_request"));
});

test("same-repo implementation and flaky-test artifacts do not deeply qualify a lead", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "impl-only",
        name: "Impl Only",
        github_url: "https://github.com/impl-only",
        icp_fit_score: 8.4,
        trigger: {
          type: "issue",
          repo: "electric-sql/electric",
          title: "Shape storage init races with draining instance during rolling deploy",
          snippet: "During production deploy, shared shape storage races and replication can diverge.",
          url: "https://github.com/electric-sql/electric/issues/1",
          occurred_at: "2026-06-24T12:00:00Z",
          matched_topics: ["sync", "replication"]
        }
      }
    ],
    userActivities: [
      {
        login: "impl-only",
        type: "issue",
        repo: "electric-sql/electric",
        title: 'Flaky test: PublicationManagerTest "handles relation tracker restart"',
        text: "The component restart test races the supervisor restart in packages/sync-service/test.",
        url: "https://github.com/electric-sql/electric/issues/2",
        occurred_at: "2026-06-23T12:00:00Z"
      },
      {
        login: "impl-only",
        type: "commit",
        repo: "electric-sql/electric",
        title: "fix(sync-service): prevent cache flooding",
        text: "Internal implementation fix for cold cache process mailbox flooding.",
        url: "https://github.com/electric-sql/electric/commit/abc",
        occurred_at: "2026-06-23T12:00:00Z"
      }
    ]
  });

  assert.ok(dossiers[0].proof_depth_score < 8);
  assert.equal(dossiers[0].qualification_status, "needs_more_user_evidence");
  assert.equal(dossiers[0].reliability_audit.level, "not_demo_ready");
  assert.ok(dossiers[0].reliability_audit.evidence_gaps.includes("Needs second-hop same-user evidence"));
  assert.equal(dossiers[0].proof_chain.stack_evidence.length, 0);
});

test("lead is not deeply qualified when reliability audit still needs a direct buyer pain report", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "support-rich",
        name: "Support Rich",
        github_url: "https://github.com/support-rich",
        icp_fit_score: 9.8,
        trigger: {
          type: "issue",
          repo: "appwrite/appwrite",
          title: "Upgrade metadata migration follow-up",
          snippet: "Metadata migration follow-up after version upgrade.",
          url: "https://github.com/appwrite/appwrite/issues/1",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["appwrite"]
        }
      }
    ],
    userActivities: [
      {
        login: "support-rich",
        type: "issue",
        repo: "support-rich/product",
        title: "Realtime sync callbacks never resume after reconnect",
        text: "In our app users stop seeing shared state updates after reconnect.",
        url: "https://github.com/support-rich/product/issues/2",
        occurred_at: "2026-06-24T12:00:00Z"
      },
      {
        login: "support-rich",
        type: "manifest",
        repo: "support-rich/product",
        path: "package.json",
        text: '{"dependencies":{"@supabase/supabase-js":"latest","@tanstack/react-query":"latest","ws":"latest"}}',
        url: "https://github.com/support-rich/product/blob/main/package.json",
        occurred_at: "2026-06-23T12:00:00Z"
      },
      {
        login: "support-rich",
        type: "code",
        repo: "support-rich/product",
        path: "src/realtime/tasks.ts",
        text:
          "socket.on('task:update', () => queryClient.invalidateQueries(['tasks'])); useEffect(() => { fetch('/api/tasks').then(refetch); }, []);",
        url: "https://github.com/support-rich/product/blob/main/src/realtime/tasks.ts",
        occurred_at: "2026-06-22T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.direct_pain.length, 0);
  assert.equal(dossiers[0].reliability_audit.evidence_gaps.includes("Needs direct buyer pain report"), true);
  assert.notEqual(dossiers[0].qualification_status, "deeply_qualified");
});

test("collaborative room overwrite and data loss is direct Convex pain when same-user code proof exists", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "room-sync",
        name: "Room Sync",
        github_url: "https://github.com/room-sync",
        icp_fit_score: 8.5,
        trigger: {
          type: "issue",
          repo: "liveblocks/liveblocks",
          title: "Large single write overwrites a room with initialStorage",
          snippet:
            "Attempting to write a large enough change in a single LiveObject.set can result in the room's contents being overwritten with initialStorage.",
          url: "https://github.com/liveblocks/liveblocks/issues/1",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["liveblocks"]
        }
      }
    ],
    userActivities: [
      {
        login: "room-sync",
        type: "code",
        repo: "room-sync/liveblocks-repro",
        path: "src/lib/loggingWebSocket.ts",
        title: "src/lib/loggingWebSocket.ts",
        text:
          "const socket = new WebSocket(url); // Liveblocks storage repro: log room storage messages before initialStorage overwrite. socket.onmessage = () => refetch(); socket.on('room:update', () => queryClient.invalidateQueries(['room']));",
        url: "https://github.com/room-sync/liveblocks-repro/blob/main/src/lib/loggingWebSocket.ts",
        occurred_at: "2026-06-24T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.direct_pain.length, 1);
  assert.equal(dossiers[0].proof_chain.code_manifestations.length, 1);
  assert.equal(
    dossiers[0].reliability_audit.evidence_gaps.includes("Needs stack or code manifestation proof"),
    false
  );
  assert.equal(
    dossiers[0].reliability_audit.evidence_gaps.includes("Needs related pain report tying code or stack proof to the buyer problem"),
    false
  );
  assert.equal(
    dossiers[0].reliability_audit.confidence_factors.includes("Code reproduction corroborates original pain"),
    true
  );
  assert.equal(dossiers[0].reliability_audit.level, "demo_ready");
  assert.equal(dossiers[0].qualification_status, "deeply_qualified");
  assert.ok(dossiers[0].proof_depth_score >= 8.5);
  assert.equal(dossiers[0].pain_diagnosis.primary_pain, "Collaborative state corruption");
  assert.equal(dossiers[0].pain_diagnosis.severity, "high");
  assert.match(dossiers[0].pain_diagnosis.why_burning, /room/i);
  assert.match(dossiers[0].pain_diagnosis.why_burning, /overwritten|overwrite/i);
  assert.match(dossiers[0].pain_diagnosis.code_manifestations[0], /WebSocket/i);
  assert.match(dossiers[0].pain_diagnosis.convex_angle, /reactive backend/i);
  assert.equal(dossiers[0].outreach.length, 3);
  assert.match(dossiers[0].outreach.join(" "), /loggingWebSocket\.ts/);
  assert.match(dossiers[0].outreach.join(" "), /Collaborative state corruption/i);
  assert.match(dossiers[0].outreach.join(" "), /reactive TypeScript backend/i);
  assert.equal(dossiers[0].demo_brief.verdict, "demo_ready");
  assert.match(dossiers[0].demo_brief.headline, /Room Sync/);
  assert.match(dossiers[0].demo_brief.headline, /demo-ready/);
  assert.match(dossiers[0].demo_brief.headline, /Collaborative state corruption/i);
  assert.equal(dossiers[0].demo_brief.proof_points.length, 2);
  assert.deepEqual(
    dossiers[0].demo_brief.proof_points.map((point) => point.kind),
    ["direct_pain", "code_reproduction"]
  );
  assert.ok(dossiers[0].demo_brief.proof_points.every((point) => point.url?.startsWith("https://github.com/")));
  assert.match(dossiers[0].demo_brief.proof_points[1].claim, /loggingWebSocket\.ts/);
  assert.match(dossiers[0].demo_brief.talk_track.join(" "), /room state/i);
  assert.deepEqual(dossiers[0].demo_brief.missing_proof, []);
  assert.match(dossiers[0].discovery_trace.summary, /same GitHub user/i);
  assert.deepEqual(
    dossiers[0].discovery_trace.steps.map((step) => step.stage),
    ["candidate_trigger", "user_deepening", "code_proof", "reliability_gate"]
  );
  assert.deepEqual(dossiers[0].discovery_trace.proof_counts, {
    direct_pain: 1,
    related_pain: 0,
    stack_evidence: 0,
    code_manifestations: 1
  });
  assert.equal(
    dossiers[0].discovery_trace.steps.find((step) => step.stage === "candidate_trigger").url,
    "https://github.com/liveblocks/liveblocks/issues/1"
  );
  assert.match(
    dossiers[0].discovery_trace.steps.find((step) => step.stage === "code_proof").title,
    /loggingWebSocket\.ts/
  );
  assert.ok(
    dossiers[0].discovery_trace.source_urls.includes(
      "https://github.com/room-sync/liveblocks-repro/blob/main/src/lib/loggingWebSocket.ts"
    )
  );
  assert.equal(dossiers[0].citation_audit.all_claims_cited, true);
  assert.equal(dossiers[0].citation_audit.uncited_claims.length, 0);
  assert.deepEqual(dossiers[0].citation_audit.checked_sections, [
    "proof_chain",
    "demo_brief",
    "evidence_timeline",
    "evidence_graph"
  ]);
  assert.ok(
    dossiers[0].citation_audit.source_urls.includes("https://github.com/liveblocks/liveblocks/issues/1")
  );
  assert.ok(
    dossiers[0].citation_audit.source_urls.includes(
      "https://github.com/room-sync/liveblocks-repro/blob/main/src/lib/loggingWebSocket.ts"
    )
  );
  assert.deepEqual(
    dossiers[0].evidence_timeline.map((event) => event.kind),
    ["code_manifestation", "direct_pain"]
  );
  assert.ok(dossiers[0].evidence_timeline[0].occurred_at < dossiers[0].evidence_timeline[1].occurred_at);
  assert.match(dossiers[0].evidence_timeline[0].title, /loggingWebSocket\.ts/);
  assert.match(dossiers[0].evidence_timeline[0].why_it_matters, /code|repro/i);
  assert.match(dossiers[0].evidence_timeline[1].title, /Large single write/);
  assert.ok(dossiers[0].evidence_timeline.every((event) => event.url?.startsWith("https://github.com/")));
});

test("demo-ready reliability requires cited URLs for every proof claim", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "uncited-proof",
        name: "Uncited Proof",
        github_url: "https://github.com/uncited-proof",
        icp_fit_score: 8.5,
        trigger: {
          type: "issue",
          repo: "liveblocks/liveblocks",
          title: "Large single write overwrites a room with initialStorage",
          snippet:
            "Attempting to write a large enough change in a single LiveObject.set can result in the room's contents being overwritten with initialStorage.",
          url: "https://github.com/liveblocks/liveblocks/issues/uncited",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["liveblocks"]
        }
      }
    ],
    userActivities: [
      {
        login: "uncited-proof",
        type: "code",
        repo: "uncited-proof/liveblocks-repro",
        path: "src/lib/loggingWebSocket.ts",
        title: "src/lib/loggingWebSocket.ts",
        text:
          "const socket = new WebSocket(url); // Liveblocks storage repro: log room storage messages before initialStorage overwrite. socket.onmessage = () => refetch(); socket.on('room:update', () => queryClient.invalidateQueries(['room']));",
        occurred_at: "2026-06-24T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.direct_pain.length, 1);
  assert.equal(dossiers[0].proof_chain.code_manifestations.length, 1);
  assert.equal(dossiers[0].citation_audit.all_claims_cited, false);
  assert.equal(dossiers[0].citation_audit.uncited_claims.length, 1);
  assert.equal(dossiers[0].citation_audit.uncited_claims[0].kind, "code_manifestation");
  assert.match(dossiers[0].citation_audit.uncited_claims[0].title, /loggingWebSocket\.ts/);
  assert.ok(dossiers[0].reliability_audit.evidence_gaps.includes("Needs citations for all proof claims"));
  assert.notEqual(dossiers[0].reliability_audit.level, "demo_ready");
  assert.notEqual(dossiers[0].qualification_status, "deeply_qualified");
});

test("commit text that mentions WebSocket is not treated as dependency-stack proof", () => {
  const ranked = rankUserEvidence({
    query,
    now,
    login: "commit-only",
    trigger: {
      type: "issue",
      repo: "supabase/supabase-flutter",
      title: "Realtime dropped connection",
      snippet: "WebSocket connection drops for users",
      url: "https://github.com/supabase/supabase-flutter/issues/1",
      occurred_at: "2026-06-24T12:00:00Z"
    },
    activities: [
      {
        login: "commit-only",
        type: "commit",
        repo: "supabase/supabase-flutter",
        title: "fix(realtime_client): detect dropped connections on iOS via WebSocket ping",
        text: "Enable pingInterval on the native WebSocket implementation.",
        url: "https://github.com/supabase/supabase-flutter/commit/1",
        occurred_at: "2026-06-24T12:00:00Z"
      }
    ]
  });

  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "commit-only",
        icp_fit_score: 8,
        trigger: {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Realtime dropped connection",
          snippet: "WebSocket connection drops for users",
          url: "https://github.com/supabase/supabase-flutter/issues/1",
          occurred_at: "2026-06-24T12:00:00Z"
        }
      }
    ],
    userActivities: ranked
  });

  assert.equal(dossiers[0].proof_chain.stack_evidence.length, 0);
});

test("generic infrastructure failures from the same user do not count as related Convex pain", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "mixed-signal",
        icp_fit_score: 8.6,
        trigger: {
          type: "comment",
          repo: "anomalyco/sst",
          title: "Intermittent bridge timeout after AppSync connection drops",
          snippet: "I'm seeing bridge timeout after AppSync connection drops and reconnect does not recover.",
          url: "https://github.com/anomalyco/sst/issues/1#issuecomment-1",
          occurred_at: "2026-06-27T12:00:00Z",
          matched_topics: ["websocket"]
        }
      }
    ],
    userActivities: [
      {
        login: "mixed-signal",
        type: "issue",
        repo: "canonical/cloud-init",
        title: "[bug]: EC2 datasource failing on first boot due to missing NICs",
        text: "cloud-init fails to retrieve EC2 metadata and SSH keys from user-data are not applied.",
        url: "https://github.com/canonical/cloud-init/issues/1",
        occurred_at: "2026-06-26T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.related_pain.length, 0);
  assert.equal(dossiers[0].qualification_status, "needs_more_user_evidence");
});

test("generic auth bugs in a BaaS repo are not treated as direct Convex pain", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "generic-auth",
        icp_fit_score: 8,
        trigger: {
          type: "issue",
          repo: "supabase/auth",
          title: "Unable to logout after OAuth redirect",
          snippet: "Bug report: logout fails after redirect and returns an auth error.",
          url: "https://github.com/supabase/auth/issues/1",
          occurred_at: "2026-06-26T12:00:00Z",
          matched_topics: ["supabase", "realtime", "sync", "cache"]
        }
      },
      {
        engineer_login: "realtime-direct",
        icp_fit_score: 7,
        trigger: {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "postgres_changes reports SUBSCRIBED but delivers nothing",
          snippet: "What happened? Realtime subscription delivers nothing to users.",
          url: "https://github.com/supabase/supabase-flutter/issues/2",
          occurred_at: "2026-06-26T12:00:00Z",
          matched_topics: ["supabase", "realtime"]
        }
      }
    ],
    userActivities: []
  });

  const generic = dossiers.find((dossier) => dossier.engineer_login === "generic-auth");
  assert.equal(generic.reliability_audit.confidence_factors.includes("Direct public pain report"), false);
  assert.equal(dossiers[0].engineer_login, "realtime-direct");
});

test("language-level sync primitives and generic backend transport code do not create demo-ready Convex leads", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "generic-sync",
        name: "Generic Sync",
        github_url: "https://github.com/generic-sync",
        icp_fit_score: 9,
        trigger: {
          type: "issue",
          repo: "casdoor/casdoor",
          title: "Device Authorization Grant breaks with multiple replicas because DeviceAuthMap is in-process sync.Map",
          snippet:
            "Device Authorization Grant breaks with multiple replicas. DeviceAuthMap is an in-process sync.Map and should be stored elsewhere.",
          url: "https://github.com/casdoor/casdoor/issues/5609",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["sync"]
        }
      }
    ],
    userActivities: [
      {
        login: "generic-sync",
        type: "issue",
        repo: "tsinghua-fib-lab/AgentSociety",
        title: "Simulation error: ray::OnlyClientSidecar.step()",
        text: "The simulation worker errors when a client sidecar step fails.",
        url: "https://github.com/tsinghua-fib-lab/AgentSociety/issues/16",
        occurred_at: "2026-06-24T12:00:00Z"
      },
      {
        login: "generic-sync",
        type: "code",
        repo: "generic-sync/SocialIRE",
        path: "extension/src/services/backendService.ts",
        title: "extension/src/services/backendService.ts",
        text:
          "BackendService handles HTTP and SSE communication with a FastAPI backend. fetch('/api/status'); eventSource.onmessage = handleMessage;",
        url: "https://github.com/generic-sync/SocialIRE/blob/main/extension/src/services/backendService.ts",
        occurred_at: "2026-06-23T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.direct_pain.length, 0);
  assert.equal(dossiers[0].proof_chain.code_manifestations.length, 0);
  assert.notEqual(dossiers[0].reliability_audit.level, "demo_ready");
  assert.notEqual(dossiers[0].qualification_status, "deeply_qualified");
  assert.ok(dossiers[0].reliability_audit.evidence_gaps.includes("Needs direct buyer pain report"));
});

test("code evidence must contain concrete realtime or cache state patterns before counting as code manifestation", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "generic-code",
        name: "Generic Code",
        github_url: "https://github.com/generic-code",
        icp_fit_score: 8.8,
        trigger: {
          type: "issue",
          repo: "firebase/firebase-tools",
          title: "Firestore local cache returns stale document after transaction timeout",
          snippet: "In our app, Firestore local cache returns stale data after a transaction timeout.",
          url: "https://github.com/firebase/firebase-tools/issues/123",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["firebase", "cache"]
        }
      }
    ],
    userActivities: [
      {
        login: "generic-code",
        type: "code",
        repo: "generic-code/app",
        path: "src/ui/ErrorDetailsDialog.tsx",
        title: "src/ui/ErrorDetailsDialog.tsx",
        text:
          "Generic Firebase error dialog for production users. It displays auth, timeout, and backend failure details in a modal. fetch('/api/errors').catch(showError); settings.set('expanded', true);",
        url: "https://github.com/generic-code/app/blob/main/src/ui/ErrorDetailsDialog.tsx",
        occurred_at: "2026-06-24T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.code_manifestations.length, 0);
  assert.notEqual(dossiers[0].reliability_audit.level, "demo_ready");
  assert.ok(dossiers[0].reliability_audit.evidence_gaps.includes("Needs second-hop same-user evidence"));
});

test("dedicated WebSocket implementation files count as code manifestation proof", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "websocket-code",
        name: "WebSocket Code",
        github_url: "https://github.com/websocket-code",
        icp_fit_score: 8.8,
        trigger: {
          type: "issue",
          repo: "liveblocks/liveblocks",
          title: "Large single write overwrites room storage",
          snippet: "Room storage is overwritten after a websocket reconnect.",
          url: "https://github.com/liveblocks/liveblocks/issues/99",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["websocket", "liveblocks"]
        }
      }
    ],
    userActivities: [
      {
        login: "websocket-code",
        type: "code",
        repo: "websocket-code/liveblocks-repro",
        path: "src/lib/loggingWebSocket.ts",
        title: "src/lib/loggingWebSocket.ts",
        text:
          "A WebSocket subclass passed to Liveblocks via polyfills.WebSocket. It logs outbound storage messages and close codes for the room overwrite repro.",
        url: "https://github.com/websocket-code/liveblocks-repro/blob/main/src/lib/loggingWebSocket.ts",
        occurred_at: "2026-06-24T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.code_manifestations.length, 1);
  assert.equal(dossiers[0].proof_chain.code_manifestations[0].path, "src/lib/loggingWebSocket.ts");
});

test("manifest and related issue support are not demo-ready without code manifestation proof", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "stack-only",
        name: "Stack Only",
        github_url: "https://github.com/stack-only",
        icp_fit_score: 9,
        trigger: {
          type: "issue",
          repo: "trpc/trpc",
          title: "ws subscription task rejection leaves stale clientSubscriptions entry",
          snippet: "WebSocket subscription task rejection leaves stale clientSubscriptions state behind.",
          url: "https://github.com/trpc/trpc/issues/7400",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["websocket", "subscription"]
        }
      }
    ],
    userActivities: [
      {
        login: "stack-only",
        type: "issue",
        repo: "stack-only/app",
        title: "Realtime subscription callbacks stop updating users after websocket reconnect",
        text:
          "In our app, users stop seeing shared server state updates after websocket reconnect and we manually invalidate cache.",
        url: "https://github.com/stack-only/app/issues/2",
        occurred_at: "2026-06-24T12:00:00Z"
      },
      {
        login: "stack-only",
        type: "manifest",
        repo: "stack-only/app",
        path: "package-lock.json",
        title: "package-lock.json",
        text: JSON.stringify({
          packages: {
            "": {
              dependencies: {
                "@supabase/supabase-js": "latest",
                "@tanstack/react-query": "latest",
                "@trpc/client": "latest",
                "ws": "latest",
                "zod": "latest"
              }
            }
          }
        }),
        url: "https://github.com/stack-only/app/blob/main/package-lock.json",
        occurred_at: "2026-06-23T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.direct_pain.length, 1);
  assert.equal(dossiers[0].proof_chain.related_pain.length, 1);
  assert.equal(dossiers[0].proof_chain.stack_evidence.length, 1);
  assert.equal(dossiers[0].proof_chain.code_manifestations.length, 0);
  assert.notEqual(dossiers[0].reliability_audit.level, "demo_ready");
  assert.ok(dossiers[0].reliability_audit.evidence_gaps.includes("Needs code manifestation proof"));
});

test("direct pain issue with explicit code fix can provide code manifestation proof", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "subscription-debugger",
        name: "Subscription Debugger",
        github_url: "https://github.com/subscription-debugger",
        icp_fit_score: 8.7,
        trigger: {
          type: "issue",
          repo: "trpc/trpc",
          title: "ws subscription task rejection leaves stale clientSubscriptions entry",
          snippet:
            "In packages/server/src/adapters/ws.ts, the catch handler does not call clientSubscriptions.delete(id), leaving stale subscription state. Fix: ```ts clientSubscriptions.delete(id); abortController.abort(); ```",
          url: "https://github.com/trpc/trpc/issues/7400",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["websocket", "subscription"]
        }
      }
    ],
    userActivities: [
      {
        login: "subscription-debugger",
        type: "issue",
        repo: "subscription-debugger/app",
        title: "Realtime jobs stop updating after subscription cleanup failure",
        text:
          "In our app, users stop seeing realtime server state updates after subscription cleanup fails.",
        url: "https://github.com/subscription-debugger/app/issues/2",
        occurred_at: "2026-06-24T12:00:00Z"
      },
      {
        login: "subscription-debugger",
        type: "manifest",
        repo: "subscription-debugger/app",
        path: "package-lock.json",
        title: "package-lock.json",
        text: JSON.stringify({
          packages: {
            "": {
              dependencies: {
                "@trpc/client": "latest",
                "@tanstack/react-query": "latest",
                "ws": "latest",
                "zod": "latest"
              }
            }
          }
        }),
        url: "https://github.com/subscription-debugger/app/blob/main/package-lock.json",
        occurred_at: "2026-06-23T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].proof_chain.direct_pain.length, 1);
  assert.equal(dossiers[0].proof_chain.related_pain.length, 1);
  assert.equal(dossiers[0].proof_chain.stack_evidence.length, 1);
  assert.equal(dossiers[0].proof_chain.code_manifestations.length, 1);
  assert.equal(dossiers[0].proof_chain.code_manifestations[0].url, "https://github.com/trpc/trpc/issues/7400");
  assert.equal(dossiers[0].reliability_audit.level, "demo_ready");
  assert.equal(dossiers[0].citation_audit.all_claims_cited, true);
});

test("direct severe buyer pain ranks above indirect same-repo support that lacks direct pain", () => {
  const dossiers = buildLeadDossiers({
    query,
    now,
    leads: [
      {
        engineer_login: "indirect-support",
        icp_fit_score: 10,
        trigger: {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Assert asyncStorage is provided for PKCE flow",
          snippet: "Constructor should assert asyncStorage for PKCE.",
          url: "https://github.com/supabase/supabase-flutter/issues/200",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["supabase"]
        }
      },
      {
        engineer_login: "direct-pain",
        icp_fit_score: 7.1,
        trigger: {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "postgres_changes reports SUBSCRIBED but delivers nothing",
          snippet:
            "What happened? In our production app, postgres_changes reports SUBSCRIBED but users receive no realtime updates.",
          url: "https://github.com/supabase/supabase-flutter/issues/201",
          occurred_at: "2026-06-25T12:00:00Z",
          matched_topics: ["supabase", "realtime"]
        }
      }
    ],
    userActivities: [
      {
        login: "indirect-support",
        type: "issue",
        repo: "supabase/supabase-flutter",
        title: "realtime_client detects dropped WebSocket connections after reconnect failure",
        text: "users lose realtime updates after websocket reconnect and subscriptions never recover.",
        url: "https://github.com/supabase/supabase-flutter/issues/202",
        occurred_at: "2026-06-24T12:00:00Z"
      },
      {
        login: "indirect-support",
        type: "issue",
        repo: "supabase/supabase-flutter",
        title: "postgres_changes channel subscription stalls and delivers nothing",
        text: "users cannot receive shared state updates because postgres_changes stalls.",
        url: "https://github.com/supabase/supabase-flutter/issues/203",
        occurred_at: "2026-06-24T12:00:00Z"
      },
      {
        login: "indirect-support",
        type: "comment",
        repo: "supabase/supabase-flutter",
        title: "realtime reconnect timeout",
        text: "the realtime channel timeout causes cache invalidation and stale server state.",
        url: "https://github.com/supabase/supabase-flutter/issues/204#issuecomment-1",
        occurred_at: "2026-06-24T12:00:00Z"
      }
    ]
  });

  assert.equal(dossiers[0].engineer_login, "direct-pain");
});
