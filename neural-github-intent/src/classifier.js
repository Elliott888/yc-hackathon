import { semanticSimilarity } from "./embedding.js";
import { compactText, matchedTerms } from "./text.js";

export function classifyRepo(repo, recipe) {
  const text = repoText(repo);
  const categories = [];

  for (const category of Object.values(recipe.categories)) {
    const matches = matchedTerms(text, category.terms);
    const semantic = semanticSimilarity(
      `${category.label} ${category.terms.join(" ")}`,
      text
    );
    const confidence = Math.min(1, matches.length * 0.22 + semantic * 0.55);

    if (matches.length > 0 && confidence >= 0.18) {
      categories.push({
        id: category.id,
        label: category.label,
        confidence: round(confidence),
        matched_terms: matches
      });
    }
  }

  categories.sort((left, right) => right.confidence - left.confidence);

  return {
    repo: repo.full_name,
    owner_login: repo.owner_login,
    owner_type: repo.owner_type,
    description: repo.description ?? null,
    topics: repo.topics ?? [],
    language: repo.language ?? null,
    stars: repo.stars ?? 0,
    forks: repo.forks ?? 0,
    is_fork: Boolean(repo.is_fork),
    is_archived: Boolean(repo.is_archived),
    pushed_at: repo.pushed_at ?? null,
    html_url: repo.html_url ?? null,
    categories,
    categoryScore: Math.round(categories.reduce((sum, category) => sum + category.confidence * 35, 0))
  };
}

export function repoText(repo) {
  return compactText([
    repo.full_name,
    repo.description,
    ...(repo.topics ?? []),
    repo.language,
    repo.readme
  ]);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
