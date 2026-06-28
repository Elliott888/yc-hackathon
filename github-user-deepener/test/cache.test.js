import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchUserDeepActivityCached } from "../src/cache.js";

test("fetchUserDeepActivityCached reuses fresh per-user cache and fetches only missing users", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "github-user-deepener-"));
  await writeFile(
    path.join(cacheDir, "cached-user.json"),
    JSON.stringify({
      fetched_at: "2026-06-28T10:00:00.000Z",
      activities: [
        {
          login: "cached-user",
          type: "issue",
          repo: "supabase/supabase",
          title: "Cached realtime issue",
          url: "https://github.com/supabase/supabase/issues/1",
          occurred_at: "2026-06-27T10:00:00.000Z"
        }
      ]
    })
  );

  const fetchedLogins = [];
  const result = await fetchUserDeepActivityCached({
    logins: ["cached-user", "fresh-user"],
    cacheDir,
    now: new Date("2026-06-28T12:00:00.000Z"),
    ttlHours: 24,
    fetchUserDeepActivityImpl: async ({ logins }) => {
      fetchedLogins.push(...logins);
      return [
        {
          login: "fresh-user",
          type: "issue",
          repo: "firebase/firebase-js-sdk",
          title: "Fresh Firestore cache issue",
          url: "https://github.com/firebase/firebase-js-sdk/issues/2",
          occurred_at: "2026-06-28T11:00:00.000Z"
        }
      ];
    }
  });

  assert.deepEqual(fetchedLogins, ["fresh-user"]);
  assert.equal(result.activities.length, 2);
  assert.deepEqual(result.cache_report, {
    hits: 1,
    misses: 1,
    stale: 0,
    writes: 1
  });

  const written = JSON.parse(await readFile(path.join(cacheDir, "fresh-user.json"), "utf8"));
  assert.equal(written.activities[0].title, "Fresh Firestore cache issue");
});

test("fetchUserDeepActivityCached refreshes stale cache entries", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "github-user-deepener-"));
  await writeFile(
    path.join(cacheDir, "stale-user.json"),
    JSON.stringify({
      fetched_at: "2026-06-20T10:00:00.000Z",
      activities: [
        {
          login: "stale-user",
          type: "issue",
          title: "Old issue",
          url: "https://github.com/example/old/issues/1"
        }
      ]
    })
  );

  const result = await fetchUserDeepActivityCached({
    logins: ["stale-user"],
    cacheDir,
    now: new Date("2026-06-28T12:00:00.000Z"),
    ttlHours: 24,
    fetchUserDeepActivityImpl: async () => [
      {
        login: "stale-user",
        type: "issue",
        repo: "supabase/supabase",
        title: "New realtime issue",
        url: "https://github.com/supabase/supabase/issues/3",
        occurred_at: "2026-06-28T11:00:00.000Z"
      }
    ]
  });

  assert.equal(result.cache_report.hits, 0);
  assert.equal(result.cache_report.stale, 1);
  assert.equal(result.cache_report.writes, 1);
  assert.equal(result.activities[0].title, "New realtime issue");
});

test("fetchUserDeepActivityCached can return cache hits when a refresh is rate limited", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "github-user-deepener-"));
  await writeFile(
    path.join(cacheDir, "cached-user.json"),
    JSON.stringify({
      fetched_at: "2026-06-28T10:00:00.000Z",
      activities: [
        {
          login: "cached-user",
          type: "issue",
          title: "Cached issue",
          url: "https://github.com/example/cached/issues/1"
        }
      ]
    })
  );

  const result = await fetchUserDeepActivityCached({
    logins: ["cached-user", "rate-limited-user"],
    cacheDir,
    now: new Date("2026-06-28T12:00:00.000Z"),
    ttlHours: 24,
    allowPartialOnFetchError: true,
    fetchUserDeepActivityImpl: async () => {
      throw new Error("GitHub request failed 403: rate limit exceeded");
    }
  });

  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].login, "cached-user");
  assert.equal(result.cache_report.hits, 1);
  assert.equal(result.cache_report.misses, 1);
  assert.equal(result.cache_report.fetch_errors.length, 1);
  assert.match(result.cache_report.fetch_errors[0], /rate limit/i);
});

test("fetchUserDeepActivityCached keeps per-user successes when one live refresh fails", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "github-user-deepener-"));
  const calls = [];

  const result = await fetchUserDeepActivityCached({
    logins: ["first-user", "rate-limited-user", "third-user"],
    cacheDir,
    now: new Date("2026-06-28T12:00:00.000Z"),
    ttlHours: 24,
    allowPartialOnFetchError: true,
    fetchUserDeepActivityImpl: async ({ logins }) => {
      calls.push(logins);
      const login = logins[0];
      if (login === "rate-limited-user") {
        throw new Error("GitHub request failed 403: rate limit exceeded for rate-limited-user");
      }
      return [
        {
          login,
          type: "issue",
          repo: "supabase/supabase",
          title: `${login} realtime issue`,
          url: `https://github.com/example/${login}/issues/1`
        }
      ];
    }
  });

  assert.deepEqual(calls, [["first-user"], ["rate-limited-user"], ["third-user"]]);
  assert.equal(result.activities.length, 2);
  assert.deepEqual(
    result.activities.map((activity) => activity.login),
    ["first-user", "third-user"]
  );
  assert.equal(result.cache_report.misses, 3);
  assert.equal(result.cache_report.writes, 2);
  assert.equal(result.cache_report.fetch_errors.length, 1);
  assert.match(result.cache_report.fetch_errors[0], /rate-limited-user/);

  const firstWritten = JSON.parse(await readFile(path.join(cacheDir, "first-user.json"), "utf8"));
  const thirdWritten = JSON.parse(await readFile(path.join(cacheDir, "third-user.json"), "utf8"));
  assert.equal(firstWritten.activities[0].login, "first-user");
  assert.equal(thirdWritten.activities[0].login, "third-user");
});
