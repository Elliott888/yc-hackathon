import type {
  RawCommit,
  RawComment,
  RawContributorStat,
  RawIssue,
  RawManifest,
  RawPullRequest,
  RawPullRequestReview,
  RawPullRequestReviewComment,
  RawRepo,
  RawWorkflowRun,
  RawUser
} from "../../track-a-harvester/src/types.js";
import { detectCodeSignals, mergeCodeSignals } from "./code-signals.js";
import { extractTopics, sortTopics, topKeys, withinWindow } from "./text.js";
import type {
  CodeSignal,
  ContributionTopicRecord,
  EngineerProfile,
  EvidenceRecord,
  RawTrackBData,
  Recipe,
  RepoCategoryRecord
} from "./types.js";

export function buildContributionTopics(
  profiles: EngineerProfile[]
): ContributionTopicRecord[] {
  return profiles.flatMap((profile) =>
    profile.evidence.map((evidence) => ({
      repo: evidence.repo,
      actor_login: profile.login,
      evidence_url: evidence.url,
      evidence_type: evidence.type,
      matched_topics: evidence.matched_topics,
      created_at: evidence.created_at
    }))
  );
}

export function buildEngineerProfiles(input: {
  raw: RawTrackBData;
  recipe: Recipe;
  repoCategories: RepoCategoryRecord[];
  now: Date;
}): EngineerProfile[] {
  const repoByName = new Map(input.raw.repos.map((repo) => [repo.full_name, repo]));
  const userByLogin = new Map(input.raw.users.map((user) => [user.login, user]));
  const categoryByRepo = new Map(input.repoCategories.map((record) => [record.repo, record]));
  const manifestByRepo = groupBy(input.raw.manifests, (manifest) => manifest.repo);
  const statsByLogin = groupBy(input.raw.contributorStats, (stat) => stat.login);
  const evidenceByLogin = new Map<string, EvidenceRecord[]>();

  const addEvidence = (login: string | null, evidence: EvidenceRecord) => {
    if (!login || isBot(login) || !withinWindow(evidence.created_at, input.now, input.recipe.time_window_days)) {
      return;
    }
    evidenceByLogin.set(login, [...(evidenceByLogin.get(login) ?? []), evidence]);
  };

  for (const pullRequest of input.raw.pullRequests) {
    addEvidence(
      pullRequest.author_login,
      evidenceFromPullRequest(pullRequest, input.recipe, categoryByRepo)
    );
  }
  for (const issue of input.raw.issues) {
    addEvidence(issue.author_login, evidenceFromIssue(issue, input.recipe, categoryByRepo));
  }
  for (const comment of input.raw.comments) {
    addEvidence(comment.author_login, evidenceFromComment(comment, input.recipe, categoryByRepo));
  }
  for (const commit of input.raw.commits) {
    addEvidence(commit.author_login, evidenceFromCommit(commit, input.recipe, categoryByRepo));
  }
  for (const review of input.raw.pullRequestReviews) {
    addEvidence(review.author_login, evidenceFromReview(review, input.recipe, categoryByRepo));
  }
  for (const reviewComment of input.raw.pullRequestReviewComments) {
    addEvidence(
      reviewComment.author_login,
      evidenceFromReviewComment(reviewComment, input.recipe, categoryByRepo)
    );
  }
  for (const workflowRun of input.raw.workflowRuns) {
    if (isFailedWorkflowRun(workflowRun)) {
      addEvidence(
        workflowRun.actor_login,
        evidenceFromWorkflowRun(workflowRun, input.recipe, categoryByRepo)
      );
    }
  }

  return [...evidenceByLogin.entries()]
    .map(([login, evidence]) =>
      buildEngineerProfile({
        login,
        evidence: sortEvidence(evidence),
        user: userByLogin.get(login),
        repoByName,
        categoryByRepo,
        manifestByRepo,
        contributorStats: statsByLogin.get(login) ?? []
      })
    )
    .sort((left, right) => {
      const dateCompare = right.last_active_at.localeCompare(left.last_active_at);
      return dateCompare !== 0 ? dateCompare : left.login.localeCompare(right.login);
    });
}

