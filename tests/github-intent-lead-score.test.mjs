import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function transpileCommonJs(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

function loadLeadScoreModule() {
  const compiledModule = { exports: {} };
  const runner = new Function(
    "exports",
    "require",
    "module",
    transpileCommonJs(read("src/lib/lead-score.ts"))
  );

  runner(compiledModule.exports, require, compiledModule);

  return compiledModule.exports;
}

test("lead aggregate score is the rounded average of its evidence scores", () => {
  const { averageLeadEvidenceScore } = loadLeadScoreModule();

  assert.equal(
    averageLeadEvidenceScore(
      [{ score: 98 }, { score: 94 }, { score: 90 }],
      98
    ),
    94
  );
  assert.notEqual(
    averageLeadEvidenceScore(
      [{ score: 98 }, { score: 94 }, { score: 90 }],
      98
    ),
    98
  );
});

test("lead aggregate score falls back to base score when evidence is empty", () => {
  const { averageLeadEvidenceScore } = loadLeadScoreModule();

  assert.equal(averageLeadEvidenceScore([], 87.4), 87);
});
