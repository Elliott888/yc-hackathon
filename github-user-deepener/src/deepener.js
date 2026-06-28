import { embedText, semanticSimilarity } from "../../neural-github-intent/src/embedding.js";

const FAILURE_TERMS = [
  "break",
  "breaks",
  "broken",
  "cannot",
  "can't",
  "data loss",
  "delivers nothing",
  "diverge",
  "diverges",
  "drop",
  "drops",
  "error",
  "fail",
  "fails",
  "failure",
  "initialstorage",
  "lost",
  "large single write",
  "never fire",
  "overwrite",
  "overwritten",
  "overwrites",
  "reconnect",
  "stale",
  "stall",
  "stalls",
  "timeout",
  "too expensive"
];

const CONVEX_FIT_TERMS = [
  "appwrite",
  "cache invalidation",
  "channel",
  "convex",
  "firebase",
  "firestore",
  "liveblocks",
  "local-first",
  "postgres_changes",
  "react query",
  "react-query",
  "realtime",
  "real-time",
  "replica",
  "replication",
  "server state",
  "shared state",
  "supabase",
  "sync",
  "subscription",
  "websocket",
  "ws"
];

const CORE_CONVEX_PAIN_TERMS = [
  "backend state",
  "cache",
  "cache invalidation",
  "collaborative",
  "data loss",
  "delivers nothing",
  "firebase",
  "firestore",
  "initialstorage",
  "liveblocks",
  "memorylocalcache",
  "overwrite",
  "overwrites",
  "postgres_changes",
  "react query",
  "react-query",
  "realtime",
  "realtime sync",
  "real-time",
  "real-time sync",
  "room",
  "self-hosted backend",
  "server state",
  "shared state",
  "stale",
  "state sync",
  "sync callbacks",
  "sync failure",
  "sync fails",
  "subscription",
  "websocket",
  "websockets"
];

const STACK_TERMS = [
  "@supabase/supabase-js",
  "@tanstack/react-query",
  "firebase",
  "firestore",
  "liveblocks",
  "pocketbase",
  "postgres",
  "prisma",
  "react-query",
  "supabase",
  "trpc",
  "websocket",
  "ws",
  "zod"
];

const CODE_MANIFESTATION_TERMS = [
  "abortcontroller",
  "clientsubscriptions",
  "fetch(",
  "invalidatequeries",
  "onmessage",
  "optimistic",
  "queryclient",
  "refetch",
  "rollback",
  "socket.on",
  "useeffect",
  "websocket"
];

const BUYER_VOICE_TERMS = [
  "in our app",
  "my app",
  "our app",
  "production",
  "reproduction",
  "users",
  "we need",
  "what happened"
];

const SUPPORT_NOISE_TERMS = [
  "chore:",
  "docs:",
  "flaky test",
  "lint",
  "readme",
  "refactor:",
  "spelling",
  "test:"
];

export function buildLeadDossiers({ query, leads, userActivities = [], now = new Date(), limit = leads?.length ?? 10 }) {
  if (!query || !query.trim()) {
    throw new Error("query is required");
  }
  if (!Array.isArray(leads)) {
    throw new Error("leads must be an array");
  }

  const dossiers = leads.map((lead) => buildLeadDossier({ query, lead, userActivities, now }));
  dossiers.sort((left, right) => dossierSortScore(right) - dossierSortScore(left));
  return dossiers.slice(0, limit);
}

export function filterDossiersByReliability(dossiers, minReliability = "any") {
  if (!Array.isArray(dossiers)) {
    throw new Error("dossiers must be an array");
  }
  if (!minReliability || minReliability === "any") {
    return dossiers;
  }
  const allowed = allowedReliabilityLevels(minReliability);
  return dossiers.filter((dossier) => allowed.includes(dossier.reliability_audit?.level));
}

export function summarizeDossierQuality({
  allDossiers,
  returnedDossiers,
  minReliability = "any",
  targetDemoReady = 0,
  nearMissLimit = 3
}) {
  if (!Array.isArray(allDossiers)) {
    throw new Error("allDossiers must be an array");
  }
  if (!Array.isArray(returnedDossiers)) {
    throw new Error("returnedDossiers must be an array");
  }
  const reliabilityCounts = {};
  for (const dossier of allDossiers) {
    const level = dossier.reliability_audit?.level ?? "unknown";
    reliabilityCounts[level] = (reliabilityCounts[level] ?? 0) + 1;
  }
  const demoReadyCount = reliabilityCounts.demo_ready ?? 0;
  const target = Math.max(0, Number(targetDemoReady) || 0);
  const nearMissCount = Math.max(0, Number(nearMissLimit) || 0);
  const nearMisses = allDossiers
    .filter((dossier) => dossier.reliability_audit?.level !== "demo_ready")
    .slice()
    .sort((left, right) => followUpConversionScore(right) - followUpConversionScore(left))
    .slice(0, nearMissCount)
    .map((dossier) => ({
      engineer_login: dossier.engineer_login,
      name: dossier.name,
      reliability_level: dossier.reliability_audit?.level ?? "unknown",
      score: dossier.proof_depth_score,
      headline: dossier.demo_brief?.headline ?? "",
      missing_proof: dossier.reliability_audit?.evidence_gaps ?? [],
      next_best_harvest: dossier.next_best_harvest,
      follow_up_actions: followUpActionsForDossier(dossier)
    }));

  return {
    min_reliability: minReliability || "any",
    target_demo_ready: target,
    target_met: target === 0 ? true : demoReadyCount >= target,
    demo_ready_shortfall: target === 0 ? 0 : Math.max(0, target - demoReadyCount),
    total_candidates_scored: allDossiers.length,
    returned_count: returnedDossiers.length,
    discarded_by_filter_count: Math.max(0, allDossiers.length - returnedDossiers.length),
    reliability_counts: reliabilityCounts,
    returned_reliability_levels: [...new Set(returnedDossiers.map((dossier) => dossier.reliability_audit?.level ?? "unknown"))],
    near_misses: nearMisses
  };
}

function allowedReliabilityLevels(minReliability) {
  const normalized = String(minReliability ?? "any");
  if (normalized === "demo_ready") return ["demo_ready"];
  if (normalized === "supported") return ["demo_ready", "needs_stack_or_code_proof", "needs_pain_linkage", "needs_independent_support"];
  if (normalized === "any") return ["demo_ready", "needs_stack_or_code_proof", "needs_pain_linkage", "needs_independent_support", "not_demo_ready"];
  throw new Error(`Unknown minimum reliability level: ${minReliability}`);
}

