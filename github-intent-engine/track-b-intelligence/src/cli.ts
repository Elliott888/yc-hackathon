import { Command } from "commander";
import { createBuyerQuery, loadBuyerCatalog, summarizeBuyerSearch } from "./buyers.js";
import { evaluateLeads } from "./eval.js";
import { importTrackOneLeads } from "./import-track1.js";
import { buildIntelligence } from "./pipeline.js";
import { searchLeads } from "./search.js";

const program = new Command();

program
  .name("track-b-intelligence")
  .description("Build, search, and evaluate Convex-oriented GitHub intent leads");

program
  .command("build")
  .option("--root <dir>", "workspace root")
  .action(async (options: { root?: string }) => {
    const result = await buildIntelligence({ rootDir: options.root });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("import-track1")
  .description("Import neural Track 1 scored_leads.ndjson into Track B search artifacts")
  .option("--root <dir>", "workspace root")
  .option("--source <file>", "Track 1 scored_leads.ndjson path")
  .option("--model <file>", "Track 1 neural_reranker.json model path")
  .action(async (options: { root?: string; source?: string; model?: string }) => {
    const result = await importTrackOneLeads({
      rootDir: options.root,
      sourcePath: options.source,
      modelPath: options.model
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("search")
  .argument("[query...]", "natural-language sales query")
  .option("--root <dir>", "workspace root")
  .option("--limit <n>", "max results", "10")
  .action(async (queryParts: string[], options: { root?: string; limit: string }) => {
    const query = queryParts.join(" ").trim();
    if (!query) {
      throw new Error("Missing search query");
    }
    const result = await searchLeads({
      rootDir: options.root,
      query,
      limit: Number(options.limit)
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("eval")
  .option("--root <dir>", "workspace root")
  .option("--query <query>", "natural-language query to evaluate")
  .option("--query-id <id>", "golden-label query id")
  .action(async (options: { root?: string; query?: string; queryId?: string }) => {
    const result = await evaluateLeads({
      rootDir: options.root,
      query: options.query,
      queryId: options.queryId
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("buyer-report")
  .description("Run buyer-specific search prompts and summarize lead quality")
  .option("--root <dir>", "workspace root")
  .option("--buyer <id>", "single buyer id or comma-separated buyer ids")
  .option("--limit <n>", "max results per buyer", "10")
  .action(async (options: { root?: string; buyer?: string; limit: string }) => {
    const buyers = await loadBuyerCatalog();
    const selectedBuyerIds = new Set(
      (options.buyer ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    const selectedBuyers =
      selectedBuyerIds.size === 0
        ? buyers
        : buyers.filter((buyer) => selectedBuyerIds.has(buyer.id));
    if (selectedBuyerIds.size > 0 && selectedBuyers.length === 0) {
      throw new Error(`No buyers matched: ${[...selectedBuyerIds].join(", ")}`);
    }

    const reports = [];
    for (const buyer of selectedBuyers) {
      const query = createBuyerQuery(buyer);
      const search = await searchLeads({
        rootDir: options.root,
        query,
        limit: Number(options.limit)
      });
      reports.push(summarizeBuyerSearch(buyer, search, Number(options.limit)));
    }

    console.log(JSON.stringify({ reports }, null, 2));
  });

await program.parseAsync();
