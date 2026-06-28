import { tokenize } from "./text.js";

const SEMANTIC_EXPANSIONS = {
  reactive: ["live_query", "subscription", "invalidation", "state", "database"],
  realtime: ["sync", "websocket", "subscription", "live_query", "streaming"],
  backend: ["serverless_backend", "database", "functions", "api"],
  database: ["postgres", "sqlite", "query", "replication", "storage"],
  sync: ["replication", "synchronization", "reconnect", "conflict_resolution", "offline_first"],
  replication: ["sync", "changefeed", "postgres", "stream"],
  subscription: ["websocket", "live_query", "reactive", "realtime"],
  subscriptions: ["websocket", "live_query", "reactive", "realtime"],
  invalidation: ["cache", "live_query", "reactive", "subscription"],
  local_first: ["offline_first", "sync", "sqlite", "conflict_resolution"],
  crdt: ["collaboration", "conflict_resolution", "automerge", "yjs"],
  baas: ["backend", "serverless_backend", "auth", "storage", "functions"],
  convex: ["reactive", "backend", "database", "realtime", "sync", "serverless_backend"]
};

export function embedText(text) {
  const vector = new Map();
  const tokens = tokenize(text);

  for (const token of tokens) {
    add(vector, token, 1);
    const expansions = Object.hasOwn(SEMANTIC_EXPANSIONS, token)
      ? SEMANTIC_EXPANSIONS[token]
      : [];
    for (const expansion of expansions) {
      add(vector, expansion, 0.45);
    }
  }

  return vector;
}

export function semanticSimilarity(left, right) {
  return cosine(embedText(left), embedText(right));
}

export function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) {
    leftNorm += value * value;
  }

  for (const [key, value] of right.entries()) {
    rightNorm += value * value;
    dot += (left.get(key) ?? 0) * value;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function add(vector, key, value) {
  vector.set(key, (vector.get(key) ?? 0) + value);
}