function followUpActionsForDossier(dossier) {
  const actions = [];
  const gaps = dossier.reliability_audit?.evidence_gaps ?? [];
  const login = dossier.engineer_login;
  const triggerText = evidenceSearchText(dossier.trigger);
  const searchTerms = searchTermsForFollowUp(triggerText);

  if (
    gaps.includes("Needs second-hop same-user evidence") ||
    gaps.includes("Needs support outside the original repo") ||
    gaps.includes("Needs related pain report tying code or stack proof to the buyer problem")
  ) {
    actions.push({
      kind: "github_user_activity_harvest",
      priority: actions.length + 1,
      expected_proof: "broad same-user issues, repos, manifests, and code samples",
      reason:
        "Fetch the user's broader public GitHub activity and owned repos to find independent evidence beyond the original trigger."
    });
    const issueQuery = issueFollowUpQuery({ login, searchTerms, qualifier: "is:issue" });
    const pullRequestQuery = issueFollowUpQuery({ login, searchTerms, qualifier: "is:pull-request" });
    actions.push(buildFollowUpAction({
      kind: "github_issue_search",
      query: issueQuery,
      priority: actions.length + 1,
      expectedProof: "same-user pain issue/comment",
      reason: "Find another same-user issue or comment that repeats the buyer pain outside the original trigger.",
      alternateQueries: [
        {
          query: pullRequestQuery,
          github_api_url: githubIssueApiUrl(pullRequestQuery),
          github_web_url: githubSearchWebUrl({ query: pullRequestQuery, type: "issues" })
        }
      ]
    }));
  }

  if (
    gaps.includes("Needs second-hop same-user evidence") ||
    gaps.includes("Needs stack or code manifestation proof") ||
    gaps.includes("Needs code manifestation proof") ||
    gaps.includes("Needs related pain report tying code or stack proof to the buyer problem")
  ) {
    actions.push(buildFollowUpAction({
      kind: "github_user_code_harvest",
      query: codeFollowUpQuery({ login, searchTerms }),
      priority: actions.length + 1,
      expectedProof: "owned repo code or manifest evidence",
      reason: "Harvest owned repos, manifests, and code files for dependency or code proof that ties the issue to implementation behavior."
    }));
  }

  if (gaps.includes("Needs direct buyer pain report")) {
    const directPainQuery = issueFollowUpQuery({ login, searchTerms, qualifier: "is:issue", actorQualifier: "author" });
    actions.push(buildFollowUpAction({
      kind: "github_direct_pain_search",
      query: directPainQuery,
      priority: actions.length + 1,
      expectedProof: "direct buyer pain issue/comment",
      reason: "Find a direct issue or comment where the user describes the pain in their own words."
    }));
  }

  return actions;
}

function buildFollowUpAction({ kind, query, priority, expectedProof, reason, alternateQueries = [] }) {
  const action = {
    kind,
    priority,
    query,
    expected_proof: expectedProof,
    reason,
    github_web_url: githubSearchWebUrl({
      query,
      type: kind === "github_user_code_harvest" ? "code" : "issues"
    }),
    alternate_queries: alternateQueries
  };
  if (kind !== "github_user_code_harvest") {
    action.github_api_url = githubIssueApiUrl(query);
  }
  return action;
}

function issueFollowUpQuery({ login, searchTerms, qualifier, actorQualifier = "involves" }) {
  return [`${actorQualifier}:${login}`, qualifier, ...searchTerms.slice(0, 3)].join(" ");
}

function codeFollowUpQuery({ login, searchTerms }) {
  return [`user:${login}`, ...searchTerms.slice(0, 4)].join(" ");
}

function githubIssueApiUrl(query) {
  return `https://api.github.com/search/issues?q=${encodeURIComponent(query)}`;
}

function githubSearchWebUrl({ query, type }) {
  return `https://github.com/search?q=${encodeURIComponent(query)}&type=${type}`;
}

function searchTermsForFollowUp(text) {
  const normalized = String(text ?? "").toLowerCase();
  const terms = [];
  for (const term of [
    "realtime",
    "websocket",
    "cache",
    "invalidation",
    "firebase",
    "firestore",
    "supabase",
    "liveblocks",
    "room",
    "initialstorage",
    "sync",
    "subscription"
  ]) {
    if (normalized.includes(term)) terms.push(term);
  }
  return terms.length > 0 ? terms.slice(0, 5) : ["realtime", "websocket", "cache"];
}

export function buildLeadDossier({ query, lead, userActivities = [], now = new Date() }) {
  const login = lead.engineer_login ?? lead.login;
  const trigger = normalizeTrigger(lead);
  const rankedEvidence = rankUserEvidence({
    query,
    now,
    login,
    trigger,
    activities: userActivities
  });
  const proofChain = buildProofChain({ trigger, rankedEvidence });
  const supportingUserEvidence = uniquePublicEvidence([
    ...proofChain.related_pain,
    ...proofChain.stack_evidence,
    ...proofChain.code_manifestations
  ]);
  const triangulation = triangulationScore({ trigger, proofChain });
  const codeCorroboration = directCodeCorroborationScore({ trigger, proofChain });
  const citationCoverage = citationCoverageForProofChain(proofChain);
  const baseScore = Math.max(0, Math.min(10, lead.icp_fit_score ?? lead.score ?? 0)) / 10;
  const supportScore = supportEvidenceScore(proofChain);
  const triggerScore = evidencePainScore(evidenceSearchText(trigger));
  const proofDepthScore = round(
    Math.min(
      10,
      baseScore * 3.2 +
        triggerScore * 1.6 +
        supportScore * 3.45 +
        triangulation * 2.6 +
        codeCorroboration * 2.8
    ) -
      underProofPenalty(proofChain, codeCorroboration)
  );

  const reliabilityAudit = auditReliability({
    trigger,
    proofChain,
    proofDepthScore,
    triangulation,
    codeCorroboration,
    citationCoverage
  });
  const painDiagnosis = diagnosePain({ trigger, proofChain });
  const qualificationStatus = qualificationStatusFor({
    proofDepthScore,
    rankedEvidence,
    reliabilityAudit
  });
  const evidenceGraph = buildEvidenceGraph({
    login,
    lead,
    trigger,
    proofChain,
    reliabilityAudit
  });
  const outreach = outreachForDossier(lead, proofChain, qualificationStatus, painDiagnosis);
  const demoBrief = buildDemoBrief({
    login,
    lead,
    proofChain,
    reliabilityAudit,
    painDiagnosis,
    proofDepthScore,
    qualificationStatus,
    outreach
  });
  const evidenceTimeline = buildEvidenceTimeline({ proofChain, painDiagnosis });
  const citationAudit = buildCitationAudit({
    proofChain,
    demoBrief,
    evidenceTimeline,
    evidenceGraph
  });
  const discoveryTrace = buildDiscoveryTrace({
    login,
    lead,
    trigger,
    proofChain,
    reliabilityAudit,
    painDiagnosis,
    demoBrief,
    citationAudit
  });

  return {
    engineer_login: login,
    name: lead.name ?? null,
    github_url: lead.github_url ?? `https://github.com/${login}`,
    proof_depth_score: proofDepthScore,
    qualification_status: qualificationStatus,
    original_icp_fit_score: lead.icp_fit_score ?? lead.score ?? null,
    trigger,
    proof_chain: proofChain,
    reliability_audit: reliabilityAudit,
    evidence_graph: evidenceGraph,
    evidence_timeline: evidenceTimeline,
    citation_audit: citationAudit,
    discovery_trace: discoveryTrace,
    strongest_user_evidence: supportingUserEvidence,
    exploratory_user_evidence: rankedEvidence
      .map(publicEvidence)
      .filter((item) => !supportingUserEvidence.some((support) => support.url === item.url))
      .slice(0, 5),
    user_activity_embedding_terms: topEmbeddingTerms([trigger, ...rankedEvidence].map(evidenceSearchText).join(" ")),
    pain_diagnosis: painDiagnosis,
    why_this_is_surprisingly_deep: whySurprisinglyDeep(login, proofChain),
    why_convex_fits: whyConvexFits(proofChain),
    next_best_harvest: nextBestHarvest(qualificationStatus, login),
    outreach,
    demo_brief: demoBrief
  };
}

function qualificationStatusFor({ proofDepthScore, rankedEvidence, reliabilityAudit }) {
  if (reliabilityAudit.level === "demo_ready") {
    return "deeply_qualified";
  }
  if (
    proofDepthScore >= 7.5 &&
    rankedEvidence.length > 0 &&
    reliabilityAudit.level === "needs_stack_or_code_proof" &&
    !reliabilityAudit.evidence_gaps.includes("Needs direct buyer pain report")
  ) {
    return "qualified_with_supporting_evidence";
  }
  return "needs_more_user_evidence";
}

