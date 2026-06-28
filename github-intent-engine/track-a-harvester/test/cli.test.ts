import { describe, expect, test } from "vitest";
import { parseHarvestArgs } from "../src/cli.js";

describe("parseHarvestArgs", () => {
  test("parses harvest defaults and numeric flags", () => {
    expect(parseHarvestArgs(["node", "run.ts"])).toMatchObject({
      days: 90,
      limit: undefined,
      maxPagesPerList: 3,
      maxItemsPerList: 50,
      maxChangedFiles: 100,
      requestTimeoutMs: 15000,
      expandRepos: false,
      maxExpandedRepos: 0,
      checkpointDir: undefined
    });

    expect(
      parseHarvestArgs([
        "node",
        "run.ts",
        "--days",
        "30",
        "--limit",
        "2",
        "--max-pages-per-list",
        "1",
        "--max-items-per-list",
        "5",
        "--max-changed-files",
        "25",
        "--request-timeout-ms",
        "5000",
        "--expand-repos",
        "--max-expanded-repos",
        "8",
        "--checkpoint-dir",
        "data/checkpoints/test"
      ])
    ).toMatchObject({
      days: 30,
      limit: 2,
      maxPagesPerList: 1,
      maxItemsPerList: 5,
      maxChangedFiles: 25,
      requestTimeoutMs: 5000,
      expandRepos: true,
      maxExpandedRepos: 8,
      checkpointDir: "data/checkpoints/test"
    });
  });
});
