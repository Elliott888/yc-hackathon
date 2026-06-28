import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildTrackOneArtifacts, classifyBuyerIntent } from "../src/pipeline.js";
import { loadRecipe } from "../src/recipe.js";

test("builds scored Convex leads with recent evidence and bot/stale penalties", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");
  const fixture = JSON.parse(await readFile("test/fixtures/convex-github.json", "utf8"));

  const artifacts = buildTrackOneArtifacts({
    raw: fixture,
    recipe,
    now: new Date(fixture.now),
    days: 90
  });

  assert.ok(artifacts.rawEvents.length >= 4);
  assert.ok(artifacts.repoProfiles.length >= 2);
  assert.ok(artifacts.engineerProfiles.length >= 3);
  assert.ok(artifacts.profileEmbeddings.length >= 3);
  assert.ok(artifacts.scoredLeads.length >= 2);

  const [topLead] = artifacts.scoredLeads;
  assert.equal(topLead.engineer_login, "jane-sync");
  assert.equal(topLead.repo, "electric-sql/electric");
  assert.ok(topLead.score > 80);
  assert.ok(topLead.matched_topics.includes("replication"));
  assert.ok(topLead.matched_topics.includes("live query"));
  assert.ok(topLead.evidence_links.every((url) => url.startsWith("https://github.com/")));
  assert.match(topLead.outreach_angle, /Convex/);
  assert.ok(topLead.answer_context.problem_signals.includes("live query"));
  assert.ok(topLead.answer_context.stack_signals.includes("Postgres"));
  assert.ok(topLead.answer_context.evidence_snippets[0].snippet.includes("live query"));
  assert.ok(topLead.answer_context.outreach_hooks.some((hook) => hook.includes("live query")));

  const janeEmbedding = artifacts.profileEmbeddings.find((embedding) => embedding.engineer_login === "jane-sync");
  assert.ok(janeEmbedding.dimensions.some((dimension) => dimension.term === "replication"));
  assert.ok(janeEmbedding.query_similarity > 0.2);

  assert.ok(artifacts.trainingExamples.length >= artifacts.rawEvents.length);
  const positiveExample = artifacts.trainingExamples.find((example) => example.engineer_login === "jane-sync");
  assert.equal(positiveExample.label, "positive");
  assert.ok(positiveExample.evidence_text.includes("live query"));
  assert.ok(positiveExample.labels.problem_signals.includes("replication"));

  const botLead = artifacts.scoredLeads.find((lead) => lead.engineer_login === "docs-bot");
  assert.equal(botLead, undefined);

  const staleLead = artifacts.scoredLeads.find((lead) => lead.engineer_login === "old-sync");
  assert.equal(staleLead, undefined);
});

test("filters bot-like logins even when GitHub user enrichment is missing", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");
  const fixture = JSON.parse(await readFile("test/fixtures/convex-github.json", "utf8"));
  fixture.users = fixture.users.filter((user) => user.login !== "renovate[bot]");
  fixture.pull_requests.push({
    repo: "electric-sql/electric",
    number: 999,
    author_login: "renovate[bot]",
    title: "Update realtime replication dependencies",
    body: "Automated dependency update for websocket sync packages.",
    state: "closed",
    created_at: "2026-06-23T10:00:00.000Z",
    updated_at: "2026-06-23T10:00:00.000Z",
    merged_at: "2026-06-23T10:00:00.000Z",
    changed_files: ["package.json"],
    html_url: "https://github.com/electric-sql/electric/pull/999"
  });

  const artifacts = buildTrackOneArtifacts({
    raw: fixture,
    recipe,
    now: new Date(fixture.now),
    days: 90
  });

  assert.equal(
    artifacts.scoredLeads.find((lead) => lead.engineer_login === "renovate[bot]"),
    undefined
  );
});

test("does not score broad repo activity without direct problem evidence", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");
  const fixture = JSON.parse(await readFile("test/fixtures/convex-github.json", "utf8"));
  fixture.repos.push({
    full_name: "appwrite/appwrite",
    owner_login: "appwrite",
    owner_type: "Organization",
    description: "Backend-as-a-service with realtime APIs, auth, storage, functions, and database.",
    topics: ["baas", "realtime", "auth", "database"],
    language: "TypeScript",
    stars: 53000,
    forks: 4700,
    is_fork: false,
    is_archived: false,
    pushed_at: "2026-06-25T09:00:00.000Z",
    html_url: "https://github.com/appwrite/appwrite",
    readme: "Appwrite provides realtime subscriptions, auth, storage, functions, and a database."
  });
  fixture.pull_requests.push({
    repo: "appwrite/appwrite",
    number: 900,
    author_login: "security-maintainer",
    title: "fix: upgrade handlebars for CVE-2026-1234",
    body: "Dependency maintenance for a security advisory.",
    state: "closed",
    created_at: "2026-06-23T10:00:00.000Z",
    updated_at: "2026-06-23T10:00:00.000Z",
    merged_at: "2026-06-23T10:00:00.000Z",
    changed_files: ["package.json"],
    html_url: "https://github.com/appwrite/appwrite/pull/900"
  });
  fixture.users.push({
    login: "security-maintainer",
    type: "User",
    name: "Security Maintainer",
    company: null,
    location: null,
    blog: "",
    email: null,
    bio: "Dependency maintenance",
    public_repos: 12,
    followers: 30,
    html_url: "https://github.com/security-maintainer"
  });

  const artifacts = buildTrackOneArtifacts({
    raw: fixture,
    recipe,
    now: new Date(fixture.now),
    days: 90
  });

  assert.equal(
    artifacts.scoredLeads.find((lead) => lead.engineer_login === "security-maintainer"),
    undefined
  );
});

