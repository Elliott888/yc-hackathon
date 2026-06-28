import type { RawRepo } from "../../track-a-harvester/src/types.js";
import { includesTerm, matchTerms, normalizeText } from "./text.js";
import type { Recipe, RepoCategoryRecord } from "./types.js";

const CATEGORY_PRIORITY = [
  "real-time sync",
  "local-first",
  "database sync",
  "reactive database",
  "backend-as-a-service",
  "offline-first",
  "CRDT/collaboration",
  "serverless backend"
];

const CATEGORY_TERMS: Record<string, string[]> = {
  "real-time sync": ["realtime", "real-time", "sync", "live query", "subscriptions", "WebSocket"],
  "reactive database": ["reactive", "reactive data", "live query", "subscriptions", "cache invalidation"],
  "backend-as-a-service": ["backend-as-a-service", "baas", "auth", "storage", "serverless backend"],
  "local-first": ["local-first", "local first", "offline-first", "SQLite sync"],
  "offline-first": ["offline-first", "offline first", "local-first", "conflict resolution"],
  "CRDT/collaboration": ["CRDT", "collaboration", "collaborative", "conflict resolution", "yjs", "automerge"],
  "serverless backend": ["serverless", "serverless function", "backend state", "functions"],
  "database sync": ["database sync", "sync engine", "replication", "Postgres changefeed", "postgres", "changefeed"]
};

export function classifyRepos(repos: RawRepo[], recipe: Recipe): RepoCategoryRecord[] {
  return repos
    .map((repo) => classifyRepo(repo, recipe))
    .sort((left, right) => left.repo.localeCompare(right.repo));
}

export function classifyRepo(repo: RawRepo, recipe: Recipe): RepoCategoryRecord {
  const text = repoText(repo);
  const categoryScores: Record<string, number> = {};

  for (const category of recipe.repo_categories) {
    const categoryTerms = CATEGORY_TERMS[category] ?? [category];
    const matchedTerms = matchTerms(text, categoryTerms);
    if (matchedTerms.length > 0) {
      categoryScores[category] = matchedTerms.length;
    }
  }

  const categories = Object.keys(categoryScores).sort((left, right) => {
    return categoryPriority(left) - categoryPriority(right);
  });

  const negativeFlags = recipe.negative_terms.filter((term) => includesTerm(text, term));
  if (repo.is_fork) {
    negativeFlags.push("fork");
  }
  if (repo.is_archived) {
    negativeFlags.push("archived");
  }

  return {
    repo: repo.full_name,
    categories,
    category_scores: categoryScores,
    negative_flags: [...new Set(negativeFlags)]
  };
}

export function repoText(repo: RawRepo): string {
  return normalizeText(
    [
      repo.full_name,
      repo.description,
      repo.topics.join(" "),
      repo.primary_language,
      repo.readme_text
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function categoryPriority(category: string): number {
  const index = CATEGORY_PRIORITY.findIndex(
    (candidate) => candidate.toLowerCase() === category.toLowerCase()
  );
  return index === -1 ? CATEGORY_PRIORITY.length : index;
}
