const FAILURE_TERMS = [
  "bug",
  "break",
  "breaks",
  "broken",
  "cannot",
  "can't",
  "data loss",
  "delivers nothing",
  "drop",
  "drops",
  "error",
  "expensive",
  "fail",
  "fails",
  "failure",
  "flaky",
  "lost",
  "never register",
  "overwrite",
  "overwrites",
  "regression",
  "reconnect",
  "stall",
  "stalls",
  "stale",
  "timeout",
  "too expensive"
];

const CONVEX_FIT_TERMS = [
  "appwrite",
  "appsync",
  "bridge timeout",
  "cache invalidation",
  "channel",
  "connection drop",
  "connection drops",
  "firebase",
  "firestore",
  "getdoc",
  "indexing lag",
  "instantdb",
  "liveblocks",
  "liveobject",
  "postgres",
  "pocketbase",
  "postgres_changes",
  "replica",
  "replication",
  "realtime",
  "real-time",
  "room",
  "self-hosted",
  "shared state",
  "supabase",
  "sync",
  "sync.map",
  "subscription",
  "websocket",
  "websockets"
];

const STRONG_NEGATIVE_EVIDENCE_TERMS = [
  "ami build",
  "approved ## code review",
  "@copilot",
  "code review overall",
  "commented ## code review",
  "copilot still fails",
  "etag expected",
  "google drive",
  "node ./scripts",
  "postinstall script",
  "s3 storage",
  "smtp connection",
  "storage upload",
  "vitest"
];

const NEGATIVE_EVIDENCE_TERMS = [
  "ad campaign",
  "ami build",
  "campaign targeting",
  "csv import",
  "db diff:",
  "dependency bump",
  "docs(troubleshooting)",
  "etag expected",
  "generated-by: openai codex",
  "google ads",
  "google drive",
  "lint",
  "marketing",
  "minio plugin",
  "postinstall script",
  "release notes by coderabbit",
  "s3 storage",
  "smtp connection",
  "sponsored",
  "storage upload",
  "test(supabase_flutter)",
  "typo",
  "was generative ai tooling used to co-author"
];

const BUYER_VOICE_TERMS = [
  "actual behavior",
  "bug description",
  "customer",
  "encountered in production",
  "expected behavior",
  "i am",
  "i get",
  "i hit",
  "i'm",
  "my app",
  "our app",
  "production",
  "reproduction",
  "reproduction steps",
  "steps to reproduce",
  "symptom",
  "user-facing",
  "users",
  "we are",
  "we hit",
  "what happened"
];

const INTERNAL_COMPANY_TERMS = {
  appwrite: ["appwrite"],
  "electric-sql": ["electric", "electric-sql", "electricsql"],
  electric: ["electric", "electric-sql", "electricsql"],
  liveblocks: ["liveblocks"],
  nhost: ["nhost"],
  partykit: ["partykit", "cloudflare"],
  pocketbase: ["pocketbase"],
  supabase: ["supabase"]
};

export function compact(value, maxLength = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

export function normalizeLogin(value) {
  return String(value ?? "").toLowerCase();
}

export function textIncludesAny(text, terms) {
  const normalized = String(text ?? "").toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

export function extractQuotedPhrases(query) {
  const phrases = [];
  const regex = /"([^"]+)"/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    phrases.push(match[1]);
  }
  return phrases;
}

export function exactPhraseMatches(text, query) {
  const phrases = extractQuotedPhrases(query);
  return phrases.filter((phrase) => textIncludesAny(text, [phrase]));
}

export function profileText(user, lead = {}) {
  return [
    user?.name,
    lead?.name,
    user?.company,
    lead?.company,
    user?.location,
    user?.blog,
    user?.email,
    user?.bio
  ]
    .filter((value) => String(value ?? "").trim())
    .join(" ");
}

export function hasProfileInfo(user, lead = {}) {
  return profileText(user, lead).trim().length > 0;
}

export function isBot(login, user) {
  return (
    !login ||
    /\[bot\]$/i.test(login) ||
    /bot$/i.test(login) ||
    user?.type === "Bot"
  );
}

export function ownerForRepo(repo) {
  return String(repo ?? "").split("/")[0]?.toLowerCase() ?? "";
}

export function isFirstPartyProductRepo(repos) {
  return repos.some((repo) => {
    const owner = ownerForRepo(repo);
    return owner === "get-convex" || owner === "convex-dev";
  });
}

export function isOwnCompanyMaintainer(user, repos) {
  const text = profileText(user).toLowerCase();
  if (!text) return false;

  for (const repo of repos) {
    const owner = ownerForRepo(repo);
    const terms = INTERNAL_COMPANY_TERMS[owner] ?? [owner];
    if (terms.some((term) => term && text.includes(term))) {
      return true;
    }
  }

  return false;
}