export function auditReliability({
  trigger,
  proofChain,
  proofDepthScore = 0,
  triangulation = 0,
  codeCorroboration,
  citationCoverage
}) {
  const directCodeCorroboration = codeCorroboration ?? directCodeCorroborationScore({ trigger, proofChain });
  const proofCitationCoverage = citationCoverage ?? citationCoverageForProofChain(proofChain);
  const supportingEvidence = uniquePublicEvidence([
    ...proofChain.related_pain,
    ...proofChain.stack_evidence,
    ...proofChain.code_manifestations
  ]);
  const supportCount = supportingEvidence.length;
  const crossRepoSupport = supportingEvidence.some((item) => item.repo && item.repo !== trigger?.repo);
  const citationCount = proofCitationCoverage.citation_count;
  const confidenceFactors = [];
  const evidenceGaps = [];

  if (proofChain.direct_pain.length > 0) {
    confidenceFactors.push("Direct public pain report");
  } else {
    evidenceGaps.push("Needs direct buyer pain report");
  }

  if (supportCount > 0) {
    confidenceFactors.push("Second-hop same-user evidence");
  } else {
    evidenceGaps.push("Needs second-hop same-user evidence");
  }

  if (crossRepoSupport) {
    confidenceFactors.push("Support outside the original repo");
  } else if (supportCount > 0) {
    evidenceGaps.push("Needs support outside the original repo");
  }

  if (proofChain.stack_evidence.length > 0) {
    confidenceFactors.push("Dependency or manifest proof");
  }

  if (proofChain.code_manifestations.length > 0) {
    confidenceFactors.push("Code manifestation proof");
  }
  if (directCodeCorroboration >= 0.8) {
    confidenceFactors.push("Code reproduction corroborates original pain");
  }
  if (proofCitationCoverage.all_claims_cited && citationCount > 0) {
    confidenceFactors.push("All proof claims have source URLs");
  } else if (!proofCitationCoverage.all_claims_cited) {
    evidenceGaps.push("Needs citations for all proof claims");
  }

  const hasStackOrCodeProof = proofChain.stack_evidence.length > 0 || proofChain.code_manifestations.length > 0;
  const hasCodeProof = proofChain.code_manifestations.length > 0;
  const hasBehavioralDepth =
    (proofChain.related_pain.length > 0 && hasCodeProof) || directCodeCorroboration >= 0.8;
  if (!hasStackOrCodeProof && supportCount > 0) {
    evidenceGaps.push("Needs stack or code manifestation proof");
  } else if (!hasCodeProof && proofChain.stack_evidence.length > 0) {
    evidenceGaps.push("Needs code manifestation proof");
  } else if (!hasBehavioralDepth && hasStackOrCodeProof) {
    evidenceGaps.push("Needs related pain report tying code or stack proof to the buyer problem");
  }

  let level = "not_demo_ready";
  if (
    proofDepthScore >= 8.5 &&
    triangulation >= 0.65 &&
    crossRepoSupport &&
    hasBehavioralDepth &&
    proofChain.direct_pain.length > 0 &&
    proofCitationCoverage.all_claims_cited
  ) {
    level = "demo_ready";
  } else if (
    proofDepthScore >= 8.5 &&
    directCodeCorroboration >= 0.8 &&
    crossRepoSupport &&
    proofChain.direct_pain.length > 0 &&
    proofCitationCoverage.all_claims_cited
  ) {
    level = "demo_ready";
  } else if (supportCount > 0 && hasStackOrCodeProof && proofChain.related_pain.length === 0) {
    level = "needs_pain_linkage";
  } else if (supportCount > 0 && !crossRepoSupport) {
    level = "needs_independent_support";
  } else if (supportCount > 0) {
    level = "needs_stack_or_code_proof";
  }

  return {
    level,
    citation_count: citationCount,
    cross_repo_support: crossRepoSupport,
    confidence_factors: confidenceFactors,
    evidence_gaps: uniquePublicEvidenceText(evidenceGaps)
  };
}

function citationCoverageForProofChain(proofChain) {
  return summarizeCitationClaims(citationClaimsForProofChain(proofChain), ["proof_chain"]);
}

function buildCitationAudit({ proofChain, demoBrief, evidenceTimeline, evidenceGraph }) {
  const claims = [
    ...citationClaimsForProofChain(proofChain),
    ...(demoBrief?.proof_points ?? []).map((point) =>
      citationClaim({
        section: "demo_brief",
        kind: point.kind,
        title: point.claim,
        repo: point.repo,
        path: point.path,
        url: point.url
      })
    ),
    ...(evidenceTimeline ?? []).map((event) =>
      citationClaim({
        section: "evidence_timeline",
        kind: event.kind,
        title: event.title,
        repo: event.repo,
        path: event.path,
        url: event.url,
        occurred_at: event.occurred_at
      })
    ),
    ...(evidenceGraph?.nodes ?? []).filter(isEvidenceGraphClaimNode).map((node) =>
      citationClaim({
        section: "evidence_graph",
        kind: node.type,
        title: node.label,
        repo: node.repo,
        path: node.path,
        url: node.url,
        occurred_at: node.occurred_at
      })
    )
  ];

  return summarizeCitationClaims(claims, [
    "proof_chain",
    "demo_brief",
    "evidence_timeline",
    "evidence_graph"
  ]);
}

function citationClaimsForProofChain(proofChain) {
  return [
    ["direct_pain", proofChain.direct_pain ?? []],
    ["related_pain", proofChain.related_pain ?? []],
    ["stack_evidence", proofChain.stack_evidence ?? []],
    ["code_manifestation", proofChain.code_manifestations ?? []]
  ].flatMap(([kind, items]) =>
    items.map((item) =>
      citationClaim({
        section: "proof_chain",
        kind,
        title: item.title || item.path || item.repo || kind,
        repo: item.repo,
        path: item.path,
        url: item.url,
        occurred_at: item.occurred_at
      })
    )
  );
}

function citationClaim({ section, kind, title, repo, path, url, occurred_at }) {
  return {
    section,
    kind: normalizeCitationKind(kind),
    title: compact(title, 180),
    repo,
    path: path ?? null,
    url: url ?? "",
    occurred_at
  };
}

function summarizeCitationClaims(claims, checkedSections) {
  const sourceUrls = [...new Set(claims.map((claim) => claim.url).filter(Boolean))];
  const seenUncited = new Set();
  const uncitedClaims = [];

  for (const claim of claims) {
    if (claim.url) continue;
    const key = citationClaimKey(claim);
    if (seenUncited.has(key)) continue;
    seenUncited.add(key);
    uncitedClaims.push({
      section: claim.section,
      kind: claim.kind,
      title: claim.title,
      repo: claim.repo,
      path: claim.path
    });
  }

  return {
    all_claims_cited: uncitedClaims.length === 0,
    citation_count: sourceUrls.length,
    source_urls: sourceUrls,
    checked_sections: checkedSections,
    uncited_claims: uncitedClaims
  };
}

function citationClaimKey(claim) {
  return [claim.kind, claim.repo ?? "", claim.path ?? claim.repo ?? claim.title ?? ""].join(":");
}

function normalizeCitationKind(kind) {
  if (kind === "trigger_pain") return "direct_pain";
  if (kind === "code_reproduction") return "code_manifestation";
  return kind;
}

function isEvidenceGraphClaimNode(node) {
  return ["trigger_pain", "related_pain", "stack_evidence", "code_manifestation"].includes(node.type);
}

