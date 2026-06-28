const PHRASE_REPLACEMENTS = [
  ["real-time", "realtime"],
  ["live queries", "live_query"],
  ["live query", "live_query"],
  ["backend-as-a-service", "baas"],
  ["serverless backend", "serverless_backend"],
  ["conflict resolution", "conflict_resolution"],
  ["offline-first", "offline_first"],
  ["local-first", "local_first"],
  ["next.js", "nextjs"]
];

export function normalizeText(value) {
  let text = String(value ?? "").toLowerCase();
  for (const [from, to] of PHRASE_REPLACEMENTS) {
    text = text.replaceAll(from, to);
  }
  return text;
}

export function tokenize(value) {
  const normalized = normalizeText(value);
  const words = normalized.match(/[a-z0-9_]+/g) ?? [];
  const tokens = [...words];

  for (let index = 0; index < words.length - 1; index += 1) {
    tokens.push(`${words[index]}_${words[index + 1]}`);
  }

  return tokens;
}

export function containsTerm(text, term) {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term).replace(/\s+/g, "_");
  return normalizedText.includes(normalizedTerm);
}

export function matchedTerms(text, terms) {
  const seen = new Set();
  for (const term of terms) {
    if (containsTerm(text, term)) {
      seen.add(term);
    }
  }
  return [...seen];
}

export function compactText(parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
