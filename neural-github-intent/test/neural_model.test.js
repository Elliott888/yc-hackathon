import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  predictNeuralIntent,
  trainNeuralReranker
} from "../src/neural_model.js";

test("trains a neural reranker that scores relevant evidence above hard negatives", () => {
  const examples = [
    positive("p1", "Fix live query replication lag in websocket subscriptions", ["live query", "replication"]),
    positive("p2", "Cache invalidation race breaks realtime backend state", ["cache invalidation", "realtime"]),
    positive("p3", "WebSocket reconnect loop in self-hosted backend", ["WebSocket", "backend state"]),
    negative("n1", "docs: fix typo in installation guide"),
    negative("n2", "chore: upgrade eslint and prettier"),
    negative("n3", "refactor: rename GraphQL helper to satisfy semgrep")
  ];

  const model = trainNeuralReranker(examples, {
    epochs: 80,
    hiddenSize: 6,
    learningRate: 0.08,
    seed: 7
  });

  const relevant = predictNeuralIntent(
    model,
    positive("candidate-good", "Live query cache invalidation over websocket transport", [
      "live query",
      "cache invalidation",
      "WebSocket"
    ])
  );
  const irrelevant = predictNeuralIntent(
    model,
    negative("candidate-bad", "docs: update screenshots for README")
  );

  assert.ok(model.vocabulary.length > 0);
  assert.equal(model.hidden_weights.length, 6);
  assert.ok(relevant > irrelevant + 0.25);
  assert.ok(model.metrics.training_accuracy >= 0.8);
});

test("does not train on URL, HTML, or bot boilerplate features", () => {
  const examples = [
    positive(
      "p1",
      '<a href="https://github.com/acme/repo/issues/1">Fix websocket reconnect loop</a>',
      ["WebSocket"]
    ),
    negative("n1", '<td><a href="https://github.com/acme/repo">docs typo</a></td>'),
    {
      ...positive("bot", "Fix live query replication", ["live query"]),
      engineer_login: "coderabbitai[bot]"
    }
  ];

  const model = trainNeuralReranker(examples, {
    epochs: 20,
    hiddenSize: 4,
    maxFeatures: 40,
    seed: 4
  });

  assert.equal(model.metrics.positive_examples, 1);
  assert.equal(model.vocabulary.includes("https"), false);
  assert.equal(model.vocabulary.includes("github"), false);
  assert.equal(model.vocabulary.includes("href"), false);
  assert.equal(model.vocabulary.includes("td"), false);
});

test("requires direct problem evidence instead of learning repo category alone", () => {
  const examples = [
    analyticsExample(
      "p1",
      "Add realtime analytics ingestion pipeline for experiment events",
      "positive",
      ["realtime analytics", "ingestion", "experiment"]
    ),
    analyticsExample(
      "p2",
      "Add feature flag attribution funnel query",
      "positive",
      ["feature flag", "attribution", "funnel"]
    ),
    analyticsExample("n1", "Add cooldown settings for Dependabot updates", "hard_negative", []),
    analyticsExample("n2", "Add asserts about special goal modals", "hard_negative", []),
    analyticsExample("n3", "Improve email copy", "hard_negative", [])
  ];

  const model = trainNeuralReranker(examples, {
    epochs: 120,
    hiddenSize: 8,
    learningRate: 0.05,
    maxFeatures: 80,
    seed: 10
  });

  const directProblem = predictNeuralIntent(
    model,
    analyticsExample("candidate-good", "Realtime analytics ingestion lag in experiment events", "positive", [
      "realtime analytics",
      "ingestion",
      "experiment"
    ])
  );
  const genericSameRepo = predictNeuralIntent(
    model,
    analyticsExample("candidate-bad", "Add cooldown settings for Dependabot updates", "hard_negative", [])
  );

  assert.ok(directProblem > 0.75);
  assert.ok(genericSameRepo < 0.3);
  assert.equal(model.vocabulary.includes("add"), false);
  assert.equal(model.vocabulary.includes("analytics_and"), false);
  assert.equal(model.vocabulary.includes("growth_engineering"), false);
});

