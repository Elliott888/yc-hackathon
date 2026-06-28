import { describe, expect, test } from "vitest";
import { parseSeedRepos } from "../src/seed.js";

describe("parseSeedRepos", () => {
  test("ignores comments, trims whitespace, dedupes, applies limit, and reports invalid rows", () => {
    const result = parseSeedRepos(
      [
        "# comment",
        " electric-sql/electric ",
        "bad",
        "supabase/supabase",
        "electric-sql/electric",
        "",
        "owner/repo/extra"
      ].join("\n"),
      2
    );

    expect(result.repos).toEqual(["electric-sql/electric", "supabase/supabase"]);
    expect(result.invalid).toEqual([
      { line: 3, value: "bad", reason: "Expected owner/repo" },
      { line: 7, value: "owner/repo/extra", reason: "Expected owner/repo" }
    ]);
    expect(result.duplicates).toEqual(["electric-sql/electric"]);
  });
});
