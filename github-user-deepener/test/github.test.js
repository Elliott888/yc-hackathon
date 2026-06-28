import assert from "node:assert/strict";
import test from "node:test";
import { fetchDirectPainLeads, fetchFollowUpActivities, fetchUserDeepActivity } from "../src/github.js";

test("fetchUserDeepActivity normalizes public user events and recent repo manifests", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    if (url.endsWith("/users/alice/events/public?per_page=100")) {
      return jsonResponse([
        {
          type: "IssueCommentEvent",
          actor: { login: "alice" },
          repo: { name: "vendor/realtime-lib" },
          created_at: "2026-06-27T12:00:00Z",
          payload: {
            issue: {
              title: "Subscription callbacks stop after reconnect",
              html_url: "https://github.com/vendor/realtime-lib/issues/9"
            },
            comment: {
              body: "In our app, users stop receiving shared state updates after reconnect.",
              html_url: "https://github.com/vendor/realtime-lib/issues/9#issuecomment-1",
              created_at: "2026-06-27T12:00:00Z"
            }
          }
        },
        {
          type: "PushEvent",
          actor: { login: "alice" },
          repo: { name: "alice/app" },
          created_at: "2026-06-26T12:00:00Z",
          payload: {
            commits: [
              {
                sha: "abc123",
                message: "Add manual cache invalidation after websocket event"
              }
            ]
          }
        },
        {
          type: "WatchEvent",
          actor: { login: "alice" },
          repo: { name: "supabase/supabase" },
          created_at: "2026-06-25T12:00:00Z",
          payload: { action: "started" }
        }
      ]);
    }

    if (url.endsWith("/users/alice/repos?sort=updated&direction=desc&per_page=2")) {
      return jsonResponse([
        {
          full_name: "alice/app",
          html_url: "https://github.com/alice/app",
          fork: false,
          archived: false,
          updated_at: "2026-06-26T12:00:00Z"
        }
      ]);
    }

    if (url.endsWith("/repos/alice/app/contents/package.json")) {
      return jsonResponse({
        path: "package.json",
        html_url: "https://github.com/alice/app/blob/main/package.json",
        content: Buffer.from(
          JSON.stringify({
            dependencies: {
              "@supabase/supabase-js": "latest",
              "@tanstack/react-query": "latest",
              ws: "latest"
            }
          })
        ).toString("base64")
      });
    }

    return jsonResponse({ message: "not found" }, 404);
  };

  const activities = await fetchUserDeepActivity({
    logins: ["alice"],
    token: "test-token",
    fetchImpl,
    repoLimit: 2,
    manifestPaths: ["package.json"]
  });

  assert.ok(calls.every((call) => call.authorization === "Bearer test-token"));
  assert.deepEqual(
    activities.map((activity) => activity.type).sort(),
    ["comment", "commit", "manifest", "repo", "star"]
  );
  assert.ok(activities.some((activity) => activity.url.includes("#issuecomment-1")));
  assert.ok(activities.some((activity) => activity.text.includes("manual cache invalidation")));
  assert.ok(activities.some((activity) => activity.path === "package.json" && activity.text.includes("supabase-js")));
});

