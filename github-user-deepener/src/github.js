const API_ROOT = "https://api.github.com";

const DEFAULT_MANIFEST_PATHS = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml"
];

const DEFAULT_CODE_SEARCH_PATTERNS = [
  "queryClient.invalidateQueries",
  "socket.on",
  "new WebSocket",
  "supabase.channel",
  "useEffect fetch",
  "onSnapshot",
  "optimistic rollback"
];

const DEFAULT_CODE_SEARCH_LANGUAGES = ["TypeScript", "JavaScript"];

const DEFAULT_DIRECT_PAIN_PHRASES = [
  '"cache invalidation"',
  '"WebSocket reconnect"',
  '"websocket reconnect"',
  '"real-time sync"',
  '"realtime sync"',
  '"Firebase alternative"',
  '"Supabase alternative"',
  '"replace Firebase"',
  '"self-hosted backend"',
  '"simpler full-stack backend"'
];

const DIRECT_PAIN_TEXT_TERMS = [
  "cache invalidation",
  "cache stale",
  "real-time sync",
  "realtime sync",
  "stale cache",
  "too much plumbing",
  "stale cache",
  "websocket reconnect",
  "websocket reconnection"
];

const ALTERNATIVE_BUYER_TERMS = [
  "firebase alternative",
  "replace firebase",
  "self-hosted backend",
  "simpler full-stack backend",
  "supabase alternative"
];

const ALTERNATIVE_POSITIONING_TERMS = [
  "differentiator vs",
  "keyword target",
  "marketing page",
  "position this",
  "positioning",
  "seo"
];

const BUYER_PAIN_CONTEXT_TERMS = [
  "because our",
  "because we",
  "broken",
  "cache invalidation",
  "can't",
  "cannot",
  "expensive",
  "fails",
  "frustrated",
  "hard to",
  "looking for",
  "migrate from",
  "migrating from",
  "migrating off",
  "move off",
  "moving off",
  "need to replace",
  "pain",
  "replace firebase",
  "stale",
  "too expensive",
  "too much",
  "want to replace",
  "websocket"
];