function buildEngineerProfile(input: {
  login: string;
  evidence: EvidenceRecord[];
  user: RawUser | undefined;
  repoByName: Map<string, RawRepo>;
  categoryByRepo: Map<string, RepoCategoryRecord>;
  manifestByRepo: Map<string, RawManifest[]>;
  contributorStats: RawContributorStat[];
}): EngineerProfile {
  const repoCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const languageCounts: Record<string, number> = {};
  const stackCounts: Record<string, number> = {};
  const contributionCounts: Record<string, number> = {};
  const negativeFlags = new Set<string>();
  const manifestTexts = new Set<string>();
  const seenManifestKeys = new Set<string>();
  const codeSignalRecords: CodeSignal[] = [];

  for (const evidence of input.evidence) {
    repoCounts[evidence.repo] = (repoCounts[evidence.repo] ?? 0) + 1;
    contributionCounts[evidence.type] = (contributionCounts[evidence.type] ?? 0) + 1;
    codeSignalRecords.push(...(evidence.code_signals ?? detectCodeSignals(`${evidence.title} ${evidence.text}`)));

    for (const topic of evidence.matched_topics) {
      topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
    }
    for (const category of evidence.repo_categories) {
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }

    const repo = input.repoByName.get(evidence.repo);
    if (repo?.primary_language) {
      languageCounts[repo.primary_language] = (languageCounts[repo.primary_language] ?? 0) + 1;
    }

    const repoCategory = input.categoryByRepo.get(evidence.repo);
    for (const flag of repoCategory?.negative_flags ?? []) {
      negativeFlags.add(flag);
    }

    for (const manifest of input.manifestByRepo.get(evidence.repo) ?? []) {
      const key = `${manifest.repo}:${manifest.path}`;
      if (seenManifestKeys.has(key)) continue;
      seenManifestKeys.add(key);
      for (const stack of manifestStackSignals(manifest)) {
        stackCounts[stack] = (stackCounts[stack] ?? 0) + 1;
      }
      const summary = manifestSummary(manifest);
      if (summary) {
        manifestTexts.add(summary);
        codeSignalRecords.push(...detectCodeSignals(summary));
      }
    }
  }

  const statTexts: string[] = [];
  for (const stat of input.contributorStats) {
    repoCounts[stat.repo] =
      (repoCounts[stat.repo] ?? 0) +
      stat.pull_request_count +
      stat.commit_count +
      stat.issue_count +
      stat.comment_count +
      stat.review_count +
      stat.review_comment_count;
    addCount(contributionCounts, "pull_request_count", stat.pull_request_count);
    addCount(contributionCounts, "merged_pull_request_count", stat.merged_pull_request_count);
    addCount(contributionCounts, "commit_count", stat.commit_count);
    addCount(contributionCounts, "issue_count", stat.issue_count);
    addCount(contributionCounts, "comment_count", stat.comment_count);
    addCount(contributionCounts, "review_count", stat.review_count);
    addCount(contributionCounts, "review_comment_count", stat.review_comment_count);
    addCount(contributionCounts, "failed_workflow_count", stat.failed_workflow_count);
    statTexts.push(contributorStatSummary(stat));
  }

  const topTopics = sortTopics(Object.keys(topicCounts));
  const topRepos = topKeys(repoCounts, 5);
  const repoCategories = topKeys(categoryCounts, 8);
  const primaryLanguages = topKeys(languageCounts, 5);
  const stackSignals = topKeys(stackCounts, 12);
  const codeSignals = mergeCodeSignals(codeSignalRecords, 12);
  const lastActiveAt = [
    ...input.evidence.map((evidence) => evidence.created_at),
    ...input.contributorStats.map((stat) => stat.last_active_at)
  ]
    .sort()
    .at(-1) ?? "";

  const user = input.user;
  const profileText = [
    input.login,
    user?.name,
    user?.company,
    user?.bio,
    topRepos.join(" "),
    topTopics.join(" "),
    repoCategories.join(" "),
    primaryLanguages.join(" "),
    stackSignals.join(" "),
    codeSignals
      .map((signal) =>
        `${signal.label} ${signal.pain_point} ${signal.code_manifestation ?? ""} ${signal.matched_terms.join(" ")}`
      )
      .join(" "),
    [...manifestTexts].join(" "),
    statTexts.join(" "),
    input.evidence.map((evidence) => `${evidence.title} ${evidence.text}`).join(" ")
  ]
    .filter(Boolean)
    .join(" ");

  return {
    login: input.login,
    name: user?.name ?? null,
    company: user?.company ?? null,
    location: user?.location ?? null,
    blog: user?.blog ?? null,
    email: user?.email ?? null,
    bio: user?.bio ?? null,
    url: user?.url ?? null,
    followers: user?.followers ?? 0,
    public_repos: user?.public_repos ?? 0,
    top_repos: topRepos,
    top_topics: topTopics,
    repo_categories: repoCategories,
    primary_languages: primaryLanguages,
    stack_signals: stackSignals,
    code_signals: codeSignals,
    contribution_counts: contributionCounts,
    last_active_at: lastActiveAt,
    evidence: input.evidence,
    negative_flags: [...negativeFlags].sort(),
    profile_text: profileText
  };
}