test("filters implementation boilerplate out of neural vocabulary", () => {
  const examples = [
    positive("p1", "Fix websocket reconnect loop in API client error handler", ["WebSocket"]),
    positive("p2", "Live query replication lag in JSON response payload", ["live query", "replication"]),
    negative("n1", "Fix API client error handling"),
    negative("n2", "Update JSON schema path defaults"),
    negative("n3", "Refactor server request type"),
    negative("n4", "technical_comment summary at if run all can but use model now was"),
    negative("n5", "Adjust mobile tooltip layout to fit smaller screens")
  ];

  const model = trainNeuralReranker(examples, {
    epochs: 80,
    hiddenSize: 6,
    learningRate: 0.06,
    maxFeatures: 80,
    seed: 12
  });

  for (const genericToken of [
    "api",
    "at",
    "client",
    "error",
    "if",
    "json",
    "model",
    "path",
    "request",
    "summary",
    "technical_comment",
    "tooltip",
    "type"
  ]) {
    assert.equal(model.vocabulary.includes(genericToken), false);
  }
  assert.equal(model.vocabulary.includes("websocket"), true);
  assert.equal(model.vocabulary.includes("live_query"), true);
});

test("caps weak maintenance evidence even when model weights are high", () => {
  const overconfidentModel = {
    vocabulary: ["demo", "link"],
    hidden_weights: [[8, 8]],
    hidden_bias: [-4],
    output_weights: [10],
    output_bias: -5
  };

  const weakScore = predictNeuralIntent(
    overconfidentModel,
    negative("weak-demo", "Update demo link")
  );

  assert.ok(weakScore < 0.3);
});

test("learns burning buyer pain labels above routine topical activity", () => {
  const examples = [
    buyerIntentExample(
      "pain-1",
      "Supabase realtime drops updates in production and reconnects fail",
      "burning_problem",
      ["realtime", "WebSocket"],
      ["production impact", "failure", "reconnect failure"]
    ),
    buyerIntentExample(
      "pain-2",
      "Looking for a Firebase alternative because backend state is too complex",
      "solution_seeking",
      ["backend state", "serverless backend"],
      ["alternative intent", "complexity pain"]
    ),
    buyerIntentExample(
      "routine-1",
      "Forward response headers on WebSocket upgrade",
      "technical_fit_only",
      ["WebSocket"],
      []
    ),
    buyerIntentExample(
      "routine-2",
      "Add provider cache option to realtime client",
      "technical_fit_only",
      ["realtime"],
      []
    ),
    buyerIntentExample("maintenance-1", "docs: clarify Supabase realtime setup", "maintenance_noise", [], []),
    buyerIntentExample("bad-1", "chore: format generated snapshots", "bad_fit", [], [])
  ];

  const model = trainNeuralReranker(examples, {
    epochs: 160,
    hiddenSize: 8,
    learningRate: 0.06,
    maxFeatures: 120,
    seed: 22
  });

  const burning = predictNeuralIntent(
    model,
    buyerIntentExample(
      "candidate-burning",
      "Production users cannot connect after WebSocket reconnect fails; looking for a simpler Supabase alternative",
      "burning_problem",
      ["WebSocket", "backend state"],
      ["production impact", "cannot connect", "alternative intent"]
    )
  );
  const routine = predictNeuralIntent(
    model,
    buyerIntentExample(
      "candidate-routine",
      "Forward response headers on WebSocket upgrade",
      "technical_fit_only",
      ["WebSocket"],
      []
    )
  );

  assert.ok(burning > 0.7);
  assert.ok(routine < 0.35);
  assert.ok(burning > routine + 0.35);
  assert.equal(model.metrics.positive_examples, 2);
  assert.equal(model.metrics.negative_examples, 4);
});

