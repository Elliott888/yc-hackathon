import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { pathsFor, readJsonl } from "./io.js";
import { evaluateLeads } from "./eval.js";
import { readRecipe } from "./recipe.js";
import { buildQueryPlan, compareSearchBaselines, searchLeads } from "./search.js";
import type { RankedLead } from "./types.js";

export type TrackBServerOptions = {
  rootDir?: string;
};

export function createTrackBServer(options: TrackBServerOptions = {}): Server {
  return createServer(async (request, response) => {
    try {
      await route(request, response, options);
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message });
    }
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: TrackBServerOptions
) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, 200, renderAppHtml());
    return;
  }

  if (request.method === "POST" && url.pathname === "/search") {
    const body = await readBody<{ query?: string; limit?: number }>(request);
    if (!body.query) {
      sendJson(response, 400, { error: "Missing query" });
      return;
    }
    sendJson(response, 200, await searchLeads({ rootDir: options.rootDir, query: body.query, limit: body.limit ?? 10 }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/compare") {
    const body = await readBody<{ query?: string; limit?: number }>(request);
    if (!body.query) {
      sendJson(response, 400, { error: "Missing query" });
      return;
    }
    sendJson(
      response,
      200,
      await compareSearchBaselines({ rootDir: options.rootDir, query: body.query, limit: body.limit ?? 10 })
    );
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/lead/")) {
    const login = decodeURIComponent(url.pathname.replace("/lead/", ""));
    const paths = pathsFor(options.rootDir);
    const leads = await readJsonl<RankedLead>(paths.processed.rankedLeads, true);
    const lead = leads.find((candidate) => candidate.engineer_login === login);
    sendJson(response, lead ? 200 : 404, lead ?? { error: "Lead not found" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/evaluate") {
    sendJson(
      response,
      200,
      await evaluateLeads({
        rootDir: options.rootDir,
        query: url.searchParams.get("query") ?? undefined,
        queryId: url.searchParams.get("query_id") ?? undefined,
        kValues: parseKValues(url.searchParams.get("k"))
      })
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/query-plan") {
    const query = url.searchParams.get("query") ?? "";
    const recipe = await readRecipe(options.rootDir);
    sendJson(response, 200, buildQueryPlan(query, recipe));
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim().length === 0 ? ({} as T) : (JSON.parse(text) as T);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

function sendHtml(response: ServerResponse, statusCode: number, body: string) {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function parseKValues(value: string | null): number[] | undefined {
  if (!value) {
    return undefined;
  }
  const kValues = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part) && part > 0);
  return kValues.length > 0 ? kValues : undefined;
}

function renderAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GitHub Intent Engine</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #12161f;
      --muted: #626b7a;
      --line: #d8dde5;
      --accent: #1769e0;
      --accent-strong: #0f4fb0;
      --chip: #eef3fb;
      --ok: #127a46;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1280px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 36px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 16px;
      align-items: start;
    }
    .toolbar {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 112px;
      gap: 10px;
    }
    input {
      width: 100%;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      color: var(--ink);
      background: #fff;
      font: inherit;
    }
    button {
      height: 42px;
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }
    button:hover { background: var(--accent-strong); }
    .preset-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    button.preset {
      width: auto;
      height: 32px;
      border: 1px solid var(--line);
      background: #fff;
      color: #244365;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 650;
    }
    button.preset:hover {
      background: var(--chip);
      color: var(--accent-strong);
    }
    button.proof-button {
      width: 100%;
      border: 1px solid var(--line);
      background: #fff;
      color: #244365;
      font-size: 13px;
    }
    button.proof-button:hover {
      background: var(--chip);
      color: var(--accent-strong);
    }
    .lead-list {
      display: grid;
      gap: 10px;
    }
    .lead {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      cursor: pointer;
    }
    .lead:hover {
      border-color: #a9bddb;
    }
    .lead-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      margin-bottom: 8px;
    }
    .login {
      font-size: 18px;
      font-weight: 750;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .repo {
      margin-top: 3px;
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .score {
      min-width: 62px;
      border-radius: 6px;
      border: 1px solid #c9d9f4;
      background: #f2f7ff;
      color: var(--accent-strong);
      padding: 6px 8px;
      text-align: center;
      font-weight: 750;
    }
    .why {
      margin: 8px 0;
      color: #252b36;
      line-height: 1.45;
      font-size: 14px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 10px 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 0 8px;
      border-radius: 6px;
      background: var(--chip);
      color: #244365;
      font-size: 12px;
      font-weight: 600;
    }
    .evidence {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .evidence a {
      color: var(--accent-strong);
      font-size: 13px;
      text-decoration: none;
      overflow-wrap: anywhere;
    }
    .side {
      position: sticky;
      top: 16px;
      display: grid;
      gap: 12px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 15px;
      letter-spacing: 0;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
    }
    .metric strong {
      display: block;
      color: var(--ink);
      font-size: 18px;
    }
    .metric span {
      color: var(--muted);
      font-size: 12px;
    }
    .baseline-list {
      display: grid;
      gap: 8px;
    }
    .baseline-row {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
    }
    .baseline-row strong {
      display: block;
      margin-bottom: 4px;
      font-size: 13px;
    }
    .baseline-row span {
      color: var(--muted);
      display: block;
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .detail-empty {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .detail-title {
      margin: 0 0 6px;
      font-size: 18px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .detail-section {
      margin-top: 12px;
    }
    .detail-section h3 {
      margin: 0 0 6px;
      font-size: 13px;
    }
    .breakdown {
      display: grid;
      gap: 5px;
    }
    .breakdown-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 860px) {
      main { width: min(100vw - 20px, 760px); padding-top: 14px; }
      header { align-items: flex-start; flex-direction: column; }
      .layout { grid-template-columns: 1fr; }
      .side { position: static; }
      form { grid-template-columns: 1fr; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>GitHub Intent Engine</h1>
      <div class="status" id="status">Ready</div>
    </header>
    <div class="layout">
      <section>
        <div class="toolbar">
          <form id="search-form">
            <input id="query" name="query" value="Find founders or backend/full-stack engineers who look like potential buyers for Convex: people publicly struggling with cache invalidation, React Query invalidations, WebSocket/SSE subscriptions, Firebase or Supabase limits, schema churn, optimistic updates, or wanting simpler durable backend state for AI/product apps. Prioritize recent issues, PRs, or comments that show a burning problem, not docs-only activity." autocomplete="off">
            <button type="submit">Search</button>
          </form>
          <div class="preset-list" id="preset-list">
            <button class="preset" type="button" data-query-id="convex_cache_websocket_baas_prompt" data-query="Find founders or backend/full-stack engineers who look like potential buyers for Convex: people publicly struggling with cache invalidation, React Query invalidations, WebSocket/SSE subscriptions, Firebase or Supabase limits, schema churn, optimistic updates, or wanting simpler durable backend state for AI/product apps. Prioritize recent issues, PRs, or comments that show a burning problem, not docs-only activity.">Convex Buyer</button>
            <button class="preset" type="button" data-query-id="" data-query="Find AI engineering teams or devtool founders who look like potential buyers for Lore: people running into Claude, Codex, or Cursor context limits, MCP server sprawl, agent handoff failures, lost repo context in monorepos, code review agent problems, or collaborative AI coding workflows. Prioritize recent issues, PRs, or comments that show team workflow pain.">Lore Buyer</button>
            <button class="preset" type="button" data-query-id="" data-query="Find growth engineers or product engineers who look like potential buyers for Lopus: people struggling with real-time product analytics, event ingestion quality, attribution, activation funnels, feature flags, ClickHouse, PostHog, GrowthBook, RudderStack, Snowplow, reverse ETL, or debugging event data. Prioritize recent GitHub evidence of burning operational analytics problems.">Lopus Buyer</button>
            <button class="preset" type="button" data-query-id="" data-query="Find AI engineers or platform teams who look like potential buyers for OpenAI: people building agents, tool calling, streaming UX, evals, structured outputs, RAG/vector stores, model routing, Vercel AI SDK, LangChain, or LlamaIndex integrations, and complaining about latency, reliability, eval quality, or model capability gaps. Prioritize production AI app pain.">OpenAI Buyer</button>
            <button class="preset" type="button" data-query-id="" data-query="Find devtool founders or founder-led sales/GTM teams who look like potential buyers for Orange Slice: people using spreadsheets, Airtable, Clay, HubSpot, Salesforce, GitHub or LinkedIn enrichment, outbound personalization, CRM cleanup, or manual lead research workflows. Prioritize public repos, issues, or automation scripts showing prospecting workflow pain.">Orange Slice Buyer</button>
            <button class="preset" type="button" data-query-id="convex_cache_websocket_baas_prompt" data-query="Find engineers comparing Firebase, Supabase, Appwrite, PocketBase, Parse, Hasura, or custom Postgres APIs because they need simpler full-stack backend state, realtime subscriptions, cache invalidation, auth-aware CRUD, or durable AI app state. Prioritize evidence where alternatives are causing active implementation pain.">Cache + BaaS Alternatives</button>
            <button class="preset" type="button" data-query-id="convex_realtime_sync_engineers" data-query="Find engineers who have been actively contributing to live query, reactive database, and realtime sync repos in the last 90 days.">Live Query Engineers</button>
            <button class="preset" type="button" data-query-id="convex_realtime_sync_engineers" data-query="Find engineers contributing to CRDT, local-first sync, conflict resolution, or offline-first collaboration infrastructure.">CRDT + Local-First</button>
            <button class="preset" type="button" data-query-id="convex_cache_websocket_baas_prompt" data-query="Find BaaS engineers working on realtime infrastructure, WebSocket subscriptions, or simpler serverless backend state.">BaaS Realtime Infra</button>
          </div>
        </div>
        <div class="lead-list" id="lead-list"></div>
      </section>
      <aside class="side">
        <section class="panel">
          <h2>Query Plan</h2>
          <pre id="query-plan">{}</pre>
        </section>
        <section class="panel">
          <h2>Evaluation</h2>
          <div class="metrics" id="metrics"></div>
        </section>
        <section class="panel">
          <h2>Baseline Comparison</h2>
          <div class="baseline-list" id="baseline-comparison"></div>
        </section>
        <section class="panel">
          <h2>Lead Detail</h2>
          <div id="lead-detail"><p class="detail-empty">Select a lead.</p></div>
        </section>
      </aside>
    </div>
  </main>
  <script>
    const form = document.getElementById("search-form");
    const input = document.getElementById("query");
    const list = document.getElementById("lead-list");
    const plan = document.getElementById("query-plan");
    const status = document.getElementById("status");
    const metrics = document.getElementById("metrics");
    const presets = document.getElementById("preset-list");
    const baseline = document.getElementById("baseline-comparison");
    const detail = document.getElementById("lead-detail");
    let activeQueryId = "convex_cache_websocket_baas_prompt";
    let activeQuery = input.value;
    let searchRunId = 0;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      activeQueryId = "";
      runSearch(input.value, activeQueryId);
    });

    presets.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-query]");
      if (!button) return;
      input.value = button.dataset.query;
      activeQueryId = button.dataset.queryId || "";
      runSearch(input.value, activeQueryId);
    });

    list.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const lead = event.target.closest("[data-login]");
      if (!lead) return;
      loadLeadDetail(lead.dataset.login);
    });

    baseline.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-proof]");
      if (!button) return;
      const query = activeQuery;
      const queryId = activeQueryId;
      loadAuxiliaryPanels(query, queryId);
    });

    async function runSearch(query, queryId) {
      const runId = ++searchRunId;
      activeQuery = query;
      activeQueryId = queryId;
      status.textContent = "Searching";
      list.innerHTML = "";
      plan.textContent = "Loading query plan...";
      metrics.innerHTML = '<p class="detail-empty">Evaluation waits for results.</p>';
      baseline.innerHTML = '<p class="detail-empty">Baseline comparison waits for results.</p>';
      detail.innerHTML = '<p class="detail-empty">Select a lead.</p>';
      loadQueryPlan(query, runId);
      try {
        const data = await fetchJson("/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, limit: 10 })
        });
        if (runId !== searchRunId) return;
        renderSearchResults(data);
        renderProofPrompt();
        status.textContent = data.results.length + " results";
      } catch (error) {
        if (runId !== searchRunId) return;
        status.textContent = "Search failed";
        list.innerHTML = '<p class="detail-empty">Search failed: ' + escapeHtml(error.message || "check server logs") + '</p>';
      }
    }

    async function fetchJson(path, options) {
      const response = await fetch(path, options);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    async function loadQueryPlan(query, runId) {
      try {
        const queryPlan = await fetchJson("/query-plan?query=" + encodeURIComponent(query));
        if (runId !== searchRunId) return;
        plan.textContent = JSON.stringify(queryPlan, null, 2);
      } catch (error) {
        if (runId !== searchRunId) return;
        plan.textContent = JSON.stringify({ error: "query plan unavailable" }, null, 2);
      }
    }

    function renderSearchResults(data) {
      plan.textContent = JSON.stringify(data.query_plan, null, 2);
      list.innerHTML = data.results.map(renderLead).join("");
    }

    function renderProofPrompt() {
      metrics.innerHTML = '<p class="detail-empty">Evaluation not run yet.</p>';
      baseline.innerHTML = '<button class="proof-button" type="button" data-proof>Run proof</button>';
    }

    async function loadAuxiliaryPanels(query, queryId) {
      const runId = searchRunId;
      const previousStatus = status.textContent;
      status.textContent = "Building proof";
      metrics.innerHTML = '<p class="detail-empty">Evaluating ranked leads...</p>';
      baseline.innerHTML = '<p class="detail-empty">Comparing keyword, semantic, and intent ranking...</p>';
      try {
        const comparison = await fetchJson("/compare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, limit: 5 })
        });
        if (runId !== searchRunId) return;
        const evalPath = "/evaluate?query=" + encodeURIComponent(query) +
          (queryId ? "&query_id=" + encodeURIComponent(queryId) : "");
        const evaluation = await fetchJson(evalPath);
        if (runId !== searchRunId) return;
        renderBaselines(comparison, evaluation);
        renderMetrics(evaluation);
        status.textContent = previousStatus || "Proof ready";
      } catch (error) {
        if (runId !== searchRunId) return;
        status.textContent = "Proof failed";
        baseline.innerHTML = '<p class="detail-empty">Baseline comparison unavailable.</p>';
        metrics.innerHTML = '<p class="detail-empty">Evaluation unavailable.</p>';
      }
    }

    async function loadLeadDetail(login) {
      const response = await fetch("/lead/" + encodeURIComponent(login));
      if (!response.ok) return;
      const lead = await response.json();
      detail.innerHTML = renderLeadDetail(lead);
    }

    function renderMetrics(data) {
      metrics.innerHTML = Object.entries(data.metrics || {}).slice(0, 4).map(([key, value]) =>
        '<div class="metric"><strong>' + value + '</strong><span>' + escapeHtml(key.replaceAll("_", " ")) + '</span></div>'
      ).join("");
    }

    function renderBaselines(comparison, evaluation) {
      const modes = ["keyword", "semantic", "intent"];
      baseline.innerHTML = modes.map((mode) => {
        const row = comparison.baselines[mode];
        const metric = evaluation.baseline_metrics?.[mode]?.precision_at_10 ?? evaluation.baseline_metrics?.[mode]?.precision_at_5 ?? "";
        const top = row.results.slice(0, 3).map((lead) => lead.engineer_login).join(", ");
        return '<div class="baseline-row"><strong>' + escapeHtml(row.label) + '</strong>' +
          '<span>Top: ' + escapeHtml(top || "none") + '</span>' +
          '<span>Precision: ' + escapeHtml(metric) + '</span></div>';
      }).join("");
    }

    function renderLead(lead) {
      const evidence = lead.evidence.slice(0, 3).map((item) =>
        '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(item.type + ": " + item.title) + '</a>'
      ).join("");
      const chips = [...lead.top_topics.slice(0, 5), ...lead.repo_categories.slice(0, 2)].map((chip) =>
        '<span class="chip">' + escapeHtml(chip) + '</span>'
      ).join("");
      return '<article class="lead" data-login="' + escapeHtml(lead.engineer_login) + '">' +
        '<div class="lead-head"><div><div class="login">' + escapeHtml(lead.engineer_login) + '</div>' +
        '<div class="repo">' + escapeHtml(lead.top_repos[0] || "") + '</div></div>' +
        '<div class="score">' + Math.round(lead.final_score) + '</div></div>' +
        '<p class="why">' + escapeHtml(lead.why_relevant) + '</p>' +
        '<div class="chips">' + chips + '</div>' +
        '<div class="evidence">' + evidence + '</div>' +
      '</article>';
    }

    function renderLeadDetail(lead) {
      const breakdown = Object.entries(lead.score_breakdown || {}).map(([key, value]) =>
        '<div class="breakdown-row"><span>' + escapeHtml(key.replaceAll("_", " ")) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
      ).join("");
      const evidence = (lead.evidence || []).slice(0, 6).map((item) =>
        '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer">' +
        escapeHtml(item.type + ": " + item.title) + '</a>'
      ).join("");
      const topics = (lead.top_topics || []).slice(0, 8).map((topic) =>
        '<span class="chip">' + escapeHtml(topic) + '</span>'
      ).join("");
      const problemSignals = (lead.answer_context?.problem_signals || []).slice(0, 8).map((signal) =>
        '<span class="chip">' + escapeHtml(signal) + '</span>'
      ).join("");
      const stackSignals = (lead.answer_context?.stack_signals || []).slice(0, 8).map((signal) =>
        '<span class="chip">' + escapeHtml(signal) + '</span>'
      ).join("");
      const outreachHooks = (lead.answer_context?.outreach_hooks || []).slice(0, 4).map((hook) =>
        '<p class="detail-empty">' + escapeHtml(hook) + '</p>'
      ).join("");
      return '<div class="detail-title">' + escapeHtml(lead.engineer_login) + '</div>' +
        '<div class="repo">' + escapeHtml((lead.top_repos || [])[0] || "") + '</div>' +
        '<p class="why">' + escapeHtml(lead.outreach_angle || lead.why_relevant || "") + '</p>' +
        '<div class="chips">' + topics + '</div>' +
        '<div class="detail-section"><h3>Problem Signals</h3><div class="chips">' + problemSignals + '</div></div>' +
        '<div class="detail-section"><h3>Stack Signals</h3><div class="chips">' + stackSignals + '</div></div>' +
        '<div class="detail-section"><h3>Outreach Hooks</h3>' + outreachHooks + '</div>' +
        '<div class="detail-section"><h3>Score Breakdown</h3><div class="breakdown">' + breakdown + '</div></div>' +
        '<div class="detail-section"><h3>Evidence</h3><div class="evidence">' + evidence + '</div></div>';
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

    function initializeDefaultQueryPlan() {
      metrics.innerHTML = '<p class="detail-empty">Run a search to evaluate results.</p>';
      baseline.innerHTML = '<p class="detail-empty">Run a search to compare baselines.</p>';
      loadQueryPlan(input.value, searchRunId);
    }

    initializeDefaultQueryPlan();
  </script>
</body>
</html>`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8787);
  createTrackBServer({ rootDir: process.cwd() }).listen(port, () => {
    process.stdout.write(`Track B intelligence API listening on http://localhost:${port}\n`);
  });
}