test("labels burning buyer pain separately from routine technical fit", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");
  const fixture = JSON.parse(await readFile("test/fixtures/convex-github.json", "utf8"));
  fixture.repos.push({
    full_name: "supabase/supabase-js",
    owner_login: "supabase",
    owner_type: "Organization",
    description: "JavaScript client for Supabase auth, database, and realtime subscriptions.",
    topics: ["supabase", "realtime", "websocket", "database"],
    language: "TypeScript",
    stars: 7600,
    forks: 1100,
    is_fork: false,
    is_archived: false,
    pushed_at: "2026-06-25T09:00:00.000Z",
    html_url: "https://github.com/supabase/supabase-js",
    readme: "Supabase realtime subscriptions over WebSocket for full-stack apps."
  });
  fixture.issues.push({
    repo: "supabase/supabase-js",
    number: 711,
    author_login: "burning-founder",
    title: "Realtime drops updates in production and we need a simpler backend",
    body:
      "Our users lose realtime updates after reconnects fail in production. We are blocked and looking for a Firebase or Supabase alternative with less backend complexity.",
    state: "open",
    created_at: "2026-06-24T10:00:00.000Z",
    updated_at: "2026-06-24T10:00:00.000Z",
    html_url: "https://github.com/supabase/supabase-js/issues/711"
  });
  fixture.pull_requests.push({
    repo: "supabase/supabase-js",
    number: 712,
    author_login: "routine-contributor",
    title: "Forward response headers on WebSocket upgrade",
    body: "Forward headers for WebSocket upgrade compatibility.",
    state: "closed",
    created_at: "2026-06-24T10:00:00.000Z",
    updated_at: "2026-06-24T10:00:00.000Z",
    merged_at: "2026-06-24T10:00:00.000Z",
    changed_files: ["src/realtime.ts"],
    html_url: "https://github.com/supabase/supabase-js/pull/712"
  });
  fixture.users.push(
    {
      login: "burning-founder",
      type: "User",
      name: "Burning Founder",
      company: "Realtime App",
      location: null,
      blog: "",
      email: null,
      bio: "Building a production realtime app",
      public_repos: 8,
      followers: 50,
      html_url: "https://github.com/burning-founder"
    },
    {
      login: "routine-contributor",
      type: "User",
      name: "Routine Contributor",
      company: null,
      location: null,
      blog: "",
      email: null,
      bio: "Maintainer",
      public_repos: 12,
      followers: 20,
      html_url: "https://github.com/routine-contributor"
    }
  );

  const artifacts = buildTrackOneArtifacts({
    raw: fixture,
    recipe,
    now: new Date(fixture.now),
    days: 90
  });

  const burningExample = artifacts.trainingExamples.find(
    (example) => example.engineer_login === "burning-founder"
  );
  const routineExample = artifacts.trainingExamples.find(
    (example) => example.engineer_login === "routine-contributor"
  );

  assert.equal(burningExample.buyer_intent_label, "burning_problem");
  assert.ok(burningExample.pain_score >= 0.75);
  assert.ok(burningExample.labels.pain_signals.includes("production impact"));
  assert.ok(burningExample.labels.pain_signals.includes("alternative intent"));

  assert.equal(routineExample.buyer_intent_label, "technical_fit_only");
  assert.ok(routineExample.pain_score <= 0.25);

  const burningLead = artifacts.scoredLeads.find((lead) => lead.engineer_login === "burning-founder");
  assert.ok(burningLead.answer_context.burning_problem_score >= 0.75);
  assert.ok(burningLead.recent_activity[0].pain_signals.includes("production impact"));
  assert.ok(burningLead.recent_activity[0].snippet.includes("users lose realtime updates"));
});

test("does not treat product terminology as production pain", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");
  const intent = classifyBuyerIntent(
    {
      type: "merged_pull_request",
      title: "Fix product analytics feature flag attribution",
      text: "Product analytics event ingestion with feature flags and attribution funnels.",
      matched_terms: ["analytics", "feature flag", "attribution"]
    },
    recipe
  );

  assert.equal(intent.pain_signals.includes("production impact"), false);
  assert.notEqual(intent.label, "burning_problem");
});

test("does not treat production-ready implementation copy as production incident pain", async () => {
  const recipe = await loadRecipe("recipes/convex.yaml");
  const intent = classifyBuyerIntent(
    {
      type: "opened_pull_request",
      title: "Add production-ready SQLite backend implementation",
      text: "This introduces a production-ready backend with realtime subscriptions and comprehensive tests.",
      matched_terms: ["realtime", "subscriptions", "websocket"]
    },
    recipe
  );

  assert.equal(intent.pain_signals.includes("production impact"), false);
  assert.notEqual(intent.label, "burning_problem");
});
