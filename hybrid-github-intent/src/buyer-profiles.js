const COMMON_QUERY_TERMS = new Set([
  "about",
  "actively",
  "build",
  "building",
  "buyer",
  "buyers",
  "engineer",
  "engineers",
  "find",
  "founder",
  "founders",
  "github",
  "good",
  "high",
  "intent",
  "lead",
  "leads",
  "looking",
  "people",
  "product",
  "strong",
  "talking",
  "that",
  "their",
  "these",
  "those",
  "users",
  "want",
  "with",
  "working"
]);

export const BUYER_PROFILES = {
  convex: {
    id: "convex",
    label: "Convex Buyer",
    product: "Convex",
    query:
      "Find founders or engineers on GitHub talking about cache invalidation, WebSocket infrastructure, Firebase alternatives, Supabase alternatives, or wanting a simpler full-stack backend.",
    fitTerms: [
      "appwrite",
      "appsync",
      "baas",
      "cache invalidation",
      "firebase",
      "firestore",
      "liveblocks",
      "postgres_changes",
      "realtime",
      "real-time",
      "replication",
      "self-hosted backend",
      "supabase",
      "sync",
      "websocket"
    ],
    defaultFit:
      "Convex is a strong fit when the evidence shows brittle backend state, realtime sync, or cache invalidation work.",
    solutionAngles: [
      {
        terms: ["websocket", "reconnect", "realtime", "real-time", "subscription", "channel"],
        text: "Convex can replace custom realtime/WebSocket plumbing with a TypeScript-native reactive backend."
      },
      {
        terms: ["cache", "invalidation", "stale", "getdoc", "memorylocalcache"],
        text: "Convex can reduce client cache invalidation and stale server-state handling by making backend queries reactive."
      },
      {
        terms: ["firebase", "supabase", "appwrite", "pocketbase", "self-hosted"],
        text: "Convex is positioned as a simpler backend-as-a-service alternative for teams tired of stitching infrastructure together."
      }
    ],
    suggestedSeedRepos: [
      "supabase/supabase",
      "supabase/supabase-js",
      "firebase/firebase-js-sdk",
      "appwrite/appwrite",
      "pocketbase/pocketbase",
      "electric-sql/electric",
      "liveblocks/liveblocks",
      "instantdb/instant"
    ]
  },
  lore: {
    id: "lore",
    label: "Lore Buyer",
    product: "Lore",
    query:
      "Find founders or engineers on GitHub building AI coding workflows who are frustrated with Claude, Codex, agent handoffs, shared context, prompt workflows, code review collaboration, or teams coordinating multiple AI coding agents.",
    fitTerms: [
      "agent handoff",
      "agent memory",
      "ai coding",
      "aider",
      "claude",
      "claude code",
      "codex",
      "code review",
      "handoff",
      "multi-agent",
      "opencode",
      "prompt workflow",
      "review agent",
      "shared context"
    ],
    defaultFit:
      "Lore fits teams whose GitHub activity shows AI coding workflows becoming hard to coordinate across people, agents, and context.",
    solutionAngles: [
      {
        terms: ["claude", "codex", "opencode", "aider", "ai coding"],
        text: "Lore can help teams coordinate work once individual AI coding tools create too much context and handoff overhead."
      },
      {
        terms: ["context", "memory", "handoff", "prompt", "workflow"],
        text: "Lore is relevant because the evidence points to shared context, prompt workflow, or agent-memory coordination pain."
      },
      {
        terms: ["review", "collaboration", "team", "multi-agent"],
        text: "Lore can turn scattered AI coding and review activity into a shared collaboration layer for engineering teams."
      }
    ],
    suggestedSeedRepos: [
      "Aider-AI/aider",
      "anomalyco/opencode",
      "coder/agentapi",
      "langchain-ai/open-swe",
      "modelcontextprotocol/typescript-sdk",
      "vercel/ai",
      "n8n-io/n8n"
    ]
  },
  lopus: {
    id: "lopus",
    label: "Lopus Buyer",
    product: "Lopus",
    query:
      "Find founders or engineers on GitHub working on real-time analytics, growth dashboards, event pipelines, ClickHouse, PostHog, experiments, funnels, ingestion lag, or metrics reliability.",
    fitTerms: [
      "analytics",
      "clickhouse",
      "dashboard",
      "event pipeline",
      "experiment",
      "funnel",
      "growth",
      "ingestion",
      "ingestion lag",
      "metrics",
      "posthog",
      "realtime analytics",
      "segment",
      "telemetry",
      "warehouse"
    ],
    defaultFit:
      "Lopus fits engineers who are fighting event ingestion, growth analytics, metrics freshness, or dashboard reliability.",
    solutionAngles: [
      {
        terms: ["analytics", "dashboard", "metrics", "funnel", "growth"],
        text: "Lopus is relevant because the evidence is about growth analytics or dashboards that need faster, more reliable iteration."
      },
      {
        terms: ["ingestion", "pipeline", "events", "lag", "warehouse"],
        text: "Lopus can help when the pain is event pipeline freshness, ingestion lag, or fragile analytics plumbing."
      },
      {
        terms: ["clickhouse", "posthog", "experiment", "telemetry"],
        text: "Lopus has a strong angle when teams are already working near ClickHouse/PostHog-style analytics infrastructure."
      }
    ],
    suggestedSeedRepos: [
      "posthog/posthog",
      "umami-software/umami",
      "ClickHouse/ClickHouse",
      "plausible/analytics",
      "growthbook/growthbook",
      "rudderlabs/rudder-server",
      "openreplay/openreplay"
    ]
  },
  openai: {
    id: "openai",
    label: "OpenAI Buyer",
    product: "OpenAI",
    query:
      "Find engineers on GitHub building AI agents, tool calling, evals, traces, streaming chat, RAG, function calling, prompt orchestration, or model routing who are hitting reliability, latency, observability, or integration pain.",
    fitTerms: [
      "agent",
      "agents",
      "ai agent",
      "agents sdk",
      "chat",
      "eval",
      "evals",
      "function calling",
      "langchain",
      "llm",
      "model routing",
      "openai",
      "prompt",
      "rag",
      "streaming",
      "tool call",
      "tool calling",
      "trace",
      "tracing"
    ],
    defaultFit:
      "OpenAI is relevant when the evidence shows teams building agents, evals, tool calls, RAG, or streaming AI workflows with reliability pain.",
    solutionAngles: [
      {
        terms: ["agent", "tool call", "tool calling", "function calling"],
        text: "OpenAI can help with first-class agent, tool-calling, and orchestration primitives instead of bespoke glue code."
      },
      {
        terms: ["eval", "evals", "trace", "tracing", "observability"],
        text: "OpenAI is relevant because the evidence points to eval, tracing, or observability needs around AI behavior."
      },
      {
        terms: ["streaming", "chat", "rag", "prompt", "model routing"],
        text: "OpenAI has a strong angle for teams building streaming chat, RAG, prompt orchestration, or model-routing systems."
      }
    ],
    suggestedSeedRepos: [
      "openai/openai-python",
      "openai/openai-node",
      "openai/openai-cookbook",
      "langchain-ai/langchainjs",
      "langchain-ai/langgraphjs",
      "vercel/ai",
      "n8n-io/n8n",
      "homeassistant-ai/ha-mcp"
    ]
  },
  "orange-slice": {
    id: "orange-slice",
    label: "Orange Slice Buyer",
    product: "Orange Slice",
    query:
      "Find founders or engineers on GitHub building sales automation, CRM enrichment, lead scraping, spreadsheet workflows, outbound personalization, GTM ops, CSV imports, or agentic workflows inside spreadsheets.",
    fitTerms: [
      "airtable",
      "csv",
      "crm",
      "enrichment",
      "google sheets",
      "gtm",
      "hubspot",
      "lead",
      "leads",
      "outbound",
      "personalization",
      "sales",
      "scraping",
      "spreadsheet",
      "spreadsheet workflow"
    ],
    defaultFit:
      "Orange Slice fits teams whose GitHub activity shows sales, lead, CRM, enrichment, or spreadsheet workflow automation pain.",
    solutionAngles: [
      {
        terms: ["spreadsheet", "google sheets", "airtable", "csv"],
        text: "Orange Slice is relevant when GTM workflows are still being stitched together through spreadsheets, CSVs, or tables."
      },
      {
        terms: ["sales", "crm", "hubspot", "lead", "leads", "outbound"],
        text: "Orange Slice can help automate sales and outbound workflows that currently require custom CRM or lead tooling."
      },
      {
        terms: ["scraping", "enrichment", "personalization", "workflow"],
        text: "Orange Slice has a strong angle when teams are building enrichment, scraping, or personalization workflows by hand."
      }
    ],
    suggestedSeedRepos: [
      "rowyio/rowy",
      "nocodb/nocodb",
      "activepieces/activepieces",
      "n8n-io/n8n",
      "open-webui/pipelines",
      "apify/crawlee",
      "browserbase/stagehand",
      "twentyhq/twenty",
      "salesforce/salesforce-mcp"
    ]
  },
  "cache-baas": {
    id: "cache-baas",
    label: "Cache + BaaS Alternatives",
    product: "Cache/BaaS alternative products",
    query:
      "Find engineers frustrated with cache invalidation, stale server state, Firebase, Supabase, Appwrite, PocketBase, self-hosted backends, or backend-as-a-service reliability.",
    fitTerms: [
      "appwrite",
      "baas",
      "cache",
      "cache invalidation",
      "firebase",
      "pocketbase",
      "self-hosted",
      "stale",
      "supabase"
    ],
    defaultFit:
      "This lead is relevant for products replacing cache-heavy BaaS stacks or simplifying backend state.",
    suggestedSeedRepos: [
      "supabase/supabase",
      "firebase/firebase-js-sdk",
      "appwrite/appwrite",
      "pocketbase/pocketbase",
      "nhost/nhost"
    ]
  },
  "live-query": {
    id: "live-query",
    label: "Live Query Engineers",
    product: "Live query infrastructure",
    query:
      "Find engineers building live queries, subscriptions, realtime dashboards, database watchers, sync engines, or reactive server state.",
    fitTerms: [
      "changefeed",
      "live query",
      "reactive",
      "realtime",
      "subscription",
      "sync",
      "watcher"
    ],
    defaultFit:
      "This lead is relevant for live-query products because the evidence shows reactive data or subscription infrastructure.",
    suggestedSeedRepos: [
      "electric-sql/electric",
      "instantdb/instant",
      "liveblocks/liveblocks",
      "hasura/graphql-engine",
      "parse-community/parse-server"
    ]
  },
  "crdt-local-first": {
    id: "crdt-local-first",
    label: "CRDT + Local-First",
    product: "CRDT/local-first infrastructure",
    query:
      "Find engineers building CRDTs, local-first apps, offline sync, multiplayer collaboration, Automerge, Yjs, Electric, Replicache, or conflict resolution.",
    fitTerms: [
      "automerge",
      "conflict",
      "crdt",
      "electric",
      "local-first",
      "offline",
      "replicache",
      "sync",
      "yjs"
    ],
    defaultFit:
      "This lead is relevant for CRDT/local-first products because the evidence shows offline sync, conflict, or multiplayer state pain.",
    suggestedSeedRepos: [
      "automerge/automerge",
      "yjs/yjs",
      "electric-sql/electric",
      "pubkey/rxdb",
      "rocicorp/replicache",
      "liveblocks/liveblocks"
    ]
  },
  "baas-realtime": {
    id: "baas-realtime",
    label: "BaaS Realtime Infra",
    product: "BaaS realtime infrastructure",
    query:
      "Find engineers working on Firebase, Supabase, Appwrite, PocketBase, Nhost, WebSocket reconnects, realtime channels, auth, storage, or self-hosted backend infrastructure.",
    fitTerms: [
      "appwrite",
      "auth",
      "baas",
      "firebase",
      "nhost",
      "pocketbase",
      "realtime",
      "self-hosted",
      "storage",
      "supabase",
      "websocket"
    ],
    defaultFit:
      "This lead is relevant for BaaS realtime infrastructure products because the evidence shows backend platform reliability pain.",
    suggestedSeedRepos: [
      "supabase/supabase",
      "supabase/realtime",
      "firebase/firebase-js-sdk",
      "appwrite/appwrite",
      "pocketbase/pocketbase",
      "nhost/nhost"
    ]
  }
};

