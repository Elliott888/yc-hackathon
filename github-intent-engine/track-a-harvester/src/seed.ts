import type { ParsedSeedRepos } from "./types.js";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseSeedRepos(content: string, limit?: number): ParsedSeedRepos {
  const repos: string[] = [];
  const invalid: ParsedSeedRepos["invalid"] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (!REPO_PATTERN.test(line)) {
      invalid.push({ line: index + 1, value: line, reason: "Expected owner/repo" });
      continue;
    }

    if (seen.has(line)) {
      duplicates.push(line);
      continue;
    }

    seen.add(line);
    repos.push(line);
  }

  return {
    repos: typeof limit === "number" ? repos.slice(0, limit) : repos,
    invalid,
    duplicates
  };
}
