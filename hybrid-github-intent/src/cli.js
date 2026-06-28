#!/usr/bin/env node
import { BUYER_PROFILES, buyerProfileIds, resolveBuyerProfile } from "./buyer-profiles.js";
import { searchHybrid, DEFAULT_NEURAL_LEADS, DEFAULT_STRUCTURED_ROOT } from "./engine.js";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (command === "buyers" || args["list-buyers"] === "true") {
  console.log(JSON.stringify(Object.values(BUYER_PROFILES).map(({ id, label, product, query }) => ({
    id,
    label,
    product,
    query
  })), null, 2));
  process.exit(0);
}

if (command !== "search") {
  console.error("Usage: node src/cli.js search --query <query> [--buyer convex|lore|lopus|openai|orange-slice] [--all-indexes] [--limit 10]");
  console.error(`Known buyer profiles: ${buyerProfileIds().join(", ")}`);
  process.exit(1);
}

try {
  const buyerProfile = resolveBuyerProfile({ buyer: args.buyer, query: args.query });
  const result = await searchHybrid({
    query: args.query ?? buyerProfile.query,
    buyerProfile,
    structuredRoot: args["structured-root"] ?? DEFAULT_STRUCTURED_ROOT,
    neuralLeadsPath: args["neural-leads"] ?? DEFAULT_NEURAL_LEADS,
    useAllIndexes: args["all-indexes"] === "true",
    limit: Number(args.limit ?? 10),
    requireProfile: args["allow-empty-profile"] !== "true"
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : "true";
  }
  return parsed;
}