export function buyerProfileIds() {
  return Object.keys(BUYER_PROFILES);
}

export function resolveBuyerProfile({ buyer, query } = {}) {
  if (buyer) {
    const normalized = normalizeProfileId(buyer);
    if (!BUYER_PROFILES[normalized]) {
      throw new Error(`Unknown buyer profile "${buyer}". Known profiles: ${buyerProfileIds().join(", ")}`);
    }
    return BUYER_PROFILES[normalized];
  }

  const inferred = inferBuyerProfile(query);
  return inferred ?? customBuyerProfile(query);
}

export function inferBuyerProfile(query = "") {
  const text = query.toLowerCase();
  const ordered = [
    ["orange-slice", ["orange slice", "spreadsheet", "sales", "crm", "outbound", "lead enrichment"]],
    ["lore", ["lore", "claude", "codex", "ai coding", "agent handoff", "shared context"]],
    ["lopus", ["lopus", "growth", "analytics", "clickhouse", "posthog", "funnel"]],
    ["openai", ["openai", "tool calling", "function calling", "evals", "rag", "agents sdk"]],
    ["crdt-local-first", ["crdt", "local-first", "automerge", "yjs", "replicache"]],
    ["baas-realtime", ["baas realtime", "realtime infra", "firebase", "supabase", "appwrite"]],
    ["live-query", ["live query", "reactive database", "subscriptions"]],
    ["cache-baas", ["cache invalidation", "baas alternatives", "firebase alternatives", "supabase alternatives"]],
    ["convex", ["convex"]]
  ];

  const match = ordered.find(([, terms]) => terms.some((term) => text.includes(term)));
  return match ? BUYER_PROFILES[match[0]] : null;
}

export function queryConceptTerms(query = "") {
  const text = query.toLowerCase();
  const quoted = [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim());
  const phrases = [
    ...quoted,
    ...[
      "cache invalidation",
      "real-time analytics",
      "real-time sync",
      "self-hosted backend",
      "tool calling",
      "function calling",
      "model routing",
      "shared context",
      "agent handoff",
      "google sheets",
      "lead enrichment",
      "local-first",
      "live query"
    ].filter((phrase) => text.includes(phrase))
  ];
  const tokens = text
    .replace(/[^a-z0-9.+#-]+/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !COMMON_QUERY_TERMS.has(term));

  return [...new Set([...phrases, ...tokens])].slice(0, 40);
}

function normalizeProfileId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/g, "-")
    .replace("-buyer", "");
}

function customBuyerProfile(query = "") {
  return {
    id: "custom",
    label: "Custom Buyer",
    product: "the requested product",
    query,
    fitTerms: queryConceptTerms(query),
    defaultFit: "This lead is relevant because the GitHub evidence matches the requested buyer pain and product category.",
    solutionAngles: []
  };
}