export async function fetchUserDeepActivity({
  logins,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  fetchImpl = globalThis.fetch,
  repoLimit = 8,
  manifestPaths = DEFAULT_MANIFEST_PATHS,
  includeIssueSearch = true,
  issueCommentLimit = 10,
  includeCodeSamples = false,
  codeFileLimit = 4,
  includeCodeSearch = false,
  codeSearchPatterns = DEFAULT_CODE_SEARCH_PATTERNS,
  codeSearchLanguages = DEFAULT_CODE_SEARCH_LANGUAGES,
  codeSearchLimit = 5,
  days = 90,
  now = new Date()
}) {
  if (!Array.isArray(logins)) {
    throw new Error("logins must be an array");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const client = githubClient({ token, fetchImpl });
  const activities = [];

  for (const login of unique(logins.filter(Boolean))) {
    const events = await client.getJson(`/users/${encodeURIComponent(login)}/events/public?per_page=100`);
    if (Array.isArray(events)) {
      activities.push(...events.flatMap((event) => activitiesFromEvent(event, login)));
    }

    if (includeIssueSearch) {
      for (const searchPath of issueSearchPaths({ login, days, now })) {
        const searchResults = await client.getJson(searchPath, { optional: true });
        if (Array.isArray(searchResults?.items)) {
          activities.push(
            ...(await activitiesFromIssueSearchItems({
              client,
              items: searchResults.items,
              login,
              source: "github_issue_search",
              issueCommentLimit
            }))
          );
        }
      }
    }

    if (includeCodeSearch) {
      activities.push(
        ...(await fetchCodeSearchActivities({
          client,
          login,
          codeSearchPatterns,
          codeSearchLanguages,
          codeSearchLimit
        }))
      );
    }

    if (repoLimit <= 0) continue;
    const repos = await client.getJson(
      `/users/${encodeURIComponent(login)}/repos?sort=updated&direction=desc&per_page=${repoLimit}`
    );
    if (!Array.isArray(repos)) continue;

    for (const repo of repos.filter((item) => !item.fork && !item.archived).slice(0, repoLimit)) {
      activities.push(activityFromRepo(repo, login));
      for (const manifestPath of manifestPaths) {
        const manifest = await client.getJson(
          `/repos/${encodeURIComponent(repo.full_name).replace("%2F", "/")}/contents/${manifestPath}`,
          { optional: true }
        );
        if (!manifest?.content) continue;
        activities.push(activityFromManifest({ manifest, repo, login, manifestPath }));
      }
      if (includeCodeSamples && codeFileLimit > 0) {
        activities.push(
          ...(await fetchCodeSamples({
            client,
            repo,
            login,
            codeFileLimit
          }))
        );
      }
    }
  }

  return dedupeActivities(activities);
}

export async function fetchDirectPainLeads({
  query,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  fetchImpl = globalThis.fetch,
  phrases = directPainSearchPhrases(query),
  searchLimit = 10,
  issueCommentLimit = 10,
  leadLimit = 30,
  days = 90,
  now = new Date(),
  requireProfile = true
}) {
  if (!query || !String(query).trim()) {
    throw new Error("query is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const client = githubClient({ token, fetchImpl });
  const since = formatDate(new Date(now.getTime() - days * 86_400_000));
  const candidates = [];
  let issueCount = 0;
  let commentCount = 0;

  for (const phrase of unique(phrases.filter(Boolean))) {
    const searchResults = await client.getJson(directPainIssueSearchPath({ phrase, since, searchLimit }), {
      optional: true
    });
    if (!Array.isArray(searchResults?.items)) continue;

    for (const item of searchResults.items) {
      issueCount += 1;
      const issueText = [item.title, item.body].filter(Boolean).join(" ");
      if (hasDirectPainText(issueText)) {
        candidates.push(directPainCandidateFromIssue(item, phrase));
      }

      const comments = await fetchIssueComments({ client, item, issueCommentLimit });
      for (const comment of comments) {
        commentCount += 1;
        if (hasDirectPainText(comment.body)) {
          candidates.push(directPainCandidateFromComment({ item, comment, phrase }));
        }
      }
    }
  }

  const deduped = dedupeDirectPainCandidates(candidates)
    .filter((candidate) => candidate.login && !isBotLogin(candidate.login))
    .sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)))
    .slice(0, Math.max(0, Number(leadLimit) || 0));

  const results = [];
  for (const candidate of deduped) {
    const profile = await client.getJson(`/users/${encodeURIComponent(candidate.login)}`, { optional: true });
    if (requireProfile && !hasProfileInfo(profile)) continue;
    results.push(directPainLeadFromCandidate({ candidate, profile }));
  }

  return {
    query,
    approach: "live GitHub direct-pain issue discovery",
    search_count: unique(phrases.filter(Boolean)).length,
    issue_count: issueCount,
    comment_count: commentCount,
    result_count: results.length,
    results
  };
}