export function hasOwnCompanyEvidenceEmail(evidenceItems) {
  for (const item of evidenceItems) {
    const owner = ownerForRepo(item.repo);
    if (!owner) continue;
    const aliases = INTERNAL_COMPANY_TERMS[owner] ?? [owner];
    const emails = String(`${item.title ?? ""} ${item.text ?? ""} ${item.snippet ?? ""}`).match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) ?? [];

    for (const email of emails) {
      const domain = email.split("@")[1]?.toLowerCase() ?? "";
      if (aliases.some((alias) => domain.includes(alias.replaceAll("-", "")) || domain.includes(alias))) {
        return true;
      }
    }
  }

  return false;
}

export function isDocsOnlyEvidence(evidenceItems) {
  const items = evidenceItems.filter(Boolean);
  if (items.length === 0) return true;

  return items.every((item) => {
    const text = `${item.title ?? ""} ${item.text ?? ""} ${item.snippet ?? ""}`.toLowerCase();
    return (
      text.includes("readme") ||
      text.includes("docs") ||
      text.includes("documentation") ||
      text.includes("typo") ||
      text.includes("spelling")
    );
  });
}

export function painTermScore(text) {
  const normalized = String(text ?? "").toLowerCase();
  const failureHits = FAILURE_TERMS.filter((term) => normalized.includes(term)).length;
  const fitHits = fitTermHits(text);
  return Math.min(1, failureHits * 0.18 + fitHits * 0.12);
}

export function fitTermScore(text) {
  return Math.min(1, fitTermHits(text) * 0.16);
}

function fitTermHits(text) {
  const normalized = String(text ?? "").toLowerCase();
  return CONVEX_FIT_TERMS.filter((term) => normalized.includes(term)).length;
}

export function failureTermScore(text) {
  const normalized = String(text ?? "").toLowerCase();
  const failureHits = FAILURE_TERMS.filter((term) => normalized.includes(term)).length;
  return Math.min(1, failureHits * 0.24);
}

export function negativeEvidencePenalty(text) {
  const normalized = String(text ?? "").toLowerCase();
  let penalty = STRONG_NEGATIVE_EVIDENCE_TERMS.some((term) => normalized.includes(term)) ? 0.62 : 0;
  if (penalty === 0 && NEGATIVE_EVIDENCE_TERMS.some((term) => normalized.includes(term))) {
    penalty = 0.35;
  }
  if (looksLikeCodeOnlyEvidence(text)) penalty += 0.35;
  return Math.min(0.75, penalty);
}

export function implementationEvidencePenalty(text, type) {
  const normalized = String(text ?? "").trim().toLowerCase();
  let penalty = type === "commit" ? 0.18 : 0;
  if (type === "pull_request" || type === "opened_pull_request" || type === "merged_pull_request") {
    penalty += 0.1;
  }
  if (/^(chore|docs|refactor|test)[:(]/.test(normalized)) {
    penalty += 0.22;
  }
  if (normalized.includes("co-authored-by:") || normalized.includes("summary by coderabbit")) {
    penalty += 0.1;
  }
  return Math.min(0.45, penalty);
}

export function buyerVoiceScore(text, type) {
  const normalized = String(text ?? "").toLowerCase();
  const voiceHits = BUYER_VOICE_TERMS.filter((term) => normalized.includes(term)).length;
  const typeBoost = type === "issue" || type === "comment" || type === "technical_comment" ? 0.35 : 0;
  return Math.min(1, voiceHits * 0.16 + typeBoost);
}

export function evidencePersuasionScore(text, type) {
  const topical = fitTermScore(text);
  const failure = failureTermScore(text);
  const voice = buyerVoiceScore(text, type);
  return Math.min(1, topical * 0.35 + failure * 0.35 + voice * 0.3);
}

export function looksLikeCodeOnlyEvidence(text) {
  const normalized = String(text ?? "").trim().toLowerCase();
  if (normalized.startsWith("```")) return true;
  const codeMarkers = [
    "import {",
    "import * as",
    "const ",
    "function ",
    "export function",
    "class ",
    "return (",
    "useeffect(",
    "usestate("
  ];
  const markerHits = codeMarkers.filter((marker) => normalized.includes(marker)).length;
  return markerHits >= 4 && !BUYER_VOICE_TERMS.some((term) => normalized.includes(term));
}

export function evidenceTypeWeight(type) {
  if (type === "issue" || type === "comment" || type === "technical_comment") return 1;
  if (type === "pull_request" || type === "opened_pull_request" || type === "merged_pull_request") return 0.78;
  if (type === "commit") return 0.55;
  return 0.35;
}

export function recencyScore(isoDate, now) {
  if (!isoDate) return 0;
  const timestamp = new Date(isoDate).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.65;
  if (ageDays <= 180) return 0.25;
  return 0;
}

export function parseEmailFromText(text) {
  const match = String(text ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? null;
}

export function evidenceText(evidence) {
  return compact(
    [
      evidence?.title,
      evidence?.text,
      evidence?.snippet,
      evidence?.matched_topics?.join(" "),
      evidence?.pain_signals?.join(" ")
    ]
      .filter(Boolean)
      .join(" "),
    3000
  );
}
