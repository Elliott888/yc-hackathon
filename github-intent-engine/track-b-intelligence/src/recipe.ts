import { readFile } from "node:fs/promises";
import { pathsFor } from "./io.js";
import type { Recipe } from "./types.js";

const requiredListKeys = ["repo_categories", "topic_terms", "strong_stacks", "negative_terms"] as const;

export async function readRecipe(rootDir?: string): Promise<Recipe> {
  return parseRecipe(await readFile(pathsFor(rootDir).recipe, "utf8"));
}

export async function loadRecipe(rootDir?: string): Promise<Recipe> {
  return readRecipe(rootDir);
}

export function parseRecipe(content: string): Recipe {
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let currentListKey: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("- ")) {
      if (!currentListKey) {
        throw new Error(`Recipe list item has no key: ${line}`);
      }
      lists.set(currentListKey, [...(lists.get(currentListKey) ?? []), line.slice(2).trim()]);
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Recipe line is not key-value YAML: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    currentListKey = value.length === 0 ? key : null;

    if (value.length > 0) {
      scalars.set(key, value);
    } else {
      lists.set(key, []);
    }
  }

  for (const key of requiredListKeys) {
    if (!lists.has(key)) {
      throw new Error(`Recipe is missing list: ${key}`);
    }
  }

  return {
    id: requiredScalar(scalars, "id"),
    label: requiredScalar(scalars, "label"),
    target_product: requiredScalar(scalars, "target_product"),
    target_entity: targetEntity(scalars, lists),
    time_window_days: Number(requiredScalar(scalars, "time_window_days")),
    repo_categories: lists.get("repo_categories") ?? [],
    topic_terms: lists.get("topic_terms") ?? [],
    strong_stacks: lists.get("strong_stacks") ?? [],
    negative_terms: lists.get("negative_terms") ?? []
  };
}

function targetEntity(scalars: Map<string, string>, lists: Map<string, string[]>): string {
  const scalar = scalars.get("target_entity");
  if (scalar) {
    return scalar;
  }
  const values = lists.get("target_entity");
  if (values && values.length > 0) {
    return values.join("_or_");
  }
  throw new Error("Recipe is missing scalar: target_entity");
}

function requiredScalar(scalars: Map<string, string>, key: string): string {
  const value = scalars.get(key);
  if (!value) {
    throw new Error(`Recipe is missing scalar: ${key}`);
  }
  return value;
}