export async function fetchFollowUpActivities({
  nearMisses,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  fetchImpl = globalThis.fetch,
  issueSearchLimit = 20,
  issueCommentLimit = 10,
  codeSearchLimit = 5,
  broadRepoLimit = 4,
  broadCodeFileLimit = 4
}) {
  if (!Array.isArray(nearMisses)) {
    throw new Error("nearMisses must be an array");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const client = githubClient({ token, fetchImpl });
  const activities = [];

  for (const nearMiss of nearMisses) {
    const login = nearMiss.engineer_login ?? nearMiss.login;
    if (!login) continue;

    for (const action of nearMiss.follow_up_actions ?? []) {
      if (action.kind === "github_user_activity_harvest") {
        activities.push(
          ...(await fetchUserDeepActivity({
            logins: [login],
            token,
            fetchImpl,
            repoLimit: Number(action.repo_limit ?? broadRepoLimit),
            issueCommentLimit,
            includeCodeSamples: true,
            codeFileLimit: Number(action.code_file_limit ?? broadCodeFileLimit),
            includeCodeSearch: false
          }))
        );
        continue;
      }

      if (action.kind === "github_user_code_harvest") {
        activities.push(
          ...(await fetchFollowUpCodeActivities({
            client,
            login,
            query: action.query,
            codeSearchLimit
          }))
        );
        continue;
      }

      if (isIssueFollowUpAction(action)) {
        for (const query of followUpIssueQueries(action)) {
          const searchResults = await client.getJson(followUpIssueSearchPath({ query, issueSearchLimit }), {
            optional: true
          });
          if (!Array.isArray(searchResults?.items)) continue;
          activities.push(
            ...(await activitiesFromIssueSearchItems({
              client,
              items: searchResults.items,
              login,
              source: "github_follow_up_issue_search",
              issueCommentLimit
            }))
          );
        }
      }
    }
  }

  return dedupeActivities(activities);
}

async function fetchIssueComments({ client, item, issueCommentLimit }) {
  if (!item.comments_url || Number(item.comments ?? 1) <= 0 || issueCommentLimit <= 0) return [];
  const comments = await client.getJson(issueCommentsPath(item.comments_url, issueCommentLimit), { optional: true });
  return Array.isArray(comments) ? comments : [];
}

async function activitiesFromIssueSearchItems({ client, items, login, source, issueCommentLimit }) {
  const activities = [];
  for (const item of items) {
    activities.push(activityFromIssueSearchItem(item, login, source));
    activities.push(
      ...(await fetchIssueCommentActivities({
        client,
        item,
        login,
        issueCommentLimit,
        source: issueCommentSource(source)
      }))
    );
  }
  return activities;
}

async function fetchIssueCommentActivities({ client, item, login, issueCommentLimit, source }) {
  const comments = await fetchIssueComments({ client, item, issueCommentLimit });
  const normalizedLogin = String(login).toLowerCase();
  return comments
    .filter((comment) => String(comment.user?.login ?? "").toLowerCase() === normalizedLogin)
    .map((comment) => activityFromIssueComment({ item, comment, login, source }));
}

function issueCommentsPath(commentsUrl, issueCommentLimit) {
  const path = apiPathFromUrl(commentsUrl);
  return `${path}${path.includes("?") ? "&" : "?"}per_page=${issueCommentLimit}`;
}

function issueCommentSource(source) {
  if (source === "github_follow_up_issue_search") return "github_follow_up_issue_comment";
  if (source === "github_issue_search") return "github_issue_comment";
  return `${source}_comment`;
}

async function fetchFollowUpCodeActivities({ client, login, query, codeSearchLimit }) {
  const activities = [];
  for (const codeQuery of followUpCodeQueries({ login, query })) {
    const searchResults = await client.getJson(followUpCodeSearchPath({ query: codeQuery, codeSearchLimit }), {
      optional: true
    });
    if (!Array.isArray(searchResults?.items)) continue;

    for (const item of searchResults.items) {
      if (!isHighSignalCodePath(item.path)) continue;
      const file = await client.getJson(apiPathFromUrl(item.url), { optional: true });
      const text = decodeBlob(file);
      if (!text || !looksLikeUsefulCodeSignal(text)) continue;
      activities.push(
        activityFromCodeSearchItem({
          item,
          file,
          text,
          login,
          source: "github_follow_up_code_search"
        })
      );
    }
  }
  return activities;
}

function followUpCodeQueries({ login, query }) {
  const userQualifier = `user:${login}`;
  return unique([
    query,
    ...DEFAULT_CODE_SEARCH_PATTERNS.map((pattern) => `${pattern} ${userQualifier}`)
  ].filter(Boolean));
}

function directPainSearchPhrases(query) {
  const normalized = String(query ?? "").toLowerCase();
  const phrases = [];
  if (normalized.includes("cache")) {
    phrases.push('"cache invalidation"', '"stale cache"', "invalidateQueries stale");
  }
  if (normalized.includes("websocket") || normalized.includes("real-time") || normalized.includes("realtime")) {
    phrases.push('"WebSocket reconnect"', '"WebSocket infrastructure"', '"WebSocket reliability"', "websocket stale");
  }
  if (normalized.includes("firebase")) {
    phrases.push('"Firebase alternative"', '"replace Firebase"', '"migrate from Firebase"', '"moving off Firebase"', '"too expensive" Firebase');
  }
  if (normalized.includes("supabase")) {
    phrases.push('"Supabase alternative"', '"replace Supabase"', '"migrate from Supabase"', '"moving off Supabase"', '"too expensive" Supabase');
  }
  if (normalized.includes("backend") || normalized.includes("full-stack") || normalized.includes("simpler")) {
    phrases.push('"self-hosted backend"', '"simpler backend"', '"too much plumbing" backend', '"backend plumbing"');
  }
  return phrases.length > 0 ? phrases : DEFAULT_DIRECT_PAIN_PHRASES;
}

function directPainIssueSearchPath({ phrase, since, searchLimit }) {
  const query = `${phrase} is:issue updated:>=${since}`;
  return `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${searchLimit}`;
}

function directPainCandidateFromIssue(item, phrase) {
  return {
    login: item.user?.login,
    type: "issue",
    repo: repoFromRepositoryUrl(item.repository_url),
    title: item.title ?? "GitHub issue",
    text: item.body ?? "",
    url: item.html_url,
    occurred_at: item.updated_at ?? item.created_at,
    phrase
  };
}

function directPainCandidateFromComment({ item, comment, phrase }) {
  return {
    login: comment.user?.login,
    type: "comment",
    repo: repoFromRepositoryUrl(item.repository_url),
    title: item.title ?? "GitHub issue comment",
    text: comment.body ?? "",
    url: comment.html_url,
    occurred_at: comment.updated_at ?? comment.created_at ?? item.updated_at ?? item.created_at,
    phrase
  };
}

function directPainLeadFromCandidate({ candidate, profile }) {
  const name = profile?.name || null;
  const githubUrl = profile?.html_url ?? `https://github.com/${candidate.login}`;
  return {
    engineer_login: candidate.login,
    name,
    company: profile?.company ?? null,
    github_url: githubUrl,
    email: profile?.email ?? null,
    icp_fit_score: candidate.type === "comment" ? 8.9 : 8.6,
    score_breakdown: {
      direct_pain_search: 10,
      recency: 8,
      profile: hasProfileInfo(profile) ? 10 : 0
    },
    trigger: {
      type: candidate.type,
      repo: candidate.repo,
      title: candidate.title,
      text: candidate.text,
      snippet: compactText(candidate.text, 260),
      url: candidate.url,
      occurred_at: candidate.occurred_at,
      matched_topics: [candidate.phrase],
      pain_signals: ["direct_pain_search"]
    },
    exact_phrase_matches: [candidate.phrase],
    pain_signal: `Public GitHub pain: ${compactText(candidate.text || candidate.title, 180)}`,
    why_this_is_high_intent:
      "The lead used GitHub to describe a backend/realtime pain phrase directly tied to the search prompt.",
    why_convex_fits:
      "Convex can replace hand-stitched realtime, cache, and backend state plumbing with a TypeScript-native reactive backend.",
    outreach: [
      `Saw your GitHub ${candidate.type} about ${candidate.title}.`,
      "It looks like you are dealing with realtime/backend state plumbing that Convex is built to remove.",
      "Worth comparing it against the current Firebase/Supabase/WebSocket setup?"
    ].join(" "),
    sources_used: {
      live_direct_pain_search: true
    }
  };
}

function dedupeDirectPainCandidates(candidates) {
  const seen = new Set();
  const uniqueCandidates = [];
  for (const candidate of candidates) {
    if (!candidate.login || !candidate.url) continue;
    const key = `${candidate.login.toLowerCase()}:${candidate.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueCandidates.push(candidate);
  }
  return uniqueCandidates;
}

function hasDirectPainText(text) {
  const normalized = String(text ?? "").toLowerCase();
  if (DIRECT_PAIN_TEXT_TERMS.some((term) => normalized.includes(term))) return true;
  const hasVendor = normalized.includes("firebase") || normalized.includes("supabase");
  if (hasVendor && BUYER_PAIN_CONTEXT_TERMS.some((term) => normalized.includes(term))) return true;
  const hasAlternativeTerm = ALTERNATIVE_BUYER_TERMS.some((term) => normalized.includes(term));
  if (!hasAlternativeTerm) return false;
  if (ALTERNATIVE_POSITIONING_TERMS.some((term) => normalized.includes(term))) return false;
  return BUYER_PAIN_CONTEXT_TERMS.some((term) => normalized.includes(term));
}

function hasProfileInfo(profile) {
  return Boolean(profile?.name || profile?.company || profile?.bio || profile?.email);
}

function isBotLogin(login) {
  return /\[bot]$/i.test(String(login)) || /bot$/i.test(String(login));
}

function isIssueFollowUpAction(action) {
  return action.kind === "github_issue_search" || action.kind === "github_direct_pain_search";
}

function followUpIssueQueries(action) {
  return unique([
    action.query,
    ...(action.alternate_queries ?? []).map((alternate) => alternate.query)
  ].filter(Boolean));
}

function followUpIssueSearchPath({ query, issueSearchLimit }) {
  return `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${issueSearchLimit}`;
}

function followUpCodeSearchPath({ query, codeSearchLimit }) {
  return `/search/code?q=${encodeURIComponent(query)}&per_page=${codeSearchLimit}`;
}

async function fetchCodeSamples({ client, repo, login, codeFileLimit }) {
  const branch = repo.default_branch ?? "main";
  const tree = await client.getJson(
    `/repos/${encodeURIComponent(repo.full_name).replace("%2F", "/")}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { optional: true }
  );
  if (!Array.isArray(tree?.tree)) return [];

  const candidates = tree.tree
    .filter((entry) => entry.type === "blob" && entry.url && isHighSignalCodePath(entry.path, entry.size))
    .map((entry) => ({
      ...entry,
      code_path_score: codePathScore(entry.path)
    }))
    .sort((left, right) => right.code_path_score - left.code_path_score)
    .slice(0, codeFileLimit);

  const activities = [];
  for (const candidate of candidates) {
    const blob = await client.getJson(apiPathFromUrl(candidate.url), { optional: true });
    const text = decodeBlob(blob);
    if (!text || !looksLikeUsefulCodeSignal(text)) continue;
    activities.push(activityFromCodeSample({ repo, login, path: candidate.path, text }));
  }
  return activities;
}

function issueSearchPaths({ login, days, now }) {
  const since = formatDate(new Date(now.getTime() - days * 86_400_000));
  return ["is:issue", "is:pull-request"].map((qualifier) => {
    const query = `involves:${login} ${qualifier} updated:>=${since}`;
    return `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=50`;
  });
}

async function fetchCodeSearchActivities({ client, login, codeSearchPatterns, codeSearchLanguages, codeSearchLimit }) {
  const activities = [];
  for (const pattern of codeSearchPatterns) {
    for (const language of codeSearchLanguages) {
      const searchResults = await client.getJson(codeSearchPath({ login, pattern, language, codeSearchLimit }), {
        optional: true
      });
      if (!Array.isArray(searchResults?.items)) continue;

      for (const item of searchResults.items) {
        if (!isHighSignalCodePath(item.path)) continue;
        const file = await client.getJson(apiPathFromUrl(item.url), { optional: true });
        const text = decodeBlob(file);
        if (!text || !looksLikeUsefulCodeSignal(text)) continue;
        activities.push(activityFromCodeSearchItem({ item, file, text, login }));
      }
    }
  }
  return activities;
}

function codeSearchPath({ login, pattern, language, codeSearchLimit }) {
  const query = `${pattern} user:${login} language:${language}`;
  return `/search/code?q=${encodeURIComponent(query)}&per_page=${codeSearchLimit}`;
}

function githubClient({ token, fetchImpl }) {
  return {
    async getJson(path, { optional = false } = {}) {
      const response = await fetchImpl(`${API_ROOT}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        if (optional && [401, 403, 404, 409, 422].includes(response.status)) return null;
        const body = typeof response.text === "function" ? await response.text() : "";
        throw new Error(`GitHub request failed ${response.status} for ${path}: ${body.slice(0, 180)}`);
      }

      return response.json();
    }
  };
}

function activitiesFromEvent(event, fallbackLogin) {
  const login = event.actor?.login ?? fallbackLogin;
  const repo = event.repo?.name;
  const occurredAt = event.created_at;

  if (event.type === "IssueCommentEvent") {
    return [
      {
        login,
        type: "comment",
        repo,
        title: event.payload?.issue?.title ?? "Issue comment",
        text: event.payload?.comment?.body ?? "",
        url: event.payload?.comment?.html_url ?? event.payload?.issue?.html_url,
        occurred_at: event.payload?.comment?.created_at ?? occurredAt,
        source: "github_public_event"
      }
    ];
  }

  if (event.type === "IssuesEvent") {
    return [
      {
        login,
        type: "issue",
        repo,
        title: event.payload?.issue?.title ?? "Issue",
        text: event.payload?.issue?.body ?? "",
        url: event.payload?.issue?.html_url,
        occurred_at: event.payload?.issue?.created_at ?? occurredAt,
        source: "github_public_event"
      }
    ];
  }

  if (event.type === "PullRequestEvent") {
    return [
      {
        login,
        type: "pull_request",
        repo,
        title: event.payload?.pull_request?.title ?? "Pull request",
        text: event.payload?.pull_request?.body ?? "",
        url: event.payload?.pull_request?.html_url,
        occurred_at: event.payload?.pull_request?.created_at ?? occurredAt,
        source: "github_public_event"
      }
    ];
  }

  if (event.type === "PullRequestReviewEvent") {
    return [
      {
        login,
        type: "review",
        repo,
        title: event.payload?.pull_request?.title ?? "Pull request review",
        text: event.payload?.review?.body ?? "",
        url: event.payload?.review?.html_url ?? event.payload?.pull_request?.html_url,
        occurred_at: event.payload?.review?.submitted_at ?? occurredAt,
        source: "github_public_event"
      }
    ];
  }

  if (event.type === "PullRequestReviewCommentEvent") {
    return [
      {
        login,
        type: "review_comment",
        repo,
        title: event.payload?.pull_request?.title ?? "Pull request review comment",
        text: event.payload?.comment?.body ?? "",
        url: event.payload?.comment?.html_url ?? event.payload?.pull_request?.html_url,
        occurred_at: event.payload?.comment?.created_at ?? occurredAt,
        source: "github_public_event"
      }
    ];
  }

  if (event.type === "PushEvent") {
    return (event.payload?.commits ?? []).map((commit) => ({
      login,
      type: "commit",
      repo,
      title: commit.message?.split("\n")[0] ?? "Commit",
      text: commit.message ?? "",
      url: commit.sha && repo ? `https://github.com/${repo}/commit/${commit.sha}` : undefined,
      occurred_at: occurredAt,
      source: "github_public_event"
    }));
  }

  if (event.type === "WatchEvent" && event.payload?.action === "started") {
    return [
      {
        login,
        type: "star",
        repo,
        title: `Starred ${repo}`,
        text: `Starred ${repo}`,
        url: repo ? `https://github.com/${repo}` : undefined,
        occurred_at: occurredAt,
        source: "github_public_event"
      }
    ];
  }

  return [];
}