function evidenceFromPullRequest(
  pullRequest: RawPullRequest,
  recipe: Recipe,
  categoryByRepo: Map<string, RepoCategoryRecord>
): EvidenceRecord {
  const text = [
    pullRequest.title,
    pullRequest.body,
    pullRequest.changed_files.join(" ")
  ]
    .filter(Boolean)
    .join(" ");
  return {
    type: "pull_request",
    repo: pullRequest.repo,
    title: pullRequest.title,
    text,
    url: pullRequest.url,
    created_at: pullRequest.merged_at ?? pullRequest.updated_at ?? pullRequest.created_at,
    matched_topics: extractTopics(text, recipe),
    repo_categories: categoryByRepo.get(pullRequest.repo)?.categories ?? [],
    contribution_weight: pullRequest.merged ? 10 : 7,
    code_signals: detectCodeSignals(text)
  };
}

function evidenceFromIssue(
  issue: RawIssue,
  recipe: Recipe,
  categoryByRepo: Map<string, RepoCategoryRecord>
): EvidenceRecord {
  const text = [issue.title, issue.body].filter(Boolean).join(" ");
  return {
    type: "issue",
    repo: issue.repo,
    title: issue.title,
    text,
    url: issue.url,
    created_at: issue.created_at,
    matched_topics: extractTopics(text, recipe),
    repo_categories: categoryByRepo.get(issue.repo)?.categories ?? [],
    contribution_weight: 4,
    code_signals: detectCodeSignals(text)
  };
}

function evidenceFromComment(
  comment: RawComment,
  recipe: Recipe,
  categoryByRepo: Map<string, RepoCategoryRecord>
): EvidenceRecord {
  const text = comment.body ?? "";
  return {
    type: "comment",
    repo: comment.repo,
    title: trimTitle(text, "Issue comment"),
    text,
    url: comment.url,
    created_at: comment.created_at,
    matched_topics: extractTopics(text, recipe),
    repo_categories: categoryByRepo.get(comment.repo)?.categories ?? [],
    contribution_weight: 2,
    code_signals: detectCodeSignals(text)
  };
}

function evidenceFromCommit(
  commit: RawCommit,
  recipe: Recipe,
  categoryByRepo: Map<string, RepoCategoryRecord>
): EvidenceRecord {
  const text = [commit.message, commit.changed_files.join(" ")].join(" ");
  return {
    type: "commit",
    repo: commit.repo,
    title: trimTitle(commit.message, "Commit"),
    text,
    url: commit.url,
    created_at: commit.committed_at,
    matched_topics: extractTopics(text, recipe),
    repo_categories: categoryByRepo.get(commit.repo)?.categories ?? [],
    contribution_weight: 6,
    code_signals: detectCodeSignals(text)
  };
}

function evidenceFromReview(
  review: RawPullRequestReview,
  recipe: Recipe,
  categoryByRepo: Map<string, RepoCategoryRecord>
): EvidenceRecord {
  const text = [review.state, review.body].filter(Boolean).join(" ");
  return {
    type: "review",
    repo: review.repo,
    title: trimTitle(text, `PR review #${review.pull_number}`),
    text,
    url: review.url,
    created_at: review.submitted_at,
    matched_topics: extractTopics(text, recipe),
    repo_categories: categoryByRepo.get(review.repo)?.categories ?? [],
    contribution_weight: review.state === "APPROVED" ? 5 : 4,
    code_signals: detectCodeSignals(text)
  };
}

function evidenceFromReviewComment(
  comment: RawPullRequestReviewComment,
  recipe: Recipe,
  categoryByRepo: Map<string, RepoCategoryRecord>
): EvidenceRecord {
  const text = [comment.path, comment.body].filter(Boolean).join(" ");
  return {
    type: "review_comment",
    repo: comment.repo,
    title: trimTitle(comment.body ?? "", `PR review comment #${comment.pull_number}`),
    text,
    url: comment.url,
    created_at: comment.created_at,
    matched_topics: extractTopics(text, recipe),
    repo_categories: categoryByRepo.get(comment.repo)?.categories ?? [],
    contribution_weight: 3,
    code_signals: detectCodeSignals(text)
  };
}