function buildDiscoveryTrace({ login, lead, trigger, proofChain, reliabilityAudit, painDiagnosis, demoBrief, citationAudit }) {
  const direct = proofChain.direct_pain[0] ?? publicEvidence(trigger);
  const code = proofChain.code_manifestations[0];
  const related = proofChain.related_pain[0];
  const stack = proofChain.stack_evidence[0];
  const displayName = lead.name ? `${lead.name} (@${login})` : `@${login}`;
  const steps = [
    traceStep({
      stage: "candidate_trigger",
      title: direct.title || direct.repo || "Initial GitHub trigger",
      url: direct.url,
      repo: direct.repo,
      path: direct.path,
      claim: `${displayName} entered the candidate set from ${direct.repo}: "${compact(direct.title, 140)}".`,
      why_it_matters:
        proofChain.direct_pain.length > 0
          ? "The original activity is direct public buyer pain, not just a keyword match."
          : "The original activity nominated the user for deeper same-user verification."
    }),
    traceStep({
      stage: "user_deepening",
      title: "Same-user GitHub deepening",
      claim: `The system searched ${login}'s public activity, involved issues/PRs, recent repos, manifests, and code evidence for independent proof.`,
      why_it_matters:
        "This moves the result from repo-local search to a user-level dossier that can prove whether the pain repeats elsewhere.",
      evidence_count:
        proofChain.related_pain.length + proofChain.stack_evidence.length + proofChain.code_manifestations.length
    })
  ];

  if (code) {
    steps.push(
      traceStep({
        stage: "code_proof",
        title: code.path || code.title || code.repo || "Code manifestation proof",
        url: code.url,
        repo: code.repo,
        path: code.path,
        claim: code.path
          ? `The same user has ${code.path} in ${code.repo}, showing ${describeCodeManifestation(code)}.`
          : `The same user supplied implementation-level proof in ${code.repo}: "${compact(code.title, 140)}".`,
        why_it_matters:
          "Code manifestation proof is required for demo-ready leads because it shows the implementation shape behind the stated pain."
      })
    );
  } else if (stack) {
    steps.push(
      traceStep({
        stage: "stack_proof",
        title: stack.path || stack.title || stack.repo || "Stack proof",
        url: stack.url,
        repo: stack.repo,
        path: stack.path,
        claim: `${stack.path ?? stack.title ?? "Manifest"} in ${stack.repo} shows relevant backend/realtime dependencies.`,
        why_it_matters:
          "Manifest evidence is useful support, but it is not enough by itself for a demo-ready lead."
      })
    );
  } else if (related) {
    steps.push(
      traceStep({
        stage: "related_pain",
        title: related.title || related.repo || "Related same-user pain",
        url: related.url,
        repo: related.repo,
        path: related.path,
        claim: `The same user also has related public activity: "${compact(related.title, 140)}".`,
        why_it_matters:
          "Related same-user pain shows the original trigger may not be an isolated keyword hit."
      })
    );
  }

  steps.push(
    traceStep({
      stage: "reliability_gate",
      title: formatVerdictLabel(reliabilityAudit.level),
      claim: `${displayName} is ${formatVerdictLabel(reliabilityAudit.level)} because the dossier has ${joinHuman(reliabilityAudit.confidence_factors.map((factor) => factor.toLowerCase()))}.`,
      why_it_matters:
        reliabilityAudit.level === "demo_ready"
          ? "The lead passed the strict gate: direct pain, same-user support, code manifestation proof, and cited claims."
          : `The lead is held back by: ${joinHuman(reliabilityAudit.evidence_gaps)}.`
    })
  );

  return {
    summary: traceSummary({ displayName, proofChain, painDiagnosis, reliabilityAudit }),
    proof_counts: {
      direct_pain: proofChain.direct_pain.length,
      related_pain: proofChain.related_pain.length,
      stack_evidence: proofChain.stack_evidence.length,
      code_manifestations: proofChain.code_manifestations.length
    },
    source_urls: citationAudit.source_urls,
    stages_checked: steps.map((step) => step.stage),
    steps,
    demo_claim: demoBrief.one_sentence_why
  };
}

function traceStep({ stage, title, claim, why_it_matters, url, repo, path, evidence_count }) {
  return {
    stage,
    title,
    claim,
    why_it_matters,
    ...(url ? { url } : {}),
    ...(repo ? { repo } : {}),
    ...(path ? { path } : {}),
    ...(Number.isFinite(evidence_count) ? { evidence_count } : {})
  };
}

function traceSummary({ displayName, proofChain, painDiagnosis, reliabilityAudit }) {
  const pieces = [];
  if (proofChain.direct_pain.length > 0) pieces.push("direct public pain");
  if (proofChain.related_pain.length > 0) pieces.push("related same-user activity");
  if (proofChain.stack_evidence.length > 0) pieces.push("stack evidence");
  if (proofChain.code_manifestations.length > 0) pieces.push("code manifestation proof");
  return `${displayName} was traced from GitHub activity to ${painDiagnosis.primary_pain}; the same GitHub user has ${joinHuman(pieces)}. Reliability: ${formatVerdictLabel(reliabilityAudit.level)}.`;
}

export function rankUserEvidence({ query, login, trigger, activities, now = new Date() }) {
  const normalizedLogin = normalizeLogin(login);
  const triggerText = evidenceSearchText(trigger);
  const triggerUrl = trigger?.url;

  return dedupeActivities(
    activities
    .map(normalizeActivity)
    .filter((activity) => normalizeLogin(activity.login) === normalizedLogin)
    .filter((activity) => activity.url !== triggerUrl)
    .filter((activity) => !isDocsOnly(activity))
  )
    .map((activity) => scoreUserEvidence({ activity, query, triggerText, now }))
    .filter((activity) => activity.deep_relevance_score >= 0.28)
    .sort((left, right) => right.deep_relevance_score - left.deep_relevance_score);
}

export function activitiesFromStructuredLeads(structuredLeads = [], neuralLeads = []) {
  const structuredActivities = structuredLeads.flatMap((lead) =>
    (lead.evidence ?? []).map((evidence) => ({
      login: lead.engineer_login,
      type: evidence.type,
      repo: evidence.repo,
      title: evidence.title,
      text: evidence.text,
      url: evidence.url,
      occurred_at: evidence.created_at,
      matched_topics: evidence.matched_topics ?? [],
      pain_signals: evidence.pain_signals ?? []
    }))
  );

  const neuralActivities = neuralLeads.flatMap((lead) =>
    (lead.recent_activity ?? []).map((activity) => ({
      login: lead.engineer_login,
      type: activity.type,
      repo: activity.repo,
      title: activity.title,
      text: activity.snippet,
      url: activity.url,
      occurred_at: activity.occurred_at,
      matched_topics: activity.matched_terms ?? [],
      pain_signals: activity.pain_signals ?? []
    }))
  );

  return [...structuredActivities, ...neuralActivities];
}

function buildProofChain({ trigger, rankedEvidence }) {
  const directPain = trigger && isDirectPainEvidence(trigger) ? [publicEvidence(trigger)] : [];
  const triggerCodeManifestation =
    directPain.length > 0 && isInlineCodeManifestation(trigger) ? [publicEvidence({ ...trigger, type: "code" })] : [];
  return {
    direct_pain: directPain,
    related_pain: rankedEvidence.filter(isRelatedPainEvidence).slice(0, 3).map(publicEvidence),
    stack_evidence: rankedEvidence.filter(isStackEvidence).slice(0, 3).map(publicEvidence),
    code_manifestations: [
      ...triggerCodeManifestation,
      ...rankedEvidence.filter(isCodeManifestation).slice(0, 3).map(publicEvidence)
    ].slice(0, 3)
  };
}