test("fetchUserDeepActivity can add involved issue and pull request search results for the user", async () => {
  const searchQueries = [];
  const fetchImpl = async (url) => {
    if (url.includes("/events/public")) return jsonResponse([]);
    if (url.includes("/repos?sort=updated")) return jsonResponse([]);
    if (url.includes("/search/issues?")) {
      const query = decodeURIComponent(new URL(url).searchParams.get("q"));
      searchQueries.push(query);
      if (query.includes("is:issue")) {
        return jsonResponse({
          items: [
            {
              title: "Realtime sync callbacks never resume after tab sleep",
              body: "Users stop seeing shared state updates after reconnect.",
              html_url: "https://github.com/acme/app/issues/12",
              repository_url: "https://api.github.com/repos/acme/app",
              updated_at: "2026-06-27T12:00:00Z"
            }
          ]
        });
      }
      if (query.includes("is:pull-request")) {
        return jsonResponse({
          items: [
            {
              title: "Replace manual websocket invalidation path",
              body: "This PR removes a custom cache invalidation path.",
              html_url: "https://github.com/acme/app/pull/13",
              repository_url: "https://api.github.com/repos/acme/app",
              pull_request: {},
              updated_at: "2026-06-26T12:00:00Z"
            }
          ]
        });
      }
      return jsonResponse({
        items: []
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  };

  const activities = await fetchUserDeepActivity({
    logins: ["alice"],
    fetchImpl,
    includeIssueSearch: true,
    repoLimit: 0,
    now: new Date("2026-06-28T12:00:00Z")
  });

  assert.deepEqual(
    activities.map((activity) => activity.type).sort(),
    ["issue", "pull_request"]
  );
  assert.ok(activities.every((activity) => activity.source === "github_issue_search"));
  assert.ok(activities[0].repo === "acme/app");
  assert.deepEqual(searchQueries, [
    "involves:alice is:issue updated:>=2026-03-30",
    "involves:alice is:pull-request updated:>=2026-03-30"
  ]);
});

test("fetchUserDeepActivity samples high-signal code files from recent user repos", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.includes("/events/public")) return jsonResponse([]);
    if (url.includes("/search/issues?")) return jsonResponse({ items: [] });
    if (url.endsWith("/users/alice/repos?sort=updated&direction=desc&per_page=1")) {
      return jsonResponse([
        {
          full_name: "alice/app",
          html_url: "https://github.com/alice/app",
          fork: false,
          archived: false,
          default_branch: "main",
          updated_at: "2026-06-27T12:00:00Z"
        }
      ]);
    }
    if (url.endsWith("/repos/alice/app/contents/package.json")) {
      return jsonResponse({ message: "not found" }, 404);
    }
    if (url.endsWith("/repos/alice/app/git/trees/main?recursive=1")) {
      return jsonResponse({
        tree: [
          {
            path: "src/hooks/useTasks.ts",
            type: "blob",
            size: 2400,
            url: "https://api.github.com/repos/alice/app/git/blobs/code-1"
          },
          {
            path: "README.md",
            type: "blob",
            size: 1000,
            url: "https://api.github.com/repos/alice/app/git/blobs/readme"
          },
          {
            path: "src/hooks/useTasks.test.ts",
            type: "blob",
            size: 1100,
            url: "https://api.github.com/repos/alice/app/git/blobs/test"
          }
        ]
      });
    }
    if (url.endsWith("/repos/alice/app/git/blobs/code-1")) {
      return jsonResponse({
        encoding: "base64",
        content: Buffer.from(
          "useEffect(() => { fetch('/api/tasks').then(load); }, [teamId]); queryClient.invalidateQueries(['tasks']); socket.on('task:update', refetch);"
        ).toString("base64")
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  };

  const activities = await fetchUserDeepActivity({
    logins: ["alice"],
    fetchImpl,
    repoLimit: 1,
    manifestPaths: ["package.json"],
    includeCodeSamples: true,
    codeFileLimit: 2
  });

  const codeActivities = activities.filter((activity) => activity.type === "code");
  assert.equal(codeActivities.length, 1);
  assert.equal(codeActivities[0].path, "src/hooks/useTasks.ts");
  assert.equal(codeActivities[0].source, "github_repo_code_sample");
  assert.ok(codeActivities[0].text.includes("queryClient.invalidateQueries"));
  assert.ok(requestedUrls.some((url) => url.includes("/git/trees/main?recursive=1")));
  assert.equal(requestedUrls.some((url) => url.endsWith("/git/blobs/test")), false);
});

test("fetchUserDeepActivity skips empty repository trees during optional code sampling", async () => {
  const activities = await fetchUserDeepActivity({
    logins: ["alice"],
    fetchImpl: async (url) => {
      if (url.includes("/events/public")) return jsonResponse([]);
      if (url.includes("/search/issues?")) return jsonResponse({ items: [] });
      if (url.endsWith("/users/alice/repos?sort=updated&direction=desc&per_page=1")) {
        return jsonResponse([
          {
            full_name: "alice/empty-repo",
            html_url: "https://github.com/alice/empty-repo",
            fork: false,
            archived: false,
            default_branch: "main",
            updated_at: "2026-06-27T12:00:00Z"
          }
        ]);
      }
      if (url.endsWith("/repos/alice/empty-repo/contents/package.json")) {
        return jsonResponse({ message: "not found" }, 404);
      }
      if (url.endsWith("/repos/alice/empty-repo/git/trees/main?recursive=1")) {
        return jsonResponse({ message: "Git Repository is empty." }, 409);
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    repoLimit: 1,
    manifestPaths: ["package.json"],
    includeCodeSamples: true,
    codeFileLimit: 2
  });

  assert.deepEqual(
    activities.map((activity) => activity.type),
    ["repo"]
  );
});

test("fetchUserDeepActivity can use GitHub code search to find user-owned code manifestations", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.includes("/events/public")) return jsonResponse([]);
    if (url.includes("/search/issues?")) return jsonResponse({ items: [] });
    if (url.includes("/users/alice/repos?")) return jsonResponse([]);
    if (url.includes("/search/code?")) {
      const decoded = decodeURIComponent(url);
      assert.ok(decoded.includes("user:alice"));
      if (decoded.includes("queryClient.invalidateQueries")) {
        return jsonResponse({
          items: [
            {
              path: "src/features/tasks/useTasks.ts",
              html_url: "https://github.com/alice/app/blob/main/src/features/tasks/useTasks.ts",
              url: "https://api.github.com/repos/alice/app/contents/src/features/tasks/useTasks.ts?ref=main",
              repository: {
                full_name: "alice/app"
              }
            },
            {
              path: "src/features/tasks/useTasks.test.ts",
              html_url: "https://github.com/alice/app/blob/main/src/features/tasks/useTasks.test.ts",
              url: "https://api.github.com/repos/alice/app/contents/src/features/tasks/useTasks.test.ts?ref=main",
              repository: {
                full_name: "alice/app"
              }
            }
          ]
        });
      }
      return jsonResponse({ items: [] });
    }
    if (url.endsWith("/repos/alice/app/contents/src/features/tasks/useTasks.ts?ref=main")) {
      return jsonResponse({
        path: "src/features/tasks/useTasks.ts",
        html_url: "https://github.com/alice/app/blob/main/src/features/tasks/useTasks.ts",
        content: Buffer.from(
          "export function useTasks(queryClient, socket) { socket.on('task:update', () => queryClient.invalidateQueries(['tasks'])); }"
        ).toString("base64")
      });
    }
    if (url.endsWith("/repos/alice/app/contents/src/features/tasks/useTasks.test.ts?ref=main")) {
      return jsonResponse({
        path: "src/features/tasks/useTasks.test.ts",
        html_url: "https://github.com/alice/app/blob/main/src/features/tasks/useTasks.test.ts",
        content: Buffer.from("queryClient.invalidateQueries(['tasks']);").toString("base64")
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  };

  const activities = await fetchUserDeepActivity({
    logins: ["alice"],
    fetchImpl,
    repoLimit: 0,
    includeCodeSearch: true,
    codeSearchPatterns: ["queryClient.invalidateQueries"],
    codeSearchLimit: 3
  });

  const codeActivities = activities.filter((activity) => activity.source === "github_code_search");
  assert.equal(codeActivities.length, 1);
  assert.equal(codeActivities[0].type, "code");
  assert.equal(codeActivities[0].repo, "alice/app");
  assert.equal(codeActivities[0].path, "src/features/tasks/useTasks.ts");
  assert.ok(codeActivities[0].text.includes("socket.on"));
  assert.equal(requestedUrls.some((url) => url.includes("search/code")), true);
});

test("fetchUserDeepActivity skips optional code search when GitHub requires authentication", async () => {
  const activities = await fetchUserDeepActivity({
    logins: ["alice"],
    fetchImpl: async (url) => {
      if (url.includes("/users/alice/events/public")) {
        return jsonResponse([
          {
            type: "IssueCommentEvent",
            actor: { login: "alice" },
            repo: { name: "vendor/realtime-lib" },
            created_at: "2026-06-27T12:00:00Z",
            payload: {
              issue: {
                title: "Subscription callbacks stop after reconnect",
                html_url: "https://github.com/vendor/realtime-lib/issues/9"
              },
              comment: {
                body: "Users stop receiving shared state updates after reconnect.",
                html_url: "https://github.com/vendor/realtime-lib/issues/9#issuecomment-1",
                created_at: "2026-06-27T12:00:00Z"
              }
            }
          }
        ]);
      }
      if (url.includes("/search/issues?")) return jsonResponse({ items: [] });
      if (url.includes("/search/code?")) {
        return jsonResponse({ message: "Requires authentication" }, 401);
      }
      if (url.includes("/users/alice/repos?")) return jsonResponse([]);
      return jsonResponse({ message: "not found" }, 404);
    },
    repoLimit: 0,
    includeCodeSearch: true,
    codeSearchPatterns: ["queryClient.invalidateQueries"],
    codeSearchLimit: 2
  });

  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "comment");
  assert.equal(activities[0].repo, "vendor/realtime-lib");
});

test("fetchUserDeepActivity skips optional issue search when GitHub rejects a user search", async () => {
  const activities = await fetchUserDeepActivity({
    logins: ["missing-user"],
    fetchImpl: async (url) => {
      if (url.includes("/events/public")) return jsonResponse([]);
      if (url.includes("/search/issues?")) {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      if (url.includes("/users/missing-user/repos?")) return jsonResponse([]);
      return jsonResponse({ message: "not found" }, 404);
    },
    repoLimit: 0
  });

  assert.deepEqual(activities, []);
});

test("fetchUserDeepActivity searches code manifestations once per language instead of combining language filters", async () => {
  const searchQueries = [];
  const activities = await fetchUserDeepActivity({
    logins: ["alice"],
    fetchImpl: async (url) => {
      if (url.includes("/events/public")) return jsonResponse([]);
      if (url.includes("/search/issues?")) return jsonResponse({ items: [] });
      if (url.includes("/users/alice/repos?")) return jsonResponse([]);
      if (url.includes("/search/code?")) {
        const query = decodeURIComponent(new URL(url).searchParams.get("q"));
        searchQueries.push(query);
        if (query.includes("language:JavaScript")) {
          return jsonResponse({
            items: [
              {
                path: "src/realtime/socket.js",
                html_url: "https://github.com/alice/app/blob/main/src/realtime/socket.js",
                url: "https://api.github.com/repos/alice/app/contents/src/realtime/socket.js?ref=main",
                repository: {
                  full_name: "alice/app"
                }
              }
            ]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/repos/alice/app/contents/src/realtime/socket.js?ref=main")) {
        return jsonResponse({
          path: "src/realtime/socket.js",
          html_url: "https://github.com/alice/app/blob/main/src/realtime/socket.js",
          content: Buffer.from(
            "export const socket = new WebSocket(url); socket.onmessage = () => queryClient.invalidateQueries(['feed']);"
          ).toString("base64")
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    repoLimit: 0,
    includeCodeSearch: true,
    codeSearchPatterns: ["queryClient.invalidateQueries"],
    codeSearchLanguages: ["TypeScript", "JavaScript"],
    codeSearchLimit: 2
  });

  assert.ok(searchQueries.some((query) => query.includes("language:TypeScript")));
  assert.ok(searchQueries.some((query) => query.includes("language:JavaScript")));
  assert.equal(searchQueries.some((query) => query.includes("language:TypeScript language:JavaScript")), false);
  assert.equal(activities.filter((activity) => activity.source === "github_code_search").length, 1);
  assert.equal(activities.find((activity) => activity.source === "github_code_search").path, "src/realtime/socket.js");
});

test("fetchFollowUpActivities executes near-miss issue and code actions", async () => {
  const searchQueries = [];
  const activities = await fetchFollowUpActivities({
    nearMisses: [
      {
        engineer_login: "thin-lead",
        follow_up_actions: [
          {
            kind: "github_issue_search",
            query: "involves:thin-lead is:issue realtime websocket",
            alternate_queries: [
              {
                query: "involves:thin-lead is:pull-request realtime websocket"
              }
            ]
          },
          {
            kind: "github_user_code_harvest",
            query: "user:thin-lead queryClient.invalidateQueries websocket"
          }
        ]
      }
    ],
    fetchImpl: async (url) => {
      if (url.includes("/search/issues?")) {
        const query = decodeURIComponent(new URL(url).searchParams.get("q"));
        searchQueries.push(query);
        if (query.includes("is:issue")) {
          return jsonResponse({
            items: [
              {
                title: "Realtime sync callbacks never resume after reconnect",
                body: "Users stop seeing shared state updates after websocket reconnect.",
                html_url: "https://github.com/acme/app/issues/12",
                repository_url: "https://api.github.com/repos/acme/app",
                updated_at: "2026-06-27T12:00:00Z"
              }
            ]
          });
        }
        return jsonResponse({ items: [] });
      }

      if (url.includes("/search/code?")) {
        const query = decodeURIComponent(new URL(url).searchParams.get("q"));
        searchQueries.push(query);
        assert.ok(query.includes("user:thin-lead"));
        return jsonResponse({
          items: [
            {
              path: "src/realtime/useTasks.ts",
              html_url: "https://github.com/thin-lead/app/blob/main/src/realtime/useTasks.ts",
              url: "https://api.github.com/repos/thin-lead/app/contents/src/realtime/useTasks.ts?ref=main",
              repository: {
                full_name: "thin-lead/app"
              }
            }
          ]
        });
      }

      if (url.endsWith("/repos/thin-lead/app/contents/src/realtime/useTasks.ts?ref=main")) {
        return jsonResponse({
          path: "src/realtime/useTasks.ts",
          html_url: "https://github.com/thin-lead/app/blob/main/src/realtime/useTasks.ts",
          content: Buffer.from(
            "socket.on('task:update', () => queryClient.invalidateQueries(['tasks']));"
          ).toString("base64")
        });
      }

      return jsonResponse({ message: "not found" }, 404);
    },
    issueSearchLimit: 5,
    codeSearchLimit: 2
  });

  assert.ok(searchQueries.some((query) => query.includes("is:issue")));
  assert.ok(searchQueries.some((query) => query.includes("is:pull-request")));
  assert.ok(searchQueries.some((query) => query.includes("queryClient.invalidateQueries")));
  assert.equal(activities.length, 2);
  assert.equal(activities[0].login, "thin-lead");
  assert.equal(activities[0].source, "github_follow_up_issue_search");
  assert.equal(activities[0].url, "https://github.com/acme/app/issues/12");
  assert.equal(activities[1].source, "github_follow_up_code_search");
  assert.equal(activities[1].path, "src/realtime/useTasks.ts");
  assert.ok(activities[1].text.includes("queryClient.invalidateQueries"));
});

test("fetchFollowUpActivities captures same-user comments from issue search results", async () => {
  const requestedUrls = [];
  const activities = await fetchFollowUpActivities({
    nearMisses: [
      {
        engineer_login: "thin-lead",
        follow_up_actions: [
          {
            kind: "github_issue_search",
            query: "involves:thin-lead is:issue websocket reconnect"
          }
        ]
      }
    ],
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      if (url.includes("/search/issues?")) {
        return jsonResponse({
          items: [
            {
              title: "WebSocket reconnect loses dashboard state",
              body: "Maintainer reproduction issue.",
              html_url: "https://github.com/acme/realtime/issues/12",
              repository_url: "https://api.github.com/repos/acme/realtime",
              comments_url: "https://api.github.com/repos/acme/realtime/issues/12/comments",
              comments: 2,
              updated_at: "2026-06-27T12:00:00Z"
            }
          ]
        });
      }
      if (url.endsWith("/repos/acme/realtime/issues/12/comments?per_page=10")) {
        return jsonResponse([
          {
            body: "In our app every websocket reconnect leaves the dashboard cache stale until users refresh.",
            html_url: "https://github.com/acme/realtime/issues/12#issuecomment-1",
            created_at: "2026-06-27T12:01:00Z",
            updated_at: "2026-06-27T12:02:00Z",
            user: { login: "thin-lead" }
          },
          {
            body: "Can you share a reproduction?",
            html_url: "https://github.com/acme/realtime/issues/12#issuecomment-2",
            created_at: "2026-06-27T12:03:00Z",
            user: { login: "maintainer" }
          }
        ]);
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    issueSearchLimit: 1,
    issueCommentLimit: 10
  });

  assert.equal(requestedUrls.some((url) => url.includes("/issues/12/comments?per_page=10")), true);
  const commentActivity = activities.find((activity) => activity.source === "github_follow_up_issue_comment");
  assert.equal(commentActivity.login, "thin-lead");
  assert.equal(commentActivity.repo, "acme/realtime");
  assert.equal(commentActivity.title, "WebSocket reconnect loses dashboard state");
  assert.ok(commentActivity.text.includes("dashboard cache stale"));
  assert.equal(
    activities.some((activity) => activity.text === "Can you share a reproduction?"),
    false
  );
});

test("fetchFollowUpActivities broadens near-miss code harvest with default implementation patterns", async () => {
  const codeQueries = [];
  const activities = await fetchFollowUpActivities({
    nearMisses: [
      {
        engineer_login: "thin-lead",
        follow_up_actions: [
          {
            kind: "github_user_code_harvest",
            query: "user:thin-lead realtime websocket supabase"
          }
        ]
      }
    ],
    fetchImpl: async (url) => {
      if (url.includes("/search/code?")) {
        const query = decodeURIComponent(new URL(url).searchParams.get("q"));
        codeQueries.push(query);
        if (query === "queryClient.invalidateQueries user:thin-lead") {
          return jsonResponse({
            items: [
              {
                path: "src/cache/useProjectCache.ts",
                html_url: "https://github.com/thin-lead/app/blob/main/src/cache/useProjectCache.ts",
                url: "https://api.github.com/repos/thin-lead/app/contents/src/cache/useProjectCache.ts?ref=main",
                repository: { full_name: "thin-lead/app" }
              }
            ]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (url.endsWith("/repos/thin-lead/app/contents/src/cache/useProjectCache.ts?ref=main")) {
        return jsonResponse({
          path: "src/cache/useProjectCache.ts",
          html_url: "https://github.com/thin-lead/app/blob/main/src/cache/useProjectCache.ts",
          content: Buffer.from(
            "export function refresh(queryClient) { queryClient.invalidateQueries(['projects']); }"
          ).toString("base64")
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    codeSearchLimit: 2
  });

  assert.ok(codeQueries.includes("user:thin-lead realtime websocket supabase"));
  assert.ok(codeQueries.includes("queryClient.invalidateQueries user:thin-lead"));
  assert.ok(codeQueries.includes("new WebSocket user:thin-lead"));
  assert.equal(activities.length, 1);
  assert.equal(activities[0].source, "github_follow_up_code_search");
  assert.equal(activities[0].path, "src/cache/useProjectCache.ts");
});

test("fetchFollowUpActivities can run a broad user activity harvest for near misses", async () => {
  const requestedUrls = [];
  const activities = await fetchFollowUpActivities({
    nearMisses: [
      {
        engineer_login: "thin-lead",
        follow_up_actions: [
          {
            kind: "github_user_activity_harvest"
          }
        ]
      }
    ],
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      if (url.includes("/users/thin-lead/events/public")) {
        return jsonResponse([
          {
            type: "IssuesEvent",
            actor: { login: "thin-lead" },
            repo: { name: "acme/realtime" },
            created_at: "2026-06-27T12:00:00Z",
            payload: {
              issue: {
                title: "WebSocket reconnect leaves shared state stale",
                body: "Users need to refresh after reconnect.",
                html_url: "https://github.com/acme/realtime/issues/12",
                created_at: "2026-06-27T12:00:00Z"
              }
            }
          }
        ]);
      }
      if (url.includes("/search/issues?")) return jsonResponse({ items: [] });
      if (url.includes("/users/thin-lead/repos?")) {
        return jsonResponse([
          {
            full_name: "thin-lead/app",
            html_url: "https://github.com/thin-lead/app",
            description: "Realtime dashboard",
            language: "TypeScript",
            topics: ["websocket"],
            fork: false,
            archived: false,
            default_branch: "main",
            updated_at: "2026-06-27T12:00:00Z"
          }
        ]);
      }
      if (url.endsWith("/repos/thin-lead/app/contents/package.json")) {
        return jsonResponse({
          path: "package.json",
          html_url: "https://github.com/thin-lead/app/blob/main/package.json",
          content: Buffer.from(
            JSON.stringify({ dependencies: { "@tanstack/react-query": "^5.0.0", ws: "^8.0.0" } })
          ).toString("base64")
        });
      }
      if (url.includes("/repos/thin-lead/app/contents/")) {
        return jsonResponse({ message: "not found" }, 404);
      }
      if (url.endsWith("/repos/thin-lead/app/git/trees/main?recursive=1")) {
        return jsonResponse({ tree: [] });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    broadRepoLimit: 1,
    broadCodeFileLimit: 1
  });

  assert.equal(requestedUrls.some((url) => url.includes("/users/thin-lead/events/public")), true);
  assert.equal(requestedUrls.some((url) => url.includes("/users/thin-lead/repos?")), true);
  assert.equal(activities.some((activity) => activity.type === "issue"), true);
  assert.equal(activities.some((activity) => activity.type === "manifest"), true);
});

test("fetchDirectPainLeads discovers issue authors and same-user pain comments with profiles", async () => {
  const requestedUrls = [];
  const result = await fetchDirectPainLeads({
    query: "Find WebSocket reconnect and Firebase alternative pain",
    phrases: ['"WebSocket reconnect"'],
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      if (url.includes("/search/issues?")) {
        return jsonResponse({
          items: [
            {
              title: "WebSocket reconnect drops shared dashboard state",
              body: "Every reconnect leaves users with stale cache state until refresh.",
              html_url: "https://github.com/acme/realtime/issues/12",
              repository_url: "https://api.github.com/repos/acme/realtime",
              comments_url: "https://api.github.com/repos/acme/realtime/issues/12/comments",
              comments: 2,
              created_at: "2026-06-26T12:00:00Z",
              updated_at: "2026-06-27T12:00:00Z",
              user: { login: "alice-builder" }
            }
          ]
        });
      }
      if (url.endsWith("/repos/acme/realtime/issues/12/comments?per_page=10")) {
        return jsonResponse([
          {
            body: "We are looking for a Firebase alternative because our cache invalidation code is too much plumbing.",
            html_url: "https://github.com/acme/realtime/issues/12#issuecomment-1",
            created_at: "2026-06-27T12:01:00Z",
            user: { login: "bob-founder" }
          },
          {
            body: "Can you share logs?",
            html_url: "https://github.com/acme/realtime/issues/12#issuecomment-2",
            created_at: "2026-06-27T12:02:00Z",
            user: { login: "maintainer" }
          }
        ]);
      }
      if (url.endsWith("/users/alice-builder")) {
        return jsonResponse({
          login: "alice-builder",
          name: "Alice Builder",
          company: "Acme",
          html_url: "https://github.com/alice-builder"
        });
      }
      if (url.endsWith("/users/bob-founder")) {
        return jsonResponse({
          login: "bob-founder",
          name: "Bob Founder",
          bio: "Founder building realtime dashboards",
          html_url: "https://github.com/bob-founder"
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    now: new Date("2026-06-28T12:00:00Z"),
    days: 90,
    searchLimit: 1,
    issueCommentLimit: 10,
    leadLimit: 5
  });

  assert.equal(requestedUrls.some((url) => url.includes("/search/issues?")), true);
  assert.equal(requestedUrls.some((url) => url.includes("/issues/12/comments?per_page=10")), true);
  const byLogin = new Map(result.results.map((lead) => [lead.engineer_login, lead]));
  assert.deepEqual([...byLogin.keys()].sort(), ["alice-builder", "bob-founder"]);
  assert.equal(byLogin.get("alice-builder").name, "Alice Builder");
  assert.equal(byLogin.get("bob-founder").name, "Bob Founder");
  assert.equal(byLogin.get("alice-builder").trigger.url, "https://github.com/acme/realtime/issues/12");
  assert.equal(byLogin.get("bob-founder").trigger.url, "https://github.com/acme/realtime/issues/12#issuecomment-1");
  assert.ok(byLogin.get("bob-founder").pain_signal.includes("Firebase alternative"));
});

test("fetchDirectPainLeads rejects positioning-only alternative mentions", async () => {
  const result = await fetchDirectPainLeads({
    query: "Find Supabase alternative pain",
    phrases: ['"Supabase alternative"'],
    fetchImpl: async (url) => {
      if (url.includes("/search/issues?")) {
        return jsonResponse({
          items: [
            {
              title: "Marketing page SEO copy",
              body:
                "This issue tracks SEO work. The landing page should position this as a real differentiator vs Supabase / Firebase. The work needs deploy access. Suggested keyword target: Supabase alternative GDPR.",
              html_url: "https://github.com/vendor/product/issues/1",
              repository_url: "https://api.github.com/repos/vendor/product",
              comments_url: "https://api.github.com/repos/vendor/product/issues/1/comments",
              comments: 0,
              created_at: "2026-06-26T12:00:00Z",
              updated_at: "2026-06-27T12:00:00Z",
              user: { login: "vendor-founder" }
            }
          ]
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    now: new Date("2026-06-28T12:00:00Z"),
    searchLimit: 1,
    requireProfile: false
  });

  assert.equal(result.result_count, 0);
});

test("fetchDirectPainLeads expands buyer-pain searches from prompt concepts", async () => {
  const searchQueries = [];
  await fetchDirectPainLeads({
    query: "Find Firebase alternatives, Supabase alternatives, WebSocket infrastructure, cache invalidation, and simpler backend pain",
    fetchImpl: async (url) => {
      if (url.includes("/search/issues?")) {
        searchQueries.push(decodeURIComponent(new URL(url).searchParams.get("q")));
        return jsonResponse({ items: [] });
      }
      return jsonResponse({ message: "not found" }, 404);
    },
    searchLimit: 1
  });

  assert.ok(searchQueries.some((query) => query.includes("migrate from Firebase")));
  assert.ok(searchQueries.some((query) => query.includes("too expensive") && query.includes("Supabase")));
  assert.ok(searchQueries.some((query) => query.includes("WebSocket infrastructure")));
  assert.ok(searchQueries.some((query) => query.includes("stale cache")));
  assert.ok(searchQueries.some((query) => query.includes("too much plumbing") && query.includes("backend")));
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}