function evidenceFromWorkflowRun(
  workflowRun: RawWorkflowRun,
  recipe: Recipe,
  categoryByRepo: Map<string, RepoCategoryRecord>
): EvidenceRecord {
  const text = [
    workflowRun.name,
    workflowRun.event,
    workflowRun.status,
    workflowRun.conclusion
  ]
    .filter(Boolean)
    .join(" ");
  return {
    type: "workflow_run",
    repo: workflowRun.repo,
    title: trimTitle(text, "Failed workflow run"),
    text,
    url: workflowRun.url,
    created_at: workflowRun.updated_at || workflowRun.created_at,
    matched_topics: extractTopics(text, recipe),
    repo_categories: categoryByRepo.get(workflowRun.repo)?.categories ?? [],
    contribution_weight: 1,
    code_signals: detectCodeSignals(text)
  };
}

function sortEvidence(evidence: EvidenceRecord[]): EvidenceRecord[] {
  return [...evidence].sort((left, right) => {
    if (right.contribution_weight !== left.contribution_weight) {
      return right.contribution_weight - left.contribution_weight;
    }
    return right.created_at.localeCompare(left.created_at);
  });
}

function trimTitle(text: string, fallback: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length === 0 ? fallback : trimmed.slice(0, 90);
}

function isBot(login: string): boolean {
  const normalized = login.toLowerCase();
  return (
    normalized === "copilot" ||
    normalized === "github-actions" ||
    normalized === "github-actions[bot]" ||
    normalized.endsWith("[bot]") ||
    normalized.endsWith("-bot") ||
    normalized.includes("dependabot") ||
    normalized.includes("renovate")
  );
}

function isFailedWorkflowRun(workflowRun: RawWorkflowRun): boolean {
  return ["failure", "timed_out", "startup_failure", "cancelled"].includes(
    (workflowRun.conclusion ?? "").toLowerCase()
  );
}

function manifestStackSignals(manifest: RawManifest): string[] {
  const text = [
    manifest.path,
    manifest.kind,
    ...manifest.package_names,
    ...manifest.scripts,
    ...manifest.ci_keywords,
    manifest.content_excerpt
  ]
    .join(" ")
    .toLowerCase();
  const signals: string[] = [];
  const addIf = (signal: string, pattern: RegExp) => {
    if (pattern.test(text)) signals.push(signal);
  };

  addIf("TypeScript", /\btypescript\b|\bts-node\b|\.ts\b/);
  addIf("React", /\breact\b|@types\/react/);
  addIf("Next.js", /\bnext\b|next\.js/);
  addIf("Node.js", /\bnode\b|node\.js|\bnpm\b|\bpnpm\b|\byarn\b/);
  addIf("Postgres", /\bpostgres\b|\bpostgresql\b|\bpg\b|@supabase/);
  addIf("SQLite", /\bsqlite\b|\blibsql\b|\bturso\b/);
  addIf("WebSocket", /\bwebsocket\b|\bws\b|socket\.io/);
  addIf("Firebase", /\bfirebase\b|@firebase/);
  addIf("Supabase", /\bsupabase\b|@supabase/);
  return [...new Set(signals)];
}

function manifestSummary(manifest: RawManifest): string {
  const parts = [
    manifest.path,
    manifest.package_names.slice(0, 30).join(" "),
    manifest.scripts.slice(0, 12).join(" "),
    manifest.ci_keywords.slice(0, 12).join(" ")
  ]
    .filter(Boolean)
    .join(" ");
  return parts.slice(0, 1_000);
}

function contributorStatSummary(stat: RawContributorStat): string {
  return [
    stat.repo,
    `prs ${stat.pull_request_count}`,
    `merged ${stat.merged_pull_request_count}`,
    `commits ${stat.commit_count}`,
    `reviews ${stat.review_count}`,
    `review_comments ${stat.review_comment_count}`,
    `failed_workflows ${stat.failed_workflow_count}`
  ].join(" ");
}

function addCount(counts: Record<string, number>, key: string, value: number): void {
  if (value <= 0) return;
  counts[key] = (counts[key] ?? 0) + value;
}

function groupBy<T>(records: T[], keyFor: (record: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = keyFor(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return groups;
}