function buildEvidenceGraph({ login, lead, trigger, proofChain, reliabilityAudit }) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const userId = `user:${login}`;
  const productId = "product:convex";
  const triggerEvidence = proofChain.direct_pain[0] ?? publicEvidence(trigger);
  const triggerId = `trigger:${stableEvidenceId(triggerEvidence)}`;

  const addNode = (node) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge) => {
    const key = `${edge.from}->${edge.relation}->${edge.to}`;
    if (edgeIds.has(key)) return;
    edgeIds.add(key);
    edges.push(edge);
  };

  addNode({
    id: userId,
    type: "user",
    label: lead.name ? `${lead.name} (@${login})` : `@${login}`,
    login,
    url: lead.github_url ?? `https://github.com/${login}`
  });
  addNode({
    id: triggerId,
    type: "trigger_pain",
    label: compact(triggerEvidence.title || triggerEvidence.repo || "Original GitHub trigger", 120),
    repo: triggerEvidence.repo,
    path: triggerEvidence.path ?? null,
    snippet: compact(triggerEvidence.snippet ?? triggerEvidence.text, 220),
    url: triggerEvidence.url,
    occurred_at: triggerEvidence.occurred_at
  });
  addNode({
    id: productId,
    type: "product_fit",
    label: "Convex",
    snippet: "Reactive TypeScript backend replacing stitched realtime, cache, and backend state plumbing."
  });
  addEdge({
    from: userId,
    to: triggerId,
    relation: proofChain.direct_pain.length > 0 ? "reported" : "triggered_by",
    reason: proofChain.direct_pain.length > 0 ? "Direct public pain report" : "Initial candidate signal"
  });
  addEdge({
    from: triggerId,
    to: productId,
    relation: "supports_fit",
    reason: "Initial activity maps to Convex-relevant backend state pain"
  });

  addEvidenceNodes({
    category: "related_pain",
    relationFromUser: "also_reported",
    relationToProduct: "supports_fit",
    items: proofChain.related_pain,
    userId,
    triggerId,
    productId,
    addNode,
    addEdge
  });
  addEvidenceNodes({
    category: "stack_evidence",
    relationFromUser: "uses_stack",
    relationToProduct: "supports_fit",
    items: proofChain.stack_evidence,
    userId,
    triggerId,
    productId,
    addNode,
    addEdge
  });
  addEvidenceNodes({
    category: "code_manifestation",
    relationFromUser: "wrote_code_pattern",
    relationToProduct: "supports_fit",
    items: proofChain.code_manifestations,
    userId,
    triggerId,
    productId,
    addNode,
    addEdge
  });

  for (const gap of reliabilityAudit.evidence_gaps) {
    const gapId = `gap:${slugId(gap)}`;
    addNode({
      id: gapId,
      type: "gap",
      label: gap
    });
    addEdge({
      from: productId,
      to: gapId,
      relation: "needs_evidence",
      reason: "Missing proof required before a high-confidence outreach claim"
    });
  }

  return {
    summary: {
      direct_pain: proofChain.direct_pain.length,
      related_pain: proofChain.related_pain.length,
      stack_evidence: proofChain.stack_evidence.length,
      code_manifestations: proofChain.code_manifestations.length
    },
    nodes,
    edges
  };
}

function addEvidenceNodes({
  category,
  relationFromUser,
  relationToProduct,
  items,
  userId,
  triggerId,
  productId,
  addNode,
  addEdge
}) {
  for (const item of items) {
    const evidenceId = `evidence:${category}:${stableEvidenceId(item)}`;
    addNode({
      id: evidenceId,
      type: category,
      label: compact(item.title || item.path || item.repo || category, 120),
      repo: item.repo,
      path: item.path ?? null,
      snippet: compact(item.snippet ?? item.text, 220),
      url: item.url,
      occurred_at: item.occurred_at,
      deep_relevance_score: item.deep_relevance_score
    });
    addEdge({
      from: userId,
      to: evidenceId,
      relation: relationFromUser,
      reason: "Same GitHub user generated this supporting signal"
    });
    addEdge({
      from: triggerId,
      to: evidenceId,
      relation: "corroborated_by",
      reason: "Supporting evidence strengthens the original trigger"
    });
    addEdge({
      from: evidenceId,
      to: productId,
      relation: relationToProduct,
      reason: "Evidence maps to realtime, cache, backend state, or TypeScript stack pain"
    });
  }
}

function scoreUserEvidence({ activity, query, triggerText, now }) {
  const text = evidenceSearchText(activity);
  const querySemantic = semanticSimilarity(query, text);
  const triggerSemantic = semanticSimilarity(triggerText, text);
  const failure = termScore(text, FAILURE_TERMS, 0.22);
  const fit = termScore(text, CONVEX_FIT_TERMS, 0.14);
  const stack = termScore(text, STACK_TERMS, 0.18);
  const code = termScore(text, CODE_MANIFESTATION_TERMS, 0.2);
  const buyerVoice = termScore(text, BUYER_VOICE_TERMS, 0.22);
  const type = typeWeight(activity.type);
  const recency = recencyScore(activity.occurred_at, now);
  const noise = supportNoisePenalty(text);
  const deepRelevanceScore = Math.min(
    1,
    Math.max(
      0,
      Math.max(querySemantic, triggerSemantic) * 0.28 +
        failure * 0.28 +
        fit * 0.24 +
        stack * 0.14 +
        code * 0.16 +
        buyerVoice * 0.14 +
        type * 0.08 +
        recency * 0.08 -
        noise
    )
  );

  return {
    ...activity,
    semantic_score: round(Math.max(querySemantic, triggerSemantic), 4),
    failure_score: round(failure, 4),
    fit_score: round(fit, 4),
    stack_score: round(stack, 4),
    code_manifestation_score: round(code, 4),
    buyer_voice_score: round(buyerVoice, 4),
    recency_score: round(recency, 4),
    support_noise_penalty: round(noise, 4),
    deep_relevance_score: round(deepRelevanceScore, 4)
  };
}

function normalizeTrigger(lead) {
  const trigger = lead.trigger ?? lead.evidence?.[0] ?? {};
  return normalizeActivity({
    login: lead.engineer_login ?? lead.login,
    type: trigger.type,
    repo: trigger.repo,
    title: trigger.title,
    text: trigger.text ?? trigger.snippet,
    url: trigger.url,
    occurred_at: trigger.occurred_at ?? trigger.created_at,
    matched_topics: trigger.matched_topics ?? [],
    pain_signals: trigger.pain_signals ?? []
  });
}

function normalizeActivity(activity) {
  return {
    login: activity.login ?? activity.engineer_login ?? activity.actor_login ?? activity.author_login,
    type: activity.type ?? "activity",
    repo: activity.repo ?? activity.repository,
    path: activity.path ?? null,
    title: activity.title ?? activity.name ?? activity.path ?? "",
    text: activity.text ?? activity.body ?? activity.snippet ?? "",
    url: activity.url ?? activity.html_url ?? "",
    occurred_at: activity.occurred_at ?? activity.created_at ?? activity.updated_at ?? "",
    matched_topics: activity.matched_topics ?? [],
    pain_signals: activity.pain_signals ?? []
  };
}

function isDirectPainEvidence(evidence) {
  const text = evidenceSearchText(evidence);
  const literalText = evidenceLiteralText(evidence);
  return (
    ["issue", "comment", "technical_comment"].includes(evidence.type) &&
    evidencePainScore(text) >= 0.36 &&
    coreConvexPainScore(literalText) >= 0.16
  );
}

