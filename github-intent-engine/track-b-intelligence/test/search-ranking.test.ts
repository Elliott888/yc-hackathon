import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { embeddingDimensions, embedText } from "../src/embedding.js";
import { writeJsonl } from "../src/io.js";
import { parseRecipe } from "../src/recipe.js";
import { searchLeads } from "../src/search.js";
import type { EngineerEmbedding, RankedLead, Recipe } from "../src/types.js";

let rootDir: string;
let recipe: Recipe;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "track-b-search-"));
  await mkdirp(join(rootDir, "contracts"));
  await mkdirp(join(rootDir, "data", "processed"));
  const recipeText = recipeFixture();
  recipe = parseRecipe(recipeText);
  await writeFile(join(rootDir, "contracts", "convex_recipe.yaml"), recipeText, "utf8");
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("search ranking", () => {
  test("prioritizes exact query-topic overlap over broad imported lead score", async () => {
    const broadLead = leadFixture({
      engineer_login: "broad-high-score",
      score: 99,
      top_topics: ["replication", "realtime", "subscriptions"],
      semantic_document: "realtime replication subscriptions backend-as-a-service"
    });
    const liveQueryLead = leadFixture({
      engineer_login: "live-query-lower-score",
      score: 88,
      top_topics: ["replication", "live query", "sync"],
      semantic_document: "live query replication sync reactive database"
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      broadLead,
      liveQueryLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(broadLead),
      embeddingFor(liveQueryLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers working on live query replication for Convex",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("live-query-lower-score");
    expect(result.results[0]?.topic_score).toBeGreaterThan(0);
    expect(result.results[1]?.topic_score).toBeLessThan(1);
    expect(result.results[0]?.topic_score).toBeGreaterThan(result.results[1]?.topic_score ?? 0);
  });

  test("prioritizes and displays evidence that matches the query topics", async () => {
    const broadProfileLead = leadFixture({
      engineer_login: "profile-only",
      score: 96,
      top_topics: ["cache invalidation", "WebSocket"],
      semantic_document: "cache invalidation WebSocket backend-as-a-service",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "Refocus benchmark on database load",
          text: "generic benchmark work",
          url: "https://github.com/appwrite/appwrite/pull/1",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const evidenceLead = leadFixture({
      engineer_login: "evidence-match",
      score: 88,
      top_topics: ["cache invalidation"],
      semantic_document: "cache invalidation reactive backend state",
      evidence: [
        {
          type: "pull_request",
          repo: "supabase/supabase",
          title: "Move SQL editor save trigger into cache invalidation scheduler",
          text: "cache invalidation scheduler provider",
          url: "https://github.com/supabase/supabase/pull/2",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      broadProfileLead,
      evidenceLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(broadProfileLead),
      embeddingFor(evidenceLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers talking about cache invalidation",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("evidence-match");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(0);
    expect(result.results[0]?.evidence_score).toBeGreaterThan(result.results[1]?.evidence_score ?? 0);
    expect(result.results[0]?.evidence[0]?.title).toContain("cache invalidation");
  });

  test("penalizes evidence-free leads when the query asks who is talking about a topic", async () => {
    const evidenceFreeLead = leadFixture({
      engineer_login: "profile-only-high-score",
      score: 130,
      top_topics: ["cache invalidation"],
      semantic_document: "cache invalidation",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "Generic backend maintenance",
          text: "maintenance",
          url: "https://github.com/appwrite/appwrite/pull/10",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const lowerScoreEvidenceLead = leadFixture({
      engineer_login: "lower-score-evidence-match",
      score: 70,
      top_topics: ["cache invalidation"],
      semantic_document: "cache invalidation",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase",
          title: "Cache invalidation issue",
          text: "cache invalidation",
          url: "https://github.com/supabase/supabase/issues/10",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      evidenceFreeLead,
      lowerScoreEvidenceLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(evidenceFreeLead),
      embeddingFor(lowerScoreEvidenceLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers talking about cache invalidation",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("lower-score-evidence-match");
    expect(result.results[1]?.evidence_score).toBe(0);
  });

  test("does not treat vendor alternatives as generic vendor mentions", async () => {
    const genericVendorLead = leadFixture({
      engineer_login: "generic-supabase-maintainer",
      score: 130,
      top_topics: ["Supabase"],
      semantic_document: "Supabase auth database routine maintenance",
      evidence: [
        {
          type: "pull_request",
          repo: "supabase/supabase",
          title: "Fix Supabase auth settings copy",
          text: "Supabase auth database UI copy",
          url: "https://github.com/supabase/supabase/pull/20",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["Supabase", "auth", "database"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const painLead = leadFixture({
      engineer_login: "backend-pain-engineer",
      score: 75,
      top_topics: ["cache invalidation", "websocket"],
      semantic_document: "cache invalidation WebSocket infrastructure simpler full-stack backend",
      evidence: [
        {
          type: "issue",
          repo: "wasp-lang/wasp",
          title: "Cache invalidation regression in full-stack action flow",
          text: "cache invalidation with WebSocket updates",
          url: "https://github.com/wasp-lang/wasp/issues/30",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation", "websocket", "full-stack"],
          repo_categories: ["full-stack framework"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      genericVendorLead,
      painLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(genericVendorLead),
      embeddingFor(painLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.query_plan.topics).not.toContain("Supabase");
    expect(result.query_plan.topics).not.toContain("Firebase");
    expect(result.query_plan.topics).not.toEqual(expect.arrayContaining(["Find", "talking"]));
    expect(result.query_plan.topics).not.toContain("a simpler full-stack backend.");
    expect(result.query_plan.topics).toEqual(
      expect.arrayContaining(["WebSocket infrastructure", "Firebase alternatives", "Supabase alternatives"])
    );
    expect(result.results[0]?.engineer_login).toBe("backend-pain-engineer");
  });

  test("treats painful competitor evidence as relevant for alternatives prompts", async () => {
    const unrelatedOpsPain = leadFixture({
      engineer_login: "unrelated-appwrite-smtp-pain",
      score: 130,
      top_topics: ["Appwrite"],
      semantic_document: "Appwrite SMTP connection reuse failure",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "Fix SMTP connection reuse failure",
          text: "SMTP connection reuse fails for some email workloads.",
          url: "https://github.com/appwrite/appwrite/pull/31",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["Appwrite"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const supabaseRealtimePain = leadFixture({
      engineer_login: "supabase-realtime-alternative-pain",
      score: 70,
      top_topics: ["realtime", "Supabase"],
      semantic_document: "Supabase realtime channel subscribed but delivers nothing async replication failure",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Supabase realtime channel reports subscribed but delivers nothing",
          text: "Async postgres_changes replication fails and system status=error is swallowed, so users lose realtime updates.",
          url: "https://github.com/supabase/supabase-flutter/issues/31",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "replication", "Supabase"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      unrelatedOpsPain,
      supabaseRealtimePain
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(unrelatedOpsPain),
      embeddingFor(supabaseRealtimePain)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("supabase-realtime-alternative-pain");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(0);
    expect(result.results[1]?.evidence_score).toBe(0);
  });

  test("demotes generic competitor auth pain below realtime backend pain for alternatives prompts", async () => {
    const genericAuthPain = leadFixture({
      engineer_login: "supabase-auth-only-pain",
      score: 135,
      top_topics: ["Supabase"],
      semantic_document: "Supabase auth passkey error",
      evidence: [
        {
          type: "pull_request",
          repo: "supabase/supabase-flutter",
          title: "Fix passkey registration auth error",
          text: "Passkey registration crashes because authenticator fields are null.",
          url: "https://github.com/supabase/supabase-flutter/pull/32",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["Supabase", "auth"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const realtimeBackendPain = leadFixture({
      engineer_login: "supabase-realtime-backend-pain",
      score: 70,
      top_topics: ["realtime", "Supabase"],
      semantic_document: "Supabase realtime WebSocket reconnect failure",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Supabase realtime WebSocket reconnect fails in production",
          text: "Customers lose realtime updates after WebSocket reconnect handling fails.",
          url: "https://github.com/supabase/supabase-flutter/issues/32",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket", "Supabase"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      genericAuthPain,
      realtimeBackendPain
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(genericAuthPain),
      embeddingFor(realtimeBackendPain)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("supabase-realtime-backend-pain");
    expect(result.results[0]?.problem_score).toBeGreaterThan(result.results[1]?.problem_score ?? 0);
    expect(result.results[1]?.problem_score).toBeLessThan(0.35);
  });

  test("prioritizes burning problem evidence over feature work for customer pain prompts", async () => {
    const featureWorkLead = leadFixture({
      engineer_login: "feature-work-high-score",
      score: 130,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket infrastructure backend-as-a-service",
      evidence: [
        {
          type: "pull_request",
          repo: "liveblocks/liveblocks",
          title: "Add WebSocket metrics dashboard option",
          text: "Adds a new dashboard option for WebSocket infrastructure metrics.",
          url: "https://github.com/liveblocks/liveblocks/pull/60",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["real-time sync"],
          contribution_weight: 10
        }
      ]
    });
    const burningProblemLead = leadFixture({
      engineer_login: "burning-websocket-pain",
      score: 70,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket fails rejected cannot connect production backend",
      evidence: [
        {
          type: "issue",
          repo: "acme/realtime-app",
          title: "Production WebSocket gateway can't connect and rejects clients",
          text: "Customers cannot connect after the gateway returns 4403 errors. Reconnects fail and realtime updates are blocked.",
          url: "https://github.com/acme/realtime-app/issues/60",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      featureWorkLead,
      burningProblemLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(featureWorkLead),
      embeddingFor(burningProblemLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("burning-websocket-pain");
    expect(result.results[0]?.problem_score).toBeGreaterThan(result.results[1]?.problem_score ?? 0);
    expect(result.results[0]?.top_problem?.summary).toMatch(/cannot connect|blocked/i);
    const productFitExplanation = result.results[0]?.answer_context?.product_fit_explanations?.[0];
    expect(productFitExplanation).toBeDefined();
    expect(productFitExplanation).toMatchObject({
      target_product: "Convex",
      severity: "high",
      evidence_url: "https://github.com/acme/realtime-app/issues/60"
    });
    expect(productFitExplanation?.why_it_is_burning).toMatch(
      /Customers cannot connect|realtime updates are blocked|production/i
    );
    expect(productFitExplanation?.why_product_can_help).toMatch(
      /Convex|reactive|realtime|backend state/i
    );
  });

  test("demotes low-severity feature alternatives below high-severity backend pain", async () => {
    const lowSeverityFeatureLead = leadFixture({
      engineer_login: "low-severity-alternative-feature",
      score: 135,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "realtime websocket alternative codec",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Support alternative realtime WebSocket codec",
          text: "Feature request for an alternative codec path for realtime serialization.",
          url: "https://github.com/supabase/supabase-flutter/issues/63",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket", "Supabase"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });
    const highSeverityPainLead = leadFixture({
      engineer_login: "high-severity-backend-pain",
      score: 70,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "realtime websocket production failure",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Realtime WebSocket reconnect fails in production",
          text: "Customers lose realtime updates after reconnect handling fails.",
          url: "https://github.com/supabase/supabase-flutter/issues/64",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket", "Supabase"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      lowSeverityFeatureLead,
      highSeverityPainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(lowSeverityFeatureLead),
      embeddingFor(highSeverityPainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("high-severity-backend-pain");
    expect(result.results[0]?.problem_score).toBeGreaterThan(0.7);
    expect(result.results[1]?.problem_score).toBeLessThan(0.5);
  });

  test("applies a weak-problem penalty for pain-discovery prompts", async () => {
    const veryHighBaseLowSeverityLead = leadFixture({
      engineer_login: "very-high-base-low-severity",
      score: 400,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "realtime websocket alternative codec",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Support alternative realtime WebSocket codec",
          text: "Feature request for an alternative codec path for realtime serialization.",
          url: "https://github.com/supabase/supabase-flutter/issues/65",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket", "Supabase"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });
    const lowerBaseHighSeverityLead = leadFixture({
      engineer_login: "lower-base-high-severity",
      score: 70,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "realtime websocket production failure",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Realtime WebSocket reconnect fails in production",
          text: "Customers lose realtime updates after reconnect handling fails.",
          url: "https://github.com/supabase/supabase-flutter/issues/66",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket", "Supabase"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      veryHighBaseLowSeverityLead,
      lowerBaseHighSeverityLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(veryHighBaseLowSeverityLead),
      embeddingFor(lowerBaseHighSeverityLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("lower-base-high-severity");
  });

  test("uses imported model pain score when evidence text is terse", async () => {
    const routineWebsocketLead = leadFixture({
      engineer_login: "routine-websocket-upgrade",
      score: 130,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket infrastructure backend-as-a-service",
      evidence: [
        {
          type: "pull_request",
          repo: "modelcontextprotocol/typescript-sdk",
          title: "Forward response headers on WebSocket upgrade",
          text: "WebSocket upgrade headers",
          url: "https://github.com/modelcontextprotocol/typescript-sdk/pull/80",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["developer tools"],
          contribution_weight: 10,
          burning_problem_score: 0.08,
          buyer_intent_label: "technical_fit_only",
          pain_signals: []
        }
      ]
    });
    const importedPainLead = leadFixture({
      engineer_login: "model-detected-sync-pain",
      score: 60,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket subscription state realtime backend",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-js",
          title: "Client subscription state desync",
          text: "WebSocket live query subscription state",
          url: "https://github.com/supabase/supabase-js/issues/80",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 4,
          burning_problem_score: 0.91,
          buyer_intent_label: "burning_problem",
          pain_signals: ["production impact", "stale data"]
        }
      ],
      burning_problem_score: 0.91,
      pain_signals: ["production impact", "stale data"]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      routineWebsocketLead,
      importedPainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(routineWebsocketLead),
      embeddingFor(importedPainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("model-detected-sync-pain");
    expect(result.results[0]?.problem_score).toBeGreaterThan(0.85);
    expect(result.results[0]?.top_problem?.signals).toEqual(
      expect.arrayContaining(["production impact", "stale data"])
    );
  });

  test("does not treat production-ready implementation copy as customer pain", async () => {
    const productionReadyLead = leadFixture({
      engineer_login: "production-ready-builder",
      score: 135,
      top_topics: ["WebSocket", "subscriptions"],
      semantic_document: "production-ready backend implementation realtime WebSocket subscriptions",
      evidence: [
        {
          type: "pull_request",
          repo: "instantdb/instant",
          title: "Add production-ready backend implementation with subscriptions",
          text: "This adds a production-ready SQLite backend with realtime subscriptions and comprehensive tests.",
          url: "https://github.com/instantdb/instant/pull/81",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket", "subscriptions"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 10,
          burning_problem_score: 0.12,
          buyer_intent_label: "technical_fit_only",
          pain_signals: []
        }
      ]
    });
    const reconnectPainLead = leadFixture({
      engineer_login: "reconnect-loop-pain",
      score: 70,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket reconnect loop blocks realtime users",
      evidence: [
        {
          type: "issue",
          repo: "rocicorp/mono",
          title: "WebSocket reconnect loop blocks realtime updates",
          text: "The client reconnects forever after oversized mutations, users are blocked and updates stop.",
          url: "https://github.com/rocicorp/mono/issues/81",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["real-time sync"],
          contribution_weight: 4,
          burning_problem_score: 0.8,
          buyer_intent_label: "burning_problem",
          pain_signals: ["blocked", "reconnect failure"]
        }
      ],
      burning_problem_score: 0.8,
      pain_signals: ["blocked", "reconnect failure"]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      productionReadyLead,
      reconnectPainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(productionReadyLead),
      embeddingFor(reconnectPainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("reconnect-loop-pain");
    expect(result.results[1]?.problem_score).toBeLessThan(0.45);
  });

  test("penalizes telemetry and log-tail evidence below backend-state pain", async () => {
    const telemetryLead = leadFixture({
      engineer_login: "telemetry-metrics-work",
      score: 135,
      top_topics: ["WebSocket"],
      semantic_document: "telemetry metrics log tail websocket infrastructure",
      evidence: [
        {
          type: "pull_request",
          repo: "directus/directus",
          title: "Telemetry Metrics Improvements",
          text: "Rewrite telemetry metrics and log tail streaming around WebSocket infrastructure.",
          url: "https://github.com/directus/directus/pull/82",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10,
          burning_problem_score: 0.4,
          buyer_intent_label: "technical_fit_only",
          pain_signals: ["error"]
        }
      ]
    });
    const backendPainLead = leadFixture({
      engineer_login: "backend-state-pain",
      score: 70,
      top_topics: ["WebSocket"],
      semantic_document: "websocket reconnect backend state bug",
      evidence: [
        {
          type: "issue",
          repo: "appwrite/appwrite",
          title: "WebSocket reconnect loses backend state",
          text: "Users lose realtime backend state after reconnect and need a workaround.",
          url: "https://github.com/appwrite/appwrite/issues/82",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket", "backend state"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4,
          burning_problem_score: 0.82,
          buyer_intent_label: "burning_problem",
          pain_signals: ["data loss", "reconnect failure", "workaround"]
        }
      ],
      burning_problem_score: 0.82,
      pain_signals: ["data loss", "reconnect failure", "workaround"]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      telemetryLead,
      backendPainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(telemetryLead),
      embeddingFor(backendPainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("backend-state-pain");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(result.results[1]?.evidence_score ?? 0);
  });

  test("demotes generic MCP transport noise below direct backend-state pain", async () => {
    const genericMcpTransportLead = leadFixture({
      engineer_login: "generic-mcp-transport",
      score: 160,
      top_topics: ["WebSocket"],
      semantic_document: "MCP protocol SSE POST response errors WebSocket transport backend service",
      evidence: [
        {
          type: "pull_request",
          repo: "modelcontextprotocol/python-sdk",
          title: "fix(client): propagate SSE POST errors to caller instead of hanging",
          text:
            "MCP client now propagates SSE POST transport errors instead of hanging. " +
            "Also touches generic WebSocket transport compatibility for protocol tests. " +
            "sync websocket mcp",
          url: "https://github.com/modelcontextprotocol/python-sdk/pull/83",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service", "reactive database", "real-time sync"],
          contribution_weight: 10,
          burning_problem_score: 0.82,
          buyer_intent_label: "burning_problem",
          pain_signals: ["error", "timeout"],
          code_signals: [
            {
              id: "realtime_product_critical",
              label: "Realtime product-critical path",
              pain_point: "Realtime behavior is becoming product-critical.",
              matched_terms: ["SSE/EventSource transport", "WebSocket transport"],
              score: 0.58
            }
          ]
        }
      ],
      burning_problem_score: 0.82,
      pain_signals: ["error", "timeout"]
    });
    const staleBackendStateLead = leadFixture({
      engineer_login: "direct-backend-state-pain",
      score: 70,
      top_topics: ["backend state", "cache invalidation", "reactive data"],
      semantic_document: "Firebase Data Connect reactive data stale backend state cache invalidation workaround",
      evidence: [
        {
          type: "issue",
          repo: "firebase/firebase-tools",
          title: "Firebase Data Connect refresh leaves reactive data stale after mutation",
          text:
            "@refresh does not fire across connectors; users see stale backend state after mutation " +
            "and need a cache invalidation workaround.",
          url: "https://github.com/firebase/firebase-tools/issues/83",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["backend state", "cache invalidation", "reactive data"],
          repo_categories: ["backend-as-a-service", "reactive database"],
          contribution_weight: 4,
          burning_problem_score: 0.84,
          buyer_intent_label: "burning_problem",
          pain_signals: ["stale data", "workaround"]
        }
      ],
      burning_problem_score: 0.84,
      pain_signals: ["stale data", "workaround"]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      genericMcpTransportLead,
      staleBackendStateLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(genericMcpTransportLead),
      embeddingFor(staleBackendStateLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("direct-backend-state-pain");
    expect(result.results[0]?.problem_score).toBeGreaterThan(result.results[1]?.problem_score ?? 0);
    expect(result.results[0]?.evidence_score).toBeGreaterThan(result.results[1]?.evidence_score ?? 0);
  });

  test("demotes auth and logout UI pain below realtime backend-state pain", async () => {
    const authLogoutLead = leadFixture({
      engineer_login: "self-hosted-auth-logout",
      score: 160,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "self-hosted realtime cache auth logout editor UI error",
      evidence: [
        {
          type: "issue",
          repo: "n8n-io/n8n",
          title: "Problem authentification",
          text:
            "After upgrading a self-hosted Enterprise instance, users cannot properly log out from the Editor UI. " +
            "Some API requests randomly return 401 Unauthorized and the realtime editor connection sometimes fails. " +
            "realtime node postgres real-time database auth cache events automation workflow",
          url: "https://github.com/n8n-io/n8n/issues/84",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket"],
          repo_categories: [],
          contribution_weight: 4,
          burning_problem_score: 0.78,
          buyer_intent_label: "burning_problem",
          pain_signals: ["error", "self-hosted"]
        }
      ],
      burning_problem_score: 0.78,
      pain_signals: ["error", "self-hosted"]
    });
    const realtimeBackendPainLead = leadFixture({
      engineer_login: "realtime-backend-state-loss",
      score: 70,
      top_topics: ["WebSocket", "backend state"],
      semantic_document: "WebSocket reconnect loses backend state realtime updates blocked",
      evidence: [
        {
          type: "issue",
          repo: "appwrite/appwrite",
          title: "WebSocket reconnect loses backend state and blocks realtime updates",
          text: "Users lose realtime backend state after reconnect and need a workaround.",
          url: "https://github.com/appwrite/appwrite/issues/84",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket", "backend state"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4,
          burning_problem_score: 0.82,
          buyer_intent_label: "burning_problem",
          pain_signals: ["data loss", "reconnect failure", "workaround"]
        }
      ],
      burning_problem_score: 0.82,
      pain_signals: ["data loss", "reconnect failure", "workaround"]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      authLogoutLead,
      realtimeBackendPainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(authLogoutLead),
      embeddingFor(realtimeBackendPainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("realtime-backend-state-loss");
    expect(result.results[0]?.problem_score).toBeGreaterThan(result.results[1]?.problem_score ?? 0);
    expect(result.results[1]?.problem_score).toBeLessThan(0.45);
  });

  test("keeps maintenance upgrade failures below customer-facing production pain", async () => {
    const maintenanceLead = leadFixture({
      engineer_login: "maintenance-upgrade-failure",
      score: 135,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket upgrade dependency failing tests",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "Upgrade WebSocket package to fix failing unit tests",
          text: "Bump dependency version and update lockfile because CI tests fail.",
          url: "https://github.com/appwrite/appwrite/pull/61",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const productionPainLead = leadFixture({
      engineer_login: "production-realtime-pain",
      score: 70,
      top_topics: ["WebSocket"],
      semantic_document: "production users cannot connect websocket realtime updates blocked",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Production users cannot connect after WebSocket reconnect regression",
          text: "Realtime updates are blocked for customers after reconnect handling fails.",
          url: "https://github.com/supabase/supabase-flutter/issues/61",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      maintenanceLead,
      productionPainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(maintenanceLead),
      embeddingFor(productionPainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("production-realtime-pain");
    expect(result.results[1]?.problem_score).toBeLessThan(0.35);
  });

  test("boosts and explains leads with code-shape pain signals", async () => {
    const broadWebsocketLead = leadFixture({
      engineer_login: "broad-websocket-profile",
      score: 120,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket infrastructure realtime backend",
      evidence: [
        {
          type: "pull_request",
          repo: "socket/server",
          title: "Refactor WebSocket example",
          text: "Clean up docs and example WebSocket server code.",
          url: "https://github.com/socket/server/pull/80",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["real-time sync"],
          contribution_weight: 10
        }
      ]
    });
    const codeShapePainLead = leadFixture({
      engineer_login: "state-sync-pain-engineer",
      score: 72,
      top_topics: ["realtime", "cache invalidation", "optimistic update"],
      semantic_document:
        "React Query invalidation useEffect fetch optimistic rollback WebSocket presence simpler full-stack backend",
      evidence: [
        {
          type: "pull_request",
          repo: "acme/collab-app",
          title: "Fix stale room state after optimistic message rollback",
          text:
            "useEffect(fetch('/api/messages')) causes stale state after queryClient.invalidateQueries. " +
            "Added rollback for optimistic update failures and WebSocket presence reconnect handling. " +
            "apps/web/src/hooks/useMessages.tsx apps/api/messages/route.ts",
          url: "https://github.com/acme/collab-app/pull/81",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation", "WebSocket", "optimistic update"],
          repo_categories: ["real-time sync", "serverless backend"],
          contribution_weight: 10
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      broadWebsocketLead,
      codeShapePainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(broadWebsocketLead),
      embeddingFor(codeShapePainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find engineers with frontend/server state sync pain, React Query invalidations, WebSocket presence, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.query_plan.indexes_used).toContain("code_shape_signal");
    expect(result.query_plan.indexes_used).toContain("pain_point_code_manifestation");
    expect(result.results[0]?.engineer_login).toBe("state-sync-pain-engineer");
    expect(result.results[0]?.answer_context?.code_signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["frontend_server_state_sync", "realtime_product_critical"])
    );
    expect(result.results[0]?.answer_context?.code_signal_context[0]?.matched_terms.length).toBeGreaterThan(0);
    expect(result.results[0]?.answer_context?.pain_point_evidence?.[0]).toMatchObject({
      pain_point: "Keeping frontend state in sync with server state is annoying.",
      evidence_title: "Fix stale room state after optimistic message rollback",
      evidence_url: "https://github.com/acme/collab-app/pull/81"
    });
    expect(result.results[0]?.answer_context?.pain_point_evidence?.[0]?.code_manifestation).toMatch(
      /useEffect\(fetch|React Query invalidations|manual cache updates|optimistic update rollback/i
    );
    expect(result.results[0]?.answer_context?.product_fit_explanations?.[0]?.detected_pain_points).toEqual(
      expect.arrayContaining(["Keeping frontend state in sync with server state is annoying."])
    );
    expect(result.results[0]?.answer_context?.product_fit_explanations?.[0]?.code_manifestations?.[0]).toMatch(
      /useEffect\(fetch|React Query invalidations|manual cache updates|optimistic update rollback/i
    );
  });

  test("orders displayed evidence by the strongest problem signal for pain prompts", async () => {
    const mixedEvidenceLead = leadFixture({
      engineer_login: "mixed-evidence-person",
      score: 80,
      top_topics: ["WebSocket"],
      semantic_document: "WebSocket infrastructure",
      evidence: [
        {
          type: "pull_request",
          repo: "supabase/supabase-flutter",
          title: "Upgrade WebSocket dependency",
          text: "Bump dependency and refresh lockfile.",
          url: "https://github.com/supabase/supabase-flutter/pull/62",
          created_at: "2026-06-21T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        },
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Realtime client drops WebSocket connections in production",
          text: "Customers lose realtime updates when reconnect handling fails.",
          url: "https://github.com/supabase/supabase-flutter/issues/62",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [mixedEvidenceLead]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(mixedEvidenceLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 1
    });

    expect(result.results[0]?.evidence[0]?.type).toBe("issue");
    expect(result.results[0]?.top_problem?.evidence_url).toBe(
      "https://github.com/supabase/supabase-flutter/issues/62"
    );
  });

  test("demotes target-product owned repos when looking for potential customers", async () => {
    const firstPartyLead = leadFixture({
      engineer_login: "convex-maintainer",
      score: 140,
      top_topics: ["WebSocket"],
      semantic_document: "Convex backend WebSocket compatibility",
      evidence: [
        {
          type: "pull_request",
          repo: "get-convex/convex-backend",
          title: "fix: prefer native WebSocket over ws package",
          text: "Fix native WebSocket compatibility in Convex backend.",
          url: "https://github.com/get-convex/convex-backend/pull/70",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const externalPainLead = leadFixture({
      engineer_login: "supabase-realtime-user",
      score: 72,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "Supabase realtime WebSocket dropped connection production issue",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase-flutter",
          title: "Realtime client drops WebSocket connections in production",
          text: "Production users lose realtime updates because reconnect handling fails on WebSocket disconnects.",
          url: "https://github.com/supabase/supabase-flutter/issues/70",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      firstPartyLead,
      externalPainLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(firstPartyLead),
      embeddingFor(externalPainLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find founders or engineers talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("supabase-realtime-user");
    expect(result.results[0]?.first_party_repo).toBe(false);
    expect(result.results[1]?.first_party_repo).toBe(true);
  });

  test("uses direct evidence terms even when they are outside the recipe vocabulary", async () => {
    const genericHighScoreLead = leadFixture({
      engineer_login: "generic-high-score",
      score: 130,
      top_topics: ["sync"],
      semantic_document: "sync backend maintenance",
      evidence: [
        {
          type: "pull_request",
          repo: "electric-sql/electric",
          title: "Generic backend maintenance",
          text: "sync backend maintenance",
          url: "https://github.com/electric-sql/electric/pull/50",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["sync"],
          repo_categories: ["reactive database"],
          contribution_weight: 10
        }
      ]
    });
    const buyerSpecificLead = leadFixture({
      engineer_login: "agent-collab-buyer-fit",
      score: 55,
      top_topics: [],
      semantic_document: "Claude Codex context limit monorepo agent collaboration",
      evidence: [
        {
          type: "issue",
          repo: "continuedev/continue",
          title: "Claude and Codex lose context in large monorepos",
          text: "Team maxed out agent context windows and needs better collaboration around AI coding workspaces.",
          url: "https://github.com/continuedev/continue/issues/50",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["developer tools"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      genericHighScoreLead,
      buyerSpecificLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(genericHighScoreLead),
      embeddingFor(buyerSpecificLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find teams talking about Claude, Codex, context limits, and agent collaboration for Lore",
      limit: 2
    });

    expect(result.query_plan.topics).toEqual(
      expect.arrayContaining(["Claude", "Codex", "context limits", "agent collaboration"])
    );
    expect(result.results[0]?.engineer_login).toBe("agent-collab-buyer-fit");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(0);
  });

  test("uses evidence-first ranking for actively contributing prompts", async () => {
    const profileOnlyLead = leadFixture({
      engineer_login: "profile-only-contributor",
      score: 130,
      top_topics: ["live query"],
      semantic_document: "live query reactive database",
      evidence: [
        {
          type: "pull_request",
          repo: "supabase/supabase",
          title: "Generic refactor",
          text: "generic maintenance",
          url: "https://github.com/supabase/supabase/pull/15",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const directContributionLead = leadFixture({
      engineer_login: "direct-live-query-contributor",
      score: 70,
      top_topics: ["live query"],
      semantic_document: "live query reactive database",
      evidence: [
        {
          type: "pull_request",
          repo: "electric-sql/electric",
          title: "Fix live query replication lag",
          text: "live query replication lag in reactive database",
          url: "https://github.com/electric-sql/electric/pull/15",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["live query", "replication"],
          repo_categories: ["reactive database"],
          contribution_weight: 10
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      profileOnlyLead,
      directContributionLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(profileOnlyLead),
      embeddingFor(directContributionLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers actively contributing to live query systems",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("direct-live-query-contributor");
    expect(result.results[1]?.evidence_score).toBe(0);
  });

  test("penalizes docs and chore evidence below product evidence for talking-about prompts", async () => {
    const docsLead = leadFixture({
      engineer_login: "docs-cache-guide",
      score: 130,
      top_topics: ["cache invalidation", "WebSocket"],
      semantic_document: "cache invalidation WebSocket backend-as-a-service",
      evidence: [
        {
          type: "pull_request",
          repo: "supabase/supabase",
          title: "docs(storage): add guide for manually purging CDN cache",
          text: "cache invalidation guide documentation",
          url: "https://github.com/supabase/supabase/pull/20",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10
        }
      ]
    });
    const productIssueLead = leadFixture({
      engineer_login: "product-cache-websocket",
      score: 70,
      top_topics: ["cache invalidation", "WebSocket"],
      semantic_document: "cache invalidation WebSocket backend-as-a-service",
      evidence: [
        {
          type: "issue",
          repo: "appwrite/appwrite",
          title: "Cache invalidation race breaks WebSocket subscriptions",
          text: "cache invalidation race in websocket subscription state",
          url: "https://github.com/appwrite/appwrite/issues/20",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation", "WebSocket", "subscriptions"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      docsLead,
      productIssueLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(docsLead),
      embeddingFor(productIssueLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers talking about cache invalidation and WebSocket infrastructure",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("product-cache-websocket");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(result.results[1]?.evidence_score ?? 0);
  });

  test("penalizes thin imported evidence titles below direct infrastructure evidence", async () => {
    const thinTitleLead = leadFixture({
      engineer_login: "thin-imported-title",
      score: 125,
      top_topics: ["WebSocket", "sync"],
      semantic_document: "WebSocket sync backend-as-a-service",
      evidence: [
        {
          type: "issue",
          repo: "appwrite/appwrite",
          title: "Aplikasi",
          text: "sync websocket node auth functions",
          url: "https://github.com/appwrite/appwrite/issues/30",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket", "sync"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });
    const directInfrastructureLead = leadFixture({
      engineer_login: "direct-websocket-infra",
      score: 70,
      top_topics: ["WebSocket", "subscriptions"],
      semantic_document: "WebSocket subscriptions backend-as-a-service",
      evidence: [
        {
          type: "issue",
          repo: "liveblocks/liveblocks",
          title: "WebSocket subscriptions drop messages under load",
          text: "websocket subscription infrastructure drops realtime messages",
          url: "https://github.com/liveblocks/liveblocks/issues/30",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["WebSocket", "subscriptions"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 4
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      thinTitleLead,
      directInfrastructureLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(thinTitleLead),
      embeddingFor(directInfrastructureLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers talking about WebSocket infrastructure",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("direct-websocket-infra");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(result.results[1]?.evidence_score ?? 0);
  });

  test("boosts evidence whose title directly matches the contribution query", async () => {
    const inheritedTopicLead = leadFixture({
      engineer_login: "inherited-topic-text",
      score: 120,
      top_topics: ["sync", "realtime"],
      semantic_document: "live query realtime sync reactive database",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "Upgrade HTTP server mode",
          text: "Upgrade HTTP server mode realtime sync react",
          url: "https://github.com/appwrite/appwrite/pull/40",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["sync", "realtime"],
          repo_categories: ["backend-as-a-service", "real-time sync"],
          contribution_weight: 10
        }
      ]
    });
    const directTitleLead = leadFixture({
      engineer_login: "direct-title-live-query",
      score: 72,
      top_topics: ["live query", "sync", "realtime"],
      semantic_document: "live query realtime sync reactive database",
      evidence: [
        {
          type: "pull_request",
          repo: "electric-sql/electric",
          title: "Add live query update throttle option",
          text: "live query updates for realtime subscriptions",
          url: "https://github.com/electric-sql/electric/pull/40",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["live query", "realtime", "subscriptions"],
          repo_categories: ["reactive database", "real-time sync"],
          contribution_weight: 10
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      inheritedTopicLead,
      directTitleLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(inheritedTopicLead),
      embeddingFor(directTitleLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers actively contributing to live query, reactive database, and realtime sync repos",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("direct-title-live-query");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(result.results[1]?.evidence_score ?? 0);
  });

  test("uses neural intent score to demote weak evidence with a higher base score", async () => {
    const weakNeuralLead = leadFixture({
      engineer_login: "weak-neural-cache",
      score: 95,
      top_topics: ["cache invalidation"],
      neural_intent_score: 0.05,
      semantic_document: "cache invalidation backend state",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "Cache invalidation cleanup",
          text: "cache invalidation backend state",
          url: "https://github.com/appwrite/appwrite/pull/90",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10,
          neural_intent_score: 0.05
        }
      ]
    });
    const strongNeuralLead = leadFixture({
      engineer_login: "strong-neural-cache",
      score: 80,
      top_topics: ["cache invalidation"],
      neural_intent_score: 0.95,
      semantic_document: "cache invalidation backend state",
      evidence: [
        {
          type: "pull_request",
          repo: "appwrite/appwrite",
          title: "Cache invalidation cleanup",
          text: "cache invalidation backend state",
          url: "https://github.com/appwrite/appwrite/pull/91",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 10,
          neural_intent_score: 0.95
        }
      ]
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      weakNeuralLead,
      strongNeuralLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(weakNeuralLead),
      embeddingFor(strongNeuralLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query: "Find engineers talking about cache invalidation",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("strong-neural-cache");
    expect(result.results[0]?.neural_intent_score).toBeGreaterThan(result.results[1]?.neural_intent_score ?? 0);
  });

  test("prioritizes buyer-specific analytics evidence over broad realtime leads", async () => {
    const broadRealtimeLead = leadFixture({
      engineer_login: "broad-realtime-platform",
      score: 130,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "realtime websocket platform work",
      evidence: [
        {
          type: "pull_request",
          repo: "vercel/ai",
          title: "Fix realtime WebSocket reconnect handling",
          text: "realtime websocket reconnect handling",
          url: "https://github.com/vercel/ai/pull/200",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["realtime", "WebSocket"],
          repo_categories: ["real-time sync"],
          contribution_weight: 10,
          neural_intent_score: 1
        }
      ],
      neural_intent_score: 1
    });
    const analyticsLead = leadFixture({
      engineer_login: "posthog-feature-flag",
      score: 70,
      top_topics: [],
      semantic_document: "PostHog product analytics feature flags attribution funnel ClickHouse",
      evidence: [
        {
          type: "pull_request",
          repo: "PostHog/posthog",
          title: "Fix product analytics feature flags attribution funnel",
          text: "Feature flags were missing from attribution funnel analytics backed by ClickHouse.",
          url: "https://github.com/PostHog/posthog/pull/200",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["analytics"],
          contribution_weight: 10,
          neural_intent_score: 0.9
        }
      ],
      neural_intent_score: 0.9
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      broadRealtimeLead,
      analyticsLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(broadRealtimeLead),
      embeddingFor(analyticsLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find growth engineers working on real-time analytics, event ingestion, feature flags, attribution, activation funnels, ClickHouse, PostHog, GrowthBook, or RudderStack.",
      limit: 2
    });

    expect(result.query_plan.topics).not.toContain("realtime");
    expect(result.results[0]?.engineer_login).toBe("posthog-feature-flag");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(result.results[1]?.evidence_score ?? 0);
  });

  test("requires direct buyer evidence for using-style workflow prompts", async () => {
    const genericHighScoreLead = leadFixture({
      engineer_login: "generic-high-score-ai",
      score: 130,
      top_topics: ["realtime", "WebSocket"],
      semantic_document: "realtime websocket ai platform",
      evidence: [
        {
          type: "pull_request",
          repo: "vercel/ai",
          title: "Add provider routing option",
          text: "provider routing option",
          url: "https://github.com/vercel/ai/pull/300",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["developer tools"],
          contribution_weight: 10,
          neural_intent_score: 1
        }
      ],
      neural_intent_score: 1
    });
    const workflowLead = leadFixture({
      engineer_login: "crm-enrichment-workflow",
      score: 70,
      top_topics: [],
      semantic_document: "CRM enrichment spreadsheet workflow outbound personalization GTM",
      evidence: [
        {
          type: "pull_request",
          repo: "activepieces/activepieces",
          title: "Add CRM enrichment workflow for spreadsheet prospecting",
          text: "Outbound personalization workflow enriches CRM rows from spreadsheet leads.",
          url: "https://github.com/activepieces/activepieces/pull/300",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: [],
          repo_categories: ["workflow automation"],
          contribution_weight: 10,
          neural_intent_score: 0.9
        }
      ],
      neural_intent_score: 0.9
    });

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), [
      genericHighScoreLead,
      workflowLead
    ]);
    await writeJsonl(join(rootDir, "data", "processed", "engineer_embeddings.jsonl"), [
      embeddingFor(genericHighScoreLead),
      embeddingFor(workflowLead)
    ]);

    const result = await searchLeads({
      rootDir,
      query:
        "Find devtool founders, sales engineers, or ops engineers using spreadsheets, CRM workflows, enrichment, automation, no-code tools, or outbound personalization to manage GTM.",
      limit: 2
    });

    expect(result.results[0]?.engineer_login).toBe("crm-enrichment-workflow");
    expect(result.results[0]?.evidence_score).toBeGreaterThan(0);
    expect(result.results[1]?.evidence_score).toBe(0);
  });

  test("large-corpus prefilter keeps directly relevant evidence candidates", async () => {
    const noiseLeads = Array.from({ length: 650 }, (_, index) =>
      leadFixture({
        engineer_login: `generic-maintenance-${index}`,
        score: 120,
        top_topics: ["realtime"],
        semantic_document: "generic backend maintenance release cleanup",
        evidence: [
          {
            type: "pull_request",
            repo: "example/generic",
            title: `Generic maintenance cleanup ${index}`,
            text: "release cleanup docs formatting",
            url: `https://github.com/example/generic/pull/${index}`,
            created_at: "2026-06-20T10:00:00Z",
            matched_topics: [],
            repo_categories: [],
            contribution_weight: 10
          }
        ]
      })
    );
    const directEvidenceLead = leadFixture({
      engineer_login: "direct-cache-pain",
      score: 50,
      top_topics: ["cache invalidation"],
      semantic_document: "cache invalidation reactive backend state",
      evidence: [
        {
          type: "issue",
          repo: "supabase/supabase",
          title: "Cache invalidation leaves dashboard stale after mutation",
          text: "Users see stale data after mutation until manual refresh.",
          url: "https://github.com/supabase/supabase/issues/999",
          created_at: "2026-06-20T10:00:00Z",
          matched_topics: ["cache invalidation"],
          repo_categories: ["backend-as-a-service"],
          contribution_weight: 4
        }
      ]
    });
    const leads = [...noiseLeads, directEvidenceLead];

    await writeJsonl(join(rootDir, "data", "processed", "ranked_leads.jsonl"), leads);
    await writeJsonl(
      join(rootDir, "data", "processed", "engineer_embeddings.jsonl"),
      leads.map(embeddingFor)
    );

    const result = await searchLeads({
      rootDir,
      query: "Find engineers talking about cache invalidation",
      limit: 1
    });

    expect(result.results[0]?.engineer_login).toBe("direct-cache-pain");
    expect(result.results[0]?.evidence[0]?.title).toContain("Cache invalidation");
  });
});

function leadFixture(overrides: Partial<RankedLead>): RankedLead {
  return {
    engineer_login: "engineer",
    name: null,
    score: 50,
    why_relevant: "Relevant public activity.",
    outreach_angle: "Relevant to Convex.",
    score_breakdown: {
      recent_activity: 20,
      repo_category_fit: 20,
      topic_fit: 20,
      contribution_depth: 10,
      stack_fit: 5,
      evidence_quality: 5,
      penalties: 0
    },
    evidence: [
      {
        type: "pull_request",
        repo: "electric-sql/electric",
        title: "Relevant PR",
        text: overrides.semantic_document ?? "",
        url: "https://github.com/electric-sql/electric/pull/1",
        created_at: "2026-06-20T10:00:00Z",
        matched_topics: overrides.top_topics ?? [],
        repo_categories: ["real-time sync", "reactive database"],
        contribution_weight: 10
      }
    ],
    top_repos: ["electric-sql/electric"],
    top_topics: [],
    repo_categories: ["real-time sync", "reactive database"],
    primary_languages: ["TypeScript"],
    last_active_at: "2026-06-20T10:00:00Z",
    window_start_at: "2026-03-22T10:00:00Z",
    time_window_days: 90,
    semantic_document: "",
    ...overrides
  };
}

function embeddingFor(lead: RankedLead): EngineerEmbedding {
  const dimensions = embeddingDimensions(recipe);
  return {
    engineer_login: lead.engineer_login,
    dimensions,
    vector: embedText(lead.semantic_document, dimensions)
  };
}

async function mkdirp(path: string) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path, { recursive: true }));
}

function recipeFixture(): string {
  return `id: convex_realtime_sync_engineers
label: Engineers working on Convex-shaped backend problems
target_product: Convex
target_entity: engineer
time_window_days: 90
repo_categories:
  - real-time sync
  - reactive database
  - backend-as-a-service
  - local-first
  - offline-first
  - CRDT/collaboration
  - serverless backend
  - database sync
topic_terms:
  - sync
  - replication
  - realtime
  - live query
  - subscriptions
  - reactive data
  - cache invalidation
  - optimistic update
  - conflict resolution
  - CRDT
  - WebSocket
  - SQLite sync
  - Postgres changefeed
  - serverless function
  - backend state
strong_stacks:
  - TypeScript
  - React
  - Next.js
  - Node.js
  - Postgres
  - SQLite
  - WebSocket
negative_terms:
  - tutorial
  - sample
  - example
  - demo
  - toy
  - awesome-list
`;
}
