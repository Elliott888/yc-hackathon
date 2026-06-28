#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_NEURAL_LEADS,
  DEFAULT_STRUCTURED_ROOT,
  searchHybrid
} from "../../hybrid-github-intent/src/engine.js";
import { nextAdaptiveBatch, shouldContinueAdaptiveDeepening } from "./adaptive.js";
import { fetchUserDeepActivityCached } from "./cache.js";
import {
  activitiesFromStructuredLeads,
  buildLeadDossiers,
  filterDossiersByReliability,
  summarizeDossierQuality
} from "./deepener.js";
import { loadEnvFiles } from "./env.js";
import {
  nearMissesForFollowUp,
  shouldRunNearMissFollowUps,
  summarizeFollowUpRun
} from "./followups.js";
import { fetchDirectPainLeads, fetchFollowUpActivities, fetchUserDeepActivity } from "./github.js";
import { readJson, readJsonl } from "./jsonl.js";
import { defaultCandidateLimit, defaultLiveCandidateLimit } from "./options.js";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (command !== "dossier") {
  console.error("Usage: node src/cli.js dossier --query <query> [--limit 8] [--user-activities path]");
  process.exit(1);
}

try {
  const envReport = await loadEnvFiles();
  const query = requiredArg(args.query, "--query");
  const limit = Number(args.limit ?? 8);
  const targetDemoReady = Number(args["target-demo-ready"] ?? 0);
  const structuredRoot = args["structured-root"] ?? DEFAULT_STRUCTURED_ROOT;
  const neuralLeadsPath = args["neural-leads"] ?? DEFAULT_NEURAL_LEADS;
  let hybridResult = args["hybrid-result"]
    ? await readJson(resolvePath(args["hybrid-result"]))
    : await searchHybrid({
        query,
        structuredRoot,
        neuralLeadsPath,
        limit: Number(args["candidate-limit"] ?? defaultCandidateLimit({ resultLimit: limit, targetDemoReady })),
        requireProfile: args["allow-empty-profile"] !== "true"
      });

  const storedActivities = await loadStoredActivities({ structuredRoot, neuralLeadsPath });
  const importedActivities = args["user-activities"]
    ? await readJsonl(resolvePath(args["user-activities"]))
    : [];
  const warnings = [];
  let directPainDiscoveryReport = {
    enabled: false,
    search_count: 0,
    issue_count: 0,
    comment_count: 0,
    result_count: 0
  };

  if (args["live-direct-pain-search"] === "true") {
    try {
      const directPainResult = await fetchDirectPainLeads({
        query,
        searchLimit: Number(args["direct-pain-search-limit"] ?? 8),
        issueCommentLimit: Number(args["direct-pain-comment-limit"] ?? 10),
        leadLimit: Number(args["direct-pain-lead-limit"] ?? 30)
      });
      hybridResult = {
        ...hybridResult,
        results: mergeLeadResults([...(directPainResult.results ?? []), ...(hybridResult.results ?? [])])
      };
      directPainDiscoveryReport = {
        enabled: true,
        search_count: directPainResult.search_count,
        issue_count: directPainResult.issue_count,
        comment_count: directPainResult.comment_count,
        result_count: directPainResult.result_count
      };
    } catch (error) {
      warnings.push(`Live direct pain search failed: ${error instanceof Error ? error.message : String(error)}`);
      directPainDiscoveryReport = {
        ...directPainDiscoveryReport,
        enabled: true
      };
    }
  }

  let liveActivities = [];
  let followUpActivities = [];
  let liveCacheReport = null;
  let nearMissFollowUpReport = {
    enabled: false,
    near_miss_count: 0,
    activity_count: 0,
    demo_ready_before: 0,
    demo_ready_after: 0,
    demo_ready_delta: 0,
    round_count: 0,
    attempted_logins: []
  };
  const fetchedLiveLogins = new Set();
  if (args["live-user-activity"] === "true") {
    try {
      const targetDemoReady = Number(args["target-demo-ready"] ?? 0);
      const liveCandidateLimit = defaultLiveCandidateLimit({
        resultLimit: limit,
        targetDemoReady,
        candidateCount: hybridResult.results?.length ?? 0,
        explicitLiveCandidateLimit: args["live-candidate-limit"]
      });
      const batchSize = Number(args["live-batch-size"] ?? liveCandidateLimit);
      const liveCandidates = (hybridResult.results ?? []).slice(0, liveCandidateLimit);
      let demoReadyCount = 0;

      do {
        const liveLogins = nextAdaptiveBatch({
          leads: liveCandidates,
          fetchedLogins: fetchedLiveLogins,
          batchSize
        });
        if (liveLogins.length === 0) break;
        for (const login of liveLogins) {
          fetchedLiveLogins.add(String(login).toLowerCase());
        }

        const liveResult = await fetchUserDeepActivityCached({
          logins: liveLogins,
          cacheDir: resolvePath(args["cache-dir"] ?? "data/cache/user-activity"),
          ttlHours: Number(args["cache-ttl-hours"] ?? 24),
          allowPartialOnFetchError: true,
          fetchUserDeepActivityImpl: fetchUserDeepActivity,
          repoLimit: Number(args["repo-limit"] ?? 6),
          issueCommentLimit: Number(args["issue-comment-limit"] ?? 10),
          includeCodeSamples: args["include-code-samples"] === "true",
          codeFileLimit: Number(args["code-file-limit"] ?? 4),
          includeCodeSearch: args["include-code-search"] === "true",
          codeSearchLanguages: parseListArg(args["code-search-languages"] ?? "TypeScript,JavaScript"),
          codeSearchLimit: Number(args["code-search-limit"] ?? 5)
        });
        liveActivities.push(...liveResult.activities);
        liveCacheReport = mergeCacheReports(liveCacheReport, liveResult.cache_report);
        for (const message of liveResult.cache_report.fetch_errors ?? []) {
          warnings.push(`Live user activity refresh failed: ${message}`);
        }

        const interimDossiers = buildLeadDossiers({
          query,
          leads: hybridResult.results ?? [],
          userActivities: [...storedActivities, ...importedActivities, ...liveActivities],
          limit: hybridResult.results?.length ?? limit
        });
        demoReadyCount = filterDossiersByReliability(interimDossiers, "demo_ready").length;
      } while (
        shouldContinueAdaptiveDeepening({
          targetDemoReady,
          demoReadyCount,
          fetchedCount: fetchedLiveLogins.size,
          candidateCount: liveCandidates.length
        })
      );
      if (!liveCacheReport) {
        liveCacheReport = { hits: 0, misses: 0, stale: 0, writes: 0 };
      }
    } catch (error) {
      warnings.push(`Live user activity fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const minReliability = args["min-reliability"] ?? "any";
  const nearMissReportLimit = Number(args["near-miss-report-limit"] ?? 3);
  const nearMissWindow = Number(args["near-miss-window"] ?? Math.max(12, nearMissReportLimit));
  let allDossiers = buildLeadDossiers({
    query,
    leads: hybridResult.results ?? [],
    userActivities: [...storedActivities, ...importedActivities, ...liveActivities],
    limit: hybridResult.results?.length ?? limit
  });
  let dossiers = filterDossiersByReliability(allDossiers, minReliability).slice(0, limit);
  let qualityReport = summarizeDossierQuality({
    allDossiers,
    returnedDossiers: dossiers,
    minReliability,
    targetDemoReady: Number(args["target-demo-ready"] ?? 0),
    nearMissLimit: nearMissWindow
  });

  if (
    shouldRunNearMissFollowUps({
      mode: args["near-miss-follow-ups"],
      liveUserActivity: args["live-user-activity"] === "true",
      targetDemoReady: Number(args["target-demo-ready"] ?? 0),
      qualityReport
    })
  ) {
    const initialQuality = qualityReport;
    const attemptedFollowUpLogins = new Set();
    const attemptedNearMisses = [];
    const maxRounds = Math.max(1, Number(args["near-miss-follow-up-rounds"] ?? 2) || 2);
    let roundCount = 0;
    try {
      while (
        roundCount < maxRounds &&
        shouldRunNearMissFollowUps({
          mode: args["near-miss-follow-ups"],
          liveUserActivity: args["live-user-activity"] === "true",
          targetDemoReady: Number(args["target-demo-ready"] ?? 0),
          qualityReport
        })
      ) {
        const nearMisses = nearMissesForFollowUp({
          qualityReport,
          limit: Number(args["near-miss-follow-up-limit"] ?? 3),
          attemptedLogins: attemptedFollowUpLogins
        });
        if (nearMisses.length === 0) break;

        for (const nearMiss of nearMisses) {
          attemptedNearMisses.push(nearMiss);
          attemptedFollowUpLogins.add(String(nearMiss.engineer_login ?? nearMiss.login).toLowerCase());
        }

        const roundActivities = await fetchFollowUpActivities({
          nearMisses,
          issueSearchLimit: Number(args["follow-up-issue-search-limit"] ?? 20),
          issueCommentLimit: Number(args["follow-up-comment-limit"] ?? 10),
          codeSearchLimit: Number(args["follow-up-code-search-limit"] ?? 5),
          broadRepoLimit: Number(args["follow-up-broad-repo-limit"] ?? 4),
          broadCodeFileLimit: Number(args["follow-up-broad-code-file-limit"] ?? 4)
        });
        followUpActivities.push(...roundActivities);
        roundCount += 1;

        allDossiers = buildLeadDossiers({
          query,
          leads: hybridResult.results ?? [],
          userActivities: [...storedActivities, ...importedActivities, ...liveActivities, ...followUpActivities],
          limit: hybridResult.results?.length ?? limit
        });
        dossiers = filterDossiersByReliability(allDossiers, minReliability).slice(0, limit);
        qualityReport = summarizeDossierQuality({
          allDossiers,
          returnedDossiers: dossiers,
          minReliability,
          targetDemoReady: Number(args["target-demo-ready"] ?? 0),
          nearMissLimit: nearMissWindow
        });
      }

      qualityReport.near_misses = qualityReport.near_misses.slice(0, nearMissReportLimit);

      nearMissFollowUpReport = summarizeFollowUpRun({
        enabled: true,
        nearMisses: attemptedNearMisses,
        activities: followUpActivities,
        beforeQuality: initialQuality,
        afterQuality: qualityReport
      });
      nearMissFollowUpReport.round_count = roundCount;
      nearMissFollowUpReport.attempted_logins = [...attemptedFollowUpLogins];
    } catch (error) {
      warnings.push(`Near-miss follow-up fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      nearMissFollowUpReport = summarizeFollowUpRun({
        enabled: true,
        nearMisses: attemptedNearMisses,
        activities: [],
        beforeQuality: initialQuality,
        afterQuality: qualityReport
      });
      nearMissFollowUpReport.round_count = roundCount;
      nearMissFollowUpReport.attempted_logins = [...attemptedFollowUpLogins];
    }
  } else {
    qualityReport.near_misses = qualityReport.near_misses.slice(0, nearMissReportLimit);
  }
  qualityReport.near_misses = qualityReport.near_misses.slice(0, nearMissReportLimit);

  console.log(
    JSON.stringify(
      {
        query,
        approach: "hybrid search plus user-level deep-dive dossiers",
        candidate_count: hybridResult.results?.length ?? 0,
        user_activity_count:
          storedActivities.length + importedActivities.length + liveActivities.length + followUpActivities.length,
        stored_user_activity_count: storedActivities.length,
        imported_user_activity_count: importedActivities.length,
        live_user_activity_count: liveActivities.length,
        follow_up_activity_count: followUpActivities.length,
        live_cache_report: liveCacheReport,
        live_deepening_report: {
          fetched_login_count: fetchedLiveLogins.size,
          target_demo_ready: Number(args["target-demo-ready"] ?? 0),
          adaptive: Number(args["target-demo-ready"] ?? 0) > 0
        },
        direct_pain_discovery_report: directPainDiscoveryReport,
        near_miss_follow_up_report: nearMissFollowUpReport,
        env_report: {
          loaded_files: envReport.loaded_files,
          loaded_keys: envReport.loaded_keys.filter((key) => key === "GITHUB_TOKEN" || key === "GH_TOKEN"),
          github_token_available: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
        },
        warnings,
        quality_report: qualityReport,
        result_count: dossiers.length,
        results: dossiers
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function loadStoredActivities({ structuredRoot, neuralLeadsPath }) {
  const structuredLeads = await readJsonl(
    path.join(structuredRoot, "data", "processed", "ranked_leads.jsonl"),
    { optional: true }
  );
  const neuralLeads = await readJsonl(neuralLeadsPath, { optional: true });
  return activitiesFromStructuredLeads(structuredLeads, neuralLeads);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : "true";
  }
  return parsed;
}

function requiredArg(value, name) {
  if (!value) {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}

function parseListArg(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePath(value) {
  if (path.isAbsolute(value)) return value;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, "..", value);
}

function mergeCacheReports(left, right) {
  if (!left) return right;
  return {
    hits: (left.hits ?? 0) + (right?.hits ?? 0),
    misses: (left.misses ?? 0) + (right?.misses ?? 0),
    stale: (left.stale ?? 0) + (right?.stale ?? 0),
    writes: (left.writes ?? 0) + (right?.writes ?? 0),
    ...(((left.fetch_errors?.length ?? 0) > 0 || (right?.fetch_errors?.length ?? 0) > 0)
      ? { fetch_errors: [...(left.fetch_errors ?? []), ...(right?.fetch_errors ?? [])] }
      : {})
  };
}

function mergeLeadResults(leads) {
  const byLogin = new Map();
  for (const lead of leads) {
    const login = String(lead?.engineer_login ?? "").toLowerCase();
    if (!login || byLogin.has(login)) continue;
    byLogin.set(login, lead);
  }
  return [...byLogin.values()];
}
