import { tokenize } from "./text.js";

const DEFAULT_OPTIONS = {
  epochs: 60,
  hiddenSize: 12,
  learningRate: 0.05,
  maxFeatures: 180,
  seed: 13
};

export function trainNeuralReranker(examples, options = {}) {
  const config = {
    ...DEFAULT_OPTIONS,
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
  };
  const trainingRows = examples.filter((example) => isLabeled(example) && !isAutomationIdentity(example.engineer_login));
  const vocabulary = buildVocabulary(trainingRows, config.maxFeatures);
  const featureIndex = new Map(vocabulary.map((term, index) => [term, index]));
  const rng = seededRandom(config.seed);
  const model = {
    kind: "one_hidden_layer_binary_reranker",
    version: 1,
    created_at: new Date(0).toISOString(),
    options: {
      epochs: config.epochs,
      hidden_size: config.hiddenSize,
      learning_rate: config.learningRate,
      max_features: config.maxFeatures,
      seed: config.seed
    },
    vocabulary,
    hidden_weights: Array.from({ length: config.hiddenSize }, () =>
      Array.from({ length: vocabulary.length }, () => (rng() - 0.5) * 0.12)
    ),
    hidden_bias: Array.from({ length: config.hiddenSize }, () => 0),
    output_weights: Array.from({ length: config.hiddenSize }, () => (rng() - 0.5) * 0.12),
    output_bias: 0,
    metrics: {
      training_accuracy: 0,
      positive_examples: trainingRows.filter((example) => labelFor(example) === 1).length,
      negative_examples: trainingRows.filter((example) => labelFor(example) === 0).length
    }
  };

  if (trainingRows.length === 0 || vocabulary.length === 0) {
    return model;
  }

  const vectors = trainingRows.map((example) => vectorize(example, featureIndex));
  const labels = trainingRows.map(labelFor);

  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    for (let index = 0; index < vectors.length; index += 1) {
      trainOne(model, vectors[index], labels[index], config.learningRate);
    }
  }

  model.metrics.training_accuracy = accuracy(model, trainingRows);
  model.metrics.average_positive_score = averageScore(model, trainingRows.filter((example) => labelFor(example) === 1));
  model.metrics.average_negative_score = averageScore(model, trainingRows.filter((example) => labelFor(example) === 0));
  return model;
}

export function predictNeuralIntent(model, example) {
  const featureIndex = new Map(model.vocabulary.map((term, index) => [term, index]));
  const rawScore = forward(model, vectorize(example, featureIndex)).prediction;
  return round(rawScore * evidenceQualityMultiplier(example));
}

export function evaluateNeuralReranker(model, examples) {
  const labeled = examples.filter((example) => isLabeled(example) && !isAutomationIdentity(example.engineer_login));
  const positives = labeled.filter((example) => labelFor(example) === 1);
  const negatives = labeled.filter((example) => labelFor(example) === 0);
  return {
    example_count: labeled.length,
    positive_examples: positives.length,
    negative_examples: negatives.length,
    training_accuracy: accuracy(model, labeled),
    average_positive_score: averageScore(model, positives),
    average_negative_score: averageScore(model, negatives),
    top_positive_examples: topExamples(model, positives),
    top_negative_examples: topExamples(model, negatives)
  };
}

function trainOne(model, vector, label, learningRate) {
  const { hidden, prediction } = forward(model, vector);
  const outputDelta = prediction - label;
  const oldOutputWeights = [...model.output_weights];

  for (let h = 0; h < model.output_weights.length; h += 1) {
    model.output_weights[h] -= learningRate * outputDelta * hidden[h];
  }
  model.output_bias -= learningRate * outputDelta;

  for (let h = 0; h < model.hidden_weights.length; h += 1) {
    const hiddenDelta = outputDelta * oldOutputWeights[h] * hidden[h] * (1 - hidden[h]);
    for (const [featureIndex, value] of vector) {
      model.hidden_weights[h][featureIndex] -= learningRate * hiddenDelta * value;
    }
    model.hidden_bias[h] -= learningRate * hiddenDelta;
  }
}

