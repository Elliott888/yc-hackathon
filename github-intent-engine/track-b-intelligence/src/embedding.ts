import { includesTerm } from "./text.js";
import type { EngineerEmbedding, EngineerProfile, Recipe } from "./types.js";

export function embeddingDimensions(recipe: Recipe): string[] {
  return [
    ...new Set([
      ...recipe.topic_terms,
      ...recipe.repo_categories,
      ...recipe.strong_stacks,
      recipe.target_product
    ])
  ];
}

export function embedText(text: string, dimensions: string[]): number[] {
  const vector: number[] = dimensions.map((dimension) => (includesTerm(text, dimension) ? 1 : 0));
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? vector : vector.map((value) => Number((value / length).toFixed(6)));
}

export function embedProfiles(profiles: EngineerProfile[], recipe: Recipe): EngineerEmbedding[] {
  const dimensions = embeddingDimensions(recipe);
  return profiles.map((profile) => ({
    engineer_login: profile.login,
    dimensions,
    vector: embedText(profile.profile_text, dimensions)
  }));
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function queryCoverageSimilarity(queryVector: number[], documentVector: number[]): number {
  let queryActive = 0;
  let covered = 0;
  const length = Math.min(queryVector.length, documentVector.length);

  for (let index = 0; index < length; index += 1) {
    if (queryVector[index] > 0) {
      queryActive += 1;
      if (documentVector[index] > 0) {
        covered += 1;
      }
    }
  }

  return queryActive === 0 ? 0 : covered / queryActive;
}
