import { describe, expect, test } from "vitest";
import { isRetryableGitHubError, retryDelayMsForError } from "../src/github.js";

describe("GitHub retry helpers", () => {
  test("retries secondary rate limits using Retry-After when present", () => {
    const error = {
      status: 403,
      response: {
        headers: {
          "retry-after": "2"
        }
      }
    };

    expect(isRetryableGitHubError(error)).toBe(true);
    expect(retryDelayMsForError(error, 0, { secondaryRateLimitDelayMs: 60_000 })).toBe(2_000);
  });

  test("waits until primary rate limit reset when remaining is zero", () => {
    const error = {
      status: 403,
      response: {
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "200"
        }
      }
    };

    expect(retryDelayMsForError(error, 0, { nowMs: 150_000 })).toBe(51_000);
  });

  test("backs off retryable server errors exponentially", () => {
    expect(isRetryableGitHubError({ status: 502 })).toBe(true);
    expect(retryDelayMsForError({ status: 502 }, 2, { retryBaseDelayMs: 500 })).toBe(2_000);
  });
});
