import { describe, expect, test } from "vitest";
import {
  createBuyerQuery,
  githubReadyBuyers,
  loadBuyerCatalog,
  summarizeBuyerSearch
} from "../src/buyers.js";
import type { SearchResponse } from "../src/types.js";

describe("buyer lead packs", () => {
  test("loads buyer catalog and identifies GitHub-ready devtool buyers", async () => {
    const buyers = await loadBuyerCatalog();
    const ready = githubReadyBuyers(buyers).map((buyer) => buyer.id);

    expect(ready).toEqual(expect.arrayContaining(["convex", "lore", "lopus", "openai"]));
    expect(ready).not.toContain("corgi");
    expect(buyers.find((buyer) => buyer.id === "convex")?.github_fit).toBe("high");
    expect(buyers.find((buyer) => buyer.id === "imagine-ai")?.github_fit).toBe("low");
  });

  test("creates buyer-specific queries from pain and stack signals", async () => {
    const buyers = await loadBuyerCatalog();
    const lopus = buyers.find((buyer) => buyer.id === "lopus");

    expect(lopus).toBeDefined();
    expect(createBuyerQuery(lopus!)).toContain("real-time analytics");
    expect(createBuyerQuery(lopus!)).toContain("growth engineers");
    expect(createBuyerQuery(lopus!)).toContain("event pipelines");
  });

  test("summarizes search output into quality-gated buyer lead report", async () => {
    const buyers = await loadBuyerCatalog();
    const lore = buyers.find((buyer) => buyer.id === "lore")!;
    const search: SearchResponse = {
      query_plan: {
        raw_query: createBuyerQuery(lore),
        target_entity: "founder_or_engineer",
        target_product: "Lore",
        time_window_days: 90,
        topics: ["Claude", "Codex", "context limits"],
        indexes_used: ["evidence", "keyword"]
      },
      results: [
        {
          engineer_login: "agent-collab-buyer-fit",
          name: null,
          score: 75,
          why_relevant: "Recently discussed Claude context limits.",
          outreach_angle: "Relevant to Lore.",
          score_breakdown: {
            recent_activity: 20,
            repo_category_fit: 15,
            topic_fit: 20,
            contribution_depth: 8,
            stack_fit: 5,
            evidence_quality: 5,
            penalties: 0
          },
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
          ],
          top_repos: ["continuedev/continue"],
          top_topics: ["Claude", "Codex", "context limits"],
          repo_categories: ["developer tools"],
          primary_languages: ["TypeScript"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.6,
          semantic_score: 0.4,
          topic_score: 0.5,
          evidence_score: 0.4,
          final_score: 78
        }
      ]
    };

    const report = summarizeBuyerSearch(lore, search);

    expect(report.quality_grade).toBe("demo_ready");
    expect(report.top_leads[0]?.high_signal).toBe(true);
    expect(report.top_leads[0]?.buyer_angle).toContain("Lore");
    expect(report.top_leads[0]?.evidence[0]?.title).toContain("Claude and Codex");
    expect(report.quality_notes).toContain("1 high-signal leads");
  });

  test("prioritizes buyer-ecosystem evidence over lexical-only false positives", async () => {
    const buyers = await loadBuyerCatalog();
    const lopus = buyers.find((buyer) => buyer.id === "lopus")!;
    const search: SearchResponse = {
      query_plan: {
        raw_query: createBuyerQuery(lopus),
        target_entity: "founder_or_engineer",
        target_product: "Lopus",
        time_window_days: 90,
        topics: ["real-time analytics", "event pipelines"],
        indexes_used: ["evidence", "keyword"]
      },
      results: [
        {
          engineer_login: "generic-streaming-engineer",
          name: null,
          score: 99,
          why_relevant: "Streaming event data work.",
          outreach_angle: "Looks lexical but not analytics ecosystem.",
          score_breakdown: {
            recent_activity: 25,
            repo_category_fit: 25,
            topic_fit: 25,
            contribution_depth: 20,
            stack_fit: 10,
            evidence_quality: 5,
            penalties: 0
          },
          evidence: [
            {
              type: "issue",
              repo: "openai/openai-python",
              title: "Real-time analytics event pipelines for product analytics event data",
              text: "Generic SSE streaming discussion uses analytics and event data words but is not growth analytics infrastructure.",
              url: "https://github.com/openai/openai-python/issues/1",
              created_at: "2026-06-20T10:00:00Z",
              matched_topics: ["real-time analytics", "event pipelines"],
              repo_categories: ["developer tools"],
              contribution_weight: 4
            }
          ],
          top_repos: ["openai/openai-python"],
          top_topics: ["real-time analytics", "event pipelines"],
          repo_categories: ["developer tools"],
          primary_languages: ["Python"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.9,
          semantic_score: 0.8,
          topic_score: 0.8,
          evidence_score: 0.5,
          final_score: 99
        },
        {
          engineer_login: "posthog-growth-engineer",
          name: null,
          score: 70,
          why_relevant: "Fixed a web analytics feature flags regression.",
          outreach_angle: "Relevant to Lopus.",
          score_breakdown: {
            recent_activity: 20,
            repo_category_fit: 20,
            topic_fit: 20,
            contribution_depth: 10,
            stack_fit: 8,
            evidence_quality: 5,
            penalties: 0
          },
          evidence: [
            {
              type: "pull_request",
              repo: "PostHog/posthog",
              title: "Fix web analytics feature flags regression",
              text: "Feature flags were not selectable in analytics match criteria.",
              url: "https://github.com/PostHog/posthog/pull/1",
              created_at: "2026-06-20T10:00:00Z",
              matched_topics: ["web analytics", "feature flags"],
              repo_categories: ["analytics"],
              contribution_weight: 10
            }
          ],
          top_repos: ["PostHog/posthog"],
          top_topics: ["web analytics", "feature flags"],
          repo_categories: ["analytics"],
          primary_languages: ["TypeScript"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.4,
          semantic_score: 0.4,
          topic_score: 0.4,
          evidence_score: 0.4,
          final_score: 70
        }
      ]
    };

    const report = summarizeBuyerSearch(lopus, search);

    expect(report.high_signal_lead_count).toBe(1);
    expect(report.top_leads).toHaveLength(1);
    expect(report.top_leads[0]?.engineer_login).toBe("posthog-growth-engineer");
    expect(report.top_leads[0]?.high_signal).toBe(true);
  });

  test("does not mark generic GitHub activity as buyer-ready without buyer-specific evidence", async () => {
    const buyers = await loadBuyerCatalog();
    const lopus = buyers.find((buyer) => buyer.id === "lopus")!;
    const search: SearchResponse = {
      query_plan: {
        raw_query: createBuyerQuery(lopus),
        target_entity: "founder_or_engineer",
        target_product: "Lopus",
        time_window_days: 90,
        topics: ["real-time analytics", "event pipelines"],
        indexes_used: ["evidence", "keyword"]
      },
      results: [
        {
          engineer_login: "generic-backend-maintainer",
          name: null,
          score: 95,
          why_relevant: "Recently changed auth routes.",
          outreach_angle: "Generic backend work.",
          score_breakdown: {
            recent_activity: 25,
            repo_category_fit: 25,
            topic_fit: 25,
            contribution_depth: 20,
            stack_fit: 10,
            evidence_quality: 5,
            penalties: 0
          },
          evidence: [
            {
              type: "pull_request",
              repo: "supabase/cli",
              title: "Local stack API proxy should require auth for admin backend routes",
              text: "Tighten local API auth handling for admin backend routes.",
              url: "https://github.com/supabase/cli/pull/1",
              created_at: "2026-06-20T10:00:00Z",
              matched_topics: ["auth", "database"],
              repo_categories: ["backend-as-a-service"],
              contribution_weight: 10
            }
          ],
          top_repos: ["supabase/cli"],
          top_topics: ["auth", "database"],
          repo_categories: ["backend-as-a-service"],
          primary_languages: ["TypeScript"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.6,
          semantic_score: 0.4,
          topic_score: 0.5,
          evidence_score: 0.5,
          final_score: 95
        }
      ]
    };

    const report = summarizeBuyerSearch(lopus, search);

    expect(report.high_signal_lead_count).toBe(0);
    expect(report.quality_grade).toBe("needs_more_data");
    expect(report.top_leads).toEqual([]);
  });

  test("requires ecosystem fit before marking medium-fit vertical buyers as high signal", async () => {
    const buyers = await loadBuyerCatalog();
    const rev1 = buyers.find((buyer) => buyer.id === "rev1")!;
    const search: SearchResponse = {
      query_plan: {
        raw_query: createBuyerQuery(rev1),
        target_entity: "engineer",
        target_product: "Rev1",
        time_window_days: 90,
        topics: ["design review"],
        indexes_used: ["evidence", "keyword"]
      },
      results: [
        {
          engineer_login: "generic-dashboard-engineer",
          name: null,
          score: 90,
          why_relevant: "Generic UI design review text.",
          outreach_angle: "Not a mechanical engineering lead.",
          score_breakdown: {
            recent_activity: 20,
            repo_category_fit: 15,
            topic_fit: 15,
            contribution_depth: 8,
            stack_fit: 5,
            evidence_quality: 5,
            penalties: 0
          },
          evidence: [
            {
              type: "pull_request",
              repo: "supabase/supabase",
              title: "Review dashboard design copy",
              text: "Review dashboard design copy in a generic web app.",
              url: "https://github.com/supabase/supabase/pull/2",
              created_at: "2026-06-20T10:00:00Z",
              matched_topics: ["design review"],
              repo_categories: ["backend-as-a-service"],
              contribution_weight: 10
            }
          ],
          top_repos: ["supabase/supabase"],
          top_topics: ["design review"],
          repo_categories: ["backend-as-a-service"],
          primary_languages: ["TypeScript"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.8,
          semantic_score: 0.5,
          topic_score: 0.5,
          evidence_score: 0.5,
          final_score: 90
        }
      ]
    };

    const report = summarizeBuyerSearch(rev1, search);

    expect(report.high_signal_lead_count).toBe(0);
    expect(report.quality_grade).toBe("needs_more_data");
    expect(report.top_leads).toEqual([]);
  });

  test("filters weak cross-ecosystem matches for high-fit buyers", async () => {
    const buyers = await loadBuyerCatalog();
    const lore = buyers.find((buyer) => buyer.id === "lore")!;
    const search: SearchResponse = {
      query_plan: {
        raw_query: createBuyerQuery(lore),
        target_entity: "engineer",
        target_product: "Lore",
        time_window_days: 90,
        topics: ["Codex"],
        indexes_used: ["evidence", "keyword"]
      },
      results: [
        {
          engineer_login: "generic-security-reporter",
          name: null,
          score: 85,
          why_relevant: "A weak Codex mention in a generic repo.",
          outreach_angle: "Not a Lore lead.",
          score_breakdown: {
            recent_activity: 20,
            repo_category_fit: 15,
            topic_fit: 15,
            contribution_depth: 8,
            stack_fit: 5,
            evidence_quality: 5,
            penalties: 0
          },
          evidence: [
            {
              type: "issue",
              repo: "trpc/trpc",
              title: "Codex generated security report needs copy tweak",
              text: "This is a weak generated report mention, not evidence of workflow pain.",
              url: "https://github.com/trpc/trpc/issues/3",
              created_at: "2026-06-20T10:00:00Z",
              matched_topics: ["Codex"],
              repo_categories: ["developer tools"],
              contribution_weight: 4
            }
          ],
          top_repos: ["trpc/trpc"],
          top_topics: ["Codex"],
          repo_categories: ["developer tools"],
          primary_languages: ["TypeScript"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.5,
          semantic_score: 0.5,
          topic_score: 0.5,
          evidence_score: 0.5,
          final_score: 85
        },
        {
          engineer_login: "agent-context-engineer",
          name: null,
          score: 70,
          why_relevant: "Strong cross-ecosystem agent collaboration pain.",
          outreach_angle: "Relevant to Lore.",
          score_breakdown: {
            recent_activity: 20,
            repo_category_fit: 15,
            topic_fit: 15,
            contribution_depth: 8,
            stack_fit: 5,
            evidence_quality: 5,
            penalties: 0
          },
          evidence: [
            {
              type: "pull_request",
              repo: "electric-sql/electric",
              title: "Agent context compaction and prompt handoff",
              text: "Agent runs lose context in long tasks; add prompt handoff and collaboration support.",
              url: "https://github.com/electric-sql/electric/pull/3",
              created_at: "2026-06-20T10:00:00Z",
              matched_topics: ["agent runs", "prompt handoff", "agent collaboration"],
              repo_categories: ["developer tools"],
              contribution_weight: 10
            }
          ],
          top_repos: ["electric-sql/electric"],
          top_topics: ["agent runs", "prompt handoff", "agent collaboration"],
          repo_categories: ["developer tools"],
          primary_languages: ["TypeScript"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.4,
          semantic_score: 0.4,
          topic_score: 0.4,
          evidence_score: 0.4,
          final_score: 70
        }
      ]
    };

    const report = summarizeBuyerSearch(lore, search);

    expect(report.high_signal_lead_count).toBe(1);
    expect(report.top_leads[0]?.engineer_login).toBe("agent-context-engineer");
  });

  test("does not treat maintenance-only seed repo work as a high-signal buyer lead", async () => {
    const buyers = await loadBuyerCatalog();
    const convex = buyers.find((buyer) => buyer.id === "convex")!;
    const search: SearchResponse = {
      query_plan: {
        raw_query: createBuyerQuery(convex),
        target_entity: "engineer",
        target_product: "Convex",
        time_window_days: 90,
        topics: ["cache invalidation"],
        indexes_used: ["evidence", "keyword"]
      },
      results: [
        {
          engineer_login: "maintenance-upgrader",
          name: null,
          score: 95,
          why_relevant: "Maintenance upgrade in a seed repo.",
          outreach_angle: "Weak Convex signal.",
          score_breakdown: {
            recent_activity: 20,
            repo_category_fit: 20,
            topic_fit: 20,
            contribution_depth: 10,
            stack_fit: 8,
            evidence_quality: 5,
            penalties: 0
          },
          evidence: [
            {
              type: "pull_request",
              repo: "trpc/trpc",
              title: "chore: upgrade Next.js examples",
              text: "Update example apps for a Next.js cache invalidation API change.",
              url: "https://github.com/trpc/trpc/pull/4",
              created_at: "2026-06-20T10:00:00Z",
              matched_topics: ["cache invalidation"],
              repo_categories: ["reactive database"],
              contribution_weight: 7
            }
          ],
          top_repos: ["trpc/trpc"],
          top_topics: ["cache invalidation"],
          repo_categories: ["reactive database"],
          primary_languages: ["TypeScript"],
          last_active_at: "2026-06-20T10:00:00Z",
          window_start_at: "2026-03-22T10:00:00Z",
          time_window_days: 90,
          keyword_score: 0.8,
          semantic_score: 0.5,
          topic_score: 0.5,
          evidence_score: 0.5,
          final_score: 95
        }
      ]
    };

    const report = summarizeBuyerSearch(convex, search);

    expect(report.high_signal_lead_count).toBe(0);
    expect(report.top_leads).toEqual([]);
  });
});
