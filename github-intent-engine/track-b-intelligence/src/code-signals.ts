import { includesTerm, normalizeText } from "./text.js";
import type { CodeSignal } from "./types.js";

type SignalPattern = {
  term: string;
  pattern: RegExp;
  weight: number;
};

type CodeSignalRule = {
  id: string;
  label: string;
  pain_point: string;
  code_manifestation: string;
  query_terms: string[];
  patterns: SignalPattern[];
  negative_patterns?: SignalPattern[];
  minimum_score?: number;
};

export const CODE_SIGNAL_RULES: CodeSignalRule[] = [
  {
    id: "frontend_server_state_sync",
    label: "Frontend/server state sync pain",
    pain_point: "Keeping frontend state in sync with server state is annoying.",
    code_manifestation:
      "Lots of useEffect(fetch...), React Query invalidations, manual cache updates, and optimistic update rollback code.",
    query_terms: [
      "frontend state",
      "server state",
      "state sync",
      "React Query",
      "cache invalidation",
      "manual cache update",
      "optimistic update",
      "optimistic rollback",
      "useEffect fetch"
    ],
    patterns: [
      { term: "useEffect(fetch...)", pattern: /\buseEffect\b[\s\S]{0,180}\bfetch\b/i, weight: 0.32 },
      { term: "React Query invalidation", pattern: /\b(queryClient\.)?invalidateQueries\b|\bReact Query\b/i, weight: 0.26 },
      { term: "manual cache update", pattern: /\bsetQueryData\b|\bmanual cache\b|\bcache update\b|\bstale (state|cache|data)\b/i, weight: 0.2 },
      { term: "optimistic update rollback", pattern: /\boptimistic (update|mutation|message|rollback)\b|\brollback\b/i, weight: 0.2 },
      { term: "client/server type state bridge", pattern: /\bserver state\b|\bclient state\b|\bfrontend state\b/i, weight: 0.14 }
    ],
    minimum_score: 0.22
  },
  {
    id: "realtime_product_critical",
    label: "Realtime product-critical path",
    pain_point: "Realtime behavior is becoming product-critical.",
    code_manifestation:
      "WebSocket, SSE, or polling code for chat, dashboards, presence, notifications, logs, jobs, collaboration, and transcript streams.",
    query_terms: [
      "WebSocket",
      "WebSocket infrastructure",
      "SSE",
      "EventSource",
      "polling",
      "presence",
      "chat",
      "notifications",
      "collaboration",
      "transcript stream"
    ],
    patterns: [
      { term: "WebSocket transport", pattern: /\b(websocket|web socket|socket\.io)\b/i, weight: 0.13 },
      { term: "SSE/EventSource transport", pattern: /\b(sse|eventsource)\b/i, weight: 0.13 },
      { term: "polling transport", pattern: /\bpolling\b/i, weight: 0.13 },
      { term: "presence/chat/collaboration surface", pattern: /\b(presence|chat|collaboration|collaborative|room|rooms)\b/i, weight: 0.2 },
      { term: "live dashboard/notifications/log stream", pattern: /\b(dashboard|notification|notifications|logs?|transcript|stream|streams)\b/i, weight: 0.16 },
      { term: "subscription/reconnect handling", pattern: /\b(subscription|subscriptions|reconnect|disconnect|dropped connection)\b/i, weight: 0.2 },
      { term: "realtime updates", pattern: /\b(realtime|real-time|live updates?|live query|changefeed)\b/i, weight: 0.2 }
    ],
    minimum_score: 0.18
  },
  {
    id: "crud_plumbing",
    label: "Thin CRUD/API plumbing",
    pain_point: "Backend CRUD is mostly plumbing.",
    code_manifestation:
      "Thin API routes that validate input, call the database, return JSON, and duplicate client/server types.",
    query_terms: [
      "CRUD",
      "API routes",
      "thin API routes",
      "serverless functions",
      "validate input",
      "return JSON",
      "duplicated client server types"
    ],
    patterns: [
      { term: "API route files", pattern: /\b(api\/|routes?\/|route\.ts|route\.tsx|controller|resolver)\b/i, weight: 0.2 },
      { term: "validation before DB call", pattern: /\b(zod|validator|validate|schema\.parse|safeParse)\b/i, weight: 0.16 },
      { term: "DB write plumbing", pattern: /\b(db|prisma|drizzle)\.(insert|update|delete|create|find|select|query)\b/i, weight: 0.2 },
      { term: "JSON response plumbing", pattern: /\b(return|returns?)\s+json\b|\bNextResponse\.json\b|\bres\.json\b/i, weight: 0.16 },
      { term: "DTO/API response types", pattern: /\b(dto|request type|response type|api response|client\/server types?)\b/i, weight: 0.18 }
    ],
    minimum_score: 0.24
  },
  {
    id: "schema_churn",
    label: "Schema and migration churn",
    pain_point: "The data model is changing fast while the product is still being shaped.",
    code_manifestation:
      "Frequent prisma migrate, drizzle, migration files, renamed tables, and added columns while prototyping.",
    query_terms: [
      "schema churn",
      "migration churn",
      "prisma migrate",
      "drizzle",
      "renaming tables",
      "adding columns"
    ],
    patterns: [
      { term: "Prisma migration", pattern: /\bprisma migrate\b|\bschema\.prisma\b/i, weight: 0.28 },
      { term: "Drizzle schema/migration", pattern: /\bdrizzle\b|\bdrizzle-kit\b/i, weight: 0.22 },
      { term: "migration files", pattern: /\b(migrations?\/|db\/migrations?|migrate|migration)\b/i, weight: 0.22 },
      { term: "adding/renaming columns", pattern: /\b(add|adding|rename|renaming|drop|alter)\s+(column|table|field)\b|\badd_[a-z0-9_]+\.sql\b/i, weight: 0.2 },
      { term: "schema changes", pattern: /\b(schema changes?|database schema|db schema)\b/i, weight: 0.16 }
    ],
    minimum_score: 0.22
  },
  {
    id: "ai_durable_state",
    label: "Durable AI app state",
    pain_point: "AI apps need durable state for conversations, tool calls, agent runs, and artifacts.",
    code_manifestation:
      "Persisted conversations, tool calls, agent runs, transcripts, eval traces, workflow steps, and generated artifacts.",
    query_terms: [
      "AI durable state",
      "agent runs",
      "tool calls",
      "conversation history",
      "transcripts",
      "eval traces",
      "workflow steps",
      "generated artifacts"
    ],
    patterns: [
      { term: "agent runs", pattern: /\bagent runs?\b|\bagent_runs\b|\bai agents?\b/i, weight: 0.26 },
      { term: "conversation transcripts", pattern: /\bconversation(s)?\b|\btranscripts?\b/i, weight: 0.16 },
      { term: "tool calls", pattern: /\btool[_\s-]?calls?\b|\bfunction calls?\b/i, weight: 0.22 },
      { term: "eval traces", pattern: /\beval traces?\b|\bevals?\b/i, weight: 0.18 },
      { term: "generated artifacts", pattern: /\bgenerated artifacts?\b/i, weight: 0.14 },
      { term: "persisted AI state", pattern: /\bpersist(ing|ed)?\b|\bdurable\b|\bcheckpoint\b|\bmemory\b/i, weight: 0.16 }
    ],
    minimum_score: 0.26
  },
  {
    id: "job_workflow_state",
    label: "Job/workflow state machine pain",
    pain_point: "Job and workflow state is messy to model and recover.",
    code_manifestation:
      "Tables or logic for pending/running/failed/done, retries, cron cleanup, webhook idempotency, and background task progress.",
    query_terms: [
      "workflow state",
      "job state",
      "pending running failed done",
      "retries",
      "cron cleanup",
      "webhook idempotency",
      "background task progress"
    ],
    patterns: [
      { term: "pending/running/failed/done states", pattern: /\bpending\b[\s\S]{0,120}\brunning\b[\s\S]{0,120}\bfailed\b[\s\S]{0,120}\bdone\b/i, weight: 0.3 },
      { term: "retry logic", pattern: /\bretr(y|ies|ied|ying)\b|\bbackoff\b|\bdead letter\b/i, weight: 0.18 },
      { term: "cron cleanup", pattern: /\bcron\b|\bcleanup\b|\bscheduled job\b/i, weight: 0.16 },
      { term: "webhook idempotency", pattern: /\bwebhook\b[\s\S]{0,80}\bidempot/i, weight: 0.24 },
      { term: "background task progress", pattern: /\b(background|async)\s+(job|task|worker|queue)\b|\bprogress\b/i, weight: 0.18 }
    ],
    minimum_score: 0.24
  },
  {
    id: "multi_user_state",
    label: "Multi-user/shared state creeping in",
    pain_point: "The product is adding teams, permissions, workspaces, and shared sessions.",
    code_manifestation:
      "New userId, teamId, workspaceId, permissions, ownership checks, shared sessions, and collaboration concepts.",
    query_terms: [
      "multi-user",
      "teamId",
      "workspaceId",
      "userId",
      "permissions",
      "ownership checks",
      "shared sessions",
      "collaboration"
    ],
    patterns: [
      { term: "user/team/workspace identifiers", pattern: /(userId|user_id|teamId|team_id|workspaceId|workspace_id|organizationId|organization_id|orgId|org_id)/i, weight: 0.28 },
      { term: "permissions/ownership checks", pattern: /\b(permission|permissions|rbac|ownership|owner|access control|authorize|authorization)\b/i, weight: 0.18 },
      { term: "shared sessions", pattern: /\b(shared session|shared workspace|shared state|members?|invites?)\b/i, weight: 0.18 },
      { term: "collaboration concepts", pattern: /\b(collaboration|collaborative|presence|workspace|team)\b/i, weight: 0.14 }
    ],
    minimum_score: 0.18
  },
  {
    id: "type_drift",
    label: "Types drift across DB/API/frontend",
    pain_point: "Types are drifting between the database, API layer, and frontend.",
    code_manifestation:
      "Separate types.ts files, DTOs, generated schemas, zod validators, API response types, and manual transformations.",
    query_terms: [
      "type drift",
      "types.ts",
      "DTO",
      "zod",
      "generated schemas",
      "API response types",
      "manual transformations"
    ],
    patterns: [
      { term: "shared types file", pattern: /\btypes\.ts\b|\btypes\.tsx\b|\btypes\/|\bshared types?\b/i, weight: 0.2 },
      { term: "DTO/API response types", pattern: /\bdto\b|\bapi response\b|\bresponse types?\b|\brequest types?\b/i, weight: 0.18 },
      { term: "Zod/generated schema", pattern: /\bzod\b|\bgenerated schemas?\b|\bgenerated types?\b|\bschema validators?\b/i, weight: 0.2 },
      { term: "manual transforms", pattern: /\bmanual transformations?\b|\btransform(er|s|ation)?\b|\bserialize(r|d)?\b|\bmapper\b/i, weight: 0.18 },
      { term: "DB/API/frontend boundary", pattern: /\b(database|db)\b[\s\S]{0,80}\b(api|frontend|client)\b|\b(api|frontend|client)\b[\s\S]{0,80}\b(database|db)\b/i, weight: 0.18 }
    ],
    minimum_score: 0.22
  },
  {
    id: "speed_over_infra_control",
    label: "Speed over infra control",
    pain_point: "The code shows rapid product iteration rather than deep infrastructure tuning.",
    code_manifestation:
      "Rapid product iteration signals like prototypes, MVPs, quick feature work, or simpler backend preferences instead of deep Postgres tuning.",
    query_terms: [
      "speed over infra",
      "rapid iteration",
      "prototype",
      "MVP",
      "experiment",
      "simple backend",
      "simpler full-stack backend"
    ],
    patterns: [
      { term: "rapid product iteration", pattern: /\b(prototype|mvp|experiment|quickstart|iterate|iteration|ship fast|hackathon)\b/i, weight: 0.2 },
      { term: "simple backend preference", pattern: /\b(simple|simpler|easy|less boilerplate)\b[\s\S]{0,80}\b(backend|full-stack|full stack|server)\b/i, weight: 0.22 },
      { term: "product feature work", pattern: /\b(feature|product|user flow|onboarding|dashboard|workspace)\b/i, weight: 0.12 }
    ],
    negative_patterns: [
      { term: "deep Postgres tuning", pattern: /\b(explain analyze|vacuum|query plan|partition|pg_stat|lock contention|replica|sharding|dba|index tuning)\b/i, weight: 0.3 }
    ],
    minimum_score: 0.2
  },
  {
    id: "interactive_app_state",
    label: "Interactive app shared state",
    pain_point: "User actions create or update shared state that other UI surfaces need immediately.",
    code_manifestation:
      "User actions create or update shared state that live UI, dashboards, presence, or notifications need to reflect immediately.",
    query_terms: [
      "interactive app",
      "shared state",
      "create update shared state",
      "live UI",
      "dashboard",
      "presence",
      "notifications"
    ],
    patterns: [
      { term: "user-created shared state", pattern: /\b(create|update|mutation|action)\b[\s\S]{0,100}\b(shared state|workspace|room|team|session)\b/i, weight: 0.22 },
      { term: "live UI surfaces", pattern: /\b(live|interactive|realtime|real-time)\b[\s\S]{0,80}\b(ui|view|dashboard|surface|feed)\b/i, weight: 0.2 },
      { term: "presence/notifications", pattern: /\bpresence|notifications?|activity feed|collaboration\b/i, weight: 0.18 },
      { term: "state propagation", pattern: /\b(immediately reflect|propagate|broadcast|sync state|shared state)\b/i, weight: 0.18 }
    ],
    minimum_score: 0.18
  }
];