function isRelatedPainEvidence(evidence) {
  return (
    ["issue", "comment", "technical_comment"].includes(evidence.type) &&
    hasConvexTopicalSupport(evidence) &&
    (evidence.deep_relevance_score >= 0.45 || evidencePainScore(evidenceSearchText(evidence)) >= 0.42)
  );
}

function hasConvexTopicalSupport(evidence) {
  const text = evidenceSearchText(evidence);
  return (
    evidence.fit_score >= 0.2 ||
    evidence.semantic_score >= 0.11 ||
    termScore(text, CONVEX_FIT_TERMS, 0.14) >= 0.28
  );
}

function isStackEvidence(evidence) {
  const text = evidenceSearchText(evidence);
  return isManifestLike(evidence) && termScore(text, STACK_TERMS, 0.18) >= 0.18;
}

function isCodeManifestation(evidence) {
  const text = evidenceSearchText(evidence);
  return termScore(text, CODE_MANIFESTATION_TERMS, 0.2) >= 0.4 || isDedicatedWebSocketCode(evidence);
}

function isInlineCodeManifestation(evidence) {
  const text = evidenceSearchText(evidence);
  const literal = evidenceLiteralText(evidence);
  const hasInlineCode = String(literal).includes("```") || /`[^`]{3,}`/.test(String(literal));
  return ["issue", "comment", "technical_comment"].includes(evidence.type) && hasInlineCode && isCodeManifestation(evidence);
}

function isDedicatedWebSocketCode(evidence) {
  if (evidence.type !== "code") return false;
  const pathText = `${evidence.path ?? ""} ${evidence.title ?? ""}`.toLowerCase();
  const text = evidenceSearchText(evidence).toLowerCase();
  return pathText.includes("websocket") && text.includes("websocket");
}

function isDocsOnly(activity) {
  const text = evidenceSearchText(activity).toLowerCase();
  const docsSignal = ["docs", "documentation", "readme", "spelling", "typo"].some((term) => text.includes(term));
  return docsSignal && evidencePainScore(text) < 0.2 && termScore(text, CODE_MANIFESTATION_TERMS, 0.2) < 0.2;
}

function isManifestLike(evidence) {
  const path = String(evidence.path ?? evidence.title ?? "").toLowerCase();
  return (
    evidence.type === "manifest" ||
    path.endsWith("package.json") ||
    path.endsWith("pnpm-lock.yaml") ||
    path.endsWith("package-lock.json") ||
    path.endsWith("yarn.lock") ||
    path.endsWith("go.mod") ||
    path.endsWith("cargo.toml") ||
    path.endsWith("pyproject.toml")
  );
}

function supportNoisePenalty(text) {
  const normalized = String(text ?? "").toLowerCase();
  return SUPPORT_NOISE_TERMS.some((term) => normalized.includes(term)) ? 0.32 : 0;
}

function dedupeActivities(activities) {
  const seen = new Set();
  const unique = [];
  for (const activity of activities) {
    const key = activity.url || `${activity.login}:${activity.type}:${activity.repo}:${activity.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(activity);
  }
  return unique;
}

function evidencePainScore(text) {
  return Math.max(termScore(text, FAILURE_TERMS, 0.2), termScore(text, CONVEX_FIT_TERMS, 0.12));
}

function coreConvexPainScore(text) {
  return termScore(text, CORE_CONVEX_PAIN_TERMS, 0.16);
}

function supportEvidenceScore(proofChain) {
  return Math.min(
    1,
    proofChain.related_pain.length * 0.38 +
      proofChain.stack_evidence.length * 0.24 +
      proofChain.code_manifestations.length * 0.3
  );
}

function triangulationScore({ trigger, proofChain }) {
  const categories = [
    proofChain.direct_pain.length > 0,
    proofChain.related_pain.length > 0,
    proofChain.stack_evidence.length > 0,
    proofChain.code_manifestations.length > 0
  ].filter(Boolean).length;
  const triggerRepo = trigger?.repo;
  const support = [
    ...proofChain.related_pain,
    ...proofChain.stack_evidence,
    ...proofChain.code_manifestations
  ];
  const crossRepo = support.some((item) => item.repo && item.repo !== triggerRepo);
  return Math.min(1, categories * 0.22 + (crossRepo ? 0.18 : 0));
}

function directCodeCorroborationScore({ trigger, proofChain }) {
  if (!trigger || proofChain.direct_pain.length === 0 || proofChain.code_manifestations.length === 0) {
    return 0;
  }

  const triggerText = evidenceSearchText(trigger).toLowerCase();
  const triggerRepo = trigger?.repo;
  const triggerTerms = corroborationTerms(triggerText);

  for (const item of proofChain.code_manifestations) {
    const codeText = evidenceSearchText(item).toLowerCase();
    const codeTerms = corroborationTerms(codeText);
    const sharedTerms = triggerTerms.filter((term) => codeTerms.includes(term));
    const crossRepo = item.repo && item.repo !== triggerRepo;
    const reproMarker = /\b(repro|reproduction|bug[-_\s]?repro|bug)\b/.test(codeText);

    if (crossRepo && reproMarker && sharedTerms.length >= 2) {
      return 1;
    }
    if (crossRepo && reproMarker && sharedTerms.length >= 1) {
      return 0.8;
    }
  }

  return 0;
}

function corroborationTerms(text) {
  const normalized = String(text ?? "").toLowerCase();
  return [
    "appwrite",
    "cache",
    "firebase",
    "firestore",
    "initialstorage",
    "liveblocks",
    "postgres_changes",
    "queryclient",
    "realtime",
    "room",
    "storage",
    "supabase",
    "sync",
    "websocket"
  ].filter((term) => normalized.includes(term));
}

function underProofPenalty(proofChain, codeCorroboration = 0) {
  const supportCount =
    proofChain.related_pain.length + proofChain.stack_evidence.length + proofChain.code_manifestations.length;
  if (codeCorroboration >= 0.8) return 0;
  return supportCount === 0 ? 1.15 : supportCount === 1 ? 0.35 : 0;
}

function dossierSortScore(dossier) {
  const levelWeight = {
    demo_ready: 100,
    needs_stack_or_code_proof: 60,
    needs_pain_linkage: 55,
    needs_independent_support: 45,
    not_demo_ready: 30
  }[dossier.reliability_audit.level] ?? 0;
  const directTriggerWeight = dossier.proof_chain.direct_pain.length > 0 ? 30 : -20;
  const crossRepoWeight = dossier.reliability_audit.cross_repo_support ? 12 : 0;
  const stackCodeWeight =
    dossier.proof_chain.stack_evidence.length > 0 || dossier.proof_chain.code_manifestations.length > 0 ? 8 : 0;
  return levelWeight + directTriggerWeight + crossRepoWeight + stackCodeWeight + dossier.proof_depth_score;
}

function followUpConversionScore(dossier) {
  const gaps = dossier.reliability_audit?.evidence_gaps ?? [];
  const triggerText = evidenceSearchText(dossier.trigger).toLowerCase();
  const hasDirectPain = (dossier.proof_chain?.direct_pain?.length ?? 0) > 0;
  const hasCodeProof = (dossier.proof_chain?.code_manifestations?.length ?? 0) > 0;
  const hasStackProof = (dossier.proof_chain?.stack_evidence?.length ?? 0) > 0;
  const codeSpecificTrigger = [
    "initialstorage",
    "liveblocks",
    "websocket",
    "subscription",
    "realtime",
    "real-time",
    "cache",
    "firestore",
    "firebase",
    "supabase"
  ].some((term) => triggerText.includes(term));

  let score = dossierSortScore(dossier);
  if (hasDirectPain) score += 80;
  if (gaps.includes("Needs second-hop same-user evidence")) score += 90;
  if (gaps.includes("Needs stack or code manifestation proof")) score += 60;
  if (gaps.includes("Needs code manifestation proof")) score += 35;
  if (codeSpecificTrigger) score += 30;
  if (hasStackProof && !hasCodeProof) score -= 35;
  if (gaps.includes("Needs direct buyer pain report")) score -= 70;
  return score;
}

