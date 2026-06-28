export type ParsedManifest = {
  kind: string;
  package_names: string[];
  scripts: string[];
  ci_keywords: string[];
};

const MANIFEST_BASENAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml"
]);

const CI_KEYWORDS = [
  "websocket",
  "firebase",
  "supabase",
  "postgres",
  "redis",
  "cache",
  "playwright",
  "vitest",
  "jest",
  "serverless",
  "realtime",
  "sync"
];

export function manifestKindForPath(path: string): string | null {
  if (/^\.github\/workflows\/[^/]+\.(ya?ml)$/i.test(path)) {
    return "github_actions_workflow";
  }

  const basename = path.split("/").at(-1) ?? path;
  if (!MANIFEST_BASENAMES.has(basename)) {
    return null;
  }

  return basename
    .replace(".", "_")
    .replace("-", "_")
    .replace(".", "_");
}

export function parseManifestContent(path: string, content: string): ParsedManifest {
  const kind = manifestKindForPath(path) ?? "unknown_manifest";
  if (path.endsWith("package.json")) {
    return parsePackageJson(kind, content);
  }
  if (path.endsWith("go.mod")) {
    return {
      kind,
      package_names: unique([...content.matchAll(/^\s*(?:require\s+)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/gm)].map((match) => match[1])),
      scripts: [],
      ci_keywords: ciKeywords(content)
    };
  }
  if (path.endsWith("Cargo.toml")) {
    return {
      kind,
      package_names: unique([...content.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map((match) => match[1])),
      scripts: [],
      ci_keywords: ciKeywords(content)
    };
  }
  if (path.endsWith("pyproject.toml") || path.endsWith("requirements.txt")) {
    return {
      kind,
      package_names: unique([...content.matchAll(/["']?([A-Za-z0-9_.-]+)["']?\s*(?:[<>=~!]=|=|\n|$)/g)].map((match) => match[1])),
      scripts: [],
      ci_keywords: ciKeywords(content)
    };
  }

  return {
    kind,
    package_names: unique(packageLikeTokens(content)),
    scripts: [],
    ci_keywords: ciKeywords(content)
  };
}

function parsePackageJson(kind: string, content: string): ParsedManifest {
  try {
    const parsed = JSON.parse(content) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    return {
      kind,
      package_names: unique([
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
        ...Object.keys(parsed.peerDependencies ?? {}),
        ...Object.keys(parsed.optionalDependencies ?? {})
      ]),
      scripts: Object.keys(parsed.scripts ?? {}).sort(),
      ci_keywords: ciKeywords(content)
    };
  } catch {
    return {
      kind,
      package_names: unique(packageLikeTokens(content)),
      scripts: [],
      ci_keywords: ciKeywords(content)
    };
  }
}

function packageLikeTokens(content: string): string[] {
  return [...content.matchAll(/(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]{3,})/g)]
    .map((match) => match[1])
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, 200);
}

function ciKeywords(content: string): string[] {
  const lower = content.toLowerCase();
  return CI_KEYWORDS.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}
