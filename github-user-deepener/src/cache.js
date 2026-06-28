import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function fetchUserDeepActivityCached({
  logins,
  cacheDir,
  now = new Date(),
  ttlHours = 24,
  fetchUserDeepActivityImpl,
  allowPartialOnFetchError = false,
  ...fetchOptions
}) {
  if (!Array.isArray(logins)) {
    throw new Error("logins must be an array");
  }
  if (!cacheDir) {
    throw new Error("cacheDir is required");
  }
  if (typeof fetchUserDeepActivityImpl !== "function") {
    throw new Error("fetchUserDeepActivityImpl is required");
  }

  await mkdir(cacheDir, { recursive: true });

  const activities = [];
  const loginsToFetch = [];
  const cacheReport = {
    hits: 0,
    misses: 0,
    stale: 0,
    writes: 0
  };

  for (const login of unique(logins.filter(Boolean))) {
    const cached = await readCacheEntry(cacheDir, login);
    if (!cached) {
      cacheReport.misses += 1;
      loginsToFetch.push(login);
      continue;
    }

    if (isFresh(cached.fetched_at, now, ttlHours)) {
      cacheReport.hits += 1;
      activities.push(...withLogin(cached.activities ?? [], login));
    } else {
      cacheReport.stale += 1;
      loginsToFetch.push(login);
    }
  }

  if (loginsToFetch.length > 0) {
    const fetchErrors = [];
    for (const login of loginsToFetch) {
      let fetchedActivities;
      try {
        fetchedActivities = await fetchUserDeepActivityImpl({
          logins: [login],
          ...fetchOptions
        });
      } catch (error) {
        if (!allowPartialOnFetchError) throw error;
        fetchErrors.push(`${login}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const byLogin = groupByLogin(fetchedActivities);
      const loginActivities = byLogin.get(normalizeLogin(login)) ?? [];
      activities.push(...loginActivities);
      await writeCacheEntry(cacheDir, login, {
        fetched_at: now.toISOString(),
        activities: loginActivities
      });
      cacheReport.writes += 1;
    }
    if (fetchErrors.length > 0) {
      cacheReport.fetch_errors = fetchErrors;
    }
  }

  return {
    activities,
    cache_report: cacheReport
  };
}

async function readCacheEntry(cacheDir, login) {
  try {
    return JSON.parse(await readFile(cachePath(cacheDir, login), "utf8"));
  } catch {
    return null;
  }
}

async function writeCacheEntry(cacheDir, login, entry) {
  await writeFile(cachePath(cacheDir, login), JSON.stringify(entry, null, 2));
}

function cachePath(cacheDir, login) {
  return path.join(cacheDir, `${encodeURIComponent(normalizeLogin(login))}.json`);
}

function isFresh(fetchedAt, now, ttlHours) {
  const timestamp = new Date(fetchedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now.getTime() - timestamp <= ttlHours * 3_600_000;
}

function groupByLogin(activities) {
  const grouped = new Map();
  for (const activity of activities ?? []) {
    const login = normalizeLogin(activity.login);
    grouped.set(login, [...(grouped.get(login) ?? []), activity]);
  }
  return grouped;
}

function withLogin(activities, login) {
  return activities.map((activity) => ({
    ...activity,
    login: activity.login ?? login
  }));
}

function unique(items) {
  return [...new Set(items)];
}

function normalizeLogin(value) {
  return String(value ?? "").toLowerCase();
}