export function detectCodeSignals(text: string): CodeSignal[] {
  const source = String(text ?? "");
  if (source.trim().length === 0) {
    return [];
  }

  return CODE_SIGNAL_RULES
    .map((rule) => signalForRule(rule, source))
    .filter((signal): signal is CodeSignal => signal !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.label.localeCompare(right.label);
    });
}

export function mergeCodeSignals(signals: CodeSignal[], limit = 10): CodeSignal[] {
  const byId = new Map<string, CodeSignal & { count: number }>();
  for (const signal of signals) {
    const existing = byId.get(signal.id);
    if (!existing) {
      byId.set(signal.id, { ...signal, matched_terms: [...signal.matched_terms], count: 1 });
      continue;
    }
    existing.score = Math.max(existing.score, signal.score);
    existing.count += 1;
    existing.pain_point = existing.pain_point || signal.pain_point;
    existing.code_manifestation = existing.code_manifestation || signal.code_manifestation;
    existing.matched_terms = unique([...existing.matched_terms, ...signal.matched_terms]).slice(0, 10);
  }

  return [...byId.values()]
    .map(({ count, ...signal }) => ({
      ...signal,
      score: Number(Math.min(1, signal.score + Math.min(0.18, (count - 1) * 0.04)).toFixed(4))
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}

export function codeSignalsFromTexts(texts: string[], limit = 10): CodeSignal[] {
  return mergeCodeSignals(texts.flatMap((text) => detectCodeSignals(text)), limit);
}

export function codeSignalScoreForQuery(query: string, signals: CodeSignal[]): number {
  if (signals.length === 0) {
    return 0;
  }
  const queryText = normalizeText(query);
  if (!queryText) {
    return 0;
  }
  const scored = signals.map((signal) => {
    const rule = CODE_SIGNAL_RULES.find((candidate) => candidate.id === signal.id);
    if (isWebSocketSpecificQuery(queryText) && signal.id === "realtime_product_critical") {
      const hasWebSocketEvidence = signal.matched_terms.some((term) =>
        ["websocket", "web socket", "socket.io"].some((candidate) => normalizeText(term).includes(normalizeText(candidate)))
      );
      if (!hasWebSocketEvidence) {
        return 0;
      }
    }
    const searchableTerms = [
      signal.id.replaceAll("_", " "),
      signal.label,
      signal.pain_point,
      ...signal.matched_terms,
      ...(rule?.query_terms ?? [])
    ];
    const directHits = searchableTerms.filter((term) => queryMatchesTerm(query, term)).length;
    if (directHits > 0) {
      return Math.min(1, signal.score + Math.min(0.45, directHits * 0.12));
    }
    if (
      isGeneralBackendPainQuery(queryText) &&
      !isWebSocketSpecificQuery(queryText) &&
      BACKEND_PAIN_SIGNAL_IDS.has(signal.id)
    ) {
      return signal.score * 0.55;
    }
    return 0;
  });
  const sorted = scored.sort((left, right) => right - left);
  const best = sorted[0] ?? 0;
  const supporting = sorted.slice(1, 4).reduce((sum, score) => sum + score * 0.18, 0);
  return Number(Math.min(1, best + supporting).toFixed(4));
}

function isWebSocketSpecificQuery(queryText: string): boolean {
  return includesTerm(queryText, "WebSocket") || includesTerm(queryText, "web socket");
}

function signalForRule(rule: CodeSignalRule, source: string): CodeSignal | null {
  const matched = rule.patterns.filter((pattern) => pattern.pattern.test(source));
  if (matched.length === 0) {
    return null;
  }
  const positiveScore = matched.reduce((sum, pattern) => sum + pattern.weight, 0);
  const negativeScore = (rule.negative_patterns ?? [])
    .filter((pattern) => pattern.pattern.test(source))
    .reduce((sum, pattern) => sum + pattern.weight, 0);
  const densityBonus = Math.min(0.12, Math.max(0, matched.length - 1) * 0.04);
  const score = Number(Math.max(0, Math.min(1, positiveScore + densityBonus - negativeScore)).toFixed(4));
  if (score < (rule.minimum_score ?? 0.18)) {
    return null;
  }
  return {
    id: rule.id,
    label: rule.label,
    pain_point: rule.pain_point,
    code_manifestation: rule.code_manifestation,
    matched_terms: unique(matched.map((pattern) => pattern.term)).slice(0, 8),
    score
  };
}

function queryMatchesTerm(query: string, term: string): boolean {
  return includesTerm(query, term) || normalizeText(query).includes(normalizeText(term));
}

function isGeneralBackendPainQuery(queryText: string): boolean {
  return [
    "alternative",
    "backend",
    "backend as a service",
    "burning problem",
    "full stack",
    "full stack backend",
    "pain",
    "simpler",
    "talking about",
    "wanting"
  ].some((term) => queryText.includes(normalizeText(term)));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

const BACKEND_PAIN_SIGNAL_IDS = new Set([
  "frontend_server_state_sync",
  "realtime_product_critical",
  "crud_plumbing",
  "schema_churn",
  "job_workflow_state",
  "multi_user_state",
  "type_drift",
  "speed_over_infra_control",
  "interactive_app_state"
]);
