import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ValidationResult } from "./types.js";

type FileSpec = {
  file: string;
  required: string[];
  key: (record: Record<string, unknown>) => string | null;
  urlFields?: string[];
  timestampFields?: string[];
  repoReference?: boolean;
};

const fileSpecs: FileSpec[] = [
  {
    file: "raw_repos.jsonl",
    required: ["id", "full_name", "owner_login", "url"],
    key: (record) => valueAsString(record.id),
    urlFields: ["url"],
    timestampFields: ["pushed_at"]
  },
  {
    file: "raw_pull_requests.jsonl",
    required: ["repo", "number", "title", "author_login", "created_at", "updated_at", "url"],
    key: (record) => `${valueAsString(record.repo)}:${valueAsString(record.number)}`,
    urlFields: ["url"],
    timestampFields: ["created_at", "updated_at", "merged_at"],
    repoReference: true
  },
  {
    file: "raw_issues.jsonl",
    required: ["repo", "number", "title", "author_login", "created_at", "updated_at", "url"],
    key: (record) => `${valueAsString(record.repo)}:${valueAsString(record.number)}`,
    urlFields: ["url"],
    timestampFields: ["created_at", "updated_at"],
    repoReference: true
  },
  {
    file: "raw_comments.jsonl",
    required: ["id", "repo", "parent_number", "author_login", "created_at", "url"],
    key: (record) => valueAsString(record.id),
    urlFields: ["url"],
    timestampFields: ["created_at"],
    repoReference: true
  },
  {
    file: "raw_commits.jsonl",
    required: ["sha", "repo", "message", "committed_at", "url"],
    key: (record) => `${valueAsString(record.repo)}:${valueAsString(record.sha)}`,
    urlFields: ["url"],
    timestampFields: ["committed_at"],
    repoReference: true
  },
  {
    file: "raw_manifests.jsonl",
    required: ["repo", "path", "kind", "url"],
    key: (record) => `${valueAsString(record.repo)}:${valueAsString(record.path)}`,
    urlFields: ["url"],
    repoReference: true
  },
  {
    file: "raw_pull_request_reviews.jsonl",
    required: ["id", "repo", "pull_number", "submitted_at", "url"],
    key: (record) => valueAsString(record.id),
    urlFields: ["url"],
    timestampFields: ["submitted_at"],
    repoReference: true
  },
  {
    file: "raw_pull_request_review_comments.jsonl",
    required: ["id", "repo", "pull_number", "created_at", "url"],
    key: (record) => valueAsString(record.id),
    urlFields: ["url"],
    timestampFields: ["created_at"],
    repoReference: true
  },
  {
    file: "raw_workflow_runs.jsonl",
    required: ["id", "repo", "event", "created_at", "updated_at", "url"],
    key: (record) => valueAsString(record.id),
    urlFields: ["url"],
    timestampFields: ["created_at", "updated_at"],
    repoReference: true
  },
  {
    file: "raw_contributor_stats.jsonl",
    required: ["login", "repo", "last_active_at"],
    key: (record) => `${valueAsString(record.login)}:${valueAsString(record.repo)}`,
    timestampFields: ["last_active_at"],
    repoReference: true
  },
  {
    file: "raw_repo_expansions.jsonl",
    required: ["source_repo", "expanded_repo", "reason"],
    key: (record) => `${valueAsString(record.source_repo)}:${valueAsString(record.expanded_repo)}:${valueAsString(record.reason)}`
  },
  {
    file: "raw_users.jsonl",
    required: ["login"],
    key: (record) => valueAsString(record.login),
    urlFields: ["url"],
    timestampFields: ["created_at"]
  }
];

export async function validateRawData(rawDir: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repoNames = new Set<string>();
  const parsedByFile = new Map<string, Record<string, unknown>[]>();

  for (const spec of fileSpecs) {
    const records = await parseJsonlFile(join(rawDir, spec.file), spec.file, errors);
    parsedByFile.set(spec.file, records);

    if (spec.file === "raw_repos.jsonl") {
      for (const record of records) {
        if (typeof record.full_name === "string") {
          repoNames.add(record.full_name);
        }
      }
    }
  }

  for (const spec of fileSpecs) {
    const records = parsedByFile.get(spec.file) ?? [];
    const seenKeys = new Set<string>();

    for (const [index, record] of records.entries()) {
      const line = index + 1;
      for (const field of spec.required) {
        if (!(field in record) || record[field] === undefined) {
          errors.push(`${spec.file} line ${line} missing required field: ${field}`);
        }
      }

      const key = spec.key(record);
      if (key) {
        if (seenKeys.has(key)) {
          errors.push(`${spec.file} has duplicate key: ${key}`);
        } else {
          seenKeys.add(key);
        }
      }

      for (const field of spec.urlFields ?? []) {
        const value = record[field];
        if (value !== null && value !== undefined && !isValidUrl(value)) {
          errors.push(`${spec.file} line ${line} has invalid URL in field: ${field}`);
        }
      }

      for (const field of spec.timestampFields ?? []) {
        const value = record[field];
        if (value !== null && value !== undefined && !isValidTimestamp(value)) {
          errors.push(`${spec.file} line ${line} has invalid timestamp in field: ${field}`);
        }
      }

      if (spec.repoReference && typeof record.repo === "string" && !repoNames.has(record.repo)) {
        errors.push(`${spec.file} line ${line} references unknown repo: ${record.repo}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function parseJsonlFile(
  path: string,
  label: string,
  errors: string[]
): Promise<Record<string, unknown>[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label} could not be read: ${message}`);
    return [];
  }

  const records: Record<string, unknown>[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push(`${label} line ${index + 1} is not a JSON object`);
        continue;
      }
      records.push(parsed as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${label} line ${index + 1} is invalid JSON: ${message}`);
    }
  }

  return records;
}

function valueAsString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function isValidUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}