test("CLI trains and writes a neural model artifact", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "neural-model-"));
  const examplesPath = path.join(dir, "examples.ndjson");
  const modelPath = path.join(dir, "model.json");
  const evalPath = path.join(dir, "eval.json");
  const body = [
    positive("p1", "Fix live query replication lag in websocket subscriptions", ["live query", "replication"]),
    positive("p2", "Cache invalidation race breaks realtime backend state", ["cache invalidation", "realtime"]),
    negative("n1", "docs: fix typo in installation guide"),
    negative("n2", "chore: upgrade eslint and prettier")
  ]
    .map((record) => JSON.stringify(record))
    .join("\n");

  try {
    await import("node:fs/promises").then(({ writeFile }) => writeFile(examplesPath, `${body}\n`, "utf8"));
    const result = spawnSync(
      process.execPath,
      [
        "src/cli.js",
        "train-neural",
        "--examples",
        examplesPath,
        "--model-out",
        modelPath,
        "--eval-out",
        evalPath,
        "--epochs",
        "80"
      ],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /neural reranker/i);

    const model = JSON.parse(await readFile(modelPath, "utf8"));
    const report = JSON.parse(await readFile(evalPath, "utf8"));
    assert.ok(model.vocabulary.length > 0);
    assert.ok(report.training_accuracy >= 0.75);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function positive(id, evidenceText, problemSignals) {
  return {
    id,
    query: "Find engineers with live query, cache invalidation, or WebSocket backend pain",
    engineer_login: `engineer-${id}`,
    repo: "electric-sql/electric",
    event_type: "issue",
    occurred_at: "2026-06-20T10:00:00Z",
    evidence_url: `https://github.com/example/repo/issues/${id}`,
    evidence_title: evidenceText,
    evidence_text: evidenceText,
    label: "positive",
    weight: 4,
    labels: {
      problem_signals: problemSignals,
      stack_signals: ["TypeScript"],
      repo_categories: ["Realtime sync", "Reactive database"]
    }
  };
}

function negative(id, evidenceText) {
  return {
    id,
    query: "Find engineers with live query, cache invalidation, or WebSocket backend pain",
    engineer_login: `engineer-${id}`,
    repo: "docs/example",
    event_type: "pull_request",
    occurred_at: "2026-06-20T10:00:00Z",
    evidence_url: `https://github.com/example/repo/pull/${id}`,
    evidence_title: evidenceText,
    evidence_text: evidenceText,
    label: "hard_negative",
    weight: 1,
    labels: {
      problem_signals: [],
      stack_signals: [],
      repo_categories: []
    }
  };
}

function analyticsExample(id, evidenceText, label, problemSignals) {
  return {
    id,
    query: "Find growth engineers working on realtime analytics, event ingestion, feature flags, and attribution",
    engineer_login: `engineer-${id}`,
    repo: "plausible/analytics",
    event_type: "pull_request",
    occurred_at: "2026-06-20T10:00:00Z",
    evidence_url: `https://github.com/plausible/analytics/pull/${id}`,
    evidence_title: evidenceText,
    evidence_text: evidenceText,
    label,
    weight: label === "positive" ? 7 : 1,
    labels: {
      problem_signals: problemSignals,
      stack_signals: ["analytics"],
      repo_categories: ["Analytics and growth engineering"]
    }
  };
}

function buyerIntentExample(id, evidenceText, buyerIntentLabel, problemSignals, painSignals) {
  return {
    id,
    query: "Find founders or engineers with burning realtime backend pain",
    engineer_login: `engineer-${id}`,
    repo: "supabase/supabase-js",
    event_type: buyerIntentLabel === "technical_fit_only" ? "merged_pull_request" : "issue",
    occurred_at: "2026-06-20T10:00:00Z",
    evidence_url: `https://github.com/example/repo/issues/${id}`,
    evidence_title: evidenceText,
    evidence_text: evidenceText,
    label: problemSignals.length > 0 ? "positive" : "hard_negative",
    buyer_intent_label: buyerIntentLabel,
    pain_score: buyerIntentLabel === "burning_problem" ? 0.92 : buyerIntentLabel === "solution_seeking" ? 0.78 : 0.1,
    weight: 4,
    labels: {
      problem_signals: problemSignals,
      pain_signals: painSignals,
      stack_signals: ["TypeScript", "WebSocket"],
      repo_categories: ["Backend as a service", "Realtime sync"]
    }
  };
}