function activityFromRepo(repo, login) {
  return {
    login,
    type: "repo",
    repo: repo.full_name,
    title: repo.full_name,
    text: [repo.description, repo.language, (repo.topics ?? []).join(" ")].filter(Boolean).join(" "),
    url: repo.html_url,
    occurred_at: repo.updated_at,
    source: "github_user_repo"
  };
}

function activityFromIssueSearchItem(item, login, source = "github_issue_search") {
  return {
    login,
    type: item.pull_request ? "pull_request" : "issue",
    repo: repoFromRepositoryUrl(item.repository_url),
    title: item.title ?? "",
    text: item.body ?? "",
    url: item.html_url,
    occurred_at: item.updated_at ?? item.created_at,
    source
  };
}

function activityFromIssueComment({ item, comment, login, source }) {
  return {
    login,
    type: "comment",
    repo: repoFromRepositoryUrl(item.repository_url),
    title: item.title ?? "Issue comment",
    text: comment.body ?? "",
    url: comment.html_url,
    occurred_at: comment.updated_at ?? comment.created_at ?? item.updated_at ?? item.created_at,
    source
  };
}

function activityFromManifest({ manifest, repo, login, manifestPath }) {
  return {
    login,
    type: "manifest",
    repo: repo.full_name,
    path: manifest.path ?? manifestPath,
    title: manifest.path ?? manifestPath,
    text: decodeBase64(manifest.content),
    url: manifest.html_url ?? `${repo.html_url}/blob/HEAD/${manifestPath}`,
    occurred_at: repo.updated_at,
    source: "github_repo_manifest"
  };
}

