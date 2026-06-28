import type { Recipe } from "./types.js";

const TOPIC_PRIORITY = [
  "replication",
  "live query",
  "sync",
  "realtime",
  "subscriptions",
  "conflict resolution",
  "cache invalidation",
  "optimistic update",
  "CRDT",
  "WebSocket",
  "SQLite sync",
  "Postgres changefeed",
  "reactive data",
  "serverless function",
  "backend state"
];

export function normalizeText(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[-_/.,;:!#?=&()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactText(text: unknown): string {
  return normalizeText(text).replace(/\s+/g, "");
}

export function matchesTerm(text: string, term: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) {
    return false;
  }
  return includesTerm(normalizedText, normalizedTerm) || compactText(normalizedText).includes(compactText(normalizedTerm));
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function sortEntriesByScore<T extends string>(
  scores: Map<T, number>,
  priority: readonly T[] = []
): Array<{ key: T; score: number }> {
  const priorityIndexByKey = new Map(priority.map((value, index) => [value.toLowerCase(), index]));
  return [...scores.entries()]
    .sort(([leftKey, leftScore], [rightKey, rightScore]) => {
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return (
        (priorityIndexByKey.get(leftKey.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
        (priorityIndexByKey.get(rightKey.toLowerCase()) ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map(([key, score]) => ({ key, score }));
}

export function includesTerm(text: string, term: string): boolean {
  const normalizedText = normalizeText(text);
  return variantsFor(term).some((variant) => {
    const normalizedVariant = normalizeText(variant);
    if (!normalizedVariant) {
      return false;
    }
    const escaped = normalizedVariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(normalizedText);
  });
}

export function matchTerms(text: string, terms: string[]): string[] {
  return terms.filter((term) => includesTerm(text, term));
}

export function extractTopics(text: string, recipe: Recipe): string[] {
  return sortTopics(recipe.topic_terms.filter((topic) => topicMatches(text, topic)));
}

export function sortTopics(topics: string[]): string[] {
  const unique = [...new Set(topics)];
  return unique.sort((left, right) => topicPriority(left) - topicPriority(right));
}

export function countBy<T extends string>(values: T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function topKeys(counts: Record<string, number>, limit: number, priority?: string[]): string[] {
  return Object.entries(counts)
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => {
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }
      if (priority) {
        return priorityIndex(priority, leftKey) - priorityIndex(priority, rightKey);
      }
      return leftKey.localeCompare(rightKey);
    })
    .slice(0, limit)
    .map(([key]) => key);
}

export function topicPriority(topic: string): number {
  return priorityIndex(TOPIC_PRIORITY, topic);
}

export function daysBetween(left: Date, right: Date): number {
  return Math.max(0, Math.floor((right.getTime() - left.getTime()) / 86_400_000));
}

export function withinWindow(timestamp: string, now: Date, days: number): boolean {
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) && daysBetween(parsed, now) <= days && parsed <= now;
}

export function isWithinWindow(timestamp: string, now: Date, days: number): boolean {
  return withinWindow(timestamp, now, days);
}

export function keywordScore(text: string, query: string): number {
  const words = normalizeText(query)
    .split(" ")
    .filter((word) => word.length > 2);
  if (words.length === 0) {
    return 0;
  }
  const uniqueWords = [...new Set(words)];
  const haystack = normalizeText(text);
  const hits = uniqueWords.filter((word) => haystack.includes(word)).length;
  return hits / uniqueWords.length;
}

function variantsFor(term: string): string[] {
  const variants = new Set([term]);
  const lower = term.toLowerCase();
  variants.add(lower);

  if (lower === "realtime") {
    variants.add("real-time");
    variants.add("real time");
  }
  if (lower === "websocket") {
    variants.add("web socket");
    variants.add("websockets");
  }
  if (lower === "crdt") {
    variants.add("crdts");
  }
  if (lower.endsWith("y")) {
    variants.add(`${lower.slice(0, -1)}ies`);
  }
  if (!lower.endsWith("s")) {
    variants.add(`${lower}s`);
  }
  if (lower === "postgres changefeed") {
    variants.add("postgres changefeeds");
    variants.add("changefeed");
    variants.add("changefeeds");
  }

  return [...variants];
}

function topicMatches(text: string, topic: string): boolean {
  if (topic.toLowerCase() === "sync") {
    return [
      "sync engine",
      "sync protocol",
      "database sync",
      "realtime sync",
      "real-time sync",
      "offline sync",
      "sqlite sync",
      "postgres sync",
      "local first sync",
      "local-first sync",
      "packages sync",
      "src sync",
      "replication"
    ].some((term) => includesTerm(text, term));
  }
  return includesTerm(text, topic);
}

function priorityIndex(priority: string[], value: string): number {
  const index = priority.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase());
  return index === -1 ? priority.length : index;
}
