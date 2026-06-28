const GITHUB_API = "https://api.github.com";

export async function harvestFromGitHub({ recipe, days, limit, maxUsers = 100, now = new Date(), token = process.env.GITHUB_TOKEN }) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const seeds = recipe.seedRepos.slice(0, limit ?? recipe.seedRepos.length);
  const raw = {
    now: now.toISOString(),
    repos: [],
    pull_requests: [],
    issues: [],
    comments: [],
    commits: [],
    users: []
  };
  const actors = new Set();

  for (const fullName of seeds) {
    const [owner, repo] = fullName.split("/");
    const repoRecord = await fetchRepo(owner, repo, token);
    raw.repos.push(repoRecord);
    actors.add(repoRecord.owner_login);

    const pulls = await listPullRequests(owner, repo, since, token);
    raw.pull_requests.push(...pulls);
    for (const pull of pulls) actors.add(pull.author_login);

    const issues = await listIssues(owner, repo, since, token);
    raw.issues.push(...issues);
    for (const issue of issues) actors.add(issue.author_login);

    const comments = await listIssueComments(owner, repo, since, token);
    raw.comments.push(...comments);
    for (const comment of comments) actors.add(comment.author_login);

    const commits = await listCommits(owner, repo, since, token);
    raw.commits.push(...commits);
    for (const commit of commits) {
      if (commit.author_login) actors.add(commit.author_login);
    }
  }

  for (const login of [...actors].filter(Boolean).sort().slice(0, maxUsers)) {
    const user = await fetchUser(login, token).catch(() => null);
    if (user) raw.users.push(user);
  }

  return raw;
}

async function fetchRepo(owner, repo, token) {
  const data = await requestJson(`/repos/${owner}/${repo}`, token);
  const readme = await requestText(`/repos/${owner}/${repo}/readme`, token, {
    accept: "application/vnd.github.raw"
  }).catch(() => null);

  return {
    full_name: data.full_name,
    owner_login: data.owner.login,
    owner_type: data.owner.type,
    description: data.description,
    topics: data.topics ?? [],
    language: data.language,
    stars: data.stargazers_count,
    forks: data.forks_count,
    is_fork: data.fork,
    is_archived: data.archived,
    pushed_at: data.pushed_at,
    html_url: data.html_url,
    readme: readme ? readme.slice(0, 20000) : null
  };
}

async function listPullRequests(owner, repo, since, token) {
  const rows = await paginate(`/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`, token);
  return rows
    .filter((pull) => new Date(pull.updated_at) >= new Date(since))
    .map((pull) => ({
      repo: `${owner}/${repo}`,
      number: pull.number,
      author_login: pull.user?.login ?? null,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      created_at: pull.created_at,
      updated_at: pull.updated_at,
      merged_at: pull.merged_at,
      changed_files: [],
      html_url: pull.html_url
    }));
}

async function listIssues(owner, repo, since, token) {
  const rows = await paginate(`/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&since=${encodeURIComponent(since)}&per_page=100`, token);
  return rows
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      repo: `${owner}/${repo}`,
      number: issue.number,
      author_login: issue.user?.login ?? null,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      html_url: issue.html_url
    }));
}

async function listIssueComments(owner, repo, since, token) {
  const rows = await paginate(`/repos/${owner}/${repo}/issues/comments?since=${encodeURIComponent(since)}&per_page=100`, token);
  return rows.map((comment) => ({
    repo: `${owner}/${repo}`,
    issue_number: issueNumberFromUrl(comment.issue_url),
    author_login: comment.user?.login ?? null,
    body: comment.body,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    html_url: comment.html_url
  }));
}

async function listCommits(owner, repo, since, token) {
  const rows = await paginate(`/repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&per_page=100`, token);
  return rows.map((commit) => ({
    repo: `${owner}/${repo}`,
    sha: commit.sha,
    author_login: commit.author?.login ?? null,
    message: commit.commit?.message ?? "",
    committed_at: commit.commit?.committer?.date ?? commit.commit?.author?.date,
    changed_files: [],
    html_url: commit.html_url
  }));
}

async function fetchUser(login, token) {
  const user = await requestJson(`/users/${login}`, token);
  return {
    login: user.login,
    type: user.type,
    name: user.name,
    company: user.company,
    location: user.location,
    blog: user.blog,
    email: user.email,
    bio: user.bio,
    public_repos: user.public_repos,
    followers: user.followers,
    html_url: user.html_url
  };
}

export async function paginate(path, token) {
  const rows = [];
  let nextPath = path;
  for (let page = 0; page < 3 && nextPath; page += 1) {
    let data;
    try {
      data = await requestJson(`${nextPath}${nextPath.includes("?") ? "&" : "?"}page=${page + 1}`, token);
    } catch (error) {
      if (rows.length > 0 && (error.status === 403 || error.status === 429)) {
        break;
      }
      throw error;
    }
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < 100) break;
  }
  return rows;
}

async function requestJson(path, token) {
  const response = await request(path, token, { accept: "application/vnd.github+json" });
  if (!response.ok) {
    const error = new Error(`GitHub request failed ${response.status} for ${path}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function requestText(path, token, options) {
  const response = await request(path, token, options);
  if (!response.ok) {
    throw new Error(`GitHub request failed ${response.status} for ${path}`);
  }
  return response.text();
}

async function request(path, token, { accept }) {
  const headers = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "neural-github-intent-hackathon"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${GITHUB_API}${path}`, { headers });
}

function issueNumberFromUrl(url) {
  return Number(String(url).split("/").at(-1));
}