function forward(model, vector) {
  const hidden = model.hidden_weights.map((weights, hiddenIndex) => {
    let sum = model.hidden_bias[hiddenIndex];
    for (const [featureIndex, value] of vector) {
      sum += (weights[featureIndex] ?? 0) * value;
    }
    return sigmoid(sum);
  });
  const output = hidden.reduce(
    (sum, value, index) => sum + value * model.output_weights[index],
    model.output_bias
  );
  return {
    hidden,
    prediction: sigmoid(output)
  };
}

function buildVocabulary(examples, maxFeatures) {
  const counts = new Map();
  for (const example of examples) {
    for (const token of featureTokens(example)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([token]) => isVocabularyToken(token))
    .sort(([leftToken, leftCount], [rightToken, rightCount]) => {
      if (rightCount !== leftCount) return rightCount - leftCount;
      return leftToken.localeCompare(rightToken);
    })
    .slice(0, maxFeatures)
    .map(([token]) => token);
}

function isVocabularyToken(token) {
  if (token.length <= 1 || STOP_WORDS.has(token)) return false;
  if (DOMAIN_PHRASES.has(token)) return true;
  if (/^\d/.test(token)) return false;
  if (token.includes("node_modules")) return false;
  if (token.includes("_")) {
    const parts = token.split("_").filter(Boolean);
    if (parts.length === 0) return false;
    if (parts.some((part) => STOP_WORDS.has(part))) return false;
    if (parts.some((part) => BOILERPLATE_WORDS.has(part))) return false;
  }
  return !BOILERPLATE_WORDS.has(token);
}

function vectorize(example, featureIndex) {
  const vector = new Map();
  const tokens = featureTokens(example);
  for (const token of tokens) {
    const index = featureIndex.get(token);
    if (index === undefined) continue;
    vector.set(index, (vector.get(index) ?? 0) + 1);
  }
  for (const [index, value] of vector) {
    vector.set(index, Math.min(3, value));
  }
  return vector;
}

function featureTokens(example) {
  return tokenize(cleanFeatureText(
    [
      example.repo,
      example.event_type,
      example.evidence_title,
      example.evidence_text,
      ...(example.labels?.problem_signals ?? []),
      ...(example.labels?.pain_signals ?? []),
      ...(example.labels?.stack_signals ?? [])
    ].join(" ")
  ));
}

function labelFor(example) {
  if (example.buyer_intent_label) {
    return ["burning_problem", "solution_seeking"].includes(example.buyer_intent_label) ? 1 : 0;
  }
  return example.label === "positive" ? 1 : 0;
}

function isLabeled(example) {
  if (example.buyer_intent_label) {
    return [
      "burning_problem",
      "solution_seeking",
      "technical_fit_only",
      "maintenance_noise",
      "bad_fit"
    ].includes(example.buyer_intent_label);
  }
  return example.label === "positive" || example.label === "hard_negative";
}

function accuracy(model, examples) {
  if (examples.length === 0) return 0;
  const correct = examples.filter((example) => {
    const prediction = predictNeuralIntent(model, example) >= 0.5 ? 1 : 0;
    return prediction === labelFor(example);
  }).length;
  return round(correct / examples.length);
}

function averageScore(model, examples) {
  if (examples.length === 0) return 0;
  return round(examples.reduce((sum, example) => sum + predictNeuralIntent(model, example), 0) / examples.length);
}

function topExamples(model, examples) {
  return examples
    .map((example) => ({
      id: example.id,
      engineer_login: example.engineer_login,
      repo: example.repo,
      score: predictNeuralIntent(model, example),
      evidence_title: example.evidence_title
    }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 10);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function evidenceQualityMultiplier(example) {
  const text = [example.evidence_title, example.evidence_text].join(" ");
  const hasWeakSignal = WEAK_EVIDENCE_TERMS.some((term) => tokenSetIncludes(text, term));
  if (!hasWeakSignal) return 1;
  const hasStrongSignal = STRONG_EVIDENCE_TERMS.some((term) => tokenSetIncludes(text, term));
  return hasStrongSignal ? 1 : 0.2;
}

function tokenSetIncludes(text, term) {
  const tokens = new Set(tokenize(cleanFeatureText(text)));
  return tokenize(term).some((token) => tokens.has(token));
}

const STOP_WORDS = new Set([
  "the",
  "to",
  "in",
  "is",
  "on",
  "as",
  "of",
  "a",
  "an",
  "it",
  "by",
  "when",
  "so",
  "no",
  "or",
  "be",
  "all",
  "also",
  "already",
  "any",
  "at",
  "because",
  "before",
  "after",
  "but",
  "can",
  "could",
  "each",
  "every",
  "how",
  "if",
  "instead",
  "instead_of",
  "non",
  "now",
  "out",
  "per",
  "same",
  "should",
  "still",
  "through",
  "up",
  "use",
  "via",
  "was",
  "we",
  "what",
  "where",
  "which",
  "while",
  "will",
  "would",
  "only",
  "new",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "does",
  "not",
  "are",
  "you",
  "who",
  "have",
  "been",
  "find",
  "engineers",
  "authored",
  "authored_by",
  "co",
  "co_authored",
  "current",
  "e_g",
  "end",
  "false",
  "first",
  "full",
  "generated",
  "github",
  "i_have",
  "internal",
  "null",
  "of_the",
  "on_the",
  "required",
  "the_same",
  "to_the",
  "with_the",
  "your",
  "add",
  "added",
  "fix",
  "fixes",
  "fixed",
  "update",
  "updated",
  "change",
  "changes",
  "changed",
  "improve",
  "improved",
  "adjust",
  "docs",
  "documentation",
  "test",
  "tests",
  "comment",
  "issue",
  "pr",
  "commit",
  "file",
  "files",
  "src",
  "package",
  "packages",
  "run"
]);

const BOILERPLATE_WORDS = new Set([
  "api",
  "app",
  "async",
  "branch",
  "build",
  "call",
  "chore",
  "ci",
  "client",
  "code",
  "column",
  "config",
  "content",
  "const",
  "core",
  "data",
  "db",
  "default",
  "defaults",
  "dev",
  "description",
  "error",
  "errors",
  "field",
  "fields",
  "filter",
  "fit",
  "handler",
  "handling",
  "height",
  "http",
  "id",
  "index",
  "json",
  "key",
  "layout",
  "line",
  "list",
  "load",
  "main",
  "md",
  "merge",
  "message",
  "metadata",
  "method",
  "middleware",
  "mobile",
  "model",
  "modal",
  "name",
  "node",
  "node_modules",
  "output",
  "page",
  "path",
  "payload",
  "pnpm",
  "project",
  "proxy",
  "read",
  "release",
  "refactor",
  "remove",
  "request",
  "result",
  "return",
  "response",
  "review",
  "row",
  "runtime",
  "schema",
  "server",
  "session",
  "set",
  "shared",
  "side",
  "screen",
  "screens",
  "smaller",
  "string",
  "summary",
  "support",
  "table",
  "technical_comment",
  "technical_comment_comment",
  "text",
  "tooltip",
  "true",
  "ts",
  "type",
  "types",
  "ui",
  "url",
  "user",
  "users",
  "value",
  "values",
  "version",
  "view",
  "without"
]);

const DOMAIN_PHRASES = new Set([
  "ai_agent",
  "backend_state",
  "cache_invalidation",
  "client_side",
  "code_assistant",
  "coding_agent",
  "conflict_resolution",
  "event_tracking",
  "feature_flag",
  "firebase_alternative",
  "function_calling",
  "live_query",
  "live_queries",
  "local_first",
  "model_context",
  "offline_first",
  "product_analytics",
  "query_cache",
  "reactive_state",
  "realtime_analytics",
  "serverless_backend",
  "state_sync",
  "supabase_alternative",
  "tool_call",
  "vector_store",
  "workflow_automation"
]);

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
  "alternative",
  "blocked",
  "cannot connect",
  "production",
  "reconnect",
  "simpler",
  "too complex",
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

function cleanFeatureText(text) {
  return String(text ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
}

function isAutomationIdentity(login) {
  const normalized = String(login ?? "").toLowerCase();
  return (
    normalized === "copilot" ||
    normalized === "github-actions" ||
    normalized === "github-actions[bot]" ||
    normalized.endsWith("[bot]") ||
    normalized.endsWith("-bot") ||
    normalized.includes("dependabot") ||
    normalized.includes("renovate") ||
    normalized.includes("coderabbit")
  );
}
