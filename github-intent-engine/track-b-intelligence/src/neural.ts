import { readFile } from "node:fs/promises";

export type NeuralIntentModel = {
  vocabulary: string[];
  hidden_weights: number[][];
  hidden_bias: number[];
  output_weights: number[];
  output_bias: number;
};

export type NeuralIntentExample = {
  repo?: string;
  event_type?: string;
  evidence_title?: string;
  evidence_text?: string;
  labels?: {
    problem_signals?: string[];
    pain_signals?: string[];
    stack_signals?: string[];
    repo_categories?: string[];
  };
};

export async function loadNeuralIntentModel(
  modelPath: string,
  options: { optional?: boolean } = {}
): Promise<NeuralIntentModel | null> {
  try {
    return JSON.parse(await readFile(modelPath, "utf8")) as NeuralIntentModel;
  } catch (error) {
    if (options.optional && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function predictNeuralIntent(model: NeuralIntentModel, example: NeuralIntentExample): number {
  const featureIndex = new Map(model.vocabulary.map((term, index) => [term, index]));
  const vector = vectorize(example, featureIndex);
  const hidden = model.hidden_weights.map((weights, hiddenIndex) => {
    let sum = model.hidden_bias[hiddenIndex] ?? 0;
    for (const [index, value] of vector) {
      sum += (weights[index] ?? 0) * value;
    }
    return sigmoid(sum);
  });
  const output = hidden.reduce(
    (sum, value, index) => sum + value * (model.output_weights[index] ?? 0),
    model.output_bias ?? 0
  );
  return round(sigmoid(output) * evidenceQualityMultiplier(example));
}

function vectorize(example: NeuralIntentExample, featureIndex: Map<string, number>): Map<number, number> {
  const vector = new Map<number, number>();
  for (const token of featureTokens(example)) {
    const index = featureIndex.get(token);
    if (index === undefined) continue;
    vector.set(index, Math.min(3, (vector.get(index) ?? 0) + 1));
  }
  return vector;
}

function featureTokens(example: NeuralIntentExample): string[] {
  return tokenize(
    [
      example.repo,
      example.event_type,
      example.evidence_title,
      example.evidence_text,
      ...(example.labels?.problem_signals ?? []),
      ...(example.labels?.pain_signals ?? []),
      ...(example.labels?.stack_signals ?? []),
      ...(example.labels?.repo_categories ?? [])
    ].join(" ")
  );
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  const words = normalized.match(/[a-z0-9_]+/g) ?? [];
  const tokens = [...words];
  for (let index = 0; index < words.length - 1; index += 1) {
    tokens.push(`${words[index]}_${words[index + 1]}`);
  }
  return tokens;
}

function normalizeText(value: string): string {
  let text = String(value ?? "").toLowerCase();
  for (const [from, to] of PHRASE_REPLACEMENTS) {
    text = text.replaceAll(from, to);
  }
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
}

function evidenceQualityMultiplier(example: NeuralIntentExample): number {
  const text = [example.evidence_title, example.evidence_text].join(" ");
  const hasWeakSignal = WEAK_EVIDENCE_TERMS.some((term) => tokenSetIncludes(text, term));
  if (!hasWeakSignal) return 1;
  const hasStrongSignal = STRONG_EVIDENCE_TERMS.some((term) => tokenSetIncludes(text, term));
  return hasStrongSignal ? 1 : 0.2;
}

function tokenSetIncludes(text: string, term: string): boolean {
  const tokens = new Set(tokenize(text));
  return tokenize(term).some((token) => tokens.has(token));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

const PHRASE_REPLACEMENTS: Array<[string, string]> = [
  ["real-time", "realtime"],
  ["live queries", "live_query"],
  ["live query", "live_query"],
  ["backend-as-a-service", "baas"],
  ["serverless backend", "serverless_backend"],
  ["conflict resolution", "conflict_resolution"],
  ["offline-first", "offline_first"],
  ["local-first", "local_first"],
  ["next.js", "nextjs"]
];

const STRONG_EVIDENCE_TERMS = [
  "ai agent",
  "agent",
  "attribution",
  "cache invalidation",
  "clickhouse",
  "claude",
  "codex",
  "conflict resolution",
  "crdt",
  "embeddings",
  "event pipeline",
  "event tracking",
  "feature flag",
  "function calling",
  "ingestion",
  "live query",
  "local-first",
  "mcp",
  "model context protocol",
  "openai",
  "product analytics",
  "realtime",
  "realtime analytics",
  "replication",
  "sync",
  "tool call",
  "vector store",
  "websocket"
];

const WEAK_EVIDENCE_TERMS = [
  "annotation",
  "chart",
  "copy",
  "demo",
  "demo link",
  "docs",
  "document content",
  "email copy",
  "file name",
  "layout",
  "link",
  "migration",
  "modal",
  "metrics",
  "log tail",
  "tail session",
  "telemetry",
  "readme",
  "rendering",
  "screenshot",
  "tooltip",
  "typo",
  "ui"
];
