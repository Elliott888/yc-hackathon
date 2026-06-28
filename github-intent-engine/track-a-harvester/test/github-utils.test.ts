import { describe, expect, test } from "vitest";
import { isAtOrAfter, parseRepoFullName } from "../src/github-utils.js";

describe("GitHub API helpers", () => {
  test("parses owner/repo names", () => {
    expect(parseRepoFullName("electric-sql/electric")).toEqual({
      owner: "electric-sql",
      repo: "electric"
    });
    expect(() => parseRepoFullName("bad")).toThrow("Invalid repo full name: bad");
  });

  test("compares nullable timestamps against a since date", () => {
    const since = new Date("2026-06-01T00:00:00Z");

    expect(isAtOrAfter("2026-06-01T00:00:00Z", since)).toBe(true);
    expect(isAtOrAfter("2026-06-02T00:00:00Z", since)).toBe(true);
    expect(isAtOrAfter("2026-05-31T23:59:59Z", since)).toBe(false);
    expect(isAtOrAfter(null, since)).toBe(false);
  });
});