function activityFromCodeSample({ repo, login, path, text }) {
  return {
    login,
    type: "code",
    repo: repo.full_name,
    path,
    title: path,
    text: compactCode(text),
    url: `${repo.html_url}/blob/${repo.default_branch ?? "main"}/${path}`,
    occurred_at: repo.updated_at,
    source: "github_repo_code_sample"
  };
}

function activityFromCodeSearchItem({ item, file, text, login, source = "github_code_search" }) {
  return {
    login,
    type: "code",
    repo: item.repository?.full_name ?? repoFromRepositoryUrl(file?.repository_url),
    path: file?.path ?? item.path,
    title: file?.path ?? item.path,
    text: compactCode(text),
    url: file?.html_url ?? item.html_url,
    occurred_at: "",
    source
  };
}

function decodeBase64(content) {
  return Buffer.from(String(content).replace(/\s/g, ""), "base64").toString("utf8");
}

function decodeBlob(blob) {
  if (!blob?.content) return "";
  if (blob.encoding && blob.encoding !== "base64") return "";
  return decodeBase64(blob.content);
}

function isHighSignalCodePath(filePath, size = 0) {
  const normalized = String(filePath ?? "").toLowerCase();
  if (!/\.(tsx?|jsx?|mts|cts)$/.test(normalized)) return false;
  if (size && size > 80_000) return false;
  if (
    normalized.includes("__tests__") ||
    normalized.includes(".test.") ||
    normalized.includes(".spec.") ||
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.includes("readme") ||
    normalized.includes("docs/")
  ) {
    return false;
  }
  return codePathScore(normalized) > 0;
}