function publicEvidence(evidence) {
  return {
    type: evidence.type,
    repo: evidence.repo,
    path: evidence.path ?? null,
    title: compact(evidence.title, 160),
    snippet: compact(evidence.text, 260),
    url: evidence.url,
    occurred_at: evidence.occurred_at,
    deep_relevance_score: evidence.deep_relevance_score
  };
}

function uniquePublicEvidence(items) {
  const seen = new Set();
  const uniqueItems = [];
  for (const item of items) {
    const key = item.url || `${item.type}:${item.repo}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(item);
  }
  return uniqueItems;
}

function uniquePublicEvidenceText(items) {
  return [...new Set(items)];
}

function whySurprisinglyDeep(login, proofChain) {
  const pieces = [];
  if (proofChain.direct_pain.length > 0) pieces.push("a direct public pain report");
  if (proofChain.related_pain.length > 0) pieces.push("another related activity from the same person");
  if (proofChain.stack_evidence.length > 0) pieces.push("their stack/dependency footprint");
  if (proofChain.code_manifestations.length > 0) pieces.push("the code pattern that creates the pain");

  if (pieces.length <= 1) {
    return `We found a strong initial trigger for ${login}, but not enough same-person supporting activity yet.`;
  }

  return `This is deeper than repo search because the same person has ${joinHuman(pieces)}, so the lead is backed by behavioral evidence rather than one keyword hit.`;
}

function whyConvexFits(proofChain) {
  const text = JSON.stringify(proofChain).toLowerCase();
  const reasons = [];
  if (text.includes("realtime") || text.includes("subscription") || text.includes("websocket") || text.includes("sync")) {
    reasons.push("Convex gives them a TypeScript-native reactive backend instead of custom realtime plumbing");
  }
  if (text.includes("invalidatequeries") || text.includes("cache") || text.includes("stale") || text.includes("react-query")) {
    reasons.push("Convex reduces manual cache invalidation and stale client/server state");
  }
  if (text.includes("supabase") || text.includes("firebase")) {
    reasons.push("the evidence shows they are already in the Firebase/Supabase alternative zone");
  }
  if (reasons.length === 0) {
    return "Convex fits if their interactive app needs durable backend state with live client updates.";
  }
  return `${joinHuman(reasons)}.`;
}

function diagnosePain({ trigger, proofChain }) {
  const combinedText = JSON.stringify({ trigger, proofChain }).toLowerCase();
  const triggerTitle = proofChain.direct_pain[0]?.title ?? trigger?.title ?? "the original GitHub activity";
  const codeManifestations = proofChain.code_manifestations.map(describeCodeManifestation);
  const stackEvidence = proofChain.stack_evidence.map((item) =>
    `${item.path ?? item.title ?? "manifest"} in ${item.repo} shows ${compact(item.snippet, 140)}`
  );

  if (
    combinedText.includes("initialstorage") ||
    combinedText.includes("liveobject") ||
    (combinedText.includes("room") && (combinedText.includes("overwrite") || combinedText.includes("overwritten")))
  ) {
    return {
      primary_pain: "Collaborative state corruption",
      severity: "high",
      why_burning: `Their GitHub evidence says "${compact(triggerTitle, 120)}"; that means shared room state can be overwritten instead of reliably converging for users.`,
      code_manifestations: codeManifestations,
      stack_evidence: stackEvidence,
      convex_angle:
        "Convex gives this kind of product a reactive backend with durable shared state, so the app does not need custom WebSocket/storage-message plumbing to keep clients consistent."
    };
  }

  if (
    combinedText.includes("websocket") ||
    combinedText.includes("reconnect") ||
    combinedText.includes("subscription") ||
    combinedText.includes("postgres_changes") ||
    combinedText.includes("delivers nothing") ||
    combinedText.includes("stalls")
  ) {
    return {
      primary_pain: "Realtime reliability failure",
      severity: "high",
      why_burning: `Their GitHub evidence centers on "${compact(triggerTitle, 120)}", which points to product-critical live updates failing or becoming unreliable for users.`,
      code_manifestations: codeManifestations,
      stack_evidence: stackEvidence,
      convex_angle:
        "Convex replaces custom realtime transport and subscription recovery work with a TypeScript-native reactive backend."
    };
  }

  if (
    combinedText.includes("cache") ||
    combinedText.includes("stale") ||
    combinedText.includes("invalidatequeries") ||
    combinedText.includes("firestore")
  ) {
    return {
      primary_pain: "Client/server state consistency",
      severity: "medium_high",
      why_burning: `Their GitHub evidence points to "${compact(triggerTitle, 120)}", which is the kind of stale state or cache invalidation problem that leaks directly into product UX.`,
      code_manifestations: codeManifestations,
      stack_evidence: stackEvidence,
      convex_angle:
        "Convex reduces manual cache invalidation by making backend state reactive to the TypeScript client."
    };
  }

  return {
    primary_pain: "Backend state plumbing",
    severity: proofChain.direct_pain.length > 0 ? "medium_high" : "medium",
    why_burning: `Their GitHub evidence starts with "${compact(triggerTitle, 120)}"; more same-user proof is needed before treating it as a finished lead.`,
    code_manifestations: codeManifestations,
    stack_evidence: stackEvidence,
    convex_angle:
      "Convex is relevant if this app needs durable backend state, live client updates, and less stitched API/cache/realtime infrastructure."
  };
}

function describeCodeManifestation(item) {
  const text = `${item.path ?? ""} ${item.title ?? ""} ${item.snippet ?? ""}`.toLowerCase();
  const patterns = [];
  if (text.includes("websocket") || text.includes("socket.on") || text.includes("onmessage")) {
    patterns.push("custom WebSocket/listener plumbing");
  }
  if (text.includes("invalidatequeries") || text.includes("queryclient")) {
    patterns.push("manual cache invalidation");
  }
  if (text.includes("useeffect") || text.includes("fetch(") || text.includes("refetch")) {
    patterns.push("manual fetch/refetch lifecycle code");
  }
  if (text.includes("optimistic") || text.includes("rollback")) {
    patterns.push("optimistic update rollback logic");
  }
  const label = item.path ?? item.title ?? item.repo ?? "code evidence";
  return patterns.length > 0
    ? `${label}: ${joinHuman(patterns)}`
    : `${label}: ${compact(item.snippet, 140)}`;
}

function buildDemoBrief({
  login,
  lead,
  proofChain,
  reliabilityAudit,
  painDiagnosis,
  proofDepthScore,
  qualificationStatus,
  outreach
}) {
  const displayName = lead.name ? `${lead.name} (@${login})` : `@${login}`;
  const proofPoints = [];
  const direct = proofChain.direct_pain[0];
  const related = proofChain.related_pain[0];
  const code = proofChain.code_manifestations[0];
  const stack = proofChain.stack_evidence[0];
  const codeReproduction = reliabilityAudit.confidence_factors.includes("Code reproduction corroborates original pain");

  if (direct) {
    proofPoints.push({
      kind: "direct_pain",
      claim: `${displayName} reported "${compact(direct.title, 120)}" in ${direct.repo}.`,
      url: direct.url,
      repo: direct.repo,
      why_it_matters: painDiagnosis.why_burning
    });
  }
  if (related) {
    proofPoints.push({
      kind: "related_pain",
      claim: `The same user also has related activity: "${compact(related.title, 120)}".`,
      url: related.url,
      repo: related.repo,
      why_it_matters: "This shows the pain is not just a one-off keyword hit."
    });
  }
  if (code) {
    const codeLabel = code.path ?? code.title ?? code.repo ?? "code evidence";
    proofPoints.push({
      kind: codeReproduction ? "code_reproduction" : "code_manifestation",
      claim: `The same user has ${codeLabel} in ${code.repo}, showing ${painDiagnosis.code_manifestations[0] ?? "the code pattern behind the pain"}.`,
      url: code.url,
      repo: code.repo,
      path: code.path ?? null,
      why_it_matters: codeReproduction
        ? "This is strong because the user's own repro code corroborates the original public pain report."
        : "This links the lead to actual implementation patterns instead of only issue text."
    });
  }
  if (stack) {
    proofPoints.push({
      kind: "stack_evidence",
      claim: `${stack.path ?? stack.title ?? "Manifest"} in ${stack.repo} shows relevant backend/realtime dependencies.`,
      url: stack.url,
      repo: stack.repo,
      path: stack.path ?? null,
      why_it_matters: "This ties the lead to a stack where Convex can replace stitched backend state infrastructure."
    });
  }

  return {
    headline: `${displayName} is a ${formatVerdictLabel(reliabilityAudit.level)} lead for ${painDiagnosis.primary_pain}.`,
    verdict: reliabilityAudit.level,
    qualification_status: qualificationStatus,
    score: proofDepthScore,
    severity: painDiagnosis.severity,
    one_sentence_why:
      proofPoints.length > 1
        ? `${painDiagnosis.why_burning} The lead is backed by ${proofPoints.length} cited proof points.`
        : painDiagnosis.why_burning,
    proof_points: proofPoints,
    reliability: {
      confidence_factors: reliabilityAudit.confidence_factors,
      citation_count: reliabilityAudit.citation_count,
      cross_repo_support: reliabilityAudit.cross_repo_support
    },
    missing_proof: reliabilityAudit.evidence_gaps,
    talk_track: [
      painDiagnosis.why_burning,
      proofPoints.map((point) => point.claim).join(" "),
      painDiagnosis.convex_angle
    ].filter(Boolean),
    outreach_opener: outreach[0] ?? ""
  };
}

function formatVerdictLabel(level) {
  if (level === "demo_ready") return "demo-ready";
  return String(level ?? "").replaceAll("_", " ");
}

function buildEvidenceTimeline({ proofChain, painDiagnosis }) {
  const events = [
    ...proofChain.direct_pain.map((item) => timelineEvent(item, "direct_pain", painDiagnosis)),
    ...proofChain.related_pain.map((item) => timelineEvent(item, "related_pain", painDiagnosis)),
    ...proofChain.stack_evidence.map((item) => timelineEvent(item, "stack_evidence", painDiagnosis)),
    ...proofChain.code_manifestations.map((item) => timelineEvent(item, "code_manifestation", painDiagnosis))
  ].filter((event) => event.url);

  return events.sort((left, right) => {
    const leftTime = new Date(left.occurred_at).getTime();
    const rightTime = new Date(right.occurred_at).getTime();
    if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return leftTime - rightTime;
  });
}

function timelineEvent(item, kind, painDiagnosis) {
  return {
    kind,
    occurred_at: item.occurred_at,
    repo: item.repo,
    path: item.path ?? null,
    title: item.title || item.path || item.repo || kind,
    url: item.url,
    why_it_matters: timelineWhyItMatters({ item, kind, painDiagnosis })
  };
}

function timelineWhyItMatters({ item, kind, painDiagnosis }) {
  if (kind === "direct_pain") {
    return `Direct public pain report: ${compact(painDiagnosis.why_burning, 180)}`;
  }
  if (kind === "related_pain") {
    return "Same-user related pain shows the problem repeats beyond the initial trigger.";
  }
  if (kind === "stack_evidence") {
    return "Manifest or dependency evidence links the user to a relevant backend/realtime stack.";
  }
  if (kind === "code_manifestation") {
    return `Same-user code/repro evidence shows ${describeCodeManifestation(item)}.`;
  }
  return "Supporting evidence for the lead.";
}

function nextBestHarvest(status, login) {
  if (status !== "needs_more_user_evidence") {
    return "Already has enough user-level evidence for a high-confidence demo dossier.";
  }
  return `Fetch ${login}'s public events, authored/commented issues, recent owned repos, package manifests, and touched code files to confirm whether the initial trigger repeats elsewhere.`;
}

function outreachForDossier(lead, proofChain, status, painDiagnosis) {
  const trigger = proofChain.direct_pain[0] ?? lead.trigger;
  const related = proofChain.related_pain[0];
  const stack = proofChain.stack_evidence[0];
  const code = proofChain.code_manifestations[0];
  const lines = [
    `Saw your GitHub report around "${compact(trigger?.title ?? "a backend/realtime issue", 100)}".`
  ];
  if (code && painDiagnosis) {
    const codeLabel = code.path ?? code.title ?? code.repo ?? "your repro code";
    lines.push(
      `I also saw ${codeLabel}, which points to ${painDiagnosis.primary_pain.toLowerCase()} through ${compact(painDiagnosis.code_manifestations[0] ?? "custom backend state plumbing", 130)}.`
    );
    lines.push(`Convex is a reactive TypeScript backend, so it can remove that realtime/shared-state plumbing instead of making you stitch it together.`);
    return lines;
  }
  if (related) {
    lines.push(`It stood out because another activity from you mentions "${compact(related.title, 90)}".`);
  }
  if (stack || code) {
    lines.push("That looks like the kind of stitched realtime/cache/backend state work Convex is designed to remove.");
  } else if (status === "needs_more_user_evidence") {
    lines.push("I would verify your recent public repos before reaching out, but the initial pain signal is relevant.");
  }
  return lines;
}

function topEmbeddingTerms(text, limit = 12) {
  return [...embedText(text).entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([term, weight]) => ({ term, weight: round(weight, 3) }));
}

function termScore(text, terms, weight) {
  const normalized = String(text ?? "").toLowerCase();
  const hits = terms.filter((term) => normalized.includes(term)).length;
  return Math.min(1, hits * weight);
}

function typeWeight(type) {
  if (type === "issue" || type === "comment" || type === "technical_comment") return 1;
  if (type === "manifest" || type === "code") return 0.85;
  if (type === "commit" || type === "pull_request") return 0.55;
  if (type === "star") return 0.25;
  return 0.35;
}

function recencyScore(isoDate, now) {
  const timestamp = new Date(isoDate).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.65;
  if (ageDays <= 180) return 0.25;
  return 0;
}

function evidenceSearchText(evidence) {
  return [
    evidence?.repo,
    evidence?.path,
    evidence?.title,
    evidence?.text,
    evidence?.matched_topics?.join(" "),
    evidence?.pain_signals?.join(" ")
  ]
    .filter(Boolean)
    .join(" ");
}

function evidenceLiteralText(evidence) {
  return [evidence?.repo, evidence?.path, evidence?.title, evidence?.text]
    .filter(Boolean)
    .join(" ");
}

function compact(value, maxLength = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function normalizeLogin(value) {
  return String(value ?? "").toLowerCase();
}

function joinHuman(items) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function stableEvidenceId(evidence) {
  return shortHash([
    evidence?.url,
    evidence?.repo,
    evidence?.path,
    evidence?.title,
    evidence?.occurred_at
  ].filter(Boolean).join("|"));
}

function slugId(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || shortHash(value);
}

function shortHash(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
