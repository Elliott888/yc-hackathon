import { readFile } from "node:fs/promises";

export async function loadRecipe(filePath) {
  const text = await readFile(filePath, "utf8");
  const raw = parseYamlSubset(text);

  return {
    id: requiredString(raw.id, "id"),
    label: requiredString(raw.label, "label"),
    targetPrompt: requiredString(raw.target_prompt, "target_prompt"),
    days: Number(raw.days ?? 90),
    seedRepos: requiredArray(raw.seed_repos, "seed_repos"),
    categories: normalizeCategories(raw.categories ?? {}),
    positiveTerms: requiredArray(raw.positive_terms, "positive_terms"),
    stackTerms: requiredArray(raw.stack_terms, "stack_terms"),
    negativeTerms: requiredArray(raw.negative_terms, "negative_terms")
  };
}

function normalizeCategories(categories) {
  const normalized = {};

  for (const [id, category] of Object.entries(categories)) {
    normalized[id] = {
      id,
      label: requiredString(category.label, `categories.${id}.label`),
      terms: requiredArray(category.terms, `categories.${id}.terms`)
    };
  }

  return normalized;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Recipe is missing required string field: ${field}`);
  }
  return value;
}

function requiredArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`Recipe is missing required array field: ${field}`);
  }
  return value.map((item) => String(item));
}

function parseYamlSubset(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => {
      const withoutComment = stripComment(line);
      return {
        indent: withoutComment.search(/\S|$/),
        text: withoutComment.trim()
      };
    })
    .filter((line) => line.text.length > 0);

  const [parsed] = parseObject(lines, 0, 0);
  return parsed;
}

function parseObject(lines, index, indent) {
  const object = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation near: ${line.text}`);
    }
    if (line.text.startsWith("- ")) break;

    const separator = line.text.indexOf(":");
    if (separator === -1) {
      throw new Error(`Invalid recipe line: ${line.text}`);
    }

    const key = line.text.slice(0, separator).trim();
    const scalar = line.text.slice(separator + 1).trim();

    if (scalar !== "") {
      object[key] = parseScalar(scalar);
      cursor += 1;
      continue;
    }

    const next = lines[cursor + 1];
    if (!next || next.indent <= line.indent) {
      object[key] = {};
      cursor += 1;
      continue;
    }

    if (next.text.startsWith("- ")) {
      const [array, nextIndex] = parseArray(lines, cursor + 1, next.indent);
      object[key] = array;
      cursor = nextIndex;
    } else {
      const [child, nextIndex] = parseObject(lines, cursor + 1, next.indent);
      object[key] = child;
      cursor = nextIndex;
    }
  }

  return [object, cursor];
}

function parseArray(lines, index, indent) {
  const array = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent !== indent || !line.text.startsWith("- ")) break;
    array.push(parseScalar(line.text.slice(2).trim()));
    cursor += 1;
  }

  return [array, cursor];
}

function parseScalar(value) {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stripComment(line) {
  const hash = line.indexOf("#");
  if (hash === -1) return line;
  const beforeHash = line.slice(0, hash);
  if (beforeHash.trim() === "") return "";
  return beforeHash;
}
