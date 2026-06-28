import { basename } from "node:path";
import { describe, expect, test } from "vitest";
import { projectRoot, seedReposPath } from "../src/paths.js";

describe("paths", () => {
  test("resolves paths inside github-intent-engine", () => {
    expect(basename(projectRoot)).toBe("github-intent-engine");
    expect(seedReposPath.endsWith("github-intent-engine/seed_repos.txt")).toBe(true);
  });
});