function codePathScore(filePath) {
  const normalized = String(filePath ?? "").toLowerCase();
  let score = 0;
  for (const term of ["api", "backend", "cache", "hooks", "lib", "mutation", "query", "realtime", "server", "socket", "sync", "websocket"]) {
    if (normalized.includes(term)) score += 1;
  }
  if (normalized.includes("src/")) score += 0.5;
  return score;
}

function looksLikeUsefulCodeSignal(text) {
  const normalized = String(text ?? "").toLowerCase();
  return [
    "fetch(",
    "invalidatequeries",
    "onmessage",
    "optimistic",
    "queryclient",
    "refetch",
    "socket.on",
    "useeffect",
    "websocket",
    "websocket("
  ].some((term) => normalized.includes(term));
}

function compactCode(text, maxLength = 2500) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function compactText(text, maxLength = 260) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function dedupeActivities(activities) {
  const seen = new Set();
  const uniqueActivities = [];
  for (const activity of activities) {
    if (!activity.url) continue;
    const key = `${activity.login}:${activity.type}:${activity.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueActivities.push(activity);
  }
  return uniqueActivities;
}

function unique(items) {
  return [...new Set(items)];
}

function repoFromRepositoryUrl(url) {
  const match = String(url ?? "").match(/\/repos\/([^/]+\/[^/]+)$/);
  return match?.[1] ?? "";
}

function apiPathFromUrl(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
