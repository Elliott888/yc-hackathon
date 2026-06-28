import { describe, expect, test } from "vitest";
import { codeSignalScoreForQuery, detectCodeSignals } from "../src/code-signals.js";

describe("code-shape signal extraction", () => {
  test("detects frontend/server state sync pain from React cache code", () => {
    const signals = detectCodeSignals(`
      useEffect(() => { fetch("/api/messages").then(loadMessages) }, [roomId])
      queryClient.invalidateQueries({ queryKey: ["messages"] })
      queryClient.setQueryData(["messages"], optimisticMessage)
      rollback optimistic update when the mutation fails
    `);

    expect(signals.map((signal) => signal.id)).toContain("frontend_server_state_sync");
    expect(signals.find((signal) => signal.id === "frontend_server_state_sync")?.code_manifestation).toMatch(
      /useEffect\(fetch|React Query invalidations|manual cache updates|optimistic update rollback/i
    );
  });

  test("detects durable AI app and workflow state pain", () => {
    const signals = detectCodeSignals(`
      Persist agent runs, conversation transcripts, tool_calls, eval traces, and generated artifacts.
      Job rows move pending -> running -> failed -> done with retries, webhook idempotency, and cron cleanup.
    `);

    expect(signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["ai_durable_state", "job_workflow_state"])
    );
  });

  test("detects schema churn and type drift from changed files and validators", () => {
    const signals = detectCodeSignals(`
      prisma migrate dev --name add_workspace_id
      db/migrations/202606_add_team_id.sql apps/web/src/types.ts
      zod validators and API response DTOs need manual transformations after adding columns.
    `);

    expect(signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["schema_churn", "multi_user_state", "type_drift"])
    );
  });

  test("does not score SSE-only evidence as a WebSocket-specific match", () => {
    const sseSignals = detectCodeSignals("Propagate SSE POST errors to callers instead of hanging.");
    const websocketSignals = detectCodeSignals("Handle WebSocket close code 1009 to prevent reconnect loop.");

    expect(codeSignalScoreForQuery("Find WebSocket infrastructure pain", sseSignals)).toBe(0);
    expect(codeSignalScoreForQuery("Find WebSocket infrastructure pain", websocketSignals)).toBeGreaterThan(0);
  });
});
